-- =============================================================
-- 0078 — ملف العاملة الكامل
--   1) worker_details (1:1 مع worker_profiles — نفس نمط employee_details):
--      الهوية والإقامة (جواز، إقامة، رقم حدود، تاريخ الوصول، تاريخ الميلاد)،
--      التواصل والسكن (جوال، سكن، باركود)، والحساب البنكي (بنك، آيبان، صاحب
--      الحساب، طريقة صرف الراتب).
--   2) ثغرة خصوصية أُغلقت: worker_profiles يقرؤه زوار الموقع (wp_public_read
--      لكتالوج العملاء) بكل أعمدته، ومنها رقم الجواز والإقامة (0068). نُقلا إلى
--      worker_details الخاص (الموارد البشرية في نطاق الفرع فقط) وحُذفا من الكتالوج.
--   3) البيانات البنكية بصلاحية hr.manage فقط (نفس قاعدة رواتب الموظفين).
--   4) ربط ملف العاملة بسجلها التشغيلي (workers: الباركود، السكن، العقود) —
--      العاملة المضافة من الموارد البشرية تُمسح بالباركود في السكن مباشرة.
--   5) قائمة البنوك في القوائم المرجعية (hr_lookups.kind = 'bank').
--   6) حاوية صور العاملات العامة worker-photos (صور الكتالوج تظهر للعملاء أصلاً).
-- =============================================================

-- ---------- 1) private details ---------------------------------------------------
create sequence if not exists worker_barcode_seq start 2001;

create table if not exists worker_details (
  worker_id      uuid primary key references worker_profiles(id) on delete cascade,
  passport_no    text,
  iqama_no       text,
  border_no      text,
  birth_date     date,
  arrival_date   date,
  phone          text,
  dorm_id        uuid references housing_dorms(id) on delete set null,
  barcode        text unique default ('MAS-W-' || nextval('worker_barcode_seq')),
  bank_name      text,
  iban           text,
  account_holder text,
  payment_method text not null default 'bank' check (payment_method in ('bank','cash')),
  ops_worker_id  uuid references workers(id) on delete set null,
  updated_at     timestamptz not null default now(),
  constraint worker_details_iban_chk check (iban is null or iban ~ '^SA[0-9]{22}$'),
  constraint worker_details_phone_chk check (phone is null or phone ~ '^05[0-9]{8}$'),
  constraint worker_details_dates_chk check (birth_date is null or birth_date < current_date)
);

-- move the identity numbers out of the public catalog (nothing is lost)
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'worker_profiles' and column_name = 'passport_no') then
    execute $m$
      insert into worker_details (worker_id, passport_no, iqama_no)
      select id, passport_no, iqama_no from worker_profiles
      on conflict (worker_id) do update
        set passport_no = coalesce(worker_details.passport_no, excluded.passport_no),
            iqama_no    = coalesce(worker_details.iqama_no, excluded.iqama_no) $m$;
  end if;
end $$;
-- workers added before this migration without identity numbers get a row too
insert into worker_details (worker_id) select id from worker_profiles on conflict do nothing;
alter table worker_profiles drop column if exists passport_no;
alter table worker_profiles drop column if exists iqama_no;

-- every catalog worker has a details row (barcode generated)
create or replace function ensure_worker_details() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into worker_details (worker_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_ensure_worker_details on worker_profiles;
create trigger trg_ensure_worker_details after insert on worker_profiles
  for each row execute function ensure_worker_details();

-- ---------- 2) RLS: HR in branch scope; bank data = hr.manage --------------------
alter table worker_details enable row level security;
drop policy if exists wd_read on worker_details;
drop policy if exists wd_insert on worker_details;
drop policy if exists wd_update on worker_details;
create policy wd_read on worker_details for select to authenticated
  using (has_perm('hr','view') and worker_in_my_branch(worker_id));
create policy wd_insert on worker_details for insert to authenticated
  with check (has_perm('hr','edit') and worker_in_my_branch(worker_id));
create policy wd_update on worker_details for update to authenticated
  using (has_perm('hr','edit') and worker_in_my_branch(worker_id))
  with check (has_perm('hr','edit') and worker_in_my_branch(worker_id));
-- no delete policy: the row follows its profile (soft delete on the profile)


-- ---------- 3) one worker: catalog + details → operational record ----------------
create or replace function sync_ops_worker(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p worker_profiles%rowtype; d worker_details%rowtype; v_status worker_status; v_ops uuid;
begin
  select * into p from worker_profiles where id = p_profile;
  if not found then return; end if;
  select * into d from worker_details where worker_id = p_profile;
  if not found then return; end if;
  v_status := case
    when not p.is_active then 'terminated'
    when p.status = 'on_service' then 'on_service'
    when p.status = 'medical' then 'medical'
    else 'available' end;
  v_ops := d.ops_worker_id;
  if v_ops is null or not exists (select 1 from workers where id = v_ops) then
    insert into workers (full_name, nationality, passport_no, iqama_no, phone, branch_id, status,
                         profession, barcode, photo_url)
    values (p.full_name, p.nationality, d.passport_no, d.iqama_no, d.phone, p.branch_id, v_status,
            p.profession, d.barcode, p.photo_url)
    on conflict (barcode) do update set full_name = excluded.full_name
    returning id into v_ops;
    perform set_config('masea.worker_sync', 'on', true);
    update worker_details set ops_worker_id = v_ops where worker_id = p_profile;
    perform set_config('masea.worker_sync', 'off', true);
  else
    update workers set full_name = p.full_name, nationality = p.nationality, passport_no = d.passport_no,
      iqama_no = d.iqama_no, phone = d.phone, branch_id = p.branch_id, status = v_status,
      profession = p.profession, barcode = d.barcode, photo_url = p.photo_url
     where id = v_ops;
  end if;
end $$;
revoke execute on function sync_ops_worker(uuid) from public, anon, authenticated;

-- bank data = hr.manage; barcode/link are system-managed (the sync writes ops_worker_id)
create or replace function guard_worker_details() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if coalesce(current_setting('masea.worker_sync', true), 'off') = 'on' then return new; end if;
  if auth.uid() is null or has_perm('hr','manage') then
    if tg_op = 'UPDATE' and auth.uid() is not null
       and (new.barcode is distinct from old.barcode or new.ops_worker_id is distinct from old.ops_worker_id) then
      raise exception 'الباركود والربط التشغيلي يُداران آليًا' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.iban is not null or new.bank_name is not null or new.account_holder is not null then
      raise exception 'البيانات البنكية من صلاحية إدارة الموارد البشرية' using errcode = '42501';
    end if;
  else
    if new.iban is distinct from old.iban or new.bank_name is distinct from old.bank_name
       or new.account_holder is distinct from old.account_holder
       or new.payment_method is distinct from old.payment_method then
      raise exception 'البيانات البنكية من صلاحية إدارة الموارد البشرية' using errcode = '42501';
    end if;
    if new.barcode is distinct from old.barcode or new.ops_worker_id is distinct from old.ops_worker_id then
      raise exception 'الباركود والربط التشغيلي يُداران آليًا' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_worker_details on worker_details;
create trigger trg_guard_worker_details before insert or update on worker_details
  for each row execute function guard_worker_details();

create or replace function trg_sync_ops_worker() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('masea.worker_sync', true), 'off') = 'on' then return null; end if;
  perform sync_ops_worker(coalesce(to_jsonb(new)->>'worker_id', to_jsonb(new)->>'id')::uuid);
  return null;
end $$;
drop trigger if exists trg_sync_ops_from_profile on worker_profiles;
create trigger trg_sync_ops_from_profile after update on worker_profiles
  for each row execute function trg_sync_ops_worker();
drop trigger if exists trg_sync_ops_from_details on worker_details;
create trigger trg_sync_ops_from_details after insert or update on worker_details
  for each row execute function trg_sync_ops_worker();

-- existing catalog workers get their operational record now
do $$
declare r record;
begin
  for r in select worker_id from worker_details where ops_worker_id is null loop
    perform sync_ops_worker(r.worker_id);
  end loop;
end $$;

drop trigger if exists trg_audit_row on worker_details;
create trigger trg_audit_row after insert or update or delete on worker_details
  for each row execute function audit_row_change();

-- ---------- 4) banks as a managed list --------------------------------------------
alter table hr_lookups drop constraint if exists hr_lookups_kind_check;
alter table hr_lookups add constraint hr_lookups_kind_check check (kind in
  ('department','job_title','nationality','profession','skill','language','doc_type','bank'));
insert into hr_lookups (kind, code, name_ar, sort_order) values
  ('bank','rjhi','مصرف الراجحي',1), ('bank','snb','البنك الأهلي السعودي',2),
  ('bank','riyad','بنك الرياض',3), ('bank','alinma','مصرف الإنماء',4),
  ('bank','albilad','بنك البلاد',5), ('bank','sab','البنك السعودي الأول (ساب)',6),
  ('bank','anb','البنك العربي الوطني',7), ('bank','bsf','البنك السعودي الفرنسي',8),
  ('bank','aljazira','بنك الجزيرة',9), ('bank','saib','البنك السعودي للاستثمار',10),
  ('bank','stc','STC Bank',11)
on conflict do nothing;

-- ---------- 5) public worker photos (shown in the customer catalog) ---------------
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — bucket worker-photos skipped';
    return;
  end if;
  execute $b$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('worker-photos', 'worker-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types $b$;
  execute 'drop policy if exists worker_photos_write on storage.objects';
  execute 'drop policy if exists worker_photos_update on storage.objects';
  execute $p$ create policy worker_photos_write on storage.objects for insert to authenticated
    with check (bucket_id = 'worker-photos' and public.has_perm('hr','edit')) $p$;
  execute $p$ create policy worker_photos_update on storage.objects for update to authenticated
    using (bucket_id = 'worker-photos' and public.has_perm('hr','edit'))
    with check (bucket_id = 'worker-photos' and public.has_perm('hr','edit')) $p$;
end $$;

-- ---------- 6) bank list: rename flows into the records, usage counted -------------
create or replace function cascade_hr_lookup_rename() returns trigger
language plpgsql security definer set search_path = public as $$
declare o text := old.name_ar; n text := new.name_ar;
begin
  if o = n then return null; end if;
  case new.kind
    when 'department' then
      update employee_details set department = n where department = o;
    when 'job_title' then
      update employees set job_title = n where job_title = o;
    when 'nationality' then
      update employees set nationality = n where nationality = o;
      update worker_profiles set nationality = n where nationality = o;
      update pricing_rules set nationality = n where nationality = o;
    when 'profession' then
      update worker_profiles set profession = n where profession = o;
      update pricing_rules set profession = n where profession = o;
    when 'skill' then
      update worker_profiles set skills = array_replace(skills, o, n) where o = any(skills);
    when 'language' then
      update worker_profiles set languages = array_replace(languages, o, n) where o = any(languages);
    when 'bank' then
      update worker_details set bank_name = n where bank_name = o;
      update employee_details set bank_name = n where bank_name = o;
    else null;  -- doc_type: records store the code
  end case;
  return null;
end $$;

create or replace function hr_lookup_usage(p_kind text)
returns table (name_ar text, uses bigint)
language sql stable security definer set search_path = public as $$
  select x.v, count(*) from (
    select department as v from employee_details where p_kind = 'department'
    union all select job_title from employees where p_kind = 'job_title'
    union all select nationality from employees where p_kind = 'nationality'
    union all select nationality from worker_profiles where p_kind = 'nationality'
    union all select profession from worker_profiles where p_kind = 'profession'
    union all select unnest(skills) from worker_profiles where p_kind = 'skill'
    union all select unnest(languages) from worker_profiles where p_kind = 'language'
    union all select type from employee_documents where p_kind = 'doc_type' and is_active
    union all select bank_name from worker_details where p_kind = 'bank'
    union all select bank_name from employee_details where p_kind = 'bank'
  ) x
  where x.v is not null and has_perm('hr','view')
  group by x.v
$$;
