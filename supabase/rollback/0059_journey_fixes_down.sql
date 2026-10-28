-- Rollback for 0059_journey_fixes.sql — restores the 0011/0020 definitions.
-- Ledger rows written while 0059 was live (wallet credits from redeeming,
-- payment points, wheel coupons) are kept: they are real customer balances.

drop trigger if exists payments_award_points on payments;
drop function if exists trg_payment_award_points();
drop function if exists award_points(uuid, numeric, uuid, uuid);
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
grant execute on function award_points(uuid, numeric, uuid) to authenticated;

drop index if exists uq_points_ledger_payment;
alter table points_ledger drop column if exists payment_id;

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

drop policy if exists pricing_rules_insert on pricing_rules;
drop policy if exists pricing_rules_update on pricing_rules;
drop policy if exists pricing_rules_delete on pricing_rules;
drop policy if exists pricing_admin on pricing_rules;
create policy pricing_admin on pricing_rules
  for all to authenticated using (is_admin()) with check (is_admin());
