-- =============================================================
-- Masiat Alsharq ERP — 0002 Core Tables
-- =============================================================

create table branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  phone       text,
  email       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table workers (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  nationality   text,
  passport_no   text,
  iqama_no      text,
  phone         text,
  branch_id     uuid references branches(id) on delete set null,
  status        worker_status not null default 'available',
  profession    text,
  daily_rate    numeric(12,2) default 0,
  monthly_rate  numeric(12,2) default 0,
  barcode       text unique,
  photo_url     text,
  rating        numeric(3,2) default 0,
  notes         text,
  created_at    timestamptz not null default now()
);
create index idx_workers_branch on workers(branch_id);
create index idx_workers_status on workers(status);

create table customers (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  national_id     text,
  phone           text,
  address         text,
  city            text,
  branch_id       uuid references branches(id) on delete set null,
  email           text,
  loyalty_points  integer not null default 0,
  wallet_balance  numeric(12,2) not null default 0,
  segment         customer_segment not null default 'bronze',
  created_at      timestamptz not null default now()
);
create index idx_customers_branch on customers(branch_id);
create index idx_customers_phone on customers(phone);

create table drivers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text,
  branch_id   uuid references branches(id) on delete set null,
  status      driver_status not null default 'available',
  vehicle_no  text,
  rating      numeric(3,2) default 0,
  created_at  timestamptz not null default now()
);
create index idx_drivers_branch on drivers(branch_id);
