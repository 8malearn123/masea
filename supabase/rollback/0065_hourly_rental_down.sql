-- Rollback for 0065_hourly_rental.sql.
-- Bookings, hourly contracts/orders already created are real records: bookings
-- are dropped with their table, contracts and orders stay. The hourly service is
-- deactivated (not deleted) when contracts or orders still reference it.

delete from role_permissions where module = 'hourly';
delete from permissions where module = 'hourly';
drop function if exists submit_service_request(text, jsonb);
drop function if exists track_service_request(text);
drop table if exists request_submissions;

drop function if exists book_hourly(jsonb);
drop function if exists set_booking_status(uuid, text, text);
drop function if exists _insert_hourly_booking(uuid, uuid, text, date, time, time, uuid, text, text, text, jsonb, numeric, uuid, uuid, uuid, text);
drop function if exists worker_is_free(uuid, timestamptz, timestamptz, uuid);
drop function if exists worker_busy_slots(date);
drop table if exists worker_bookings;
drop function if exists worker_bookings_period();

-- 0062 versions
create or replace function create_quote_from_price(
  p_service_code   text,
  p_params         jsonb,
  p_customer_name  text,
  p_customer_phone text,
  p_valid_until    date,
  p_notes          text default null,
  p_parent_id      uuid default null,
  p_snapshot       jsonb default null,
  p_extra          jsonb default '{}'::jsonb
) returns quotes
language plpgsql security definer set search_path = public as $$
declare
  v_price   jsonb;
  v_row     quotes;
  v_lead    leads;
  v_branch  uuid := get_my_branch();
  v_cust    uuid := nullif(p_extra->>'customer_id', '')::uuid;
  v_start   date := nullif(p_extra->>'start_date', '')::date;
  v_unit    text := nullif(p_extra->>'duration_unit', '');
  v_count   integer := nullif(p_extra->>'duration_count', '')::integer;
  v_end     date;
begin
  if not (has_perm('pricing','create') or has_perm('leads','create')) then
    raise exception 'لا تملك صلاحية إنشاء عروض الأسعار';
  end if;
  if length(btrim(coalesce(p_customer_name, ''))) < 3 then raise exception 'اسم العميل مطلوب'; end if;
  if p_valid_until is null or p_valid_until <= current_date then raise exception 'تاريخ صلاحية العرض يجب أن يكون لاحقًا لليوم'; end if;

  if nullif(p_extra->>'lead_id', '') is not null then
    select * into v_lead from leads where id = (p_extra->>'lead_id')::uuid;
    if v_lead.id is null then raise exception 'العميل المحتمل غير موجود'; end if;
    if not can_act_on_sales_row(v_lead.branch_id, v_lead.assigned_to) then
      raise exception 'هذا العميل المحتمل خارج نطاقك';
    end if;
    v_branch := coalesce(v_lead.branch_id, v_branch);
    v_cust := coalesce(v_cust, v_lead.customer_id);
  end if;
  if v_cust is not null and not exists (select 1 from customers where id = v_cust and in_my_branch(branch_id)) then
    raise exception 'العميل خارج نطاق فرعك';
  end if;

  if v_start is not null and v_unit is not null and v_count is not null then
    v_end := case v_unit
      when 'day'   then v_start + (v_count - 1)
      when 'week'  then v_start + (v_count * 7 - 1)
      when 'month' then (v_start + make_interval(months => v_count))::date - 1
      when 'year'  then (v_start + make_interval(years => v_count))::date - 1
      else v_start end;
  end if;

  -- the backend price is authoritative (same engine as contracts)
  v_price := calc_price(p_service_code, p_params);
  if (v_price->>'base')::numeric <= 0 then raise exception 'لا توجد قاعدة سعر نشطة لهذه الخدمة'; end if;
  if not coalesce((v_price->>'promotion_ok')::boolean, true) then
    raise exception 'الخصم غير قابل للتطبيق: %', coalesce(v_price->>'promotion_reason', '');
  end if;
  if (v_price->>'total')::numeric <= 0 then raise exception 'الإجمالي غير صالح'; end if;

  insert into quotes (service_code, customer_name, customer_phone, nationality, profession, quantity,
                      base_amount, vat_amount, total_amount, gross_amount, discount_amount,
                      promotion_id, coupon_code, status, valid_until, notes,
                      assigned_to, branch_id, created_by, parent_id, price_snapshot,
                      lead_id, customer_id, worker_profile_id, worker_name,
                      start_date, duration_unit, duration_count, end_date, terms)
  values (p_service_code, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone,'')), ''),
          nullif(p_params->>'nationality',''), nullif(p_params->>'profession',''),
          greatest(coalesce((p_params->>'quantity')::integer, 1), 1),
          (v_price->>'net')::numeric, (v_price->>'vat')::numeric, (v_price->>'total')::numeric,
          (v_price->>'base')::numeric, (v_price->>'discounts')::numeric,
          case when (v_price->>'discounts')::numeric > 0 then nullif(v_price->>'promotion_id','')::uuid end,
          nullif(upper(btrim(coalesce(p_params->>'promotion_code',''))), ''),
          'draft', p_valid_until, p_notes, auth.uid(), v_branch, auth.uid(), p_parent_id,
          coalesce(p_snapshot, '{}'::jsonb)
            || jsonb_build_object('server', v_price, 'params', p_params, 'computed_at', now()),
          v_lead.id, v_cust, nullif(p_extra->>'worker_profile_id','')::uuid,
          nullif(btrim(coalesce(p_extra->>'worker_name','')), ''),
          v_start, v_unit, v_count, v_end,
          coalesce(p_extra->'terms', '[]'::jsonb))
  returning * into v_row;

  insert into quote_events (quote_id, type, actor, note)
  values (v_row.id, case when p_parent_id is null then 'created' else 'version_created' end, auth.uid(), null);

  -- a quote on the lead moves it to the "quoted" stage
  if v_lead.id is not null and v_lead.stage_code in ('new','contacted') then
    update leads set stage_code = 'quoted', updated_at = now() where id = v_lead.id;
  end if;

  update pricing_log set op_type = 'quote', reference = 'QT-' || v_row.quote_no
  where id = (select id from pricing_log
              where created_at = now() and created_by is not distinct from auth.uid()
              order by created_at desc limit 1);
  return v_row;
end;
$$;


create or replace function convert_quote_to_contract(p_quote_id uuid, p_branch text default null)
returns contracts language plpgsql security definer set search_path = public as $$
declare
  q          quotes;
  v_lead     leads;
  v_customer uuid;
  v_branch   uuid;
  v_row      contracts;
  v_req      uuid;
  v_clause   text;
  v_i        integer := 0;
begin
  if not has_perm('contracts','create') then raise exception 'لا تملك صلاحية إنشاء العقود'; end if;
  select * into q from quotes where id = p_quote_id for update;
  if q.id is null then raise exception 'العرض غير موجود'; end if;
  if not can_act_on_sales_row(q.branch_id, q.assigned_to) then raise exception 'هذا العرض خارج نطاقك'; end if;
  if q.contract_id is not null then raise exception 'هذا العرض مرتبط بعقد مسبقًا'; end if;
  if q.status <> 'accepted' then raise exception 'لا يُحوَّل إلى عقد إلا العرض المقبول من العميل'; end if;

  v_branch := coalesce(q.branch_id, resolve_branch_id(p_branch));
  if v_branch is null then raise exception 'حدّد فرع العقد'; end if;
  if not in_my_branch(v_branch) then raise exception 'لا يمكنك إنشاء عقد خارج نطاق فرعك'; end if;

  -- the customer: on the quote, else the lead's (converted now), else by phone in the branch, else new
  v_customer := q.customer_id;
  if v_customer is null and q.lead_id is not null then
    select * into v_lead from leads where id = q.lead_id;
    v_customer := (convert_lead_to_customer(q.lead_id)).id;
  end if;
  if v_customer is null and nullif(btrim(coalesce(q.customer_phone,'')), '') is not null then
    select id into v_customer from customers
     where branch_id = v_branch
       and right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = right(regexp_replace(q.customer_phone, '\D', '', 'g'), 9)
     order by created_at limit 1;
  end if;
  if v_customer is null then
    insert into customers (full_name, phone, branch_id)
    values (q.customer_name, q.customer_phone, v_branch) returning id into v_customer;
  end if;

  -- the contract carries the quote's frozen amounts — no re-pricing between offer and contract
  insert into contracts (
    contract_no, service_code, customer_id, branch_id, start_date, end_date,
    gross_amount, discount_amount, promotion_id, base_amount, pricing_params,
    status, created_by, quote_id, issue_date, notes
  ) values (
    generate_contract_no(), q.service_code, v_customer, v_branch,
    coalesce(q.start_date, current_date), q.end_date,
    coalesce(q.gross_amount, q.base_amount), q.discount_amount, q.promotion_id, q.base_amount,
    q.price_snapshot->'params', 'draft', auth.uid(), q.id, current_date, q.notes
  ) returning * into v_row;

  for v_clause in select jsonb_array_elements_text(coalesce(q.terms, '[]'::jsonb)) loop
    insert into contract_clauses (contract_id, sort_order, body) values (v_row.id, v_i, v_clause);
    v_i := v_i + 1;
  end loop;
  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'draft', auth.uid());
  if q.promotion_id is not null then
    update promotions set usage_count = usage_count + 1, updated_at = now() where id = q.promotion_id;
  end if;

  -- the operational order that results from the deal (orders board / dispatch)
  insert into service_requests (service_code, branch_id, customer_id, worker_profile_id,
                                customer_name, customer_phone, base_amount, vat_amount, total_amount,
                                status, contract_id, details)
  values (q.service_code, v_branch, v_customer, q.worker_profile_id,
          q.customer_name, q.customer_phone, q.base_amount, q.vat_amount, q.total_amount,
          'new', v_row.id,
          jsonb_build_object('source', 'quote', 'quote_no', q.quote_no,
                             'start_date', q.start_date, 'end_date', q.end_date,
                             'nationality', q.nationality, 'profession', q.profession))
  returning id into v_req;

  update quotes set contract_id = v_row.id, request_id = v_req, customer_id = v_customer where id = q.id;
  insert into quote_events (quote_id, type, actor, note)
  values (q.id, 'converted', auth.uid(), v_row.contract_no);
  if q.lead_id is not null then
    update leads set stage_code = 'won', customer_id = v_customer, updated_at = now() where id = q.lead_id;
  end if;

  insert into audit_log (action, table_name, entity, record_id, new_data, branch_id)
  values ('quote.convert', 'contracts', 'contracts', v_row.id,
          jsonb_build_object('quote_no', q.quote_no, 'contract_no', v_row.contract_no), v_branch);
  return v_row;
end;
$$;


drop function if exists hourly_hours(time, time);
alter table quotes drop column if exists start_time, drop column if exists end_time;

-- 0056 calc_price (no branch preference)
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

delete from pricing_rules where branch_id is not null;
drop index if exists idx_pricing_rules_branch;
alter table pricing_rules drop column if exists branch_id;
delete from pricing_rules where service_code = 'hourly_rental';
delete from contract_templates where service_code = 'hourly_rental'
  and not exists (select 1 from contracts where template_id = contract_templates.id);
delete from app_config where key in ('hourly_min_hours','hourly_max_hours','hourly_buffer_minutes','hourly_slot_minutes');
update services set is_active = false where code = 'hourly_rental';
delete from services where code = 'hourly_rental'
  and not exists (select 1 from contracts where service_code = 'hourly_rental')
  and not exists (select 1 from service_requests where service_code = 'hourly_rental')
  and not exists (select 1 from quotes where service_code = 'hourly_rental')
  and not exists (select 1 from pricing_log where service_code = 'hourly_rental');
