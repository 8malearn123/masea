-- =============================================================
-- Masiat Alsharq ERP — 0023 Accounting (Phase A: double-entry foundation)
-- Chart of accounts + balanced journal + auto-posting engine.
-- Reuses: contracts (base/vat/total), payments, branches, service_type /
-- payment_method enums, has_perm/current_branch_id. No isolated island —
-- journals are GENERATED from operational events (contract signed, payment).
-- =============================================================

-- ---------- chart of accounts (hierarchical) --------------------
create table chart_of_accounts (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,
  name_ar        text not null,
  type           text not null check (type in ('asset','liability','equity','revenue','expense')),
  parent_id      uuid references chart_of_accounts(id) on delete restrict,
  is_postable    boolean not null default true,        -- leaf accounts only
  normal_balance text not null check (normal_balance in ('debit','credit')),
  created_at     timestamptz not null default now()
);
create index idx_coa_parent on chart_of_accounts(parent_id);
create index idx_coa_type on chart_of_accounts(type);

-- ---------- accounting periods (open / closed) -----------------
create table accounting_periods (
  id        uuid primary key default gen_random_uuid(),
  year      integer not null,
  month     integer not null check (month between 1 and 12),
  status    text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  unique (year, month)
);

-- ---------- journal entries (header) ---------------------------
create table journal_entries (
  id          uuid primary key default gen_random_uuid(),
  entry_no    serial unique,
  entry_date  date not null default current_date,
  period_id   uuid not null references accounting_periods(id) on delete restrict,
  branch_id   uuid references branches(id) on delete set null,   -- cost center; null = head office
  description text not null,
  reference   text,
  source_type text not null default 'manual'
              check (source_type in ('manual','contract','payment','payroll','loyalty','penalty','adjustment')),
  source_id   uuid,
  status      text not null default 'posted' check (status in ('posted','void')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_je_period on journal_entries(period_id);
create index idx_je_branch on journal_entries(branch_id);
create index idx_je_source on journal_entries(source_type, source_id);

-- ---------- journal entry lines (debit / credit) --------------
create table journal_entry_lines (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references journal_entries(id) on delete cascade,
  account_id  uuid not null references chart_of_accounts(id) on delete restrict,
  debit       numeric(14,2) not null default 0 check (debit  >= 0),
  credit      numeric(14,2) not null default 0 check (credit >= 0),
  branch_id   uuid references branches(id) on delete set null,
  description text,
  -- a line is either a debit or a credit, never both, never empty
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index idx_jel_entry on journal_entry_lines(entry_id);
create index idx_jel_account on journal_entry_lines(account_id);

-- =============================================================
-- Integrity: every entry must balance (Σ debit = Σ credit), only postable
-- accounts accept lines, and posting into a CLOSED period is forbidden.
-- =============================================================

-- account must be a postable leaf
create or replace function jel_account_postable() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from chart_of_accounts where id = new.account_id and is_postable) then
    raise exception 'الحساب % غير قابل للترحيل (حساب رئيسي)', new.account_id;
  end if;
  return new;
end;
$$;
create trigger trg_jel_postable before insert or update on journal_entry_lines
  for each row execute function jel_account_postable();

-- balance check, DEFERRED to commit so multi-line inserts are allowed mid-transaction
create or replace function je_assert_balanced() returns trigger
language plpgsql as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_cnt integer;
begin
  -- entry may have been deleted (cascade) — nothing to check
  if not exists (select 1 from journal_entries where id = v_entry) then
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
create constraint trigger trg_je_balanced
  after insert or update or delete on journal_entry_lines
  deferrable initially deferred
  for each row execute function je_assert_balanced();

-- forbid posting into a closed period (entry insert/update)
create or replace function je_period_open() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from accounting_periods p where p.id = new.period_id and p.status = 'closed') then
    raise exception 'لا يمكن الترحيل في فترة محاسبية مقفلة';
  end if;
  return new;
end;
$$;
create trigger trg_je_period_open before insert or update on journal_entries
  for each row execute function je_period_open();

-- =============================================================
-- Helpers + auto-posting engine
-- =============================================================
create or replace function acc_id(p_code text) returns uuid
language sql stable as $$ select id from chart_of_accounts where code = p_code $$;

-- get-or-create the (open) period for a date
create or replace function ensure_period(p_date date) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into accounting_periods (year, month)
  values (extract(year from p_date)::int, extract(month from p_date)::int)
  on conflict (year, month) do nothing;
  select id into v_id from accounting_periods
   where year = extract(year from p_date)::int and month = extract(month from p_date)::int;
  return v_id;
end;
$$;

-- revenue account by service_type (الخدمات الفعلية لماسية الشرق)
create or replace function revenue_account_for(p_service service_type) returns uuid
language sql stable as $$
  select acc_id(case p_service
    when 'direct'   then '4100'   -- استقدام
    when 'kafala'   then '4400'   -- نقل كفالة
    when 'monthly'  then '4200'   -- تأجير شهري
    else '4300'                   -- daily / hourly_8 / hourly_5 / cleaning → تأجير يومي وبالساعة
  end)
$$;

-- cash/bank account by payment method (مدى/Apple Pay عبر مُيسّر، تمارا حساب وسيط)
create or replace function cash_account_for(p_method payment_method) returns uuid
language sql stable as $$
  select acc_id(case p_method
    when 'cash'      then '1111'  -- الصندوق
    when 'transfer'  then '1112'  -- البنك
    when 'tamara'    then '1132'  -- تمارا (وسيط)
    else '1131'                   -- mada / apple_pay عبر مُيسّر (وسيط)
  end)
$$;

-- 1) Contract signed → DR ذمم العملاء / CR إيراد (قبل الضريبة) + CR ضريبة مخرجات
create or replace function post_contract_signed(p_contract_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c        contracts%rowtype;
  v_entry  uuid;
  v_period uuid;
begin
  select * into c from contracts where id = p_contract_id;
  if not found then raise exception 'العقد غير موجود'; end if;

  -- idempotent: one entry per contract
  select id into v_entry from journal_entries
   where source_type = 'contract' and source_id = p_contract_id and status = 'posted';
  if v_entry is not null then return v_entry; end if;

  v_period := ensure_period(coalesce(c.start_date, current_date));
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (coalesce(c.start_date, current_date), v_period, c.branch_id,
          'إثبات عقد رقم ' || c.contract_number, 'CON-' || c.contract_number, 'contract', p_contract_id)
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, acc_id('1120'), c.total_amount, 0, c.branch_id, 'ذمة العميل'),
    (v_entry, revenue_account_for(c.service_type), 0, c.base_amount, c.branch_id, 'إيراد الخدمة (قبل الضريبة)'),
    (v_entry, acc_id('2120'), 0, c.vat_amount, c.branch_id, 'ضريبة القيمة المضافة المستحقة');
  return v_entry;
end;
$$;

-- 2) Payment received → DR البنك/النقدية/الوسيط / CR ذمم العملاء
create or replace function post_payment_received(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p        payments%rowtype;
  v_branch uuid;
  v_entry  uuid;
  v_period uuid;
begin
  select * into p from payments where id = p_payment_id;
  if not found then raise exception 'الدفعة غير موجودة'; end if;

  select id into v_entry from journal_entries
   where source_type = 'payment' and source_id = p_payment_id and status = 'posted';
  if v_entry is not null then return v_entry; end if;

  select branch_id into v_branch from contracts where id = p.contract_id;
  v_period := ensure_period(p.paid_at::date);
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (p.paid_at::date, v_period, v_branch, 'تحصيل دفعة', coalesce(p.reference_no, 'PMT'), 'payment', p_payment_id)
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, cash_account_for(p.method), p.amount, 0, v_branch, 'تحصيل نقدي/بنكي'),
    (v_entry, acc_id('1120'), 0, p.amount, v_branch, 'سداد ذمة العميل');
  return v_entry;
end;
$$;

grant execute on function post_contract_signed(uuid)  to authenticated;
grant execute on function post_payment_received(uuid) to authenticated;

-- =============================================================
-- Seed: Saudi recruitment-company chart of accounts
-- =============================================================
-- headers (non-postable)
insert into chart_of_accounts (code, name_ar, type, is_postable, normal_balance) values
  ('1000','الأصول','asset',false,'debit'),
  ('1100','الأصول المتداولة','asset',false,'debit'),
  ('1110','النقدية والبنوك','asset',false,'debit'),
  ('1130','حسابات بوابات الدفع الوسيطة','asset',false,'debit'),
  ('2000','الخصوم','liability',false,'credit'),
  ('2100','الخصوم المتداولة','liability',false,'credit'),
  ('3000','حقوق الملكية','equity',false,'credit'),
  ('4000','الإيرادات','revenue',false,'credit'),
  ('5000','المصروفات','expense',false,'debit');

-- postable leaves with parents
insert into chart_of_accounts (code, name_ar, type, parent_id, normal_balance) values
  ('1111','الصندوق (نقدية)','asset', acc_id('1110'),'debit'),
  ('1112','البنك - مصرف الراجحي','asset', acc_id('1110'),'debit'),
  ('1113','البنك - البنك الأهلي','asset', acc_id('1110'),'debit'),
  ('1120','ذمم العملاء المدينة','asset', acc_id('1100'),'debit'),
  ('1131','مدينو مُيسّر (مدى/Apple Pay)','asset', acc_id('1130'),'debit'),
  ('1132','مدينو تمارا','asset', acc_id('1130'),'debit'),
  ('1140','ضريبة القيمة المضافة - المدخلات','asset', acc_id('1100'),'debit'),
  ('2110','الذمم الدائنة (الموردون/المكاتب الخارجية)','liability', acc_id('2100'),'credit'),
  ('2120','ضريبة القيمة المضافة - المخرجات المستحقة','liability', acc_id('2100'),'credit'),
  ('2130','رواتب مستحقة الدفع','liability', acc_id('2100'),'credit'),
  ('2140','تأمينات اجتماعية مستحقة (GOSI)','liability', acc_id('2100'),'credit'),
  ('2150','كاش باك ونقاط ولاء مستحقة','liability', acc_id('2100'),'credit'),
  ('3100','رأس المال','equity', acc_id('3000'),'credit'),
  ('3200','الأرباح المحتجزة','equity', acc_id('3000'),'credit'),
  ('4100','إيرادات الاستقدام','revenue', acc_id('4000'),'credit'),
  ('4200','إيرادات التأجير الشهري','revenue', acc_id('4000'),'credit'),
  ('4300','إيرادات التأجير اليومي وبالساعة','revenue', acc_id('4000'),'credit'),
  ('4400','إيرادات نقل الكفالة','revenue', acc_id('4000'),'credit'),
  ('4500','إيرادات أخرى (غرامات)','revenue', acc_id('4000'),'credit'),
  ('4900','خصومات ومردودات المبيعات','revenue', acc_id('4000'),'debit'),
  ('5100','مصروف الرواتب','expense', acc_id('5000'),'debit'),
  ('5200','مصروف التأمينات (حصة الشركة)','expense', acc_id('5000'),'debit'),
  ('5300','مصروف التسويق والولاء','expense', acc_id('5000'),'debit'),
  ('5400','مصروفات تشغيلية عامة','expense', acc_id('5000'),'debit'),
  ('5500','رسوم بوابات الدفع','expense', acc_id('5000'),'debit');

-- link the header parents (1100→1000, 1110→1100, etc.)
update chart_of_accounts set parent_id = acc_id('1000') where code = '1100';
update chart_of_accounts set parent_id = acc_id('1100') where code in ('1110','1130');
update chart_of_accounts set parent_id = acc_id('2000') where code = '2100';

-- =============================================================
-- RLS — accountant & admin manage all; branch_manager reads own cost center.
-- =============================================================
alter table chart_of_accounts   enable row level security;
alter table accounting_periods  enable row level security;
alter table journal_entries     enable row level security;
alter table journal_entry_lines enable row level security;

create policy coa_read  on chart_of_accounts for select using (has_perm('accounting','view'));
create policy coa_write on chart_of_accounts for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));

create policy period_read  on accounting_periods for select using (has_perm('accounting','view'));
create policy period_write on accounting_periods for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));

-- accountant/admin (create) see all; view-only roles (branch_manager) see their branch / head office
create policy je_read on journal_entries for select using (
  has_perm('accounting','view')
  and (has_perm('accounting','create') or branch_id = current_branch_id() or branch_id is null)
);
create policy je_write on journal_entries for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));

create policy jel_read on journal_entry_lines for select using (
  exists (select 1 from journal_entries e where e.id = entry_id and (
    has_perm('accounting','create') or e.branch_id = current_branch_id() or e.branch_id is null
  )) and has_perm('accounting','view')
);
create policy jel_write on journal_entry_lines for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));
