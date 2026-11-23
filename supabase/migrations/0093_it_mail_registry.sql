-- =============================================================
-- 0093 — سجل البريد المؤسسي وإدارة الحسابات (المرحلة 6)
--
-- النظام سجلٌّ إداري فقط — لا يتصل بلوحة مزوّد البريد ولا يحفظ كلمات مرور:
--   1) it_mail_ownership: بيانات ملكية الدومين والبريد (مسجّلة باسم الشركة،
--      حساب المسجّل، المزوّد، Super Admin والحساب الاحتياطي المملوكان للشركة،
--      إلزام MFA، مواعيد التجديد). صف واحد يُعدَّل من الواجهة.
--   2) it_mail_accounts: حسابات الموظفين والمجموعات (العنوان فريد بلا تكرار)
--      مربوطة بسجل الموظف (employees) إن وُجد — الحالة: مطلوب ← نشط ← موقوف ←
--      معطّل ← محذوف (حذف منطقي بعد سياسة الاحتفاظ).
--   3) it_account_requests: سجل طلبات الإنشاء/التعديل/إعادة التعيين/الإيقاف/
--      التعطيل/الحذف/المجموعات: الموظف، الطلب، الطالب، المعتمد (≠ الطالب)،
--      المنفّذ، التواريخ، الحالة. التنفيذ يُسجَّل بعد إجرائه في لوحة المزوّد.
--   4) وحدة صلاحيات جديدة it_admin (المدير العام) + تدقيق كل جدول.
--   5) البذرة: قائمة الشركة (26 حساباً) بحالة «مطلوب» مع طلبات إنشاء معلّقة —
--      لا يُنشأ أي حساب فعلي، و«مرام» بانتظار اعتماد التسمية.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) permission module --------------------------------------------------
insert into permissions (module, action, label)
select 'it_admin', a.code, a.name_ar || ' البريد المؤسسي'
from (values ('view','عرض'),('create','إنشاء'),('edit','تعديل'),('delete','حذف'),
             ('approve','اعتماد'),('export','تصدير'),('manage','إدارة')) as a(code, name_ar)
where not exists (select 1 from permissions p where p.module = 'it_admin' and p.action = a.code);

insert into role_permissions (role_code, module, action)
select 'admin', 'it_admin', a from unnest(array['view','create','edit','delete','approve','export','manage']) a
on conflict do nothing;

-- ---------- 2) ownership -------------------------------------------------------
create table if not exists it_mail_ownership (
  id                   integer primary key default 1 check (id = 1),
  domain               text not null default 'masiatalsharq.com',
  domain_status        text not null default 'not_checked'
                         check (domain_status in ('not_checked','available','registered_by_company','registered_by_other','purchased')),
  registrar            text,
  registrant_name      text,          -- يجب أن يكون اسم الشركة
  registrar_account    text,          -- البريد/المعرّف الإداري للشركة (لا كلمات مرور)
  provider             text,          -- Google Workspace / Microsoft 365 / Zoho …
  billing_owner        text,          -- الفوترة باسم الشركة
  super_admin_email    text,
  backup_admin_email   text,
  mfa_enforced         boolean not null default false,
  dns_mx               boolean not null default false,
  dns_spf              boolean not null default false,
  dns_dkim             boolean not null default false,
  dns_dmarc            boolean not null default false,
  renewal_date         date,
  notes                text,
  updated_by           uuid references auth.users(id) on delete set null,
  updated_at           timestamptz not null default now()
);
insert into it_mail_ownership (id) values (1) on conflict (id) do nothing;
alter table it_mail_ownership enable row level security;
drop policy if exists imo_read on it_mail_ownership;
create policy imo_read on it_mail_ownership for select to authenticated using (has_perm('it_admin', 'view'));
drop policy if exists imo_update on it_mail_ownership;
create policy imo_update on it_mail_ownership for update to authenticated
  using (has_perm('it_admin', 'manage')) with check (has_perm('it_admin', 'manage'));

-- ---------- 3) accounts --------------------------------------------------------
create table if not exists it_mail_accounts (
  id            uuid primary key default gen_random_uuid(),
  address       text not null check (address ~ '^[a-z0-9]+([._-][a-z0-9]+)*@[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  display_name  text not null,
  kind          text not null default 'person' check (kind in ('person','group','shared')),
  employee_id   uuid references employees(id) on delete set null,
  status        text not null default 'requested'
                  check (status in ('requested','active','suspended','disabled','deleted')),
  mfa_enabled   boolean not null default false,
  groups        text[] not null default '{}',
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists ux_it_mail_address on it_mail_accounts (lower(address));
alter table it_mail_accounts enable row level security;
drop policy if exists ima_read on it_mail_accounts;
create policy ima_read on it_mail_accounts for select to authenticated using (has_perm('it_admin', 'view'));

-- ---------- 4) requests log ----------------------------------------------------
create table if not exists it_account_requests (
  id            uuid primary key default gen_random_uuid(),
  request_no    text unique,
  request_type  text not null check (request_type in
                  ('create','modify','reset_password','suspend','disable','delete','group_change','reactivate')),
  account_id    uuid references it_mail_accounts(id) on delete restrict,
  employee_name text not null,
  details       jsonb not null default '{}'::jsonb,   -- العنوان/المجموعات/الاسم الجديد… (لا كلمات مرور)
  reason        text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','done','cancelled')),
  requested_by  uuid references auth.users(id) on delete set null,
  approved_by   uuid references auth.users(id) on delete set null,
  executed_by   uuid references auth.users(id) on delete set null,
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  executed_at   timestamptz,
  decision_note text,
  execution_note text
);
create index if not exists idx_iar_status on it_account_requests(status);
alter table it_account_requests enable row level security;
drop policy if exists iar_read on it_account_requests;
create policy iar_read on it_account_requests for select to authenticated using (has_perm('it_admin', 'view'));

do $$
declare t text;
begin
  foreach t in array array['it_mail_ownership','it_mail_accounts','it_account_requests'] loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on %I
                    for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ---------- 5) functions -------------------------------------------------------
create or replace function update_mail_ownership(p jsonb) returns it_mail_ownership
language plpgsql security definer set search_path = public as $$
declare v it_mail_ownership;
begin
  if not has_perm('it_admin', 'manage') then raise exception 'لا تملك صلاحية إدارة ملكية البريد'; end if;
  update it_mail_ownership set
    domain = coalesce(nullif(btrim(p->>'domain'), ''), domain),
    domain_status = coalesce(p->>'domain_status', domain_status),
    registrar = nullif(btrim(coalesce(p->>'registrar', registrar, '')), ''),
    registrant_name = nullif(btrim(coalesce(p->>'registrant_name', registrant_name, '')), ''),
    registrar_account = nullif(btrim(coalesce(p->>'registrar_account', registrar_account, '')), ''),
    provider = nullif(btrim(coalesce(p->>'provider', provider, '')), ''),
    billing_owner = nullif(btrim(coalesce(p->>'billing_owner', billing_owner, '')), ''),
    super_admin_email = nullif(btrim(coalesce(p->>'super_admin_email', super_admin_email, '')), ''),
    backup_admin_email = nullif(btrim(coalesce(p->>'backup_admin_email', backup_admin_email, '')), ''),
    mfa_enforced = coalesce((p->>'mfa_enforced')::boolean, mfa_enforced),
    dns_mx = coalesce((p->>'dns_mx')::boolean, dns_mx),
    dns_spf = coalesce((p->>'dns_spf')::boolean, dns_spf),
    dns_dkim = coalesce((p->>'dns_dkim')::boolean, dns_dkim),
    dns_dmarc = coalesce((p->>'dns_dmarc')::boolean, dns_dmarc),
    renewal_date = coalesce(nullif(p->>'renewal_date', '')::date, renewal_date),
    notes = nullif(btrim(coalesce(p->>'notes', notes, '')), ''),
    updated_by = auth.uid(), updated_at = now()
  where id = 1 returning * into v;
  return v;
end $$;
grant execute on function update_mail_ownership(jsonb) to authenticated;

create or replace function submit_account_request(
  p_type text, p_account uuid, p_employee_name text, p_details jsonb default '{}'::jsonb, p_reason text default null)
returns it_account_requests language plpgsql security definer set search_path = public as $$
declare v it_account_requests; v_addr text; v_domain text;
begin
  if not has_perm('it_admin', 'create') then raise exception 'لا تملك صلاحية تقديم طلبات الحسابات'; end if;
  if nullif(btrim(coalesce(p_employee_name, '')), '') is null then raise exception 'اكتب اسم الموظف'; end if;
  if p_details ? 'password' then raise exception 'لا تُسجَّل كلمات المرور في النظام'; end if;
  if p_type = 'create' then
    v_addr := lower(btrim(coalesce(p_details->>'address', '')));
    select domain into v_domain from it_mail_ownership where id = 1;
    if v_addr !~ ('^[a-z0-9]+([._-][a-z0-9]+)*@' || replace(v_domain, '.', '\.') || '$') then
      raise exception 'العنوان يجب أن يكون على دومين الشركة %', v_domain;
    end if;
    if exists (select 1 from it_mail_accounts where lower(address) = v_addr and status <> 'deleted') then
      raise exception 'العنوان % مستخدم مسبقاً — لا حسابات مكررة', v_addr;
    end if;
    if exists (select 1 from it_account_requests where request_type = 'create' and status in ('pending','approved')
                and lower(details->>'address') = v_addr) then
      raise exception 'يوجد طلب إنشاء قائم لهذا العنوان';
    end if;
  elsif p_account is null or not exists (select 1 from it_mail_accounts where id = p_account) then
    raise exception 'اختر الحساب';
  end if;
  insert into it_account_requests (request_no, request_type, account_id, employee_name, details, reason, requested_by)
  values (next_ops_no('IT'), p_type, p_account, btrim(p_employee_name), coalesce(p_details, '{}'::jsonb),
          nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  returning * into v;
  return v;
end $$;
grant execute on function submit_account_request(text, uuid, text, jsonb, text) to authenticated;

create or replace function decide_account_request(p_id uuid, p_approve boolean, p_note text default null)
returns it_account_requests language plpgsql security definer set search_path = public as $$
declare v it_account_requests;
begin
  if not has_perm('it_admin', 'approve') then raise exception 'لا تملك صلاحية اعتماد طلبات الحسابات'; end if;
  select * into v from it_account_requests where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if v.status <> 'pending' then raise exception 'الطلب ليس معلّقاً'; end if;
  if v.requested_by = auth.uid() then raise exception 'لا يعتمد مقدّم الطلب طلبه (أربع أعين)'; end if;
  if not p_approve and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'اكتب سبب الرفض'; end if;
  update it_account_requests set status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id returning * into v;
  return v;
end $$;
grant execute on function decide_account_request(uuid, boolean, text) to authenticated;

-- recorded AFTER the action was done in the provider's admin console
create or replace function execute_account_request(p_id uuid, p_note text default null)
returns it_account_requests language plpgsql security definer set search_path = public as $$
declare v it_account_requests; v_acc uuid;
begin
  if not has_perm('it_admin', 'edit') then raise exception 'لا تملك صلاحية تنفيذ طلبات الحسابات'; end if;
  select * into v from it_account_requests where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if v.status <> 'approved' then raise exception 'يُنفَّذ الطلب بعد اعتماده'; end if;
  if coalesce(p_note, '') ~* 'pass(word)?|كلمة ?(ال)?مرور ?[:=]' then
    raise exception 'لا تُسجَّل كلمات المرور في ملاحظة التنفيذ';
  end if;

  if v.request_type = 'create' then
    insert into it_mail_accounts (address, display_name, kind, employee_id, status, mfa_enabled, groups, note)
    values (lower(v.details->>'address'), coalesce(v.details->>'display_name', v.employee_name),
            coalesce(v.details->>'kind', 'person'), nullif(v.details->>'employee_id', '')::uuid, 'active',
            coalesce((v.details->>'mfa_enabled')::boolean, false),
            coalesce(array(select jsonb_array_elements_text(v.details->'groups')), '{}'), null)
    on conflict (lower(address)) do update set status = 'active', updated_at = now()
    returning id into v_acc;
    update it_account_requests set account_id = v_acc where id = p_id;
  elsif v.request_type in ('suspend','disable','delete','reactivate') then
    update it_mail_accounts set status = case v.request_type when 'suspend' then 'suspended'
      when 'disable' then 'disabled' when 'delete' then 'deleted' else 'active' end, updated_at = now()
     where id = v.account_id;
  elsif v.request_type = 'group_change' then
    update it_mail_accounts set groups = coalesce(array(select jsonb_array_elements_text(v.details->'groups')), groups),
      updated_at = now() where id = v.account_id;
  elsif v.request_type = 'modify' then
    update it_mail_accounts set display_name = coalesce(nullif(v.details->>'display_name', ''), display_name),
      mfa_enabled = coalesce((v.details->>'mfa_enabled')::boolean, mfa_enabled),
      employee_id = coalesce(nullif(v.details->>'employee_id', '')::uuid, employee_id), updated_at = now()
     where id = v.account_id;
  end if;   -- reset_password: performed in the provider console; only the record is kept

  update it_account_requests set status = 'done', executed_by = auth.uid(), executed_at = now(),
    execution_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id returning * into v;
  return v;
end $$;
grant execute on function execute_account_request(uuid, text) to authenticated;

create or replace function cancel_account_request(p_id uuid) returns it_account_requests
language plpgsql security definer set search_path = public as $$
declare v it_account_requests;
begin
  select * into v from it_account_requests where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if v.status not in ('pending','approved') then raise exception 'لا يُلغى الطلب بعد تنفيذه أو رفضه'; end if;
  if not (v.requested_by = auth.uid() or has_perm('it_admin', 'manage')) then raise exception 'لا تملك صلاحية الإلغاء'; end if;
  update it_account_requests set status = 'cancelled' where id = p_id returning * into v;
  return v;
end $$;
grant execute on function cancel_account_request(uuid) to authenticated;

-- ---------- 6) seed: the company's list (requested, nothing created) -----------
insert into it_mail_accounts (address, display_name, status, note)
select a, n, 'requested',
       case when a = 'maram@masiatalsharq.com'
            then 'بانتظار اعتماد التسمية: maram أو maram.almustanir' end
from (values
  ('abdullah@masiatalsharq.com', 'Abdullah'), ('abdulmonem@masiatalsharq.com', 'Abdulmonem'),
  ('ahmed.alsayed@masiatalsharq.com', 'Ahmed AlSayed'), ('ahmed.mohamed@masiatalsharq.com', 'Ahmed Mohamed'),
  ('khaled.mohamed@masiatalsharq.com', 'Khaled Mohamed'), ('khaled.natej@masiatalsharq.com', 'Khaled Natej'),
  ('karim@masiatalsharq.com', 'Karim'), ('mohamed.abdelhamid@masiatalsharq.com', 'Mohamed Abdelhamid'),
  ('mohamed.dhafer@masiatalsharq.com', 'Mohamed Dhafer'), ('mohamed.omar@masiatalsharq.com', 'Mohamed Omar'),
  ('hamad@masiatalsharq.com', 'Hamad'), ('sameh@masiatalsharq.com', 'Sameh'), ('adel@masiatalsharq.com', 'Adel'),
  ('maram@masiatalsharq.com', 'Maram'), ('bdoor@masiatalsharq.com', 'Bdoor'), ('nouf@masiatalsharq.com', 'Nouf'),
  ('busy@masiatalsharq.com', 'Busy'), ('saja@masiatalsharq.com', 'Saja'), ('sarah@masiatalsharq.com', 'Sarah'),
  ('wijdan@masiatalsharq.com', 'Wijdan'), ('reem@masiatalsharq.com', 'Reem'), ('shatha@masiatalsharq.com', 'Shatha'),
  ('layali@masiatalsharq.com', 'Layali'), ('noura@masiatalsharq.com', 'Noura'), ('amwaj@masiatalsharq.com', 'Amwaj'),
  ('alanoud@masiatalsharq.com', 'Al Anoud')
) as l(a, n)
on conflict do nothing;

insert into it_account_requests (request_no, request_type, account_id, employee_name, details, reason)
select next_ops_no('IT'), 'create', a.id, a.display_name,
       jsonb_build_object('address', a.address, 'display_name', a.display_name, 'kind', 'person', 'mfa_enabled', true),
       'من قائمة الشركة المعتمدة — بانتظار اختيار مزوّد البريد وتفعيل الدومين'
from it_mail_accounts a
where a.status = 'requested'
  and not exists (select 1 from it_account_requests r where r.account_id = a.id and r.request_type = 'create');
