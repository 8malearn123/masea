-- =============================================================
-- Masiat Alsharq ERP — 0011 Customer Sales Funnel (B2C)
-- Public-facing catalog + order intake that writes into the
-- internal order pipeline. Reuses existing `branches` / `customers`.
-- =============================================================

-- ---------- services (extensible catalog) ----------
create table services (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,          -- recruitment | monthly_rental | daily_rental | sponsorship_transfer | ...
  name_ar       text not null,
  tagline_ar    text,
  description_ar text,
  icon          text,                           -- emoji / icon key
  unit          text not null default 'fixed',  -- fixed | month | day
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- worker_profiles (public showcase — NO sensitive PII) ----------
create table worker_profiles (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  nationality      text not null,
  profession       text not null,
  age              integer,
  experience_years integer not null default 0,
  languages        text[] not null default '{}',
  monthly_salary   numeric(12,2) not null default 0,
  status           text not null default 'available',  -- available | reserved
  photo_url        text,
  bio_ar           text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
create index idx_wp_status on worker_profiles(status);
create index idx_wp_profession on worker_profiles(profession);

-- ---------- pricing_rules (service + nationality/profession + duration) ----------
create table pricing_rules (
  id            uuid primary key default gen_random_uuid(),
  service_code  text not null references services(code) on delete cascade,
  nationality   text,            -- null = any
  profession    text,            -- null = any
  duration_unit text,            -- fixed | month | day
  base_price    numeric(12,2) not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index idx_pricing_service on pricing_rules(service_code);

-- ---------- service_requests (the order pipeline) ----------
create table service_requests (
  id                   uuid primary key default gen_random_uuid(),
  request_no           text not null unique
                         default ('REQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  service_code         text not null references services(code),
  details              jsonb not null default '{}'::jsonb,
  branch_id            uuid references branches(id) on delete set null,
  customer_id          uuid references customers(id) on delete set null,
  worker_profile_id    uuid references worker_profiles(id) on delete set null,
  customer_name        text,
  customer_phone       text,
  customer_national_id text,
  customer_city        text,
  base_amount          numeric(12,2) not null default 0,
  vat_amount           numeric(12,2) not null default 0,
  total_amount         numeric(12,2) not null default 0,
  status               text not null default 'new',     -- new | paid | processing | completed | cancelled
  payment_status       text not null default 'unpaid',  -- unpaid | paid | partial
  created_at           timestamptz not null default now()
);
create index idx_sr_service on service_requests(service_code);
create index idx_sr_status on service_requests(status);
create index idx_sr_created on service_requests(created_at desc);

-- ---------- calc_price(): VAT computed in the backend, never the client ----------
-- SECURITY DEFINER so anon can price an order via RPC without ever
-- being able to read the pricing_rules table directly.
create or replace function calc_price(p_service_code text, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_qty   numeric := coalesce((p_params->>'quantity')::numeric, 1);
  v_nat   text    := nullif(p_params->>'nationality', '');
  v_prof  text    := nullif(p_params->>'profession', '');
  v_rule  numeric(12,2);
  v_base  numeric(12,2);
  v_vat   numeric(12,2);
begin
  -- pick the most specific active rule for this service
  select base_price
    into v_rule
  from pricing_rules
  where service_code = p_service_code
    and is_active
    and (nationality is null or nationality = v_nat)
    and (profession  is null or profession  = v_prof)
  order by (case when nationality is not null then 1 else 0 end)
         + (case when profession  is not null then 1 else 0 end) desc
  limit 1;

  v_base := round(coalesce(v_rule, 0) * greatest(coalesce(v_qty, 1), 1), 2);
  v_vat  := round(v_base * 0.15, 2);

  return jsonb_build_object('base', v_base, 'vat', v_vat, 'total', v_base + v_vat);
end;
$$;

grant execute on function calc_price(text, jsonb) to anon, authenticated;

-- =============================================================
-- RLS — public catalog read, public order write, no public read of internals
-- =============================================================
alter table services         enable row level security;
alter table worker_profiles  enable row level security;
alter table pricing_rules    enable row level security;
alter table service_requests enable row level security;

-- services: public read (active only); admin manages
create policy services_public_read on services
  for select to anon, authenticated using (is_active);
create policy services_admin on services
  for all to authenticated using (is_admin()) with check (is_admin());

-- worker_profiles: public sees only available + active; staff full
create policy wp_public_read on worker_profiles
  for select to anon, authenticated using (is_active and status = 'available');
create policy wp_staff_read on worker_profiles
  for select to authenticated using (true);
create policy wp_admin on worker_profiles
  for all to authenticated using (is_admin()) with check (is_admin());

-- pricing_rules: NOT public (priced through calc_price); staff read, admin manage
create policy pricing_staff_read on pricing_rules
  for select to authenticated using (true);
create policy pricing_admin on pricing_rules
  for all to authenticated using (is_admin()) with check (is_admin());

-- service_requests: anyone may submit; only staff may read/manage
create policy sr_public_insert on service_requests
  for insert to anon, authenticated with check (true);
create policy sr_staff_read on service_requests
  for select to authenticated using (true);
create policy sr_staff_write on service_requests
  for all to authenticated using (is_admin()) with check (is_admin());

-- customers: allow guest (anon) INSERT only — no public read of the CRM
create policy customers_public_insert on customers
  for insert to anon with check (true);
