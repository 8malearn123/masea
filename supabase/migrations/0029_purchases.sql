-- =============================================================
-- Masiat Alsharq ERP — 0029 Purchases (Accounting Phase 4)
-- Vendors + the five purchase documents with double-entry posting:
--   فواتير مشتريات (bills, 0025) · سندات الموردين (payment vouchers) ·
--   مصروفات نقدية (cash expenses) · إشعارات مدينة (debit notes) · أوامر شراء (POs).
-- Reuses: bills (0025), chart_of_accounts, journal engine, branches, has_perm.
-- =============================================================

-- ---------- vendors (managed reference) ------------------------
create table vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  vendor_type text not null default 'supplier'
              check (vendor_type in ('external_office','supplier','gosi','utility','other')),
  vat_number  text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- bills gain a vendor link + payment tracking
alter table bills add column if not exists vendor_id uuid references vendors(id) on delete set null;
alter table bills add column if not exists amount_paid numeric(14,2) not null default 0;

-- ---------- سندات الموردين (vendor payment vouchers) -----------
create table payment_vouchers (
  id               uuid primary key default gen_random_uuid(),
  voucher_no       serial unique,
  bill_id          uuid references bills(id) on delete set null,
  vendor_name      text not null,
  amount           numeric(14,2) not null check (amount > 0),
  pay_account_code text not null default '1112' references chart_of_accounts(code), -- bank/cash
  branch_id        uuid references branches(id) on delete set null,
  voucher_date     date not null default current_date,
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- ---------- مصروفات نقدية (cash / petty expenses) -------------
create table cash_expenses (
  id               uuid primary key default gen_random_uuid(),
  expense_no       serial unique,
  description      text not null,
  expense_code     text not null default '5400' references chart_of_accounts(code),
  subtotal         numeric(14,2) not null check (subtotal >= 0),
  vat_amount       numeric(14,2) not null default 0,
  total            numeric(14,2) not null,
  pay_account_code text not null default '1111' references chart_of_accounts(code),
  branch_id        uuid references branches(id) on delete set null,
  expense_date     date not null default current_date,
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- ---------- إشعارات مدينة (debit notes — purchase returns) -----
create table debit_notes (
  id               uuid primary key default gen_random_uuid(),
  note_no          serial unique,
  bill_id          uuid references bills(id) on delete set null,
  vendor_name      text not null,
  expense_code     text not null default '5400' references chart_of_accounts(code),
  subtotal         numeric(14,2) not null check (subtotal >= 0),
  vat_amount       numeric(14,2) not null default 0,
  total            numeric(14,2) not null,
  reason           text,
  branch_id        uuid references branches(id) on delete set null,
  note_date        date not null default current_date,
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- ---------- أوامر شراء (purchase orders — non-financial) -------
create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  po_no         serial unique,
  vendor_name   text not null,
  branch_id     uuid references branches(id) on delete set null,
  status        text not null default 'draft'
                check (status in ('draft','approved','received','closed','cancelled')),
  order_date    date not null default current_date,
  expected_date date,
  total         numeric(14,2) not null default 0,
  created_at    timestamptz not null default now()
);
create table purchase_order_lines (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references purchase_orders(id) on delete cascade,
  description text not null,
  qty         numeric(12,2) not null default 1 check (qty > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  line_total  numeric(14,2) generated always as (round(qty * unit_price, 2)) stored
);

-- =============================================================
-- Posting functions (each balanced + idempotent by reference)
-- =============================================================

-- سند مورد: DR ذمم دائنة (2110) / CR البنك/النقدية
create or replace function post_payment_voucher(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v payment_vouchers%rowtype; v_entry uuid; v_period uuid;
begin
  select * into v from payment_vouchers where id = p_id;
  if not found then raise exception 'السند غير موجود'; end if;
  select id into v_entry from journal_entries where reference = 'PV-' || v.voucher_no;
  if v_entry is not null then return v_entry; end if;
  v_period := ensure_period(v.voucher_date);
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type)
  values (v.voucher_date, v_period, v.branch_id, 'سند صرف لمورد ' || v.vendor_name, 'PV-' || v.voucher_no, 'manual')
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, acc_id('2110'), v.amount, 0, v.branch_id, 'سداد ذمة دائنة'),
    (v_entry, acc_id(v.pay_account_code), 0, v.amount, v.branch_id, 'صرف نقدي/بنكي');
  if v.bill_id is not null then
    update bills set amount_paid = least(total, amount_paid + v.amount),
      status = case when amount_paid + v.amount >= total then 'paid' else 'partial' end
     where id = v.bill_id;
  end if;
  update payment_vouchers set journal_entry_id = v_entry where id = p_id;
  return v_entry;
end; $$;

-- مصروف نقدي: DR مصروف + DR ضريبة مدخلات / CR البنك/النقدية
create or replace function post_cash_expense(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare e cash_expenses%rowtype; v_entry uuid; v_period uuid;
begin
  select * into e from cash_expenses where id = p_id;
  if not found then raise exception 'المصروف غير موجود'; end if;
  select id into v_entry from journal_entries where reference = 'CE-' || e.expense_no;
  if v_entry is not null then return v_entry; end if;
  v_period := ensure_period(e.expense_date);
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type)
  values (e.expense_date, v_period, e.branch_id, 'مصروف نقدي: ' || e.description, 'CE-' || e.expense_no, 'manual')
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id(e.expense_code), e.subtotal, 0, e.branch_id, 'مصروف');
  if e.vat_amount > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('1140'), e.vat_amount, 0, e.branch_id, 'ضريبة مدخلات');
  end if;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id(e.pay_account_code), 0, e.total, e.branch_id, 'صرف نقدي/بنكي');
  update cash_expenses set journal_entry_id = v_entry where id = p_id;
  return v_entry;
end; $$;

-- إشعار مدين (مرتجع مشتريات): DR ذمم دائنة (2110) / CR مصروف + CR ضريبة مدخلات
create or replace function post_debit_note(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare n debit_notes%rowtype; v_entry uuid; v_period uuid;
begin
  select * into n from debit_notes where id = p_id;
  if not found then raise exception 'الإشعار غير موجود'; end if;
  select id into v_entry from journal_entries where reference = 'DN-' || n.note_no;
  if v_entry is not null then return v_entry; end if;
  v_period := ensure_period(n.note_date);
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type)
  values (n.note_date, v_period, n.branch_id, 'إشعار مدين على مورد ' || n.vendor_name, 'DN-' || n.note_no, 'manual')
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id('2110'), n.total, 0, n.branch_id, 'تخفيض ذمة دائنة');
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id(n.expense_code), 0, n.subtotal, n.branch_id, 'تخفيض مصروف');
  if n.vat_amount > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('1140'), 0, n.vat_amount, n.branch_id, 'عكس ضريبة مدخلات');
  end if;
  update debit_notes set journal_entry_id = v_entry where id = p_id;
  return v_entry;
end; $$;

grant execute on function post_payment_voucher(uuid), post_cash_expense(uuid), post_debit_note(uuid)
  to authenticated;

-- =============================================================
-- RLS — accountant/admin manage; branch managers read their cost center.
-- =============================================================
alter table vendors              enable row level security;
alter table payment_vouchers     enable row level security;
alter table cash_expenses        enable row level security;
alter table debit_notes          enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_lines enable row level security;

create policy vendors_read on vendors for select using (has_perm('accounting','view'));
create policy vendors_write on vendors for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));

do $$
declare t text;
begin
  foreach t in array array['payment_vouchers','cash_expenses','debit_notes','purchase_orders'] loop
    execute format(
      'create policy %1$s_read on %1$s for select using (has_perm(''accounting'',''view'')
         and (has_perm(''accounting'',''create'') or branch_id = current_branch_id() or branch_id is null))',
      t);
    execute format(
      'create policy %1$s_write on %1$s for all using (has_perm(''accounting'',''create''))
         with check (has_perm(''accounting'',''create''))', t);
  end loop;
end $$;

create policy pol_lines_read on purchase_order_lines for select using (
  exists (select 1 from purchase_orders po where po.id = po_id and (
    has_perm('accounting','create') or po.branch_id = current_branch_id() or po.branch_id is null
  )) and has_perm('accounting','view'));
create policy pol_lines_write on purchase_order_lines for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));
