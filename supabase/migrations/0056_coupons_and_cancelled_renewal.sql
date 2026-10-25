-- =============================================================
-- Masiat Alsharq ERP — 0056 Discount coupons + renewing cancelled contracts
-- 1) كوبون الخصم: خصم مُعرّف مسبقاً في `promotions` (0051) لا يظهر في قائمة
--    الخصومات، ولا يُطبَّق إلا بإدخال رمزه (requires_code). يُتحقّق من الرمز في
--    الـ backend؛ لا خصم مفتوح.
-- 2) العقد الملغى يمكن تجديده: renew_contract() (0055) يقبل الملغى أيضاً ويُنشئ
--    مسودة نسخة جديدة مرتبطة بالأصل بنفس مدته، دون شرط البدء بعد نهاية الأصل.
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
-- يحلّ محلّ renew_contract(uuid, date, date) من 0055 بنفس التوقيع والقواعد،
-- مع فرقين فقط: يقبل العقد الملغى، ولا يُشترط أن تبدأ نسخته بعد نهاية الأصل.
create or replace function renew_contract(
  p_contract_id uuid,
  p_start_date  date,
  p_end_date    date
)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_parent   contracts;
  v_unit     text;
  v_count    integer;
  v_existing text;
  v_version  integer;
  v_row      contracts;
begin
  if not has_perm('contracts', 'create') then
    raise exception 'لا تملك صلاحية إنشاء العقود وتجديدها';
  end if;

  -- قفل الأصل: طلبات التجديد المتزامنة لنفس العقد تُنفَّذ واحدًا تلو الآخر
  select * into v_parent from contracts where id = p_contract_id for update;

  -- نفس شرط القراءة في contracts_read (0037) — لا نكشف وجود عقد خارج الصلاحية.
  -- coalesce: RLS تعامل NULL كرفض، أما IF NOT (NULL) فلا ترفض — فنحوّله صراحةً.
  if not found or not coalesce(
    has_perm('contracts', 'view') and (
      is_cross_branch()
      or v_parent.assigned_office_id = auth.uid()
      or (get_my_role() <> 'external_office'
          and (v_parent.branch_id = get_my_branch() or v_parent.branch_id is null))
    ), false
  ) then
    raise exception 'العقد غير موجود';
  end if;

  -- نفس شرط الإنشاء في contracts_insert (0016): النسخة في فرع الأصل
  if not coalesce(is_cross_branch() or v_parent.branch_id = get_my_branch(), false) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;

  if v_parent.status not in ('active', 'cancelled') then
    raise exception 'التجديد متاح للعقود السارية أو الملغاة فقط';
  end if;

  v_unit := case v_parent.service_code
    when 'recruitment'    then 'month'
    when 'monthly_rental' then 'month'
    when 'daily_rental'   then 'day'
    else null
  end;
  if v_unit is null then
    raise exception 'هذه الخدمة بلا مدة — لا تُجدَّد';
  end if;
  if v_parent.start_date is null or v_parent.end_date is null then
    raise exception 'تاريخ نهاية العقد الأصلي غير محدد';
  end if;

  -- مدة الأصل (عدد الأيام/الأشهر) من تاريخَيه
  if v_unit = 'day' then
    v_count := v_parent.end_date - v_parent.start_date + 1;
  else
    select n into v_count
    from generate_series(1, 600) as n
    where contract_term_end(v_parent.start_date, 'month', n) = v_parent.end_date
    limit 1;
  end if;
  if v_count is null or v_count < 1 then
    raise exception 'تعذّر تحديد مدة العقد الأصلي من تاريخَي بدايته ونهايته';
  end if;

  -- تواريخ النسخة الجديدة: بعد نهاية الأصل، وبنفس مدته بالضبط
  if p_start_date is null or p_end_date is null then
    raise exception 'حدّد تاريخ بداية ونهاية النسخة الجديدة';
  end if;
  -- الملغى يُجدَّد كعقد جديد متى احتاجه العميل؛ الساري يبدأ تجديده بعد نهايته
  if v_parent.status <> 'cancelled' and p_start_date <= v_parent.end_date then
    raise exception 'تبدأ النسخة الجديدة بعد نهاية العقد الأصلي';
  end if;
  if p_end_date <> contract_term_end(p_start_date, v_unit, v_count) then
    raise exception 'تاريخ نهاية النسخة الجديدة لا يطابق مدة العقد الأصلي';
  end if;

  -- تجديد قائم واحد فقط لكل عقد (يُعاد التجديد إن أُلغيت النسخة)
  select contract_no into v_existing
  from contracts
  where parent_contract_id = v_parent.id and status <> 'cancelled'
  limit 1;
  if found then
    raise exception 'يوجد تجديد قائم لهذا العقد: %', coalesce(v_existing, '');
  end if;

  -- الإصدار التالي: أكبر إصدار في الأصل وتجديداته (ومنها الملغاة) + ١
  select greatest(v_parent.version, coalesce(max(version), 0)) + 1
    into v_version
  from contracts
  where parent_contract_id = v_parent.id;

  -- النسخة الجديدة: بيانات الأصل التجارية فقط؛ لا توقيع/سداد/مساند/مراحل استقدام
  -- السعر: من السعر قبل الخصم (gross_amount، 0052) — الخصم يُستهلك مرة واحدة
  insert into contracts (
    contract_no, customer_id, worker_id, branch_id, service_type, service_code,
    template_id, start_date, end_date, gross_amount, discount_amount, promotion_id,
    base_amount, pricing_params, payment_method,
    status, version, parent_contract_id, created_by
  ) values (
    generate_contract_no(), v_parent.customer_id, v_parent.worker_id, v_parent.branch_id,
    v_parent.service_type, v_parent.service_code, v_parent.template_id,
    p_start_date, p_end_date,
    coalesce(v_parent.gross_amount, v_parent.base_amount), 0, null,
    coalesce(v_parent.gross_amount, v_parent.base_amount), v_parent.pricing_params,
    v_parent.payment_method,
    'draft', v_version, v_parent.id, auth.uid()
  )
  returning * into v_row;

  -- لقطة البنود: نصوص الأصل مع تاريخ البداية الجديد (المدة والمبلغ كما هما)
  insert into contract_clauses (contract_id, sort_order, body)
  select v_row.id, cc.sort_order,
         replace(cc.body, v_parent.start_date::text, p_start_date::text)
  from contract_clauses cc
  where cc.contract_id = v_parent.id;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'draft', auth.uid());

  insert into audit_log (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'contract.renew', 'contracts', v_row.id,
          jsonb_build_object('parent', v_parent.id, 'version', v_row.version,
                             'from_status', v_parent.status::text));

  return v_row;
end $$;

revoke all on function renew_contract(uuid, date, date) from public, anon;
grant execute on function renew_contract(uuid, date, date) to authenticated;
