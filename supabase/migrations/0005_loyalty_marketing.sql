-- =============================================================
-- Masiat Alsharq ERP — 0005 Loyalty & Marketing
-- =============================================================

create table loyalty_transactions (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  type        loyalty_txn_type not null,
  points      integer not null default 0,
  amount      numeric(12,2) not null default 0,
  description text,
  contract_id uuid references contracts(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_loyalty_customer on loyalty_transactions(customer_id);

create table campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         campaign_type not null,
  discount_pct numeric(5,2) default 0,
  start_at     timestamptz,
  end_at       timestamptz,
  is_active    boolean not null default true,
  usage_count  integer not null default 0,
  created_at   timestamptz not null default now()
);

create table abandoned_carts (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid references customers(id) on delete cascade,
  service_type     service_type,
  estimated_amount numeric(12,2) default 0,
  created_at       timestamptz not null default now(),
  reminded_at      timestamptz,
  converted        boolean not null default false
);

create table referrals (
  id                uuid primary key default gen_random_uuid(),
  referrer_id       uuid references customers(id) on delete set null,
  referee_id        uuid references customers(id) on delete set null,
  commission_amount numeric(12,2) default 0,
  is_paid           boolean not null default false,
  created_at        timestamptz not null default now()
);
