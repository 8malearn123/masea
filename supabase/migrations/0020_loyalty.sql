-- =============================================================
-- Masiat Alsharq ERP — 0020 Loyalty & Marketing (module 07)
-- "من عميل عادي إلى سفير للعلامة"
--
-- Reuses: customers (loyalty_points, wallet_balance, segment), service_requests,
-- enums customer_segment + loyalty_txn_type, has_perm (RBAC). Adds only the new
-- loyalty primitives. Points & wallet are LEDGERS (balance = SUM of rows);
-- the wheel prize is decided server-side by stored probabilities.
-- =============================================================

alter table customers add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_customers_user on customers(user_id);

-- ---------- 1) tunable config (singleton) --------------------
create table loyalty_config (
  id                                integer primary key default 1 check (id = 1),
  points_per_riyal                  numeric(6,2)  not null default 1,
  redeem_points_per_riyal           numeric(6,2)  not null default 100,  -- 100 نقطة = 1 ريال
  first_order_discount_pct          numeric(5,2)  not null default 10,
  absence_compensation_rule         jsonb         not null default '{"per_day": 50, "max_days": 5}',
  referral_commission_pct           numeric(5,2)  not null default 5,
  free_postponement_count           integer       not null default 1,
  postponement_fee                  numeric(12,2) not null default 100,
  abandoned_cart_window_hours       integer       not null default 24,
  abandoned_cart_extra_discount_pct numeric(5,2)  not null default 5,
  wheel_spins_per_customer          integer       not null default 1,
  updated_at                        timestamptz   not null default now()
);
insert into loyalty_config (id) values (1);

-- ---------- 2) customer tiers --------------------------------
create table customer_tiers (
  tier      customer_segment primary key,
  label     text          not null,
  min_spend numeric(12,2) not null,
  benefits  jsonb         not null default '{}'
);
insert into customer_tiers (tier, label, min_spend, benefits) values
  ('bronze', 'برونز',  0,     '{"points_multiplier": 1.0,  "free_postponement": 1}'),
  ('silver', 'فضي',   10000, '{"points_multiplier": 1.25, "free_postponement": 2, "priority_support": true}'),
  ('gold',   'ذهبي',  30000, '{"points_multiplier": 1.5,  "free_postponement": 3, "priority_support": true, "dedicated_manager": true}');

-- ---------- 3) points ledger (signed: earn +, redeem −) ------
create table points_ledger (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  type        loyalty_txn_type not null,
  points      integer not null,
  order_id    uuid references service_requests(id) on delete set null,
  description text,
  created_at  timestamptz not null default now()
);
create index idx_points_ledger_customer on points_ledger(customer_id);

-- ---------- 4) wallet ledger (cashback) ----------------------
create table wallet_ledger (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  type        text not null check (type in ('credit', 'debit')),
  amount      numeric(12,2) not null check (amount >= 0),
  source      text not null check (source in ('cashback', 'referral', 'prize', 'absence', 'redeem', 'order')),
  order_id    uuid references service_requests(id) on delete set null,
  description text,
  created_at  timestamptz not null default now()
);
create index idx_wallet_ledger_customer on wallet_ledger(customer_id);

-- ---------- 5) referrals (replaces 0005 stub) ----------------
drop table if exists referrals cascade;
create table referrals (
  id                   uuid primary key default gen_random_uuid(),
  referrer_customer_id uuid not null references customers(id) on delete cascade,
  referral_code        text not null unique,
  referred_customer_id uuid references customers(id) on delete set null,
  status               text not null default 'pending' check (status in ('pending', 'joined', 'rewarded')),
  commission_amount    numeric(12,2) not null default 0,
  created_at           timestamptz not null default now(),
  rewarded_at          timestamptz
);
create index idx_referrals_referrer on referrals(referrer_customer_id);

-- ---------- 6) promotions ------------------------------------
create table promotions (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  type            text not null check (type in ('first_order', 'hourly_offer', 'absence', 'abandoned_cart')),
  discount_pct    numeric(5,2),
  discount_amount numeric(12,2),
  starts_at       timestamptz,
  ends_at         timestamptz,
  is_active       boolean not null default true,
  target_segment  customer_segment,
  created_at      timestamptz not null default now()
);
insert into promotions (name, type, discount_pct, is_active) values
  ('خصم الطلب الأول', 'first_order', 10, true),
  ('عرض الساعة — تأجير شهري', 'hourly_offer', 15, true);

-- ---------- 7) abandoned carts (replaces 0005 stub) ----------
drop table if exists abandoned_carts cascade;
create table abandoned_carts (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid references customers(id) on delete cascade,
  cart_snapshot    jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  reminder_sent_at timestamptz,
  recovered_at     timestamptz
);
create index idx_abandoned_carts_open on abandoned_carts(created_at) where recovered_at is null;

-- ---------- 8) wheel prizes (probabilities sum to 100) -------
create table wheel_prizes (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  prize_type  text not null check (prize_type in ('points', 'wallet', 'discount', 'free_service', 'none')),
  value       numeric(12,2) not null default 0,
  probability numeric(5,2) not null check (probability >= 0 and probability <= 100),
  is_active   boolean not null default true,
  sort_order  integer not null default 0
);
insert into wheel_prizes (label, prize_type, value, probability, sort_order) values
  ('100 نقطة',       'points',       100, 30, 1),
  ('20 ريال محفظة',  'wallet',        20, 20, 2),
  ('خصم 10٪',        'discount',      10, 20, 3),
  ('500 نقطة',       'points',       500, 10, 4),
  ('تأجيل مجاني',     'free_service',   1,  8, 5),
  ('50 ريال محفظة',  'wallet',        50,  5, 6),
  ('حظ أوفر',        'none',           0,  7, 7);

-- ---------- 9) wheel spins -----------------------------------
create table wheel_spins (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  prize_id    uuid references wheel_prizes(id) on delete set null,
  spun_at     timestamptz not null default now()
);
create index idx_wheel_spins_customer on wheel_spins(customer_id);

-- ---------- 10) packages -------------------------------------
create table packages (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  included_services jsonb not null default '[]',
  special_price     numeric(12,2) not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
insert into packages (name, included_services, special_price) values
  ('باقة العائلة', '["استقدام","خدمة يومية شهر"]', 17500),
  ('باقة المنزل المتكامل', '["تأجير شهري","نقل كفالة"]', 4200);

-- ---------- 11) order postponements --------------------------
create table order_postponements (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references service_requests(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  postponed_at timestamptz not null default now(),
  is_free      boolean not null default true,
  fee_charged  numeric(12,2) not null default 0
);

-- =============================================================
-- DB FUNCTIONS (SECURITY DEFINER — server is the source of truth)
-- =============================================================

-- recompute & store cached balances on customers from the ledgers
create or replace function loyalty_sync_balances(p_customer_id uuid)
returns void language sql security definer set search_path = public as $$
  update customers set
    loyalty_points = coalesce((select sum(points) from points_ledger where customer_id = p_customer_id), 0),
    wallet_balance = coalesce((select sum(case when type = 'credit' then amount else -amount end)
                               from wallet_ledger where customer_id = p_customer_id), 0)
  where id = p_customer_id;
$$;

-- evaluate_tier: recompute the customer's tier from total paid spend
create or replace function evaluate_tier(p_customer_id uuid)
returns customer_segment language plpgsql security definer set search_path = public as $$
declare v_spend numeric(12,2); v_tier customer_segment;
begin
  select coalesce(sum(total_amount), 0) into v_spend
  from service_requests
  where customer_id = p_customer_id and status in ('paid', 'completed');

  select tier into v_tier from customer_tiers
  where min_spend <= v_spend order by min_spend desc limit 1;

  v_tier := coalesce(v_tier, 'bronze');
  update customers set segment = v_tier where id = p_customer_id;
  return v_tier;
end;
$$;

-- award_points: at payment — points (×tier multiplier) + referral payout + tier eval
create or replace function award_points(p_customer_id uuid, p_order_total numeric, p_order_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_cfg   loyalty_config%rowtype;
  v_mult  numeric := 1;
  v_pts   integer;
  v_ref   referrals%rowtype;
  v_comm  numeric(12,2);
begin
  select * into v_cfg from loyalty_config where id = 1;
  select coalesce((benefits->>'points_multiplier')::numeric, 1) into v_mult
  from customer_tiers where tier = (select segment from customers where id = p_customer_id);

  v_pts := floor(p_order_total * v_cfg.points_per_riyal * coalesce(v_mult, 1));
  insert into points_ledger (customer_id, type, points, order_id, description)
  values (p_customer_id, 'earn', v_pts, p_order_id, 'نقاط على طلب مدفوع');

  -- referral commission on the referred customer's first paid order
  select * into v_ref from referrals
  where referred_customer_id = p_customer_id and status = 'joined' limit 1;
  if found then
    v_comm := round(p_order_total * v_cfg.referral_commission_pct / 100.0, 2);
    insert into wallet_ledger (customer_id, type, amount, source, order_id, description)
    values (v_ref.referrer_customer_id, 'credit', v_comm, 'referral', p_order_id, 'عمولة إحالة');
    update referrals set status = 'rewarded', commission_amount = v_comm, rewarded_at = now()
    where id = v_ref.id;
    perform loyalty_sync_balances(v_ref.referrer_customer_id);
  end if;

  perform loyalty_sync_balances(p_customer_id);
  perform evaluate_tier(p_customer_id);
  return v_pts;
end;
$$;

-- redeem_points: convert points → SAR value (config rate). Guards balance.
create or replace function redeem_points(p_customer_id uuid, p_points integer)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_cfg loyalty_config%rowtype; v_bal integer; v_value numeric(12,2);
begin
  if p_points <= 0 then raise exception 'عدد النقاط غير صالح'; end if;
  select * into v_cfg from loyalty_config where id = 1;
  select coalesce(sum(points), 0) into v_bal from points_ledger where customer_id = p_customer_id;
  if v_bal < p_points then raise exception 'رصيد النقاط غير كافٍ'; end if;

  insert into points_ledger (customer_id, type, points, description)
  values (p_customer_id, 'redeem', -p_points, 'استبدال نقاط');
  perform loyalty_sync_balances(p_customer_id);
  v_value := round(p_points / v_cfg.redeem_points_per_riyal, 2);
  return v_value;
end;
$$;

-- spin_wheel: server picks the prize by stored probabilities, never the client
create or replace function spin_wheel(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg   loyalty_config%rowtype;
  v_used  integer;
  v_total numeric;
  v_r     numeric;
  v_acc   numeric := 0;
  v_prize wheel_prizes%rowtype;
begin
  select * into v_cfg from loyalty_config where id = 1;
  select count(*) into v_used from wheel_spins where customer_id = p_customer_id;
  if v_used >= v_cfg.wheel_spins_per_customer then
    raise exception 'تجاوزت عدد محاولات عجلة الحظ المسموحة';
  end if;

  select sum(probability) into v_total from wheel_prizes where is_active;
  v_r := random() * v_total;
  for v_prize in select * from wheel_prizes where is_active order by sort_order loop
    v_acc := v_acc + v_prize.probability;
    exit when v_r <= v_acc;
  end loop;

  insert into wheel_spins (customer_id, prize_id) values (p_customer_id, v_prize.id);

  if v_prize.prize_type = 'points' then
    insert into points_ledger (customer_id, type, points, description)
    values (p_customer_id, 'earn', v_prize.value::integer, 'جائزة عجلة الحظ');
    perform loyalty_sync_balances(p_customer_id);
  elsif v_prize.prize_type = 'wallet' then
    insert into wallet_ledger (customer_id, type, amount, source, description)
    values (p_customer_id, 'credit', v_prize.value, 'prize', 'جائزة عجلة الحظ');
    perform loyalty_sync_balances(p_customer_id);
  end if;

  return jsonb_build_object('label', v_prize.label, 'prize_type', v_prize.prize_type, 'value', v_prize.value);
end;
$$;

-- apply_referral: link a referral code to a new customer (commission at 1st paid order)
create or replace function apply_referral(p_code text, p_new_customer_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ref referrals%rowtype;
begin
  select * into v_ref from referrals where referral_code = p_code limit 1;
  if not found or v_ref.referred_customer_id is not null
     or v_ref.referrer_customer_id = p_new_customer_id then
    return false;
  end if;
  update referrals set referred_customer_id = p_new_customer_id, status = 'joined' where id = v_ref.id;
  return true;
end;
$$;

grant execute on function award_points(uuid, numeric, uuid) to authenticated;
grant execute on function redeem_points(uuid, integer) to authenticated;
grant execute on function evaluate_tier(uuid) to authenticated;
grant execute on function spin_wheel(uuid) to authenticated;
grant execute on function apply_referral(text, uuid) to anon, authenticated;

-- =============================================================
-- RLS
-- =============================================================
alter table loyalty_config       enable row level security;
alter table customer_tiers       enable row level security;
alter table points_ledger        enable row level security;
alter table wallet_ledger        enable row level security;
alter table referrals            enable row level security;
alter table promotions           enable row level security;
alter table abandoned_carts      enable row level security;
alter table wheel_prizes         enable row level security;
alter table wheel_spins          enable row level security;
alter table packages             enable row level security;
alter table order_postponements  enable row level security;

-- helper: does auth.uid() own this customer row?
create or replace function owns_customer(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from customers where id = p_customer_id and user_id = auth.uid());
$$;

-- customer reads own ledgers / spins / postponements; staff (loyalty.view) reads all
create policy points_self on points_ledger for select
  using (owns_customer(customer_id) or has_perm('loyalty', 'view'));
create policy wallet_self on wallet_ledger for select
  using (owns_customer(customer_id) or has_perm('loyalty', 'view'));
create policy spins_self on wheel_spins for select
  using (owns_customer(customer_id) or has_perm('loyalty', 'view'));
create policy postp_self on order_postponements for select
  using (owns_customer(customer_id) or has_perm('loyalty', 'view'));
create policy carts_self on abandoned_carts for select
  using (owns_customer(customer_id) or has_perm('loyalty', 'view'));
create policy referrals_self on referrals for select
  using (owns_customer(referrer_customer_id) or has_perm('loyalty', 'view'));

-- public catalog (read by anyone authenticated; managed by loyalty.manage)
create policy tiers_read    on customer_tiers for select using (true);
create policy prizes_read   on wheel_prizes   for select using (true);
create policy packages_read on packages       for select using (is_active or has_perm('loyalty', 'view'));
create policy promos_read   on promotions     for select using (is_active or has_perm('loyalty', 'view'));
create policy config_read   on loyalty_config for select using (has_perm('loyalty', 'view'));

create policy tiers_manage    on customer_tiers  for all using (has_perm('loyalty', 'manage')) with check (has_perm('loyalty', 'manage'));
create policy prizes_manage   on wheel_prizes    for all using (has_perm('loyalty', 'manage')) with check (has_perm('loyalty', 'manage'));
create policy packages_manage on packages        for all using (has_perm('loyalty', 'manage')) with check (has_perm('loyalty', 'manage'));
create policy promos_manage   on promotions      for all using (has_perm('loyalty', 'manage')) with check (has_perm('loyalty', 'manage'));
create policy config_manage   on loyalty_config  for all using (has_perm('loyalty', 'manage')) with check (has_perm('loyalty', 'manage'));
