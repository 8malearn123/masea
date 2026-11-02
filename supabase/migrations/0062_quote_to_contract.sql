-- =============================================================
-- Masiat Alsharq ERP — 0062 Lead → quote → contract (المرحلة 1)
-- يُبنى فوق leads / quotes / quote_events (0044, 0058) و contracts و calc_price
-- و create_contract_draft — لا جداول جديدة. التراجع:
-- supabase/rollback/0062_quote_to_contract_down.sql
--
--  1. quotes: العميل والعاملة والمدة والخصم والكوبون والشروط وربط الطلب الناتج،
--     وحالة «بانتظار الموافقة» لاعتماد مدير الفرع حين يتجاوز الخصم حدًّا مُدارًا.
--  2. create_quote_from_price(): يقبل p_extra (العميل المحتمل/العميل/العاملة/المدة/
--     الشروط) ويأخذ فرع العميل المحتمل، ويتحقّق من نطاقه.
--  3. set_quote_status(): + pending_approval، الاعتماد لمن يملك leads.approve،
--     وفحص نطاق الفرع (كانت الدالة SECURITY DEFINER بلا فحص نطاق).
--  4. convert_quote_to_contract(): عرض مقبول ← عميل ← عقد (بنفس مبالغ العرض
--     المجمّدة) ← طلب تشغيلي، وكلها مربوطة؛ عرض واحد = عقد واحد.
--  5. حقول التسجيل الإضافية المعتمدة: تاريخ تحرير العقد وملاحظاته ومهلة تنبيهه،
--     الرقم الضريبي للعميل، مكتب العاملة وهاتفه، مدينة وبريد العميل المحتمل.
-- =============================================================

-- ---------- 1) columns -------------------------------------------------------
alter table quotes
  add column if not exists worker_profile_id uuid references worker_profiles(id) on delete set null,
  add column if not exists worker_name      text,
  add column if not exists start_date       date,
  add column if not exists duration_unit    text check (duration_unit in ('day','week','month','year','hour')),
  add column if not exists duration_count   integer check (duration_count is null or duration_count > 0),
  add column if not exists end_date         date,
  add column if not exists gross_amount     numeric(12,2),
  add column if not exists discount_amount  numeric(12,2) not null default 0,
  add column if not exists promotion_id     uuid references promotions(id) on delete set null,
  add column if not exists coupon_code      text,
  add column if not exists terms            jsonb not null default '[]'::jsonb,
  add column if not exists request_id       uuid references service_requests(id) on delete set null,
  add column if not exists approved_by      uuid references auth.users(id) on delete set null,
  add column if not exists approved_at      timestamptz;
create unique index if not exists ux_quotes_contract on quotes(contract_id) where contract_id is not null;

alter table quotes drop constraint if exists quotes_status_check;
alter table quotes add constraint quotes_status_check
  check (status in ('draft','pending_approval','sent','accepted','rejected','expired'));

alter table quote_events drop constraint if exists quote_events_type_check;
alter table quote_events add constraint quote_events_type_check
  check (type in ('created','whatsapp_opened','marked_sent','pdf_generated','accepted','rejected',
                  'expired','version_created','converted','submitted_for_approval','approved'));

alter table contracts
  add column if not exists quote_id          uuid references quotes(id) on delete set null,
  add column if not exists issue_date        date not null default current_date,
  add column if not exists notes             text,
  add column if not exists alert_days_before integer check (alert_days_before is null or alert_days_before >= 0);
create unique index if not exists ux_contracts_quote on contracts(quote_id) where quote_id is not null;

alter table customers add column if not exists vat_number text;
alter table customers drop constraint if exists customers_vat_number_chk;
alter table customers add constraint customers_vat_number_chk
  check (vat_number is null or vat_number ~ '^3[0-9]{13}3$');

alter table worker_profiles
  add column if not exists office_name  text,
  add column if not exists office_phone text;

alter table leads
  add column if not exists city  text,
  add column if not exists email text;

-- ---------- 2) managed thresholds -------------------------------------------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('quote_approval_discount_pct', 'عرض السعر يحتاج اعتماد مدير الفرع إذا تجاوز الخصم', 'المبيعات', 10, '٪', 10)
on conflict (key) do nothing;

-- approving quotes is a manager duty — the sales rep submits, the manager approves
delete from role_permissions where role_code = 'sales' and module = 'leads' and action = 'approve';

-- ---------- 3) helpers ---------------------------------------------------------
-- may the current user act on a quote/lead of this branch, assigned to this user?
create or replace function can_act_on_sales_row(p_branch uuid, p_assigned uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select is_cross_branch()
      or (p_branch is not null and p_branch = get_my_branch()
          and (p_assigned = auth.uid() or get_my_role() = 'branch_manager' or has_perm('leads','approve')))
$$;

create or replace function quote_needs_approval(p_gross numeric, p_discount numeric)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(p_gross, 0) > 0 and coalesce(p_discount, 0) > 0
     and (p_discount / p_gross) * 100 >
         coalesce((select value from app_config where key = 'quote_approval_discount_pct'), 100)
$$;

grant execute on function can_act_on_sales_row(uuid, uuid), quote_needs_approval(numeric, numeric) to authenticated;

-- ---------- 4) create a quote (server price) ----------------------------------
drop function if exists create_quote_from_price(text, jsonb, text, text, date, text, uuid, jsonb);
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

-- ---------- 5) guarded lifecycle ----------------------------------------------
create or replace function set_quote_status(p_quote_id uuid, p_status text, p_note text default null)
returns quotes language plpgsql security definer set search_path = public as $$
declare v_row quotes; v_from text; v_needs boolean;
begin
  if not (has_perm('pricing','edit') or has_perm('leads','edit')) then
    raise exception 'لا تملك صلاحية تحديث العروض';
  end if;
  select * into v_row from quotes where id = p_quote_id for update;
  if v_row.id is null then raise exception 'العرض غير موجود'; end if;
  if not can_act_on_sales_row(v_row.branch_id, v_row.assigned_to) then
    raise exception 'هذا العرض خارج نطاقك';
  end if;

  v_from := case when v_row.status in ('draft','pending_approval','sent') and v_row.valid_until < current_date
                 then 'expired' else v_row.status end;
  v_needs := quote_needs_approval(coalesce(v_row.gross_amount, v_row.base_amount), v_row.discount_amount)
             and v_row.approved_at is null;

  if not ((v_from = 'draft' and p_status in ('pending_approval','rejected'))
       or (v_from = 'draft' and p_status in ('sent','accepted') and not v_needs)
       or (v_from = 'pending_approval' and p_status in ('sent','rejected'))
       or (v_from = 'sent' and p_status in ('accepted','rejected'))) then
    if v_from = 'draft' and v_needs then
      raise exception 'الخصم يتجاوز الحد المسموح — أرسل العرض لاعتماد مدير الفرع أولاً';
    end if;
    raise exception 'لا يمكن نقل العرض من «%» إلى «%»', v_from, p_status;
  end if;
  if v_from = 'pending_approval' and not has_perm('leads','approve') then
    raise exception 'اعتماد العرض أو رفضه لمدير الفرع';
  end if;

  update quotes set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         decided_at = case when p_status in ('accepted','rejected') then now() else decided_at end,
         approved_by = case when v_from = 'pending_approval' and p_status = 'sent' then auth.uid() else approved_by end,
         approved_at = case when v_from = 'pending_approval' and p_status = 'sent' then now() else approved_at end
  where id = p_quote_id returning * into v_row;

  if v_from = 'pending_approval' and p_status = 'sent' then
    insert into quote_events (quote_id, type, actor, note) values (p_quote_id, 'approved', auth.uid(), p_note);
  end if;
  insert into quote_events (quote_id, type, actor, note)
  values (p_quote_id, case p_status when 'sent' then 'marked_sent'
                                    when 'pending_approval' then 'submitted_for_approval'
                                    else p_status end, auth.uid(), p_note);
  return v_row;
end;
$$;

-- ---------- 6) accepted quote → customer → contract → order -------------------
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

grant execute on function
  create_quote_from_price(text, jsonb, text, text, date, text, uuid, jsonb, jsonb),
  set_quote_status(uuid, text, text),
  convert_quote_to_contract(uuid, text) to authenticated;
