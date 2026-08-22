-- =============================================================
-- Masiat Alsharq ERP — 0006 Targets & Housing
-- =============================================================

create table targets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  branch_id        uuid references branches(id) on delete set null,
  month            integer not null check (month between 1 and 12),
  year             integer not null,
  contracts_target integer default 0,
  renewal_target   numeric(12,2) default 0,
  collection_target numeric(12,2) default 0,
  created_at       timestamptz not null default now(),
  unique (user_id, month, year)
);

create table target_progress (
  id                  uuid primary key default gen_random_uuid(),
  target_id           uuid not null references targets(id) on delete cascade,
  contracts_achieved  integer default 0,
  renewal_rate        numeric(5,2) default 0,
  collection_rate     numeric(5,2) default 0,
  avg_rating          numeric(3,2) default 0,
  updated_at          timestamptz not null default now(),
  unique (target_id)
);

create table rewards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  month            integer not null check (month between 1 and 12),
  year             integer not null,
  achievement_pct  numeric(5,2) default 0,
  reward_amount    numeric(12,2) default 0,
  paid_with_salary boolean not null default false,
  created_at       timestamptz not null default now()
);

create table housing_dorms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  branch_id     uuid references branches(id) on delete set null,
  supervisor_id uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table housing_attendance (
  id        uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  dorm_id   uuid references housing_dorms(id) on delete set null,
  date      date not null default current_date,
  status    housing_status not null default 'present',
  notes     text,
  unique (worker_id, date)
);
