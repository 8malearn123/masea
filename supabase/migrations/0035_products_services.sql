-- =============================================================
-- Masiat Alsharq ERP — 0035 Products & Services catalog (Accountant)
-- Managed catalog of Masiat services/products with selling price + the revenue
-- account each maps to + VAT applicability. Drives sales-invoice line items.
-- Reuses chart_of_accounts (revenue 4xxx) + has_perm. No hardcoded prices in code.
-- =============================================================

create table products_services (
  id            uuid primary key default gen_random_uuid(),
  name_ar       text not null,
  kind          text not null default 'service' check (kind in ('service','product')),
  service_code  text,                         -- links to the platform service (funnel) or null
  revenue_code  text not null references chart_of_accounts(code),  -- 41xx/45xx
  unit          text not null default 'fixed' check (unit in ('fixed','month','day','hour','unit')),
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  taxable       boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Saudi-realistic catalog mapped to the real services + revenue accounts.
insert into products_services (name_ar, kind, service_code, revenue_code, unit, default_price, taxable) values
  ('استقدام عمالة منزلية', 'service', 'recruitment',           '4100', 'fixed', 16000, true),
  ('تأجير عمالة شهري',     'service', 'monthly_rental',        '4200', 'month',  7500, true),
  ('تأجير عمالة يومي',     'service', 'daily_rental',          '4300', 'day',    1800, true),
  ('تأجير عمالة بالساعة',  'service', null,                    '4300', 'hour',    250, true),
  ('نقل كفالة',            'service', 'sponsorship_transfer',  '4400', 'fixed',  6000, true),
  ('خدمة نظافة منزلية',    'service', null,                    '4300', 'day',     400, true),
  ('رسوم إصدار تأشيرة',    'product', null,                    '4500', 'unit',   2000, true);

alter table products_services enable row level security;
create policy ps_read on products_services for select using (has_perm('accounting','view'));
create policy ps_write on products_services for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));
