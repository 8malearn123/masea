-- =============================================================
-- Masiat Alsharq ERP — 0057 Professional accounting layer
-- Builds ON the existing engine (0023 journal · 0025/0027 invoicing · 0029
-- purchases · 0031 banks · 0032 VAT · 0034 fixed assets). Forward-only;
-- additive (no table/column dropped, no existing balance changed).
-- Rollback script: supabase/rollback/0057_accounting_pro_down.sql
--
--  1. Journal lifecycle: draft → pending → approved → posted (+ void), entry
--     kinds, reversal links, idempotency keys, attachments. POSTED entries are
--     immutable (trigger) — corrections only through reversing entries.
--  2. Fine-grained accounting duties (has_acc_perm) layered under has_perm.
--  3. Append-only accounting audit log (who / when / what / old → new).
--  4. Cost centers (departments/projects), allocation rules, budgets.
--  5. Bank statements, matching, approved posting rules.
--  6. Fixed-asset methods / disposal / transfer events.
--  7. Fiscal years, period reopen log.
--  8. AR/AP: credit limits, reminders, payment scheduling, sales credit notes.
--  9. VAT/e-invoicing data (ZATCA Phase-2 readiness — NOT a certified
--     integration; submission requires onboarding + CSID). Re-introduces
--     e-invoice data in its own table (0028 removed the invoice columns).
-- 10. Alerts state, assistant log, AI provider config (no secrets stored).
-- =============================================================

-- ---------------------------------------------------------------
-- 0) permissions catalog: posting / reopening are distinct actions
-- ---------------------------------------------------------------
insert into permissions (module, action, label) values
  ('accounting', 'post',   'ترحيل القيود'),
  ('accounting', 'reopen', 'إعادة فتح الفترات المقفلة')
on conflict (module, action) do nothing;

insert into role_permissions (role_code, module, action) values
  ('admin', 'accounting', 'post'), ('admin', 'accounting', 'reopen'),
  ('accountant', 'accounting', 'post')
on conflict do nothing;

-- ---------------------------------------------------------------
-- 1) accounting duties (المدير المالي، المحاسب العام، …)
-- ---------------------------------------------------------------
create table if not exists accounting_duties (
  code       text primary key,
  name_ar    text not null,
  caps       text[] not null default '{}',   -- 'area.action'
  is_system  boolean not null default false,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists user_accounting_duties (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  duty_code  text not null references accounting_duties(code),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now()
);

insert into accounting_duties (code, name_ar, caps, is_system) values
  ('cfo', 'المدير المالي', array(
     select a || '.' || x
     from unnest(array['gl','ar','ap','bank','assets','budget','tax','close','reports','audit']) a,
          unnest(array['view','create','edit','approve','post','export','reopen']) x
   ) || array['settings.view'], true),
  ('general_accountant', 'المحاسب العام', array[
     'gl.view','gl.create','gl.edit','gl.export','gl.post',
     'bank.view','bank.create','bank.edit','bank.export',
     'assets.view','assets.create','assets.edit','assets.export',
     'tax.view','tax.create','tax.edit','tax.export',
     'ar.view','ap.view','budget.view','close.view','reports.view','reports.export'], true),
  ('ar_accountant', 'محاسب العملاء', array[
     'ar.view','ar.create','ar.edit','ar.export','gl.view','bank.view','reports.view','reports.export'], true),
  ('ap_accountant', 'محاسب الموردين', array[
     'ap.view','ap.create','ap.edit','ap.export','bank.view','bank.create','gl.view','reports.view','reports.export'], true),
  ('internal_auditor', 'المراجع الداخلي', array(
     select a || '.' || x
     from unnest(array['gl','ar','ap','bank','assets','budget','tax','close','reports','audit']) a,
          unnest(array['view','export']) x
   ), true),
  ('reports_only', 'مستخدم التقارير فقط', array['reports.view','reports.export'], true)
on conflict (code) do nothing;

-- Admin = everything. Explicit duty assignment wins; otherwise the role default
-- (accountant → cfo, operations_manager → reports_only) keeps today's behaviour.
create or replace function has_acc_perm(p_area text, p_action text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when get_my_role() = 'admin' then true
    when not has_perm('accounting', 'view') then false
    else coalesce((
      select (p_area || '.' || p_action) = any(d.caps) and d.is_active
      from accounting_duties d
      where d.code = coalesce(
        (select duty_code from user_accounting_duties where user_id = auth.uid()),
        case get_my_role() when 'accountant' then 'cfo'
                           when 'operations_manager' then 'reports_only' end)
    ), false)
  end
$$;
grant execute on function has_acc_perm(text, text) to authenticated;

-- ---------------------------------------------------------------
-- 2) append-only audit log
-- ---------------------------------------------------------------
create table if not exists accounting_audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  old_data   jsonb,
  new_data   jsonb,
  note       text
);
create index if not exists idx_acc_audit_entity on accounting_audit_log(entity, entity_id);
create index if not exists idx_acc_audit_at on accounting_audit_log(at desc);

-- no UPDATE / DELETE ever (even for the table owner via the API)
create or replace function acc_audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'سجل التدقيق غير قابل للتعديل أو الحذف';
end;
$$;
drop trigger if exists trg_acc_audit_immutable on accounting_audit_log;
create trigger trg_acc_audit_immutable before update or delete on accounting_audit_log
  for each row execute function acc_audit_immutable();

create or replace function acc_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'code',
    '?');
  insert into accounting_audit_log (user_id, action, entity, entity_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------
-- 3) chart: statement classification + disposal accounts
-- ---------------------------------------------------------------
alter table chart_of_accounts add column if not exists fs_class text
  check (fs_class in ('current_asset','non_current_asset','current_liability','non_current_liability',
                      'equity','revenue','cost_of_sales','operating_expense','other_income','other_expense'));
alter table chart_of_accounts add column if not exists cf_class text
  check (cf_class in ('cash','operating','investing','financing'));

insert into chart_of_accounts (code, name_ar, type, parent_id, normal_balance, fs_class) values
  ('4600','أرباح بيع واستبعاد الأصول','revenue', acc_id('4000'),'credit','other_income'),
  ('5960','خسائر بيع واستبعاد الأصول','expense', acc_id('5000'),'debit','other_expense')
on conflict (code) do nothing;
update chart_of_accounts set fs_class = 'cost_of_sales' where code = '5600' and fs_class is null;

-- ---------------------------------------------------------------
-- 4) cost centers (branches stay primary; departments / projects too)
-- ---------------------------------------------------------------
create table if not exists cost_centers (
  id        uuid primary key default gen_random_uuid(),
  code      text unique not null,
  name_ar   text not null,
  kind      text not null check (kind in ('branch','department','project')),
  branch_id uuid references branches(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into cost_centers (code, name_ar, kind, branch_id)
select 'BR-' || b.name, 'فرع ' || b.name, 'branch', b.id from branches b
on conflict (code) do nothing;
insert into cost_centers (code, name_ar, kind) values
  ('DEP-FIN','الإدارة المالية','department'),
  ('DEP-OPS','العمليات والتشغيل','department'),
  ('DEP-SALES','المبيعات وخدمة العملاء','department')
on conflict (code) do nothing;

create table if not exists allocation_rules (
  id            uuid primary key default gen_random_uuid(),
  name_ar       text not null,
  account_codes text[] not null,
  basis         text not null check (basis in ('fixed','revenue')),
  weights       jsonb not null default '{}'::jsonb,  -- {branch_id: pct}
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 5) journal lifecycle
-- ---------------------------------------------------------------
alter table journal_entries drop constraint if exists journal_entries_status_check;
alter table journal_entries add constraint journal_entries_status_check
  check (status in ('draft','pending','approved','posted','void'));
alter table journal_entries drop constraint if exists journal_entries_source_type_check;
alter table journal_entries add constraint journal_entries_source_type_check
  check (source_type in ('manual','contract','payment','payroll','loyalty','penalty','adjustment',
                         'invoice','bill','voucher','asset','bank','allocation','credit_note','closing'));

alter table journal_entries add column if not exists kind text not null default 'auto'
  check (kind in ('manual','auto','recurring','reversing','opening','adjusting','closing'));
alter table journal_entries add column if not exists cost_center_id uuid references cost_centers(id) on delete set null;
alter table journal_entries add column if not exists submitted_at timestamptz;
alter table journal_entries add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table journal_entries add column if not exists approved_at timestamptz;
alter table journal_entries add column if not exists posted_by uuid references auth.users(id) on delete set null;
alter table journal_entries add column if not exists posted_at timestamptz;
alter table journal_entries add column if not exists reversal_of uuid references journal_entries(id) on delete restrict;
alter table journal_entries add column if not exists reversed_by uuid references journal_entries(id) on delete set null;
alter table journal_entries add column if not exists idempotency_key text;
create unique index if not exists ux_je_idempotency on journal_entries(idempotency_key)
  where idempotency_key is not null and status <> 'void';
-- existing rows were posted by the engine at insert time
update journal_entries set posted_at = created_at where status = 'posted' and posted_at is null;

create table if not exists journal_entry_attachments (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references journal_entries(id) on delete restrict,
  file_name   text not null,
  storage_path text not null,           -- supabase storage object (bucket: accounting)
  size_bytes  bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create table if not exists recurring_entries (
  id            uuid primary key default gen_random_uuid(),
  name_ar       text not null,
  description   text not null,
  branch_id     uuid references branches(id) on delete set null,
  lines         jsonb not null,            -- [{account_code, debit, credit, description}]
  start_period  text not null,             -- YYYY-MM
  end_period    text,
  last_period   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- balance is required for POSTED entries; drafts may be saved unbalanced
create or replace function je_assert_balanced() returns trigger
language plpgsql as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  v_status text;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_cnt integer;
begin
  select status into v_status from journal_entries where id = v_entry;
  if v_status is null or v_status <> 'posted' then
    return null;
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*)
    into v_debit, v_credit, v_cnt
  from journal_entry_lines where entry_id = v_entry;
  if v_cnt > 0 and v_debit <> v_credit then
    raise exception 'القيد غير متوازن: مدين % ≠ دائن %', v_debit, v_credit;
  end if;
  return null;
end;
$$;

-- closed periods reject POSTING (drafts may wait in a closed month)
create or replace function je_period_open() returns trigger
language plpgsql as $$
begin
  -- only the act of POSTING is checked: setting the reversal link on an entry
  -- that sits in an already-closed month must still work
  if new.status = 'posted' and (tg_op = 'INSERT' or old.status <> 'posted')
     and exists (select 1 from accounting_periods p where p.id = new.period_id and p.status = 'closed') then
    raise exception 'لا يمكن الترحيل في فترة محاسبية مقفلة';
  end if;
  return new;
end;
$$;

-- posted entries are immutable: only the reversal link may be set afterwards
create or replace function je_guard_posted() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'لا يُحذف القيد المُرحَّل — استخدم قيدًا عكسيًا';
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    if (to_jsonb(new) - 'reversed_by') <> (to_jsonb(old) - 'reversed_by') then
      raise exception 'القيد المُرحَّل محمي من التعديل — استخدم قيدًا عكسيًا';
    end if;
  elsif old.status = 'void' and new.status <> 'void' then
    raise exception 'لا يُعاد تفعيل قيد ملغى';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_je_guard_posted on journal_entries;
create trigger trg_je_guard_posted before update or delete on journal_entries
  for each row execute function je_guard_posted();

-- lines of a posted entry are frozen; inserts are allowed only in the same
-- transaction that created the entry (now() = transaction start time).
create or replace function jel_guard_posted() returns trigger
language plpgsql as $$
declare v_status text; v_created timestamptz;
begin
  select status, created_at into v_status, v_created
  from journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if v_status = 'posted' and (tg_op <> 'INSERT' or v_created <> now()) then
    raise exception 'أسطر القيد المُرحَّل محمية من التعديل';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_jel_guard_posted on journal_entry_lines;
create trigger trg_jel_guard_posted before insert or update or delete on journal_entry_lines
  for each row execute function jel_guard_posted();

drop trigger if exists trg_je_audit on journal_entries;
create trigger trg_je_audit after insert or update on journal_entries
  for each row execute function acc_audit();

-- ----- workflow functions (SECURITY DEFINER; permission + SoD checked here) -----
create or replace function je_errors(p_entry uuid) returns text[]
language plpgsql stable as $$
declare v_err text[] := '{}'; v_d numeric; v_c numeric; v_n int;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into v_d, v_c, v_n
  from journal_entry_lines where entry_id = p_entry;
  if v_n < 2 then v_err := array_append(v_err, 'القيد يحتاج سطرين على الأقل'); end if;
  if v_d <> v_c then v_err := array_append(v_err, format('القيد غير متوازن: مدين %s ≠ دائن %s', v_d, v_c)); end if;
  if exists (select 1 from journal_entry_lines l join chart_of_accounts a on a.id = l.account_id
             where l.entry_id = p_entry and (not a.is_postable or not a.is_active)) then
    v_err := array_append(v_err, 'سطر على حساب رئيسي أو معطّل');
  end if;
  if exists (select 1 from journal_entries e join accounting_periods p on p.id = e.period_id
             where e.id = p_entry and p.status = 'closed') then
    v_err := array_append(v_err, 'الفترة مقفلة');
  end if;
  return v_err;
end;
$$;

create or replace function submit_journal_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_err text[];
begin
  if not has_acc_perm('gl','create') then raise exception 'لا تملك صلاحية إنشاء القيود'; end if;
  v_err := je_errors(p_entry);
  if array_length(v_err, 1) > 0 then raise exception '%', array_to_string(v_err, ' · '); end if;
  update journal_entries set status = 'pending', submitted_at = now()
  where id = p_entry and status = 'draft';
  if not found then raise exception 'يُرسل للاعتماد القيد المسودة فقط'; end if;
end;
$$;

create or replace function approve_journal_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_creator uuid; v_sod boolean;
begin
  if not has_acc_perm('gl','approve') then raise exception 'لا تملك صلاحية الاعتماد'; end if;
  select created_by into v_creator from journal_entries where id = p_entry and status = 'pending';
  if not found then raise exception 'يُعتمد القيد بانتظار الاعتماد فقط'; end if;
  select coalesce((select value from app_config where key = 'acc_require_sod'), 1) = 1 into v_sod;
  if v_sod and v_creator = auth.uid() then
    raise exception 'فصل المهام: لا يعتمد المستخدم قيدًا أنشأه بنفسه';
  end if;
  update journal_entries set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_entry;
end;
$$;

-- idempotent: posting an already-posted entry is a no-op
create or replace function post_journal_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text; v_err text[]; v_sod boolean;
begin
  if not has_acc_perm('gl','post') then raise exception 'لا تملك صلاحية الترحيل'; end if;
  select status into v_status from journal_entries where id = p_entry for update;
  if v_status is null then raise exception 'القيد غير موجود'; end if;
  if v_status = 'posted' then return; end if;
  if v_status = 'void' then raise exception 'قيد ملغى'; end if;
  select coalesce((select value from app_config where key = 'acc_require_sod'), 1) = 1 into v_sod;
  if v_sod and v_status <> 'approved' then raise exception 'القيد يحتاج اعتمادًا قبل الترحيل'; end if;
  v_err := je_errors(p_entry);
  if array_length(v_err, 1) > 0 then raise exception '%', array_to_string(v_err, ' · '); end if;
  update journal_entries set status = 'posted', posted_by = auth.uid(), posted_at = now()
  where id = p_entry;
  update journal_entries set reversed_by = p_entry
  where id = (select reversal_of from journal_entries where id = p_entry);
end;
$$;

create or replace function void_journal_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_acc_perm('gl','edit') then raise exception 'لا تملك صلاحية الإلغاء'; end if;
  update journal_entries set status = 'void' where id = p_entry and status in ('draft','pending','approved');
  if not found then raise exception 'القيد المُرحَّل لا يُلغى — استخدم قيدًا عكسيًا'; end if;
end;
$$;

-- creates a reversing DRAFT (then follows the normal approval/posting path)
create or replace function reverse_journal_entry(p_entry uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_orig journal_entries; v_new uuid;
begin
  if not has_acc_perm('gl','create') then raise exception 'لا تملك صلاحية إنشاء القيود'; end if;
  select * into v_orig from journal_entries where id = p_entry;
  if v_orig.status is distinct from 'posted' then raise exception 'يُعكس القيد المُرحَّل فقط'; end if;
  if v_orig.reversed_by is not null then raise exception 'هذا القيد معكوس بالفعل'; end if;
  if p_date < v_orig.entry_date then raise exception 'تاريخ القيد العكسي يسبق القيد الأصلي'; end if;
  insert into journal_entries (entry_date, period_id, branch_id, cost_center_id, description, reference,
                               source_type, source_id, status, kind, reversal_of, idempotency_key, created_by)
  values (p_date, ensure_period(p_date), v_orig.branch_id, v_orig.cost_center_id,
          'قيد عكسي للقيد #' || v_orig.entry_no || ' — ' || v_orig.description,
          'REV-' || v_orig.entry_no, 'adjustment', v_orig.id, 'draft', 'reversing', v_orig.id,
          'REV-' || v_orig.id, auth.uid())
  returning id into v_new;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  select v_new, account_id, credit, debit, branch_id, 'عكس: ' || coalesce(description, '')
  from journal_entry_lines where entry_id = p_entry;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------
-- 6) fiscal years & period close
-- ---------------------------------------------------------------
create table if not exists fiscal_years (
  year      integer primary key,
  start_date date not null,
  end_date   date not null,
  status    text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  closing_entry_id uuid references journal_entries(id) on delete set null
);
insert into fiscal_years (year, start_date, end_date)
select distinct year, make_date(year,1,1), make_date(year,12,31) from accounting_periods
on conflict (year) do nothing;

create table if not exists period_reopen_log (
  id         bigint generated always as identity primary key,
  period_id  uuid not null references accounting_periods(id) on delete restrict,
  reason     text not null check (length(trim(reason)) >= 5),
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz not null default now()
);

create or replace function close_period(p_year int, p_month int) returns void
language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_pending int;
begin
  if not has_acc_perm('close','approve') then raise exception 'لا تملك صلاحية الإقفال'; end if;
  select id into v_pid from accounting_periods where year = p_year and month = p_month;
  if v_pid is null then raise exception 'الفترة غير موجودة'; end if;
  select count(*) into v_pending from journal_entries
  where period_id = v_pid and status in ('draft','pending','approved');
  if v_pending > 0 then raise exception 'لا يمكن الإقفال: % قيد معلّق في الفترة', v_pending; end if;
  update accounting_periods set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = v_pid;
end;
$$;

create or replace function reopen_period(p_year int, p_month int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  if not (has_acc_perm('close','reopen') and has_perm('accounting','reopen')) then
    raise exception 'إعادة فتح الفترة تحتاج صلاحية خاصة';
  end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'سبب إعادة الفتح مطلوب'; end if;
  select id into v_pid from accounting_periods where year = p_year and month = p_month and status = 'closed';
  if v_pid is null then raise exception 'الفترة ليست مقفلة'; end if;
  if exists (select 1 from fiscal_years where year = p_year and status = 'closed') then
    raise exception 'السنة المالية مقفلة — لا يُعاد فتح أشهرها';
  end if;
  update accounting_periods set status = 'open', closed_at = null, closed_by = null where id = v_pid;
  insert into period_reopen_log (period_id, reason, reopened_by) values (v_pid, trim(p_reason), auth.uid());
end;
$$;

drop trigger if exists trg_period_audit on accounting_periods;
create trigger trg_period_audit after update on accounting_periods
  for each row execute function acc_audit();
drop trigger if exists trg_coa_audit on chart_of_accounts;
create trigger trg_coa_audit after insert or update on chart_of_accounts
  for each row execute function acc_audit();

-- ---------------------------------------------------------------
-- 7) budgets
-- ---------------------------------------------------------------
create table if not exists budgets (
  id            uuid primary key default gen_random_uuid(),
  name_ar       text not null,
  year          integer not null,
  scope         text not null check (scope in ('company','branch','department','project')),
  branch_id     uuid references branches(id) on delete set null,
  cost_center_id uuid references cost_centers(id) on delete set null,
  status        text not null default 'draft' check (status in ('draft','approved')),
  is_active     boolean not null default true,
  approved_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create table if not exists budget_lines (
  id         uuid primary key default gen_random_uuid(),
  budget_id  uuid not null references budgets(id) on delete cascade,
  account_id uuid not null references chart_of_accounts(id) on delete restrict,
  month      integer not null check (month between 1 and 12),
  amount     numeric(14,2) not null default 0 check (amount >= 0),
  unique (budget_id, account_id, month)
);
drop trigger if exists trg_budget_audit on budgets;
create trigger trg_budget_audit after insert or update on budgets
  for each row execute function acc_audit();

-- ---------------------------------------------------------------
-- 8) bank reconciliation
-- ---------------------------------------------------------------
create table if not exists bank_statements (
  id             uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id) on delete restrict,
  period_from    date,
  period_to      date,
  closing_balance numeric(14,2) not null,
  imported_by    uuid references auth.users(id) on delete set null,
  imported_at    timestamptz not null default now()
);
create table if not exists bank_statement_lines (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references bank_statements(id) on delete cascade,
  txn_date     date not null,
  description  text,
  reference    text,
  amount       numeric(14,2) not null    -- + deposit / − withdrawal
);
create table if not exists bank_matches (
  id                 uuid primary key default gen_random_uuid(),
  statement_line_id  uuid not null unique references bank_statement_lines(id) on delete cascade,
  journal_line_id    uuid not null unique references journal_entry_lines(id) on delete restrict,
  matched_by         uuid references auth.users(id) on delete set null,
  matched_at         timestamptz not null default now()
);
-- rules never post on their own: an APPROVED rule only proposes a draft entry
create table if not exists bank_rules (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null,
  contains    text not null,
  direction   text not null check (direction in ('in','out')),
  account_id  uuid not null references chart_of_accounts(id) on delete restrict,
  approved    boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  is_active   boolean not null default true
);
drop trigger if exists trg_bank_rule_audit on bank_rules;
create trigger trg_bank_rule_audit after insert or update on bank_rules
  for each row execute function acc_audit();

-- ---------------------------------------------------------------
-- 9) fixed assets: method, disposal, transfers
-- ---------------------------------------------------------------
alter table fixed_assets add column if not exists method text not null default 'straight_line'
  check (method in ('straight_line','declining_balance'));
alter table fixed_assets add column if not exists disposed_at date;
alter table fixed_assets add column if not exists disposal_proceeds numeric(14,2);
create table if not exists fixed_asset_events (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references fixed_assets(id) on delete restrict,
  event       text not null check (event in ('acquire','depreciate','transfer','dispose','method_change')),
  event_date  date not null,
  from_branch uuid references branches(id) on delete set null,
  to_branch   uuid references branches(id) on delete set null,
  amount      numeric(14,2),
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 10) receivables / payables
-- ---------------------------------------------------------------
alter table customers add column if not exists credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0);
alter table bills add column if not exists planned_pay_date date;
create table if not exists payment_reminders (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  channel    text not null default 'sms' check (channel in ('sms','whatsapp','email','call')),
  status     text not null default 'queued' check (status in ('queued','sent','failed')),
  queued_by  uuid references auth.users(id) on delete set null,
  queued_at  timestamptz not null default now()
);
create table if not exists sales_credit_notes (
  id          uuid primary key default gen_random_uuid(),
  note_no     serial unique,
  invoice_id  uuid not null references invoices(id) on delete restrict,
  note_date   date not null default current_date,
  subtotal    numeric(14,2) not null check (subtotal > 0),
  vat_amount  numeric(14,2) not null default 0 check (vat_amount >= 0),
  total       numeric(14,2) not null,
  reason      text not null,
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (total = subtotal + vat_amount)
);

-- ---------------------------------------------------------------
-- 11) VAT / e-invoicing (ZATCA) — data only, see header note
-- ---------------------------------------------------------------
create table if not exists company_tax_profile (
  id         integer primary key default 1 check (id = 1),
  seller_name text not null,
  vat_number text not null check (vat_number ~ '^3[0-9]{13}3$'),
  cr_number  text,
  address    text,
  city       text,
  updated_at timestamptz not null default now()
);
create table if not exists einvoice_documents (
  invoice_id  uuid primary key references invoices(id) on delete restrict,
  uuid        uuid not null unique,
  icv         bigint not null unique,
  pih         text not null,
  invoice_hash text not null,
  qr_tlv      text not null,
  xml         text not null,
  flow        text not null check (flow in ('clearance','reporting')),
  status      text not null default 'generated'
              check (status in ('generated','pending_submission','cleared','reported','rejected','error')),
  messages    jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  submitted_at timestamptz
);
-- generated e-invoice payloads are never edited (corrections by credit/debit note)
create or replace function einv_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'لا تُحذف الفاتورة الإلكترونية'; end if;
  if (to_jsonb(new) - array['status','messages','submitted_at']) <> (to_jsonb(old) - array['status','messages','submitted_at']) then
    raise exception 'بيانات الفاتورة الإلكترونية غير قابلة للتعديل';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_einv_guard on einvoice_documents;
create trigger trg_einv_guard before update or delete on einvoice_documents
  for each row execute function einv_guard();

-- ---------------------------------------------------------------
-- 12) alerts, assistant, AI provider (no secrets in tables)
-- ---------------------------------------------------------------
create table if not exists fin_alert_states (
  alert_id   text primary key,
  assignee   uuid references auth.users(id) on delete set null,
  status     text not null default 'open' check (status in ('open','in_progress','resolved','dismissed')),
  priority   text check (priority in ('high','medium','low')),
  note       text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists assistant_log (
  id        bigint generated always as identity primary key,
  user_id   uuid references auth.users(id) on delete set null,
  question  text not null,
  intent    text,
  refused   boolean not null default false,
  provider  text,                 -- null = local engine
  at        timestamptz not null default now()
);
create table if not exists ai_provider_config (
  id                   integer primary key default 1 check (id = 1),
  enabled              boolean not null default false,
  provider             text,
  allow_sensitive_data boolean not null default false,  -- explicit admin consent to send data out
  updated_by           uuid references auth.users(id) on delete set null,
  updated_at           timestamptz not null default now()
);
insert into ai_provider_config (id) values (1) on conflict (id) do nothing;
-- the API key lives in Supabase Vault / an Edge Function secret — never here.

-- ---------------------------------------------------------------
-- 13) managed thresholds (no hard-coded business numbers)
-- ---------------------------------------------------------------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('acc_low_cash_threshold', 'حد انخفاض السيولة', 'المحاسبة', 50000, 'ريال', 20),
  ('acc_bill_due_alert_days', 'تنبيه استحقاق فواتير الموردين قبل', 'المحاسبة', 7, 'يوم', 21),
  ('acc_budget_alert_pct', 'نسبة استهلاك الموازنة للتنبيه', 'المحاسبة', 90, '٪', 22),
  ('acc_anomaly_multiplier', 'معامل اكتشاف القيود غير المعتادة (× المتوسط)', 'المحاسبة', 3, 'ضعف', 23),
  ('acc_require_sod', 'فصل مهام الإنشاء والاعتماد (1 = مفعّل)', 'المحاسبة', 1, null, 24),
  ('acc_bank_match_days', 'فارق الأيام المسموح في المطابقة البنكية', 'المحاسبة', 3, 'يوم', 25),
  ('acc_reminder_after_days', 'تذكير العميل بعد تأخر', 'المحاسبة', 7, 'يوم', 26)
on conflict (key) do nothing;

-- ---------------------------------------------------------------
-- 14) reporting helpers (respect RLS of the base tables)
-- ---------------------------------------------------------------
create or replace view v_general_ledger with (security_invoker = true) as
select l.id as line_id, e.id as entry_id, e.entry_no, e.entry_date, e.reference, e.description,
       e.source_type, e.kind, coalesce(l.branch_id, e.branch_id) as branch_id, e.cost_center_id,
       a.code as account_code, a.name_ar as account_name, a.type as account_type,
       l.debit, l.credit,
       sum(case when a.type in ('asset','expense') then l.debit - l.credit else l.credit - l.debit end)
         over (partition by a.id order by e.entry_date, e.entry_no, l.id) as running_balance
from journal_entry_lines l
join journal_entries e on e.id = l.entry_id and e.status = 'posted'
join chart_of_accounts a on a.id = l.account_id;

create or replace function trial_balance(p_from date, p_to date, p_branch uuid default null)
returns table(code text, name_ar text, type text,
              opening_debit numeric, opening_credit numeric,
              period_debit numeric, period_credit numeric,
              closing_debit numeric, closing_credit numeric)
language sql stable security invoker set search_path = public as $$
  with mv as (
    select a.code, a.name_ar, a.type,
      coalesce(sum(case when e.entry_date < p_from then l.debit - l.credit end), 0) as open_net,
      coalesce(sum(case when e.entry_date between p_from and p_to then l.debit end), 0) as pd,
      coalesce(sum(case when e.entry_date between p_from and p_to then l.credit end), 0) as pc
    from journal_entry_lines l
    join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_to
    join chart_of_accounts a on a.id = l.account_id
    where p_branch is null or coalesce(l.branch_id, e.branch_id) = p_branch
    group by a.code, a.name_ar, a.type
  )
  select code, name_ar, type,
         greatest(open_net, 0), greatest(-open_net, 0), pd, pc,
         greatest(open_net + pd - pc, 0), greatest(-(open_net + pd - pc), 0)
  from mv order by code
$$;

-- ---------------------------------------------------------------
-- 15) RLS on every new table (has_perm for module, has_acc_perm for duty)
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cost_centers','allocation_rules','recurring_entries','journal_entry_attachments',
                           'budgets','budget_lines','bank_statements','bank_statement_lines','bank_matches',
                           'bank_rules','fixed_asset_events','payment_reminders','sales_credit_notes',
                           'company_tax_profile','einvoice_documents','fin_alert_states','fiscal_years',
                           'period_reopen_log','accounting_duties','user_accounting_duties','assistant_log',
                           'ai_provider_config','accounting_audit_log']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy cc_read  on cost_centers for select to authenticated using (has_perm('accounting','view'));
create policy cc_write on cost_centers for all to authenticated
  using (has_acc_perm('budget','edit')) with check (has_acc_perm('budget','edit'));
create policy alloc_read  on allocation_rules for select to authenticated using (has_acc_perm('budget','view'));
create policy alloc_write on allocation_rules for all to authenticated
  using (has_acc_perm('budget','edit')) with check (has_acc_perm('budget','edit'));
create policy rec_read  on recurring_entries for select to authenticated using (has_acc_perm('gl','view'));
create policy rec_write on recurring_entries for all to authenticated
  using (has_acc_perm('gl','create')) with check (has_acc_perm('gl','create'));
create policy att_read  on journal_entry_attachments for select to authenticated using (has_acc_perm('gl','view'));
create policy att_insert on journal_entry_attachments for insert to authenticated with check (has_acc_perm('gl','create'));
create policy bud_read  on budgets for select to authenticated using (has_acc_perm('budget','view'));
create policy bud_write on budgets for all to authenticated
  using (has_acc_perm('budget','edit')) with check (has_acc_perm('budget','edit'));
create policy budl_read  on budget_lines for select to authenticated using (has_acc_perm('budget','view'));
create policy budl_write on budget_lines for all to authenticated
  using (has_acc_perm('budget','edit') and exists (select 1 from budgets b where b.id = budget_id and b.status = 'draft'))
  with check (has_acc_perm('budget','edit') and exists (select 1 from budgets b where b.id = budget_id and b.status = 'draft'));
create policy bst_read  on bank_statements for select to authenticated using (has_acc_perm('bank','view'));
create policy bst_write on bank_statements for insert to authenticated with check (has_acc_perm('bank','create'));
create policy bsl_read  on bank_statement_lines for select to authenticated using (has_acc_perm('bank','view'));
create policy bsl_write on bank_statement_lines for insert to authenticated with check (has_acc_perm('bank','create'));
create policy bm_read  on bank_matches for select to authenticated using (has_acc_perm('bank','view'));
create policy bm_write on bank_matches for all to authenticated
  using (has_acc_perm('bank','edit')) with check (has_acc_perm('bank','edit'));
create policy br_read  on bank_rules for select to authenticated using (has_acc_perm('bank','view'));
create policy br_write on bank_rules for all to authenticated
  using (has_acc_perm('bank','edit'))
  -- approving a rule needs the approve duty
  with check (has_acc_perm('bank','edit') and (not approved or has_acc_perm('bank','approve')));
create policy fae_read  on fixed_asset_events for select to authenticated using (has_acc_perm('assets','view'));
create policy fae_write on fixed_asset_events for insert to authenticated with check (has_acc_perm('assets','create'));
create policy rem_read  on payment_reminders for select to authenticated using (has_acc_perm('ar','view'));
create policy rem_write on payment_reminders for insert to authenticated with check (has_acc_perm('ar','create'));
create policy scn_read  on sales_credit_notes for select to authenticated using (has_acc_perm('ar','view'));
create policy scn_write on sales_credit_notes for insert to authenticated with check (has_acc_perm('ar','create'));
create policy ctp_read  on company_tax_profile for select to authenticated using (has_acc_perm('tax','view'));
create policy ctp_write on company_tax_profile for all to authenticated
  using (has_acc_perm('tax','edit')) with check (has_acc_perm('tax','edit'));
create policy einv_read  on einvoice_documents for select to authenticated using (has_acc_perm('tax','view'));
create policy einv_write on einvoice_documents for insert to authenticated with check (has_acc_perm('tax','create'));
create policy einv_upd on einvoice_documents for update to authenticated
  using (has_acc_perm('tax','edit')) with check (has_acc_perm('tax','edit'));
create policy fas_read  on fin_alert_states for select to authenticated using (has_perm('accounting','view'));
create policy fas_write on fin_alert_states for all to authenticated
  using (has_perm('accounting','view')) with check (has_perm('accounting','view'));
create policy fy_read  on fiscal_years for select to authenticated using (has_acc_perm('close','view'));
create policy fy_write on fiscal_years for all to authenticated
  using (has_acc_perm('close','approve')) with check (has_acc_perm('close','approve'));
create policy prl_read on period_reopen_log for select to authenticated using (has_acc_perm('close','view'));
create policy duty_read  on accounting_duties for select to authenticated using (has_perm('accounting','view'));
create policy duty_write on accounting_duties for all to authenticated using (is_admin()) with check (is_admin());
create policy uad_read  on user_accounting_duties for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy uad_write on user_accounting_duties for all to authenticated using (is_admin()) with check (is_admin());
create policy alog_read on assistant_log for select to authenticated using (user_id = auth.uid() or has_acc_perm('audit','view'));
create policy alog_insert on assistant_log for insert to authenticated with check (user_id = auth.uid());
create policy ai_read  on ai_provider_config for select to authenticated using (has_perm('accounting','view'));
create policy ai_write on ai_provider_config for all to authenticated using (is_admin()) with check (is_admin());
-- audit: read by auditors/CFO/admin; inserts only through SECURITY DEFINER triggers
create policy aud_read on accounting_audit_log for select to authenticated using (has_acc_perm('audit','view'));

grant execute on function submit_journal_entry(uuid), approve_journal_entry(uuid), post_journal_entry(uuid),
  void_journal_entry(uuid), reverse_journal_entry(uuid, date), close_period(int, int),
  reopen_period(int, int, text), trial_balance(date, date, uuid) to authenticated;
