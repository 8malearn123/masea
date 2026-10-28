-- =============================================================
-- Masiat Alsharq ERP — 0059 Journey fixes (QA report 2026-10-27)
-- يُبنى فوق الجداول والدوال القائمة — لا جداول جديدة، لا حذف بيانات،
-- لا تغيير على أي سعر أو رصيد قائم. التراجع: supabase/rollback/0059_journey_fixes_down.sql
--
--  1. pricing_rules: إضافة قاعدة سعر وتعطيلها لمن يملك pricing.edit (كان is_admin فقط،
--     فزرّا «سعر جديد» و«تعطيل» يُرفضان لمدير العمليات). الحذف النهائي يبقى للمدير العام.
--  2. redeem_points: قيمة النقاط المستبدلة تُضاف للمحفظة في نفس العملية (كانت تُخصم فقط).
--  3. spin_wheel: جائزة الخصم تصدر كوبونًا حقيقيًا في promotions برمز فريد لاستخدام واحد،
--     ويُعاد الرمز للواجهة (سياسة promos_manage تمنع الموظف من إنشائه بنفسه).
--  4. النقاط عند الدفع: كل دفعة على عقد تمنح العميل نقاطه عبر award_points القائمة،
--     مرة واحدة لكل دفعة (points_ledger.payment_id فريد).
-- =============================================================

-- ---------- 1) pricing_rules write policy --------------------
drop policy if exists pricing_admin on pricing_rules;
drop policy if exists pricing_rules_insert on pricing_rules;
drop policy if exists pricing_rules_update on pricing_rules;
drop policy if exists pricing_rules_delete on pricing_rules;
create policy pricing_rules_insert on pricing_rules
  for insert to authenticated with check (is_admin() or has_perm('pricing', 'edit'));
create policy pricing_rules_update on pricing_rules
  for update to authenticated
  using (is_admin() or has_perm('pricing', 'edit'))
  with check (is_admin() or has_perm('pricing', 'edit'));
create policy pricing_rules_delete on pricing_rules
  for delete to authenticated using (is_admin());

-- ---------- 2) redeem_points → wallet credit -----------------
create or replace function redeem_points(p_customer_id uuid, p_points integer)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_cfg loyalty_config%rowtype; v_bal integer; v_value numeric(12,2);
begin
  if p_points <= 0 then raise exception 'عدد النقاط غير صالح'; end if;
  select * into v_cfg from loyalty_config where id = 1;
  select coalesce(sum(points), 0) into v_bal from points_ledger where customer_id = p_customer_id;
  if v_bal < p_points then raise exception 'رصيد النقاط غير كافٍ'; end if;

  v_value := round(p_points / v_cfg.redeem_points_per_riyal, 2);
  insert into points_ledger (customer_id, type, points, description)
  values (p_customer_id, 'redeem', -p_points, 'استبدال نقاط');
  -- the SAR value lands in the wallet in the same transaction
  insert into wallet_ledger (customer_id, type, amount, source, description)
  values (p_customer_id, 'credit', v_value, 'redeem', 'استبدال ' || p_points || ' نقطة');
  perform loyalty_sync_balances(p_customer_id);
  return v_value;
end;
$$;

-- ---------- 3) wheel discount → single-use coupon ------------
create or replace function spin_wheel(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg   loyalty_config%rowtype;
  v_used  integer;
  v_total numeric;
  v_r     numeric;
  v_acc   numeric := 0;
  v_prize wheel_prizes%rowtype;
  v_code  text;
  v_name  text;
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
  elsif v_prize.prize_type = 'discount' then
    select full_name into v_name from customers where id = p_customer_id;
    loop
      v_code := 'MAS-DISC' || trim(to_char(v_prize.value, 'FM999990')) || '-'
                || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
      exit when not exists (select 1 from promotions where upper(code) = v_code);
    end loop;
    insert into promotions (name, type, code, description, discount_pct, service_codes,
                            usage_limit, requires_code, is_active)
    values ('عجلة الحظ: ' || v_prize.label || ' — ' || coalesce(v_name, 'عميل'), 'manual', v_code,
            'جائزة عجلة الحظ — استخدام واحد.', v_prize.value, null, 1, true, true);
  end if;

  return jsonb_build_object('label', v_prize.label, 'prize_type', v_prize.prize_type,
                            'value', v_prize.value, 'coupon_code', v_code);
end;
$$;

-- ---------- 4) points on every contract payment --------------
alter table points_ledger
  add column if not exists payment_id uuid references payments(id) on delete set null;
create unique index if not exists uq_points_ledger_payment
  on points_ledger (payment_id) where payment_id is not null;

-- award_points gains an optional payment reference (same body otherwise).
-- The 3-argument form is replaced so existing calls resolve unambiguously.
drop function if exists award_points(uuid, numeric, uuid);
create or replace function award_points(
  p_customer_id uuid,
  p_order_total numeric,
  p_order_id    uuid default null,
  p_payment_id  uuid default null
)
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
  insert into points_ledger (customer_id, type, points, order_id, payment_id, description)
  values (p_customer_id, 'earn', v_pts, p_order_id, p_payment_id,
          case when p_payment_id is null then 'نقاط على طلب مدفوع' else 'نقاط على دفعة عقد' end);

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
grant execute on function award_points(uuid, numeric, uuid, uuid) to authenticated;

create or replace function trg_payment_award_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_customer uuid;
begin
  if new.amount is null or new.amount <= 0 then return new; end if;
  if exists (select 1 from points_ledger where payment_id = new.id) then return new; end if;
  select customer_id into v_customer from contracts where id = new.contract_id;
  if v_customer is null then return new; end if;
  -- reuse award_points (tier multiplier, referral payout, tier evaluation)
  perform award_points(v_customer, new.amount, null, new.id);
  return new;
end $$;

drop trigger if exists payments_award_points on payments;
create trigger payments_award_points after insert on payments
  for each row execute function trg_payment_award_points();
