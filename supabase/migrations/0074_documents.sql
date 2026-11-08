-- =============================================================
-- 0074 — المرحلة ح: الوثائق والإقامات والتأشيرات
--   1) employee_documents يصبح سجل وثائق الموارد البشرية الموحّد: وثائق
--      الموظفين + وثائق العمالة (worker_profiles) — لا جدول جديد لمفهوم موجود.
--   2) تعطيل بدل حذف (is_active) + سجل تجديد (superseded_by) + تكلفة التجديد.
--   3) مهلة تنبيه الانتهاء قابلة للتعديل (app_config.doc_expiry_alert_days).
--   4) RLS بنطاق الفرع للعمالة، ومنع الحذف النهائي، وربط مسار الملف بصاحبه.
--   5) renew_document: تجديد = نسخة جديدة والقديمة تُؤرشف.
--   6) post_document_cost: تكلفة التجديد مصروف «رسوم حكومية» مدين / بنك دائن.
--   7) Storage: حاوية خاصة hr-documents بسياسات مرتبطة بصلاحيات الوثيقة.
-- =============================================================

-- ---------- 1) columns ---------------------------------------------------------
alter table employee_documents alter column employee_id drop not null;
alter table employee_documents
  add column if not exists worker_id     uuid references worker_profiles(id) on delete cascade,
  add column if not exists is_active     boolean not null default true,
  add column if not exists superseded_by uuid references employee_documents(id) on delete set null,
  add column if not exists renewal_cost  numeric(12,2) not null default 0,
  add column if not exists cost_entry_id uuid references journal_entries(id) on delete set null,
  add column if not exists notes         text,
  add column if not exists mime_type     text,
  add column if not exists file_size     integer,
  add column if not exists created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  add column if not exists updated_at    timestamptz not null default now();

alter table employee_documents drop constraint if exists employee_documents_owner_chk;
alter table employee_documents add constraint employee_documents_owner_chk
  check (num_nonnulls(employee_id, worker_id) = 1);
alter table employee_documents drop constraint if exists employee_documents_cost_chk;
alter table employee_documents add constraint employee_documents_cost_chk
  check (renewal_cost >= 0);
alter table employee_documents drop constraint if exists employee_documents_dates_chk;
alter table employee_documents add constraint employee_documents_dates_chk
  check (issue_date is null or expiry_date is null or expiry_date > issue_date) not valid;
alter table employee_documents drop constraint if exists employee_documents_size_chk;
alter table employee_documents add constraint employee_documents_size_chk
  check (file_size is null or file_size between 1 and 10485760);

create index if not exists idx_emp_docs_worker on employee_documents(worker_id) where worker_id is not null;

-- ---------- 2) configurable alert window --------------------------------------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('doc_expiry_alert_days', 'التنبيه قبل انتهاء الوثائق والإقامات', 'الموارد البشرية', 60, 'يوم', 40)
on conflict (key) do nothing;

alter table app_config drop constraint if exists app_config_doc_alert_chk;
alter table app_config add constraint app_config_doc_alert_chk
  check (key <> 'doc_expiry_alert_days' or value between 1 and 365);

-- HR managers tune their own group's settings (admin keeps everything)
drop policy if exists cfg_hr_update on app_config;
create policy cfg_hr_update on app_config for update to authenticated
  using (has_perm('hr','manage') and grp = 'الموارد البشرية')
  with check (has_perm('hr','manage') and grp = 'الموارد البشرية');

drop trigger if exists trg_audit_row on app_config;
create trigger trg_audit_row after insert or update or delete on app_config
  for each row execute function audit_row_change();

create or replace function doc_alert_days() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select value::integer from app_config where key = 'doc_expiry_alert_days'), 60)
$$;
create or replace function hr_doc_status(p_expiry date) returns text
language sql stable set search_path = public as $$
  select doc_expiry_status(p_expiry, doc_alert_days())
$$;

-- ---------- 3) scope helpers ---------------------------------------------------
create or replace function worker_in_my_branch(p_worker uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_cross_branch()
      or exists (select 1 from worker_profiles w where w.id = p_worker and in_my_branch(w.branch_id))
$$;

create or replace function hr_doc_visible(p_employee uuid, p_worker uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_employee is not null then hr_can_see(p_employee)
    when p_worker   is not null then has_perm('hr','view') and worker_in_my_branch(p_worker)
    else false end
$$;

create or replace function hr_doc_writable(p_employee uuid, p_worker uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_perm('hr','manage') and case
    when p_employee is not null then hr_in_scope(p_employee)
    when p_worker   is not null then worker_in_my_branch(p_worker)
    else false end
$$;

-- storage path convention: employee/<uuid>/<file> · worker/<uuid>/<file>
create or replace function hr_doc_path_owner(p_path text, out p_employee uuid, out p_worker uuid)
language plpgsql immutable as $$
declare v_kind text := split_part(p_path, '/', 1); v_id text := split_part(p_path, '/', 2);
begin
  if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_path, '/', 3) = '' then return; end if;
  if v_kind = 'employee' then p_employee := v_id::uuid;
  elsif v_kind = 'worker' then p_worker := v_id::uuid; end if;
end $$;

create or replace function hr_doc_path_visible(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select hr_doc_visible(o.p_employee, o.p_worker) from hr_doc_path_owner(p_path) o
$$;
create or replace function hr_doc_path_writable(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select hr_doc_writable(o.p_employee, o.p_worker) from hr_doc_path_owner(p_path) o
$$;

grant execute on function doc_alert_days(), hr_doc_status(date), worker_in_my_branch(uuid),
  hr_doc_visible(uuid, uuid), hr_doc_writable(uuid, uuid), hr_doc_path_owner(text),
  hr_doc_path_visible(text), hr_doc_path_writable(text) to authenticated;

-- ---------- 4) RLS: read by scope, write by hr.manage + scope, never delete ----
drop policy if exists emp_docs_read   on employee_documents;
drop policy if exists emp_docs_write  on employee_documents;
drop policy if exists emp_docs_insert on employee_documents;
drop policy if exists emp_docs_update on employee_documents;
create policy emp_docs_read on employee_documents for select to authenticated
  using (hr_doc_visible(employee_id, worker_id));
create policy emp_docs_insert on employee_documents for insert to authenticated
  with check (hr_doc_writable(employee_id, worker_id));
create policy emp_docs_update on employee_documents for update to authenticated
  using (hr_doc_writable(employee_id, worker_id))
  with check (hr_doc_writable(employee_id, worker_id));
-- no delete policy: «حذف» = تعطيل (is_active = false)

create or replace function guard_employee_document() returns trigger
language plpgsql set search_path = public as $$
declare v_prefix text;
begin
  if tg_op = 'UPDATE' then
    if new.employee_id is distinct from old.employee_id or new.worker_id is distinct from old.worker_id then
      raise exception 'لا يمكن نقل الوثيقة إلى شخص آخر' using errcode = '42501';
    end if;
    if old.cost_entry_id is not null and (new.renewal_cost is distinct from old.renewal_cost
       or new.cost_entry_id is distinct from old.cost_entry_id) then
      raise exception 'تكلفة الوثيقة مُرحَّلة محاسبيًا ولا تُعدَّل' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  if new.file_path is not null then
    v_prefix := case when new.employee_id is not null then 'employee/' || new.employee_id
                     else 'worker/' || new.worker_id end || '/';
    if left(new.file_path, length(v_prefix)) <> v_prefix then
      raise exception 'مسار الملف لا يخص صاحب الوثيقة' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_employee_document on employee_documents;
create trigger trg_guard_employee_document before insert or update on employee_documents
  for each row execute function guard_employee_document();

-- ---------- 5) renewal = new version, old one archived -----------------------
create or replace function renew_document(
  p_id uuid, p_doc_number text, p_issue date, p_expiry date, p_cost numeric default 0,
  p_file_path text default null, p_file_name text default null,
  p_mime_type text default null, p_file_size integer default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d employee_documents%rowtype; v_new uuid;
begin
  select * into d from employee_documents where id = p_id for update;
  if not found then raise exception 'الوثيقة غير موجودة'; end if;
  if not hr_doc_writable(d.employee_id, d.worker_id) then
    raise exception 'تجديد الوثائق من صلاحية إدارة الموارد البشرية' using errcode = '42501';
  end if;
  if not d.is_active then raise exception 'الوثيقة معطّلة — أعد تفعيلها أولاً'; end if;
  if d.superseded_by is not null then raise exception 'الوثيقة جُدِّدت سابقًا'; end if;
  if p_expiry is null then raise exception 'حدّد تاريخ الانتهاء الجديد'; end if;
  if d.expiry_date is not null and p_expiry <= d.expiry_date then
    raise exception 'تاريخ الانتهاء الجديد يجب أن يكون بعد الحالي (%)', d.expiry_date;
  end if;
  if coalesce(p_cost, 0) < 0 then raise exception 'التكلفة لا تكون سالبة'; end if;

  insert into employee_documents (employee_id, worker_id, type, doc_number, issue_date, expiry_date,
    renewal_cost, file_path, file_name, mime_type, file_size, notes)
  values (d.employee_id, d.worker_id, d.type, coalesce(nullif(trim(p_doc_number), ''), d.doc_number),
    coalesce(p_issue, current_date), p_expiry, coalesce(p_cost, 0),
    p_file_path, p_file_name, p_mime_type, p_file_size, p_notes)
  returning id into v_new;
  update employee_documents set superseded_by = v_new where id = p_id;
  return v_new;
end $$;

-- ---------- 6) renewal cost → accounting -------------------------------------
insert into chart_of_accounts (code, name_ar, type, parent_id, normal_balance) values
  ('5160', 'الرسوم الحكومية (إقامات وتأشيرات ورخص عمل)', 'expense', acc_id('5000'), 'debit')
on conflict (code) do nothing;

create or replace function post_document_cost(p_id uuid, p_paid_on date, p_bank_code text default '1112')
returns uuid language plpgsql security definer set search_path = public as $$
declare d employee_documents%rowtype; v_entry uuid; v_branch uuid; v_who text;
begin
  if not has_acc_perm('bank','post') then
    raise exception 'ترحيل رسوم الوثائق من صلاحية المحاسبة' using errcode = '42501';
  end if;
  select * into d from employee_documents where id = p_id for update;
  if not found then raise exception 'الوثيقة غير موجودة'; end if;
  if d.cost_entry_id is not null then return d.cost_entry_id; end if;   -- idempotent
  if d.renewal_cost <= 0 then raise exception 'لا توجد تكلفة لترحيلها'; end if;
  if not d.is_active then raise exception 'الوثيقة معطّلة'; end if;
  if p_paid_on is null then raise exception 'حدّد تاريخ السداد'; end if;
  if p_bank_code not like '111%' then raise exception 'اختر حساب بنك أو صندوق'; end if;

  if d.employee_id is not null then
    select branch_id, full_name into v_branch, v_who from employees where id = d.employee_id;
  else
    select branch_id, full_name into v_branch, v_who from worker_profiles where id = d.worker_id;
  end if;

  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (p_paid_on, ensure_period(p_paid_on), v_branch,
          'رسوم حكومية (' || case d.type when 'iqama' then 'إقامة' when 'work_permit' then 'رخصة عمل' when 'visa' then 'تأشيرة' when 'passport' then 'جواز' else 'وثيقة' end || ') — ' || coalesce(v_who, ''), 'DOC-' || left(d.id::text, 8), 'payroll', d.id)
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, acc_id('5160'), d.renewal_cost, 0, v_branch, 'رسوم حكومية — ' || coalesce(v_who, '')),
    (v_entry, acc_id(p_bank_code), 0, d.renewal_cost, v_branch, 'سداد رسوم حكومية');
  update employee_documents set cost_entry_id = v_entry where id = p_id;
  return v_entry;
end $$;

-- accounting needs to see which documents carry an unposted cost (amounts only)
create or replace function pending_document_costs()
returns table (id uuid, owner_kind text, owner_name text, branch_id uuid, type text,
               doc_number text, expiry_date date, renewal_cost numeric, cost_entry_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, case when d.employee_id is not null then 'employee' else 'worker' end,
         coalesce(e.full_name, w.full_name), coalesce(e.branch_id, w.branch_id),
         d.type, d.doc_number, d.expiry_date, d.renewal_cost, d.cost_entry_id, d.created_at
    from employee_documents d
    left join employees e on e.id = d.employee_id
    left join worker_profiles w on w.id = d.worker_id
   where d.renewal_cost > 0 and d.is_active
     and has_perm('accounting','view')
   order by d.cost_entry_id is not null, d.created_at desc
$$;

grant execute on function renew_document(uuid, text, date, date, numeric, text, text, text, integer, text),
  post_document_cost(uuid, date, text), pending_document_costs() to authenticated;

-- ---------- 7) storage bucket (only where Supabase Storage exists) ------------
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — bucket hr-documents skipped';
    return;
  end if;
  execute $b$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('hr-documents', 'hr-documents', false, 10485760,
            array['application/pdf','image/jpeg','image/png','image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types $b$;
  execute 'drop policy if exists hr_docs_read on storage.objects';
  execute 'drop policy if exists hr_docs_insert on storage.objects';
  execute 'drop policy if exists hr_docs_update on storage.objects';
  execute $p$ create policy hr_docs_read on storage.objects for select to authenticated
    using (bucket_id = 'hr-documents' and public.hr_doc_path_visible(name)) $p$;
  execute $p$ create policy hr_docs_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'hr-documents' and public.hr_doc_path_writable(name)) $p$;
  execute $p$ create policy hr_docs_update on storage.objects for update to authenticated
    using (bucket_id = 'hr-documents' and public.hr_doc_path_writable(name))
    with check (bucket_id = 'hr-documents' and public.hr_doc_path_writable(name)) $p$;
  -- no delete policy: files stay as the evidence behind archived versions
end $$;
