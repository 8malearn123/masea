-- =============================================================
-- Masiat Alsharq ERP — 0051 Predefined discounts (module 03)
-- Business rule (ماسية الشرق): لا خصم مفتوح. الخصم لا يُكتب يدوياً على الطلب
-- أو العقد، بل يُختار من خصومات مُعرّفة مسبقاً تديرها الإدارة من شاشة التسويق
-- والتسعير (نسبة أو قيمة + شروط التطبيق)، ويُتحقّق منه في الـ backend قبل اعتماده.
--
-- Reuses: promotions (0020) as THE discount catalogue — no new table for an
-- existing concept; pricing_rules.min_price (0048) as the floor; calc_price
-- (0019) stays the single pricing source; has_perm (0013) for RLS.
-- =============================================================

-- ---------- 1) promotions → managed discount definitions -----
alter table promotions
  add column if not exists code                text,
  add column if not exists description         text,
  add column if not exists service_codes       text[],          -- null/empty = كل الخدمات
  add column if not exists min_base_amount     numeric(12,2),   -- أقل مبلغ أساسي لتطبيق الخصم
  add column if not exists max_discount_amount numeric(12,2),   -- سقف قيمة الخصم (للنسبة)
  add column if not exists usage_limit         integer,         -- null = بلا حد
  add column if not exists usage_count         integer not null default 0,
  add column if not exists updated_at          timestamptz not null default now();

create unique index if not exists uq_promotions_code on promotions (upper(code)) where code is not null;

-- 'manual' = خصم تعرّفه الإدارة ويُختار من القائمة في العقد/عرض السعر.
alter table promotions drop constraint if exists promotions_type_check;
alter table promotions
  add constraint promotions_type_check
  check (type in ('manual', 'first_order', 'hourly_offer', 'absence', 'abandoned_cart'));
alter table promotions alter column type set default 'manual';

-- exactly one of pct / amount, both sane
alter table promotions drop constraint if exists promotions_value_chk;
alter table promotions
  add constraint promotions_value_chk check (
    (discount_pct is not null and discount_amount is null and discount_pct > 0 and discount_pct <= 100)
    or (discount_amount is not null and discount_pct is null and discount_amount > 0)
  ) not valid;

-- realistic Masiat Alsharq starter catalogue (editable / disable-able from the UI)
insert into promotions (name, type, code, description, discount_pct, discount_amount,
                        service_codes, min_base_amount, max_discount_amount, is_active)
values
  ('خصم اليوم الوطني — استقدام', 'manual', 'NATIONAL95',
   'خصم موسمي على عقود الاستقدام خلال فترة اليوم الوطني.', 5, null,
   array['recruitment'], 10000, 1000, true),
  ('خصم التأجير الشهري الطويل', 'manual', 'RENT6M',
   'خصم ثابت على عقود التأجير الشهري التي لا تقل عن 6 أشهر.', null, 500,
   array['monthly_rental'], 12000, null, true)
on conflict do nothing;

-- write access for pricing managers too (loyalty.manage policy from 0020 stays)
drop policy if exists promos_pricing_manage on promotions;
create policy promos_pricing_manage on promotions
  for all using (has_perm('pricing', 'manage')) with check (has_perm('pricing', 'manage'));

-- ---------- 2) server-side eligibility check -----------------
-- Returns {ok, amount, reason}. amount is the discount in SAR on p_base.
create or replace function evaluate_promotion(
  p_promotion_id uuid,
  p_service_code text,
  p_base         numeric
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  p        promotions%rowtype;
  v_amount numeric(12,2);
begin
  select * into p from promotions where id = p_promotion_id;
  if not found then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم غير موجود');
  end if;
  if not p.is_active then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم معطّل');
  end if;
  if p.starts_at is not null and now() < p.starts_at then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم لم يبدأ بعد');
  end if;
  if p.ends_at is not null and now() > p.ends_at then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'انتهت صلاحية الخصم');
  end if;
  if coalesce(array_length(p.service_codes, 1), 0) > 0
     and not (p_service_code = any(p.service_codes)) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم لا يشمل هذه الخدمة');
  end if;
  if p.min_base_amount is not null and p_base < p.min_base_amount then
    return jsonb_build_object('ok', false, 'amount', 0,
      'reason', 'المبلغ أقل من الحد الأدنى لتطبيق الخصم');
  end if;
  if p.usage_limit is not null and p.usage_count >= p.usage_limit then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'استُنفد عدد مرات استخدام الخصم');
  end if;

  v_amount := case
    when p.discount_pct is not null then round(p_base * p.discount_pct / 100.0, 2)
    else coalesce(p.discount_amount, 0)
  end;
  if p.max_discount_amount is not null then
    v_amount := least(v_amount, p.max_discount_amount);
  end if;
  v_amount := least(v_amount, p_base);
  return jsonb_build_object('ok', true, 'amount', v_amount, 'reason', null);
end $$;

grant execute on function evaluate_promotion(uuid, text, numeric) to anon, authenticated;

-- ---------- 3) calc_price(): predefined discounts only -------
-- Removes the open `discount_pct` / `discount_amount` params. A discount now
-- comes only from `promotion_id` (validated above) + wallet + absence rule, and
-- the net may never fall below the rule's min_price floor.
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
  v_promo_id   uuid    := nullif(p_params->>'promotion_id', '')::uuid;
  v_rule       numeric(12,2);
  v_rule_min   numeric(12,2);
  v_base       numeric(12,2);
  v_floor      numeric(12,2);
  v_discounts  numeric(12,2) := 0;
  v_promo      jsonb;
  v_promo_amt  numeric(12,2) := 0;
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
  select base_price, min_price into v_rule, v_rule_min
  from pricing_rules
  where service_code = p_service_code and is_active
    and (nationality is null or nationality = v_nat)
    and (profession  is null or profession  = v_prof)
  order by (case when nationality is not null then 1 else 0 end)
         + (case when profession  is not null then 1 else 0 end) desc
  limit 1;
  v_base  := round(coalesce(v_rule, 0) * v_qty, 2);
  v_floor := round(coalesce(v_rule_min, 0) * v_qty, 2);

  -- (2) discounts: predefined promotion + wallet + absence compensation
  if v_promo_id is not null then
    v_promo := evaluate_promotion(v_promo_id, p_service_code, v_base);
    if (v_promo->>'ok')::boolean then
      v_promo_amt := (v_promo->>'amount')::numeric;
    end if;
  end if;
  v_discounts := v_promo_amt + coalesce((p_params->>'wallet_redeem')::numeric, 0);
  if v_absence > 0 then
    v_abs_perday := coalesce((v_cfg.absence_compensation_rule->>'per_day')::numeric, 0);
    v_abs_max    := coalesce((v_cfg.absence_compensation_rule->>'max_days')::integer, 0);
    v_discounts  := v_discounts + round(v_abs_perday * least(v_absence, v_abs_max), 2);
  end if;
  -- never discount below the managed floor (min_price) nor below zero
  v_discounts := least(round(v_discounts, 2), greatest(v_base - v_floor, 0));

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
    'net', v_net, 'vat', v_vat, 'total', v_total,
    'promotion_id', v_promo_id,
    'promotion_ok', coalesce((v_promo->>'ok')::boolean, v_promo_id is null),
    'promotion_reason', v_promo->>'reason'
  );

  insert into pricing_log (service_code, params, result, created_by)
  values (p_service_code, p_params, v_result, auth.uid());

  return v_result;
end;
$$;

grant execute on function calc_price(text, jsonb) to anon, authenticated;

-- calc_price writes pricing_log → its wrapper must not be declared STABLE.
create or replace function calc_contract_price(p_service_code text, p_params jsonb)
returns jsonb language sql volatile security definer set search_path = public
as $$ select calc_price(p_service_code, p_params) $$;
