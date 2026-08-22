-- =============================================================
-- Masiat Alsharq ERP — 0003 Contracts & Payments
-- =============================================================

create table contracts (
  id               uuid primary key default gen_random_uuid(),
  contract_number  serial unique,
  customer_id      uuid not null references customers(id) on delete restrict,
  worker_id        uuid references workers(id) on delete set null,
  branch_id        uuid references branches(id) on delete set null,
  driver_id        uuid references drivers(id) on delete set null,
  service_type     service_type not null,
  start_date       date,
  end_date         date,
  base_amount      numeric(12,2) not null default 0,
  vat_amount       numeric(12,2) generated always as (round(base_amount * 0.15, 2)) stored,
  total_amount     numeric(12,2) generated always as (round(base_amount * 1.15, 2)) stored,
  amount_paid      numeric(12,2) not null default 0,
  status           contract_status not null default 'draft',
  late_return_days integer not null default 0,
  payment_method   payment_method,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_contracts_customer on contracts(customer_id);
create index idx_contracts_worker on contracts(worker_id);
create index idx_contracts_branch on contracts(branch_id);
create index idx_contracts_status on contracts(status);

create table payments (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references contracts(id) on delete cascade,
  amount         numeric(12,2) not null,
  method         payment_method,
  installment_no integer default 1,
  reference_no   text,
  paid_at        timestamptz not null default now()
);
create index idx_payments_contract on payments(contract_id);

create table scans_log (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid references workers(id) on delete set null,
  contract_id uuid references contracts(id) on delete set null,
  driver_id   uuid references drivers(id) on delete set null,
  scan_type   scan_type not null,
  scanned_at  timestamptz not null default now(),
  latitude    numeric(10,7),
  longitude   numeric(10,7)
);
create index idx_scans_worker on scans_log(worker_id);
create index idx_scans_contract on scans_log(contract_id);

create table absence_reports (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid references contracts(id) on delete cascade,
  worker_id    uuid references workers(id) on delete set null,
  customer_id  uuid references customers(id) on delete set null,
  reported_at  timestamptz not null default now(),
  verified     boolean not null default false,
  false_report boolean not null default false
);

create table penalties (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid references contracts(id) on delete cascade,
  type        penalty_type not null,
  amount      numeric(12,2) not null default 0,
  days        integer default 0,
  is_paid     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_penalties_contract on penalties(contract_id);
