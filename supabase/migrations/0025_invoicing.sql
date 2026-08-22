-- =============================================================
-- Masiat Alsharq ERP — 0025 Invoicing & Payables (Accounting Phase B)
-- AR invoices (linked to contracts, 15% VAT separated) + ZATCA fields +
-- AP bills (external offices / suppliers / GOSI) with auto-posting.
-- Reuses: contracts, customers, branches, journal_entries (0023),
-- chart_of_accounts, has_perm. Revenue recognition stays in the contract's
-- journal entry (0023) — an invoice is the TAX DOCUMENT over it (no double post).
-- =============================================================

-- ---------- AR: sales invoices -------------------------------
create table invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    serial unique,
  invoice_type  text not null default 'simplified'
                check (invoice_type in ('standard','simplified')), -- B2B معيارية / B2C مبسطة
  contract_id   uuid references contracts(id) on delete set null,
  customer_id   uuid references customers(id) on delete set null,
  branch_id     uuid references branches(id) on delete set null,
  issue_date    date not null default current_date,
  due_date      date,
  subtotal      numeric(14,2) not null default 0,  -- قبل الضريبة
  vat_amount    numeric(14,2) not null default 0,  -- ضريبة منفصلة
  total         numeric(14,2) not null default 0,
  status        text not null default 'draft'
                check (status in ('draft','issued','paid','partial','void')),
  -- ZATCA e-invoice fields (Phase 1 QR now; Phase 2 stamp pending Fatoora onboarding)
  zatca_uuid    uuid not null default gen_random_uuid(),
  zatca_qr      text,    -- base64 TLV payload (built by the zatca adapter)
  zatca_hash    text,    -- TODO(zatca-ph2): cryptographic stamp / PCSID signature
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index idx_invoices_contract on invoices(contract_id);
create index idx_invoices_status on invoices(status);

create table invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  description   text not null,
  qty           numeric(12,2) not null default 1 check (qty > 0),
  unit_price    numeric(14,2) not null check (unit_price >= 0),
  vat_rate      numeric(5,4) not null default 0.15,
  line_subtotal numeric(14,2) generated always as (round(qty * unit_price, 2)) stored,
  line_vat      numeric(14,2) generated always as (round(qty * unit_price * vat_rate, 2)) stored,
  line_total    numeric(14,2) generated always as (round(qty * unit_price * (1 + vat_rate), 2)) stored
);
create index idx_invoice_lines_invoice on invoice_lines(invoice_id);

-- ---------- AP: vendor bills (payables) ----------------------
create table bills (
  id            uuid primary key default gen_random_uuid(),
  bill_no       serial unique,
  vendor_name   text not null,
  vendor_type   text not null default 'supplier'
                check (vendor_type in ('external_office','supplier','gosi','utility','other')),
  branch_id     uuid references branches(id) on delete set null,
  issue_date    date not null default current_date,
  due_date      date,
  subtotal      numeric(14,2) not null default 0,
  vat_amount    numeric(14,2) not null default 0,  -- ضريبة المدخلات القابلة للخصم
  total         numeric(14,2) not null default 0,
  expense_code  text not null default '5400' references chart_of_accounts(code),
  status        text not null default 'open' check (status in ('open','paid','partial','void')),
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index idx_bills_status on bills(status);

-- =============================================================
-- Auto-posting: vendor bill received →
--   DR مصروف (5xxx) + DR ضريبة مدخلات (1140) / CR ذمم دائنة (2110)
-- (Sales invoices do NOT post here — revenue was booked when the contract was
--  signed in 0023; the invoice only carries the ZATCA tax document.)
-- =============================================================
create or replace function post_bill_received(p_bill_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b        bills%rowtype;
  v_entry  uuid;
  v_period uuid;
begin
  select * into b from bills where id = p_bill_id;
  if not found then raise exception 'الفاتورة الواردة غير موجودة'; end if;

  select id into v_entry from journal_entries
   where source_type = 'manual' and reference = 'BILL-' || b.bill_no;
  if v_entry is not null then return v_entry; end if;

  v_period := ensure_period(b.issue_date);
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type)
  values (b.issue_date, v_period, b.branch_id,
          'فاتورة واردة من ' || b.vendor_name, 'BILL-' || b.bill_no, 'manual')
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id(b.expense_code), b.subtotal, 0, b.branch_id, 'مصروف');
  -- input VAT line only when the bill carries deductible VAT (avoids a 0/0 line)
  if b.vat_amount > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('1140'), b.vat_amount, 0, b.branch_id, 'ضريبة مدخلات');
  end if;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id('2110'), 0, b.total, b.branch_id, 'ذمة دائنة - ' || b.vendor_name);

  update bills set journal_entry_id = v_entry where id = p_bill_id;
  return v_entry;
end;
$$;

grant execute on function post_bill_received(uuid) to authenticated;

-- =============================================================
-- RLS — accountant & admin manage; branch managers read their cost center.
-- =============================================================
alter table invoices      enable row level security;
alter table invoice_lines enable row level security;
alter table bills         enable row level security;

create policy inv_read on invoices for select using (
  has_perm('accounting','view')
  and (has_perm('accounting','create') or branch_id = current_branch_id() or branch_id is null)
);
create policy inv_write on invoices for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));

create policy invl_read on invoice_lines for select using (
  exists (select 1 from invoices i where i.id = invoice_id and (
    has_perm('accounting','create') or i.branch_id = current_branch_id() or i.branch_id is null
  )) and has_perm('accounting','view')
);
create policy invl_write on invoice_lines for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));

create policy bill_read on bills for select using (
  has_perm('accounting','view')
  and (has_perm('accounting','create') or branch_id = current_branch_id() or branch_id is null)
);
create policy bill_write on bills for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));
