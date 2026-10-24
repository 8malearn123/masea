-- =============================================================
-- Masiat Alsharq ERP — 0055 Discount coupons + renewing cancelled contracts
-- 1) كوبون الخصم: خصم مُعرّف مسبقاً في `promotions` (0051) لا يظهر في قائمة
--    الخصومات، ولا يُطبَّق إلا بإدخال رمزه (requires_code). يُتحقّق من الرمز في
--    الـ backend؛ لا خصم مفتوح.
-- 2) العقد الملغى يمكن تجديده: renew_contract() يُنشئ مسودة نسخة جديدة مرتبطة
--    بالعقد الأصلي (يبدأ من اليوم)، كما في العقد النشط/المنتهي.
-- يُبنى فوق: promotions, evaluate_promotion, calc_price, create_contract_draft,
-- renew_contract — لا جداول جديدة.
-- =============================================================

-- ---------- 1) coupon-only discounts -------------------------
alter table promotions
  add column if not exists requires_code boolean not null default false;

alter table promotions drop constraint if exists promotions_coupon_code_chk;
alter table promotions
  add constraint promotions_coupon_code_chk
  check (not requires_code or nullif(btrim(coalesce(code, '')), '') is not null);

insert into promotions (name, type, code, description, discount_pct, max_discount_amount,
                        service_codes, requires_code, is_active)
values ('كوبون عملاء نجران المميزين', 'manual', 'NJR-VIP',
        'كوبون يُمنح لعملاء فرع نجران المميزين — يُطبَّق بإدخال الرمز فقط.',
        8, 1200, null, true, true)
on conflict do nothing;

-- evaluate with an optional entered code (coupons need the matching code)
drop function if exists evaluate_promotion(uuid, text, numeric);
create or replace function evaluate_promotion(
  p_promotion_id uuid,
  p_service_code text,
  p_base         numeric,
  p_code         text default null
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
  if p.requires_code and upper(btrim(coalesce(p_code, ''))) <> upper(coalesce(p.code, '')) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم يتطلب رمز كوبون صحيح');
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

grant execute on function evaluate_promotion(uuid, text, numeric, text) to anon, authenticated;

-- calc_price: accepts promotion_id and/or promotion_code (coupon)
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
  v_promo_id   uuid    := nullif(p_params->>'promotion_id', '')::uuid;
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

  -- coupon code → its promotion
  if v_promo_id is null and v_code is not null then
    select id into v_promo_id from promotions where upper(code) = upper(v_code);
    if v_promo_id is null then
      v_promo := jsonb_build_object('ok', false, 'amount', 0, 'reason', 'رمز الكوبون غير صحيح');
    end if;
  end if;
  if v_promo_id is not null then
    v_promo := evaluate_promotion(v_promo_id, p_service_code, v_base, v_code);
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
    'promotion_reason', v_promo->>'reason'
  );

  insert into pricing_log (service_code, params, result, created_by)
  values (p_service_code, p_params, v_result, auth.uid());

  return v_result;
end;
$$;

grant execute on function calc_price(text, jsonb) to anon, authenticated;

-- create_contract_draft: forward the coupon code; store the resolved promotion
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
    'promotion_code', v_code
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

-- ---------- 2) renewal also from a CANCELLED contract ----------
create or replace function renew_contract(p_contract_id uuid)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_old   contracts;
  v_row   contracts;
  v_start date;
  v_end   date;
begin
  select * into v_old from contracts where id = p_contract_id;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not has_perm('contracts', 'create') then
    raise exception 'لا تملك صلاحية إنشاء العقود';
  end if;
  if v_old.status not in ('active', 'completed', 'cancelled') then
    raise exception 'يُجدَّد العقد النشط أو المنتهي أو الملغى فقط';
  end if;
  if not (is_cross_branch() or v_old.branch_id = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;
  if exists (select 1 from contracts where parent_contract_id = v_old.id and status <> 'cancelled') then
    raise exception 'يوجد تجديد قائم لهذا العقد';
  end if;

  -- a cancelled contract restarts today; a live/finished one continues after its end
  v_start := case when v_old.status = 'cancelled' then current_date
                  else greatest(coalesce(v_old.end_date + 1, current_date), current_date) end;
  v_end   := case when v_old.end_date is not null and v_old.start_date is not null
                  then v_start + (v_old.end_date - v_old.start_date) else null end;

  insert into contracts (
    contract_no, service_code, template_id, customer_id, worker_id, branch_id,
    start_date, end_date, gross_amount, discount_amount, promotion_id, base_amount,
    pricing_params, status, version, parent_contract_id, created_by
  ) values (
    generate_contract_no(), v_old.service_code, v_old.template_id, v_old.customer_id,
    v_old.worker_id, v_old.branch_id, v_start, v_end,
    coalesce(v_old.gross_amount, v_old.base_amount), 0, null,
    coalesce(v_old.gross_amount, v_old.base_amount),
    v_old.pricing_params, 'draft', v_old.version + 1, v_old.id, auth.uid()
  ) returning * into v_row;

  insert into contract_clauses (contract_id, sort_order, body)
  select v_row.id, sort_order, body from contract_clauses where contract_id = v_old.id;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'draft', auth.uid());

  insert into audit_log (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'contract.renew', 'contracts', v_row.id,
          jsonb_build_object('parent', v_old.id, 'version', v_row.version,
                             'from_status', v_old.status::text));
  return v_row;
end $$;

grant execute on function renew_contract(uuid) to authenticated;
