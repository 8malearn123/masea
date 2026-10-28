-- =============================================================
-- Masiat Alsharq ERP — 0060 Contract from accepted terms (daily rental)
-- التأجير اليومي يُطلب من الموقع/مركز الاتصال ويوافق فيه العميل على الشروط
-- والأحكام دون عقد يُوقَّع. هذا الملف يُنشئ له سجل عقد تلقائيًا حتى يظهر مع بقية
-- العقود (التحصيل، التجديد، نقاط الولاء، التقارير):
--   • العقد «موقّع» بتاريخ الموافقة، وبنوده = نص الشروط الذي وافق عليه العميل
--     (details.accepted_terms)، وتوقيع العميل = موافقته الإلكترونية.
--   • يُربط الطلب بعقده عبر service_requests.contract_id (قائم منذ 0016).
--   • قابل للإيقاف من الإعدادات: app_config.contract_auto_terms_daily (1 = مفعّل).
-- يُبنى فوق contracts / contract_clauses / contract_signatures /
-- contract_status_history / customers / app_config — لا جداول جديدة، لا تعديل
-- على أي بيانات قائمة. التراجع: supabase/rollback/0060_contract_from_accepted_terms_down.sql
-- =============================================================

-- ---------- 1) when the customer accepted the terms ----------
alter table contracts add column if not exists terms_accepted_at timestamptz;

-- ---------- 2) managed switch (settings UI) ------------------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('contract_auto_terms_daily',
   'إنشاء عقد تلقائي للتأجير اليومي عند موافقة العميل على الشروط (1 = مفعّل)',
   'العقود', 1, null, 40)
on conflict (key) do nothing;

-- ---------- 3) the contract from an order --------------------
create or replace function contract_from_accepted_terms(p_request_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  r          service_requests%rowtype;
  v_customer uuid;
  v_accepted timestamptz;
  v_start    date;
  v_end      date;
  v_row      contracts;
  v_clause   text;
  v_i        integer := 0;
begin
  select * into r from service_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if r.contract_id is not null then return r.contract_id; end if;  -- idempotent
  if r.service_code <> 'daily_rental' then return null; end if;
  if not coalesce((r.details->>'agreeTerms')::boolean, false) then return null; end if;

  -- the customer: the order's, else by phone, else a new customer row
  v_customer := r.customer_id;
  if v_customer is null and nullif(btrim(coalesce(r.customer_phone, '')), '') is not null then
    select id into v_customer from customers
    where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9)
        = right(regexp_replace(r.customer_phone, '\D', '', 'g'), 9)
    order by created_at limit 1;
  end if;
  if v_customer is null then
    insert into customers (full_name, phone, city, branch_id)
    values (coalesce(nullif(btrim(r.customer_name), ''), 'عميل'), r.customer_phone,
            r.customer_city, r.branch_id)
    returning id into v_customer;
  end if;

  v_accepted := coalesce(nullif(r.details->>'terms_accepted_at', '')::timestamptz, r.created_at);
  v_start := coalesce(nullif(r.details->>'start_date', '')::date, r.created_at::date);
  v_end   := nullif(r.details->>'end_date', '')::date;

  insert into contracts (
    contract_no, service_code, customer_id, branch_id, start_date, end_date,
    gross_amount, discount_amount, base_amount, status, signed_at, terms_accepted_at
  ) values (
    generate_contract_no(), r.service_code, v_customer, r.branch_id, v_start, v_end,
    r.base_amount, 0, r.base_amount, 'signed', v_accepted, v_accepted
  ) returning * into v_row;

  -- the exact terms the customer accepted become the contract clauses
  for v_clause in
    select jsonb_array_elements_text(coalesce(r.details->'accepted_terms', '[]'::jsonb))
  loop
    insert into contract_clauses (contract_id, sort_order, body) values (v_row.id, v_i, v_clause);
    v_i := v_i + 1;
  end loop;

  -- the acceptance is the customer's signature
  insert into contract_signatures (contract_id, signer_type, signer_name, signed_at)
  values (v_row.id, 'customer',
          coalesce(nullif(btrim(r.customer_name), ''), 'العميل') || ' — موافقة إلكترونية على الشروط',
          v_accepted);

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'signed', null);

  update service_requests set contract_id = v_row.id, customer_id = v_customer where id = r.id;

  insert into audit_log (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'contract.create_from_terms', 'contracts', v_row.id,
          jsonb_build_object('request_no', r.request_no, 'contract_no', v_row.contract_no));

  return v_row.id;
end $$;

grant execute on function contract_from_accepted_terms(uuid) to authenticated;

-- ---------- 4) on every new daily-rental order ---------------
create or replace function trg_request_contract_from_terms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_code = 'daily_rental'
     and coalesce((new.details->>'agreeTerms')::boolean, false)
     and coalesce((select value from app_config where key = 'contract_auto_terms_daily'), 0) = 1 then
    begin
      perform contract_from_accepted_terms(new.id);
    exception when others then
      -- the order must never fail because of the contract record
      raise warning 'contract_from_accepted_terms(%): %', new.request_no, sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists service_requests_contract_from_terms on service_requests;
create trigger service_requests_contract_from_terms after insert on service_requests
  for each row execute function trg_request_contract_from_terms();
