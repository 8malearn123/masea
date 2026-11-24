-- =============================================================
-- 0103 — صلاحية الحملات: مسودة، نهاية اليوم بتوقيت الرياض، التحقق الكامل في الخادم
-- (docs/plans/marketing-whatsapp-expiry-wheel-plan.md — المرحلة 2)
--
--   * الحالات: مسودة · مجدولة · نشطة · منتهية · موقوفة يدوياً (campaign_status).
--   * النهاية = 23:59:59 بتوقيت الرياض من يوم النهاية؛ تُصحَّح الحملات المحفوظة سابقاً
--     بمنتصف الليل UTC (كانت تنتهي 3 فجراً بتوقيت الرياض) وكوبوناتها المرتبطة.
--   * evaluate_promotion عند كل استخدام: الوجود ← الحملة ← الوقت ← الخدمة ← الفرع ←
--     الشروط ← حد الاستخدام، ورسالة الانتهاء «انتهت صلاحية هذا العرض، ولا يمكن تطبيق الخصم».
--     لا اعتماد على مهمة مجدولة: التحقق بـ now() وقت الاستخدام.
--   * فرع العقد يُمرَّر للتحقق من فرع الحملة فقط — أسعار الخدمات لا تتغيّر.
-- آمن لإعادة التشغيل.
-- =============================================================

alter table campaigns add column if not exists is_draft boolean not null default false;

create or replace function campaign_status(p campaigns) returns text
language sql stable as $$
  select case
    when p.is_draft then 'draft'
    when not p.is_active then 'paused'
    when p.start_at is not null and now() < p.start_at then 'scheduled'
    when coalesce(p.extended_until, p.end_at) is not null and now() > coalesce(p.extended_until, p.end_at) then 'ended'
    else 'active' end
$$;

create or replace function publish_campaign(p_campaign uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية تفعيل الحملات'; end if;
  update campaigns set is_draft = false, updated_at = now() where id = p_campaign and is_draft;
  if not found then raise exception 'الحملة ليست مسودة'; end if;
end $$;
grant execute on function publish_campaign(uuid) to authenticated;

-- ---------- end of day, Asia/Riyadh (existing rows saved at 00:00 UTC) ----------------------
do $$
declare r record;
begin
  for r in select id, start_at, end_at from campaigns loop
    -- كوبونات الحملة التي كانت تنتهي بنهايتها تتبعها
    if r.end_at is not null and (r.end_at at time zone 'UTC')::time = '00:00:00' then
      update promotions set ends_at = ((r.end_at at time zone 'UTC')::date + time '23:59:59') at time zone 'Asia/Riyadh'
       where campaign_id = r.id and ends_at = r.end_at;
      update campaigns set end_at = ((r.end_at at time zone 'UTC')::date + time '23:59:59') at time zone 'Asia/Riyadh'
       where id = r.id;
    end if;
    if r.start_at is not null and (r.start_at at time zone 'UTC')::time = '00:00:00' then
      update promotions set starts_at = ((r.start_at at time zone 'UTC')::date + time '00:00:00') at time zone 'Asia/Riyadh'
       where campaign_id = r.id and starts_at = r.start_at;
      update campaigns set start_at = ((r.start_at at time zone 'UTC')::date + time '00:00:00') at time zone 'Asia/Riyadh'
       where id = r.id;
    end if;
  end loop;
end $$;

-- ---------- the full check, at every use ----------------------------------------------------
drop function if exists evaluate_promotion(uuid, text, numeric, text);
create or replace function evaluate_promotion(
  p_promotion_id uuid,
  p_service_code text,
  p_base         numeric,
  p_code         text default null,
  p_branch       uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  p        promotions%rowtype;
  c        campaigns%rowtype;
  v_amount numeric(12,2);
  v_expired constant text := 'انتهت صلاحية هذا العرض، ولا يمكن تطبيق الخصم';
begin
  -- 1) الوجود
  select * into p from promotions where id = p_promotion_id;
  if not found then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم غير موجود');
  end if;
  if p.requires_code and upper(btrim(coalesce(p_code, ''))) <> upper(coalesce(p.code, '')) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم يتطلب رمز كوبون صحيح');
  end if;
  -- 2) حالة الحملة
  if p.campaign_id is not null then
    select * into c from campaigns where id = p.campaign_id;
    if not found then
      return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الحملة التسويقية للكوبون غير موجودة');
    end if;
    if c.is_draft then
      return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'العرض غير مفعّل بعد');
    end if;
    if not c.is_active then
      return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'العرض موقوف');
    end if;
  end if;
  if not p.is_active then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم معطّل');
  end if;
  -- 3) التاريخ والوقت (لحظة الاستخدام)
  if (p.starts_at is not null and now() < p.starts_at) or (c.id is not null and c.start_at is not null and now() < c.start_at) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'العرض لم يبدأ بعد');
  end if;
  if (p.ends_at is not null and now() > p.ends_at)
     or (c.id is not null and coalesce(c.extended_until, c.end_at) is not null and now() > coalesce(c.extended_until, c.end_at)) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', v_expired);
  end if;
  -- 4) الخدمة المشمولة
  if c.id is not null and coalesce(array_length(c.service_codes, 1), 0) > 0 and not (p_service_code = any(c.service_codes)) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'العرض لا يشمل هذه الخدمة');
  end if;
  if coalesce(array_length(p.service_codes, 1), 0) > 0 and not (p_service_code = any(p.service_codes)) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'العرض لا يشمل هذه الخدمة');
  end if;
  -- 5) الفرع المشمول
  if c.id is not null and c.branch_id is not null and p_branch is not null and c.branch_id <> p_branch then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'العرض غير متاح في هذا الفرع');
  end if;
  -- 6) شروط الاستخدام
  if p.min_base_amount is not null and p_base < p.min_base_amount then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'المبلغ أقل من الحد الأدنى لتطبيق الخصم');
  end if;
  -- 7) حد الاستخدام
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
grant execute on function evaluate_promotion(uuid, text, numeric, text, uuid) to anon, authenticated;

create or replace function calc_price(p_service_code text, p_params jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cfg        pricing_config%rowtype;
  v_qty        numeric := greatest(coalesce((p_params->>'quantity')::numeric, 1), 1);
  v_nat        text    := nullif(p_params->>'nationality', '');
  v_prof       text    := nullif(p_params->>'profession', '');
  v_branch     uuid    := coalesce(nullif(p_params->>'branch_id', '')::uuid,
                                   resolve_branch_id(nullif(p_params->>'branch', '')));
  v_promo_id   uuid    := nullif(p_params->>'promotion_id', '')::uuid;
  v_package    uuid    := nullif(p_params->>'package_id', '')::uuid;
  v_pkg        pricing_rules%rowtype;
  v_code       text    := nullif(btrim(coalesce(p_params->>'promotion_code', '')), '');
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

  if v_package is not null then
    -- الباقة = قاعدة تسعير مسمّاة بمدة ثابتة: سعرها للوحدة × مدتها (لا تُعدَّل المدة)
    select * into v_pkg from pricing_rules
     where id = v_package and service_code = p_service_code and is_active and package_name is not null;
    if not found then raise exception 'الباقة غير متاحة لهذه الخدمة'; end if;
    v_rule := v_pkg.base_price; v_rule_min := v_pkg.min_price;
    v_qty  := greatest(coalesce(v_pkg.duration_count, 1), 1);
  else
  select base_price, min_price into v_rule, v_rule_min
  from pricing_rules
  where service_code = p_service_code and is_active and package_name is null
    and (nationality is null or nationality = v_nat)
    and (profession  is null or profession  = v_prof)
    and (branch_id   is null or branch_id   = v_branch)
  order by (case when branch_id   is not null then 4 else 0 end)
         + (case when nationality is not null then 1 else 0 end)
         + (case when profession  is not null then 1 else 0 end) desc
  limit 1;
  end if;
  v_base  := round(coalesce(v_rule, 0) * v_qty, 2);
  v_floor := round(coalesce(v_rule_min, 0) * v_qty, 2);

  if v_promo_id is null and v_code is not null then
    select id into v_promo_id from promotions where upper(code) = upper(v_code);
    if v_promo_id is null then
      v_promo := jsonb_build_object('ok', false, 'amount', 0, 'reason', 'رمز الكوبون غير صحيح');
    end if;
  end if;
  if v_promo_id is not null then
    v_promo := evaluate_promotion(v_promo_id, p_service_code, v_base, v_code,
                                  coalesce(nullif(p_params->>'promo_branch', '')::uuid, v_branch));
  end if;
  if coalesce((v_promo->>'ok')::boolean, false) then
    v_promo_amt := (v_promo->>'amount')::numeric;
  end if;

  v_discounts := v_promo_amt + coalesce((p_params->>'wallet_redeem')::numeric, 0);
  if v_absence > 0 then
    v_abs_perday := coalesce((v_cfg.absence_compensation_rule->>'per_day')::numeric, 0);
    v_abs_max    := coalesce((v_cfg.absence_compensation_rule->>'max_days')::integer, 0);
    v_discounts  := v_discounts + round(v_abs_perday * least(v_absence, v_abs_max), 2);
  end if;
  v_discounts := least(round(v_discounts, 2), greatest(v_base - v_floor, 0));

  if v_late_days > v_cfg.late_grace_days then
    v_late_pct  := least(v_late_days * v_cfg.late_daily_pct, v_cfg.late_max_pct);
    v_penalties := v_penalties + round(v_base * v_late_pct / 100.0, 2);
  end if;
  if coalesce((p_params->>'cancelled')::boolean, false) then
    v_penalties := v_penalties + round(v_base * v_cfg.cancellation_pct / 100.0, 2);
  end if;

  v_net   := greatest(v_base - v_discounts + v_penalties, 0);
  v_vat   := round(v_net * v_cfg.vat_rate, 2);
  v_total := v_net + v_vat;

  v_result := jsonb_build_object(
    'base', v_base, 'discounts', v_discounts, 'penalties', v_penalties,
    'net', v_net, 'vat', v_vat, 'total', v_total,
    'promotion_id', v_promo_id,
    'promotion_ok', coalesce((v_promo->>'ok')::boolean, v_promo is null),
    'promotion_reason', v_promo->>'reason',
    'unit_price', coalesce(v_rule, 0),
    'quantity', v_qty,
    'package_id', v_pkg.id,
    'package_name', v_pkg.package_name
  );

  insert into pricing_log (service_code, params, result, created_by)
  values (p_service_code, p_params, v_result, auth.uid());

  return v_result;
end;
$$;
grant execute on function calc_price(text, jsonb) to anon, authenticated;

create or replace function create_contract_draft(p_input jsonb, p_clauses jsonb default '[]'::jsonb)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_service text := p_input->>'service_code';
  v_branch  uuid := resolve_branch_id(p_input->>'branch');
  v_params  jsonb;
  v_price   jsonb;
  v_promo   uuid := nullif(p_input->>'promotion_id', '')::uuid;
  v_code    text := nullif(btrim(coalesce(p_input->>'promotion_code', '')), '');
  v_row     contracts;
  v_clause  text;
  v_i       integer := 0;
begin
  if not has_perm('contracts', 'create') then
    raise exception 'لا تملك صلاحية إنشاء العقود';
  end if;
  if v_service is null or not exists (select 1 from services where code = v_service) then
    raise exception 'نوع الخدمة غير صحيح';
  end if;
  if nullif(p_input->>'customer_id', '') is null then
    raise exception 'اختر العميل';
  end if;
  if v_branch is null then
    raise exception 'الفرع غير معروف';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'لا يمكنك إنشاء عقد خارج نطاق فرعك';
  end if;
  if nullif(p_input->>'start_date', '') is null then
    raise exception 'حدّد تاريخ البداية';
  end if;
  if nullif(p_input->>'end_date', '') is not null
     and (p_input->>'end_date')::date < (p_input->>'start_date')::date then
    raise exception 'تاريخ النهاية قبل تاريخ البداية';
  end if;

  v_params := jsonb_strip_nulls(jsonb_build_object(
    'nationality',    p_input->>'nationality',
    'profession',     p_input->>'profession',
    'quantity',       coalesce((p_input->>'quantity')::numeric, 1),
    'promotion_id',   v_promo,
    'promotion_code', v_code,
    -- فرع العقد للتحقق من فرع الحملة فقط (0103) — لا يغيّر اختيار قاعدة السعر
    'promo_branch', v_branch,
    'package_id',     nullif(p_input->>'package_id', '')
  ));
  v_price := calc_price(v_service, v_params);
  if (v_promo is not null or v_code is not null)
     and not coalesce((v_price->>'promotion_ok')::boolean, false) then
    raise exception 'لا يمكن تطبيق الخصم: %', coalesce(v_price->>'promotion_reason', 'غير مؤهل');
  end if;
  v_promo := nullif(v_price->>'promotion_id', '')::uuid;
  if coalesce((v_price->>'base')::numeric, 0) <= 0 then
    raise exception 'لا توجد قاعدة تسعير فعّالة لهذه الخدمة';
  end if;

  -- البيانات التسويقية (0098): مصدر الاكتساب إلزامي إن لم يكن مسجّلاً للعميل
  if p_input ? 'marketing' then
    perform apply_customer_acquisition((p_input->>'customer_id')::uuid, p_input->'marketing');
  end if;

  insert into contracts (
    contract_no, service_code, template_id, customer_id, worker_id, branch_id,
    start_date, end_date, gross_amount, discount_amount, promotion_id, base_amount,
    musaned_contract_no, pricing_params, status, created_by
  ) values (
    generate_contract_no(), v_service, nullif(p_input->>'template_id', '')::uuid,
    (p_input->>'customer_id')::uuid, nullif(p_input->>'worker_id', '')::uuid, v_branch,
    (p_input->>'start_date')::date, nullif(p_input->>'end_date', '')::date,
    (v_price->>'base')::numeric, (v_price->>'discounts')::numeric, v_promo,
    (v_price->>'net')::numeric,
    nullif(btrim(coalesce(p_input->>'musaned_contract_no', '')), ''), v_params, 'draft', auth.uid()
  ) returning * into v_row;

  if p_input ? 'marketing' then
    perform apply_contract_marketing(v_row.id, p_input->'marketing');
    select * into v_row from contracts where id = v_row.id;
  end if;

  for v_clause in select jsonb_array_elements_text(coalesce(p_clauses, '[]'::jsonb)) loop
    insert into contract_clauses (contract_id, sort_order, body) values (v_row.id, v_i, v_clause);
    v_i := v_i + 1;
  end loop;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'draft', auth.uid());

  if v_promo is not null then
    update promotions set usage_count = usage_count + 1, updated_at = now() where id = v_promo;
  end if;

  insert into audit_log (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'contract.create', 'contracts', v_row.id, to_jsonb(v_row));

  return v_row;
end $$;
grant execute on function create_contract_draft(jsonb, jsonb) to authenticated;


-- ---------- results kept after the end ----------------------------------------------------------
create or replace function campaign_summary(p_campaign uuid)
returns table (redemptions bigint, discount_total numeric, customers bigint, contracts bigint, contracts_value numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not marketing_can_view() then raise exception 'لا تملك صلاحية التقارير'; end if;
  return query
  select (select count(*) from coupon_redemptions r where r.campaign_id = p_campaign and r.status = 'redeemed'),
         coalesce((select sum(r.amount) from coupon_redemptions r where r.campaign_id = p_campaign and r.status = 'redeemed'), 0),
         (select count(distinct x.customer_id) from (
            select k.customer_id from contracts k where k.campaign_id = p_campaign and k.status::text <> 'cancelled'
            union select r.customer_id from coupon_redemptions r where r.campaign_id = p_campaign and r.status = 'redeemed') x),
         (select count(*) from contracts k where (k.campaign_id = p_campaign
             or k.id in (select r.contract_id from coupon_redemptions r where r.campaign_id = p_campaign and r.status = 'redeemed'))
            and k.status::text <> 'cancelled'),
         coalesce((select sum(k.total_amount) from contracts k where (k.campaign_id = p_campaign
             or k.id in (select r.contract_id from coupon_redemptions r where r.campaign_id = p_campaign and r.status = 'redeemed'))
            and k.status::text <> 'cancelled'), 0);
end $$;
grant execute on function campaign_summary(uuid) to authenticated;
