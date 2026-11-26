-- =============================================================
-- 0108 — السعر المُدخل شامل ضريبة القيمة المضافة (لا تُضاف الضريبة عليه)
--
--   * contracts.vat_inclusive: العقد الذي يُدخل سعره يدوياً يُسعَّر بالإجمالي شاملاً الضريبة؛
--     set_contract_vat يستخرج الصافي والضريبة منه بنسبة الإعدادات (pricing_config.vat_rate):
--       الصافي = round(الإجمالي ÷ (1 + النسبة), 2) · الضريبة = الإجمالي − الصافي · الإجمالي = المدخل.
--     العقود الأخرى (قائمة الأسعار قبل الضريبة) والعقود السابقة دون تغيير.
--   * create_trial_agreement: «سعر التجربة المتفق عليه» = الإجمالي شامل الضريبة (1,000 ← 869.57 + 130.43).
--   * invoice_lines.line_vat_fixed: بند فاتورة العقد شامل الضريبة يحمل ضريبته المستخرجة نفسها
--     (لا يُعاد حسابها فتصبح 130.44 / 1,000.01)؛ البنود السابقة تُحسب كما كانت تماماً.
-- آمن لإعادة التشغيل.
-- =============================================================

alter table contracts add column if not exists vat_inclusive boolean not null default false;

-- ---------- 1) one split rule, one rate ----------
create or replace function vat_split_inclusive(p_total numeric)
returns table (net numeric, vat numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_rate numeric; v_total numeric := round(coalesce(p_total, 0), 2); v_net numeric;
begin
  select vat_rate into v_rate from pricing_config where id = 1;
  if v_rate is null then raise exception 'نسبة الضريبة غير معرّفة في إعدادات التسعير'; end if;
  v_net := round(v_total / (1 + v_rate), 2);
  return query select v_net, v_total - v_net, v_total;
end $$;
grant execute on function vat_split_inclusive(numeric) to authenticated;

create or replace function set_contract_vat() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_qvat numeric; v_qbase numeric; s record;
begin
  -- السعر المدخل شامل الضريبة: الإجمالي هو المصدر، ويُستخرج منه الصافي والضريبة
  if new.vat_inclusive then
    if tg_op = 'UPDATE' and old.vat_inclusive and new.total_amount is not distinct from old.total_amount
       and new.base_amount is not distinct from old.base_amount then
      new.vat_amount := old.vat_amount;
      return new;
    end if;
    if tg_op = 'UPDATE' and new.total_amount is not distinct from old.total_amount
       and new.base_amount is distinct from old.base_amount then
      -- تغيّر الصافي وحده (مسار قائمة الأسعار): يُضاف عليه الضريبة كالمعتاد
      select vat_rate into v_rate from pricing_config where id = 1;
      new.vat_amount := round(coalesce(new.base_amount, 0) * v_rate, 2);
      new.total_amount := coalesce(new.base_amount, 0) + new.vat_amount;
      return new;
    end if;
    select * into s from vat_split_inclusive(new.total_amount);
    new.base_amount := s.net;
    new.vat_amount := s.vat;
    new.total_amount := s.total;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.base_amount is not distinct from old.base_amount then
    new.vat_amount := old.vat_amount;
    new.total_amount := old.total_amount;
    return new;
  end if;
  -- a contract converted from a quote keeps the quote's frozen VAT
  if tg_op = 'INSERT' and new.quote_id is not null then
    select vat_amount, base_amount into v_qvat, v_qbase from quotes where id = new.quote_id;
    if v_qvat is not null and v_qbase is not distinct from new.base_amount then
      new.vat_amount := v_qvat;
      new.total_amount := new.base_amount + v_qvat;
      return new;
    end if;
  end if;
  select vat_rate into v_rate from pricing_config where id = 1;
  if v_rate is null then raise exception 'نسبة الضريبة غير معرّفة في إعدادات التسعير'; end if;
  new.vat_amount := round(coalesce(new.base_amount, 0) * v_rate, 2);
  new.total_amount := coalesce(new.base_amount, 0) + new.vat_amount;
  return new;
end $$;
drop trigger if exists trg_set_contract_vat on contracts;
create trigger trg_set_contract_vat before insert or update of base_amount, vat_amount, total_amount, vat_inclusive on contracts
  for each row execute function set_contract_vat();

-- ---------- 2) the trial's agreed price is VAT-inclusive ----------
create or replace function create_trial_agreement(
  p_customer uuid, p_worker uuid, p_branch text, p_price numeric, p_days int, p_receipt date)
returns trial_agreements language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid := resolve_branch_id(p_branch); v_tpl contract_templates; v_max int;
  v_ref numeric; v_contract contracts; v_row trial_agreements; v_end date; v_hit contracts; v_wname text;
begin
  if not has_perm('contracts', 'create') then raise exception 'لا تملك صلاحية إنشاء التجارب'; end if;
  if v_branch is null then raise exception 'الفرع غير معروف'; end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then raise exception 'لا يمكنك الإنشاء خارج فرعك'; end if;
  if p_customer is null then raise exception 'اختر العميل'; end if;
  if coalesce(p_price, 0) <= 0 then raise exception 'حدّد سعر التجربة المتفق عليه'; end if;
  v_max := ops_cfg('trial_max_days', 90)::int;
  if coalesce(p_days, 0) <= 0 or p_days > v_max then
    raise exception 'مدة التجربة بين يوم و% يوماً (لائحة العمالة المنزلية — المادة التاسعة)', v_max;
  end if;
  if p_receipt is null then raise exception 'حدّد تاريخ استلام العاملة'; end if;
  select * into v_tpl from contract_templates
   where template_code = 'transfer_trial_terms' and service_code = 'transfer_trial' and status = 'approved'
   order by version desc limit 1;
  if v_tpl.id is null then
    raise exception 'لا توجد شروط تجربة معتمدة — تكتبها الشركة وتعتمدها من الإعدادات أولاً';
  end if;
  select full_name into v_wname from worker_profiles where id = p_worker and is_active;
  if v_wname is null then raise exception 'العاملة غير موجودة أو معطّلة'; end if;
  v_end := p_receipt + p_days - 1;
  v_hit := worker_contract_conflict(p_worker, p_receipt, v_end, null);
  if v_hit.id is not null then
    raise exception 'العاملة % محجوزة على العقد % في فترة التجربة', v_wname, coalesce(v_hit.contract_no, v_hit.id::text);
  end if;
  begin
    v_ref := nullif((calc_price('transfer_trial', jsonb_build_object('quantity', 1))->>'base')::numeric, 0);
  exception when others then v_ref := null;
  end;

  -- الإجمالي = السعر المتفق عليه كما أُدخل؛ الصافي والضريبة يُستخرجان منه (set_contract_vat)
  insert into contracts (contract_no, service_code, template_id, customer_id, branch_id, start_date, end_date,
                         gross_amount, discount_amount, base_amount, total_amount, vat_inclusive,
                         pricing_params, status, created_by)
  values (generate_contract_no(), 'transfer_trial', v_tpl.id, p_customer, v_branch, p_receipt, v_end,
          0, 0, 0, round(p_price, 2), true,
          jsonb_build_object('agreed_price_incl_vat', round(p_price, 2), 'calc_price_reference', v_ref,
                             'trial_days', p_days),
          'draft', auth.uid())
  returning * into v_contract;
  update contracts set worker_profile_id = p_worker, gross_amount = v_contract.base_amount
   where id = v_contract.id returning * into v_contract;
  insert into contract_status_history (contract_id, from_status, to_status, changed_by, note)
  values (v_contract.id, null, 'draft', auth.uid(), 'تجربة نقل خدمات');

  insert into trial_agreements (trial_no, contract_id, customer_id, worker_profile_id, branch_id, price, vat_amount,
    total_amount, pricing_reference, trial_days, receipt_date, end_date, terms_template_id, terms_snapshot, created_by)
  values (next_ops_no('TR'), v_contract.id, p_customer, p_worker, v_branch, v_contract.base_amount, v_contract.vat_amount,
    v_contract.total_amount, v_ref, p_days, p_receipt, v_end, v_tpl.id, v_tpl.doc, auth.uid())
  returning * into v_row;
  perform log_contract_op(v_contract.id, 'trial', v_row.id, 'create', null, 'draft', null);
  return v_row;
end $$;
grant execute on function create_trial_agreement(uuid, uuid, text, numeric, int, date) to authenticated;

-- ---------- 3) invoice lines carry the extracted VAT of inclusive contracts ----------
alter table invoice_lines add column if not exists line_vat_fixed numeric(14,2);
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'invoice_lines'
                  and column_name = 'line_vat' and generation_expression like '%line_vat_fixed%') then
    alter table invoice_lines drop column line_total, drop column line_vat;
    alter table invoice_lines
      add column line_vat numeric(14,2) generated always as
        (coalesce(line_vat_fixed, round(qty * unit_price * vat_rate, 2))) stored,
      add column line_total numeric(14,2) generated always as
        (round(qty * unit_price, 2) + coalesce(line_vat_fixed, round(qty * unit_price * vat_rate, 2))) stored;
  end if;
end $$;

create or replace function issue_contract_invoice_core(p_contract uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts%rowtype; v_id uuid; v_vatno text; v_now timestamptz := now(); v_desc text; v_rate numeric;
begin
  select id into v_id from invoices where contract_id = p_contract and status <> 'void';
  if v_id is not null then return v_id; end if;
  select * into c from contracts where id = p_contract;
  if not found then raise exception 'العقد غير موجود'; end if;
  if c.status::text not in ('signed', 'musaned_signed', 'active', 'completed') then
    raise exception 'تُصدر الفاتورة الضريبية بعد توقيع العقد فقط';
  end if;
  if coalesce(c.total_amount, 0) <= 0 then raise exception 'لا قيمة للعقد لإصدار فاتورة'; end if;
  select nullif(btrim(vat_number), '') into v_vatno from customers where id = c.customer_id;
  v_desc := coalesce((select name_ar from services where code = c.service_code), c.service_code, 'خدمة')
            || ' — عقد ' || coalesce(c.contract_no, c.contract_number::text)
            || coalesce(' (' || to_char(c.start_date, 'YYYY-MM-DD') || ' إلى ' || to_char(c.end_date, 'YYYY-MM-DD') || ')', '');
  insert into invoices (invoice_type, contract_id, customer_id, branch_id, issue_date, due_date,
                        subtotal, vat_amount, total, status, zatca_qr, issued_at, created_by)
  values (case when v_vatno is not null then 'standard' else 'simplified' end,
          c.id, c.customer_id, c.branch_id, v_now::date, coalesce(c.start_date, v_now::date),
          c.base_amount, c.vat_amount, c.total_amount,
          case when c.amount_paid >= c.total_amount then 'paid' when c.amount_paid > 0 then 'partial' else 'issued' end,
          zatca_qr_tlv(v_now, c.total_amount, c.vat_amount), v_now, auth.uid())
  returning id into v_id;
  if c.vat_inclusive then
    -- النسبة المعتمدة نفسها، والضريبة المستخرجة من الإجمالي كما هي في العقد
    select vat_rate into v_rate from pricing_config where id = 1;
    insert into invoice_lines (invoice_id, description, qty, unit_price, vat_rate, line_vat_fixed)
    values (v_id, v_desc, 1, c.base_amount, v_rate, c.vat_amount);
  else
    insert into invoice_lines (invoice_id, description, qty, unit_price, vat_rate)
    values (v_id, v_desc, 1, c.base_amount,
            case when c.base_amount > 0 then round(c.vat_amount / c.base_amount, 4) else 0 end);
  end if;
  return v_id;
end $$;
revoke execute on function issue_contract_invoice_core(uuid) from public, anon, authenticated;
