-- =============================================================
-- Masiat Alsharq ERP — 0019 Pricing engine (module 03)
-- Single source of truth for prices. Builds the price in fixed layers:
--   base − discounts + penalties = net  →  + VAT(net) = total
-- All tunables live in pricing_config (no hard-coded values in app code).
-- Every calculation is logged to pricing_log for audit / dispute.
--
-- Reuses existing: pricing_rules (0011), has_perm (0013). Extends the
-- existing calc_price() — the returned object is a superset of the old
-- {base,vat,total}, so existing consumers (contracts, landing) keep working.
-- =============================================================

-- ---------- 1) tunable config (singleton) --------------------
create table if not exists pricing_config (
  id                        integer primary key default 1 check (id = 1),
  vat_rate                  numeric(5,4)  not null default 0.15,
  late_grace_days           integer       not null default 3,
  late_daily_pct            numeric(5,2)  not null default 1,   -- % per late day
  late_max_pct              numeric(5,2)  not null default 10,  -- cap
  cancellation_pct          numeric(5,2)  not null default 25,  -- after dispatch
  absence_compensation_rule jsonb         not null default '{"per_day": 50, "max_days": 5}',
  updated_at                timestamptz   not null default now()
);
insert into pricing_config (id) values (1) on conflict (id) do nothing;

-- ---------- 2) audit log -------------------------------------
create table if not exists pricing_log (
  id           uuid primary key default gen_random_uuid(),
  service_code text not null,
  params       jsonb not null,
  result       jsonb not null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pricing_log_created on pricing_log(created_at desc);

-- ---------- 3) calc_price(): layered, logged -----------------
create or replace function calc_price(p_service_code text, p_params jsonb)
returns jsonb
language plpgsql
volatile               -- writes to pricing_log
security definer
set search_path = public
as $$
declare
  v_cfg        pricing_config%rowtype;
  v_qty        numeric := greatest(coalesce((p_params->>'quantity')::numeric, 1), 1);
  v_nat        text    := nullif(p_params->>'nationality', '');
  v_prof       text    := nullif(p_params->>'profession', '');
  v_rule       numeric(12,2);
  v_base       numeric(12,2);
  v_discounts  numeric(12,2) := 0;
  v_penalties  numeric(12,2) := 0;
  v_net        numeric(12,2);
  v_vat        numeric(12,2);
  v_total      numeric(12,2);
  v_late_days  integer := coalesce((p_params->>'late_days')::integer, 0);
  v_absence    integer := coalesce((p_params->>'absence_days')::integer, 0);
  v_late_pct   numeric(5,2);
  v_abs_perday numeric(12,2);
  v_abs_max    integer;
  v_result     jsonb;
begin
  select * into v_cfg from pricing_config where id = 1;

  -- (1) base from the most specific active rule
  select base_price into v_rule
  from pricing_rules
  where service_code = p_service_code and is_active
    and (nationality is null or nationality = v_nat)
    and (profession  is null or profession  = v_prof)
  order by (case when nationality is not null then 1 else 0 end)
         + (case when profession  is not null then 1 else 0 end) desc
  limit 1;
  v_base := round(coalesce(v_rule, 0) * v_qty, 2);

  -- (2) discounts: explicit (loyalty/first-order/wallet) + absence compensation
  v_discounts := round(
      coalesce((p_params->>'discount_amount')::numeric, 0)
    + v_base * coalesce((p_params->>'discount_pct')::numeric, 0) / 100.0
    + coalesce((p_params->>'wallet_redeem')::numeric, 0)
  , 2);
  if v_absence > 0 then
    v_abs_perday := coalesce((v_cfg.absence_compensation_rule->>'per_day')::numeric, 0);
    v_abs_max    := coalesce((v_cfg.absence_compensation_rule->>'max_days')::integer, 0);
    v_discounts  := v_discounts + round(v_abs_perday * least(v_absence, v_abs_max), 2);
  end if;
  v_discounts := least(v_discounts, v_base); -- never discount below zero

  -- (3) penalties: late payment + cancellation
  if v_late_days > v_cfg.late_grace_days then
    v_late_pct  := least(v_late_days * v_cfg.late_daily_pct, v_cfg.late_max_pct);
    v_penalties := v_penalties + round(v_base * v_late_pct / 100.0, 2);
  end if;
  if coalesce((p_params->>'cancelled')::boolean, false) then
    v_penalties := v_penalties + round(v_base * v_cfg.cancellation_pct / 100.0, 2);
  end if;

  -- (4) net + VAT (VAT is on the NET, after discounts & penalties)
  v_net   := greatest(v_base - v_discounts + v_penalties, 0);
  v_vat   := round(v_net * v_cfg.vat_rate, 2);
  v_total := v_net + v_vat;

  v_result := jsonb_build_object(
    'base', v_base, 'discounts', v_discounts, 'penalties', v_penalties,
    'net', v_net, 'vat', v_vat, 'total', v_total
  );

  insert into pricing_log (service_code, params, result, created_by)
  values (p_service_code, p_params, v_result, auth.uid());

  return v_result;
end;
$$;

grant execute on function calc_price(text, jsonb) to anon, authenticated;

-- ---------- 4) RLS -------------------------------------------
alter table pricing_config enable row level security;
alter table pricing_log    enable row level security;

-- config: staff with pricing.view can read; only pricing.manage can change.
create policy pricing_config_read on pricing_config
  for select using (has_perm('pricing', 'view'));
create policy pricing_config_write on pricing_config
  for all using (has_perm('pricing', 'manage')) with check (has_perm('pricing', 'manage'));

-- log: readable by pricing.view; inserts happen via SECURITY DEFINER calc_price.
create policy pricing_log_read on pricing_log
  for select using (has_perm('pricing', 'view'));
