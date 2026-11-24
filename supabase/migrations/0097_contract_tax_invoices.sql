-- =============================================================
-- 0097 — الفاتورة الضريبية للعقد + الإشعارات الدائنة والمدينة
-- (docs/plans/contracts-operations-finance-plan.md — المرحلة 4)
--
-- العقد ليس فاتورة: تُصدر له فاتورة ضريبية واحدة عند توقيعه (الحدث الضريبي —
-- متسق مع ترحيل الإيراد عند التوقيع في 0089)، والفاتورة مستند ضريبي فقط لا قيد
-- إيراد ثانٍ (post_invoice_issued يتخطى فواتير العقود). التصحيح بعد الإصدار عبر
-- إشعار دائن/مدين مرتبط بالفاتورة والعقد — لا تعديل للفاتورة المُصدرة.
--   1) zatca_qr_tlv(): رمز QR للمرحلة الأولى (TLV: البائع، الرقم الضريبي، الوقت،
--      الإجمالي، الضريبة) من بيانات المنشأة الضريبية. المرحلة الثانية (الربط
--      والتوقيع التشفيري) تتطلب شهادة المنشأة من فاتورة — خارج النطاق.
--   2) issue_contract_invoice(): يدوي بالصلاحية، وتلقائي عند التوقيع (قابل للإيقاف
--      من الإعدادات: contract_auto_invoice). فاتورة واحدة نشطة لكل عقد.
--   3) issue_contract_note(): إشعار دائن/مدين يدوي مرحَّل محاسبياً بحدود الفاتورة.
--   4) تسوية العقد المنفّذة (0090) تُنشئ الإشعار الضريبي المطابق لقيدها تلقائياً
--      دون قيد إضافي.
-- آمن لإعادة التشغيل.
-- =============================================================

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('contract_auto_invoice', 'إصدار الفاتورة الضريبية تلقائياً عند توقيع العقد (1 = نعم، 0 = لا)',
   'الفوترة', 1, 'مفتاح', 10)
on conflict (key) do nothing;

-- ---------- 1) ZATCA phase-1 QR --------------------------------------------------
create or replace function zatca_tlv(p_tag int, p_val text) returns bytea
language sql immutable as $$
  select decode(lpad(to_hex(p_tag), 2, '0') || lpad(to_hex(octet_length(convert_to(p_val, 'UTF8'))), 2, '0'), 'hex')
         || convert_to(p_val, 'UTF8')
$$;

-- بيانات البائع: الملف الضريبي (0057) وإلا ملف المنشأة (0086)
create or replace function seller_tax_identity(out seller_name text, out vat_number text)
language sql stable security definer set search_path = public as $$
  select coalesce((select t.seller_name from company_tax_profile t where t.id = 1),
                  (select coalesce(p.legal_name, p.display_name) from company_profile p where p.id = 1)),
         coalesce((select t.vat_number from company_tax_profile t where t.id = 1),
                  (select p.vat_number from company_profile p where p.id = 1))
$$;

create or replace function zatca_qr_tlv(p_at timestamptz, p_total numeric, p_vat numeric) returns text
language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from seller_tax_identity();
  if s.seller_name is null or s.vat_number is null then return null; end if;
  return replace(encode(
      zatca_tlv(1, s.seller_name) || zatca_tlv(2, s.vat_number)
      || zatca_tlv(3, to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      || zatca_tlv(4, to_char(p_total, 'FM999999999990.00'))
      || zatca_tlv(5, to_char(p_vat, 'FM999999999990.00')), 'base64'), E'\n', '');
end $$;

-- ---------- 2) one tax invoice per contract ------------------------------------------
alter table invoices add column if not exists issued_at timestamptz;
-- 0028 أزال حقول الربط مع فاتورة؛ يُعاد رمز QR للمرحلة الأولى فقط (إلزامي على
-- الفاتورة المبسطة)، دون الختم التشفيري أو الإرسال (المرحلة الثانية).
alter table invoices add column if not exists zatca_qr text;
do $$
begin
  if exists (select 1 from invoices where contract_id is not null and status <> 'void'
              group by contract_id having count(*) > 1) then
    raise notice 'invoices_one_per_contract: توجد عقود بأكثر من فاتورة نشطة — راجعها ثم أنشئ الفهرس';
  else
    create unique index if not exists invoices_one_per_contract
      on invoices(contract_id) where contract_id is not null and status <> 'void';
  end if;
end $$;

create or replace function issue_contract_invoice_core(p_contract uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts%rowtype; v_id uuid; v_vatno text; v_now timestamptz := now(); v_desc text;
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
  insert into invoice_lines (invoice_id, description, qty, unit_price, vat_rate)
  values (v_id, v_desc, 1, c.base_amount,
          case when c.base_amount > 0 then round(c.vat_amount / c.base_amount, 4) else 0 end);
  return v_id;
end $$;
revoke execute on function issue_contract_invoice_core(uuid) from public, anon, authenticated;

create or replace function issue_contract_invoice(p_contract uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not (has_perm('accounting', 'create') or has_perm('contracts', 'approve')) then
    raise exception 'لا تملك صلاحية إصدار الفاتورة الضريبية';
  end if;
  if not contract_in_my_scope(p_contract) then raise exception 'العقد غير موجود'; end if;
  return issue_contract_invoice_core(p_contract);
end $$;
grant execute on function issue_contract_invoice(uuid) to authenticated;

create or replace function contracts_auto_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text in ('signed', 'musaned_signed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and ops_cfg('contract_auto_invoice', 1) = 1 and coalesce(new.total_amount, 0) > 0 then
    perform issue_contract_invoice_core(new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_contracts_auto_invoice on contracts;
create trigger trg_contracts_auto_invoice after insert or update of status on contracts
  for each row execute function contracts_auto_invoice();

-- حالة سداد الفاتورة تتبع المدفوع على العقد
create or replace function contracts_sync_invoice_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount_paid is distinct from old.amount_paid then
    update invoices set status = case when new.amount_paid >= total then 'paid'
                                      when new.amount_paid > 0 then 'partial' else 'issued' end
     where contract_id = new.id and status in ('issued', 'partial', 'paid');
  end if;
  return new;
end $$;
drop trigger if exists trg_contracts_sync_invoice_paid on contracts;
create trigger trg_contracts_sync_invoice_paid after update of amount_paid on contracts
  for each row execute function contracts_sync_invoice_paid();

-- ---------- 3) credit / debit notes ---------------------------------------------------
alter table sales_credit_notes add column if not exists contract_id uuid references contracts(id) on delete restrict;
alter table sales_credit_notes add column if not exists settlement_id uuid references contract_settlements(id) on delete restrict;
alter table sales_credit_notes add column if not exists zatca_qr text;
create unique index if not exists scn_one_per_settlement on sales_credit_notes(settlement_id) where settlement_id is not null;

create table if not exists sales_debit_notes (
  id          uuid primary key default gen_random_uuid(),
  note_no     serial unique,
  invoice_id  uuid not null references invoices(id) on delete restrict,
  contract_id uuid references contracts(id) on delete restrict,
  settlement_id uuid references contract_settlements(id) on delete restrict,
  note_date   date not null default current_date,
  subtotal    numeric(14,2) not null check (subtotal > 0),
  vat_amount  numeric(14,2) not null default 0 check (vat_amount >= 0),
  total       numeric(14,2) not null,
  reason      text not null,
  zatca_qr    text,
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  check (total = subtotal + vat_amount)
);
create unique index if not exists sdn_one_per_settlement on sales_debit_notes(settlement_id) where settlement_id is not null;
alter table sales_debit_notes enable row level security;
drop policy if exists sdn_read on sales_debit_notes;
create policy sdn_read on sales_debit_notes for select to authenticated
  using (has_perm('accounting', 'view') or (contract_id is not null and has_perm('contracts', 'view') and contract_in_my_scope(contract_id)));
drop trigger if exists trg_audit_row on sales_debit_notes;
create trigger trg_audit_row after insert or update or delete on sales_debit_notes
  for each row execute function audit_row_change();
-- الإشعارات لا تُعدَّل ولا تُحذف بعد إصدارها
create or replace function tax_note_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'لا يُحذف الإشعار الضريبي بعد إصداره'; end if;
  if (to_jsonb(new) - 'journal_entry_id') <> (to_jsonb(old) - 'journal_entry_id') then
    raise exception 'الإشعار الضريبي المُصدر لا يُعدَّل';
  end if;
  return new;
end $$;
drop trigger if exists trg_sdn_guard on sales_debit_notes;
create trigger trg_sdn_guard before update or delete on sales_debit_notes
  for each row execute function tax_note_guard();

-- قراءة إشعارات العقد الدائنة لمن يرى العقد
drop policy if exists scn_contract_read on sales_credit_notes;
create policy scn_contract_read on sales_credit_notes for select to authenticated
  using (contract_id is not null and has_perm('contracts', 'view') and contract_in_my_scope(contract_id));
-- وفواتير العقود لمن يرى العقد
drop policy if exists inv_contract_read on invoices;
create policy inv_contract_read on invoices for select to authenticated
  using (contract_id is not null and has_perm('contracts', 'view') and contract_in_my_scope(contract_id));
drop policy if exists invl_contract_read on invoice_lines;
create policy invl_contract_read on invoice_lines for select to authenticated
  using (exists (select 1 from invoices i where i.id = invoice_id and i.contract_id is not null
                   and has_perm('contracts', 'view') and contract_in_my_scope(i.contract_id)));

-- صافي الفاتورة بعد الإشعارات (الحد الأقصى للإشعار الدائن)
create or replace function invoice_net_total(p_invoice uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select i.total
         - coalesce((select sum(total) from sales_credit_notes where invoice_id = i.id), 0)
         + coalesce((select sum(total) from sales_debit_notes where invoice_id = i.id), 0)
    from invoices i where i.id = p_invoice
$$;

create or replace function issue_contract_note_core(
  p_contract uuid, p_kind text, p_total numeric, p_reason text,
  p_settlement uuid default null, p_entry uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c contracts%rowtype; v_inv invoices%rowtype; v_net numeric; v_vat numeric; v_id uuid;
        v_entry uuid := p_entry; v_rev uuid; v_rate numeric;
begin
  if p_kind not in ('credit', 'debit') then raise exception 'نوع الإشعار غير صحيح'; end if;
  if coalesce(p_total, 0) <= 0 then raise exception 'مبلغ الإشعار يجب أن يكون أكبر من صفر'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'سبب الإشعار مطلوب'; end if;
  select * into c from contracts where id = p_contract;
  select * into v_inv from invoices where contract_id = p_contract and status <> 'void';
  if v_inv.id is null then raise exception 'لا فاتورة ضريبية لهذا العقد — أصدرها أولاً'; end if;
  if p_kind = 'credit' and p_total > invoice_net_total(v_inv.id) + 0.005 then
    raise exception 'الإشعار الدائن يتجاوز صافي الفاتورة (%)', round(invoice_net_total(v_inv.id), 2);
  end if;
  v_rate := case when v_inv.subtotal > 0 then v_inv.vat_amount / v_inv.subtotal else 0 end;
  v_net := round(p_total / (1 + v_rate), 2);
  v_vat := round(p_total, 2) - v_net;

  if v_entry is null then
    v_rev := case when c.service_code is not null then revenue_account_for_code(c.service_code)
                  else revenue_account_for(c.service_type) end;
    insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type,
                                 source_id, status, kind, idempotency_key, posted_at)
    values (current_date, ensure_period(current_date), c.branch_id,
            case p_kind when 'credit' then 'إشعار دائن — عقد ' else 'إشعار مدين — عقد ' end
              || coalesce(c.contract_no, c.contract_number::text),
            'INV-' || v_inv.invoice_no, 'adjustment', p_contract, 'posted', 'adjusting',
            'TN-' || p_kind || '-' || gen_random_uuid(), now())
    returning id into v_entry;
    if p_kind = 'credit' then
      insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
      select v_entry, a, d, cr, c.branch_id, ds from (values
        (v_rev, v_net, 0::numeric, 'تخفيض الإيراد'),
        (acc_id('2120'), v_vat, 0::numeric, 'تخفيض ضريبة المخرجات'),
        (acc_id('1120'), 0::numeric, round(p_total, 2), 'تخفيض ذمة العميل')) l(a, d, cr, ds) where d > 0 or cr > 0;
    else
      insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
      select v_entry, a, d, cr, c.branch_id, ds from (values
        (acc_id('1120'), round(p_total, 2), 0::numeric, 'زيادة ذمة العميل'),
        (v_rev, 0::numeric, v_net, 'إيراد إضافي'),
        (acc_id('2120'), 0::numeric, v_vat, 'ضريبة مخرجات')) l(a, d, cr, ds) where d > 0 or cr > 0;
    end if;
  end if;

  if p_kind = 'credit' then
    insert into sales_credit_notes (invoice_id, contract_id, settlement_id, subtotal, vat_amount, total,
                                    reason, journal_entry_id, created_by, zatca_qr)
    values (v_inv.id, p_contract, p_settlement, v_net, v_vat, round(p_total, 2), btrim(p_reason), v_entry,
            auth.uid(), zatca_qr_tlv(now(), round(p_total, 2), v_vat))
    returning id into v_id;
  else
    insert into sales_debit_notes (invoice_id, contract_id, settlement_id, subtotal, vat_amount, total,
                                   reason, journal_entry_id, zatca_qr)
    values (v_inv.id, p_contract, p_settlement, v_net, v_vat, round(p_total, 2), btrim(p_reason), v_entry,
            zatca_qr_tlv(now(), round(p_total, 2), v_vat))
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function issue_contract_note_core(uuid, text, numeric, text, uuid, uuid) from public, anon, authenticated;

create or replace function issue_contract_note(p_contract uuid, p_kind text, p_total numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('accounting', 'create') then raise exception 'لا تملك صلاحية إصدار الإشعارات الضريبية'; end if;
  if not contract_in_my_scope(p_contract) then raise exception 'العقد غير موجود'; end if;
  return issue_contract_note_core(p_contract, p_kind, p_total, p_reason);
end $$;
grant execute on function issue_contract_note(uuid, text, numeric, text) to authenticated;

-- ---------- 4) settled settlement → matching tax note (its entry already exists) -------------
create or replace function settlements_tax_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_r numeric; v_entry uuid;
begin
  if new.status = 'settled' and old.status is distinct from 'settled'
     and exists (select 1 from invoices where contract_id = new.contract_id and status <> 'void') then
    select id into v_entry from journal_entries where idempotency_key = 'ST-' || new.id;
    v_r := new.contract_value - new.service_due - new.fees_total;
    if v_entry is not null and v_r > 0 then
      perform issue_contract_note_core(new.contract_id, 'credit', least(v_r, invoice_net_total(
                (select id from invoices where contract_id = new.contract_id and status <> 'void'))),
              'تسوية ' || new.settlement_no || ' — ' || coalesce(nullif(new.reason_note, ''), 'إلغاء/إرجاع'),
              new.id, v_entry);
    elsif v_entry is not null and v_r < 0 then
      perform issue_contract_note_core(new.contract_id, 'debit', abs(v_r),
              'رسوم تسوية ' || new.settlement_no, new.id, v_entry);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_settlements_tax_note on contract_settlements;
create trigger trg_settlements_tax_note after update of status on contract_settlements
  for each row execute function settlements_tax_note();

-- ---------- 5) the contract's tax documents ---------------------------------------------------
create or replace function contract_tax_documents(p_contract uuid)
returns table (id uuid, kind text, doc_no text, doc_date date, subtotal numeric, vat_amount numeric,
               total numeric, status text, invoice_type text, reason text, zatca_qr text, issued_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((has_perm('contracts', 'view') and contract_in_my_scope(p_contract)) or has_perm('accounting', 'view')) then
    raise exception 'لا تملك صلاحية عرض فواتير العقد';
  end if;
  return query
    select i.id, 'invoice'::text, 'INV-' || lpad(i.invoice_no::text, 6, '0'), i.issue_date, i.subtotal,
           i.vat_amount, i.total, i.status, i.invoice_type, null::text, i.zatca_qr, coalesce(i.issued_at, i.created_at)
      from invoices i where i.contract_id = p_contract
    union all
    select n.id, 'credit_note', 'CN-' || lpad(n.note_no::text, 6, '0'), n.note_date, n.subtotal, n.vat_amount,
           n.total, 'issued', null, n.reason, n.zatca_qr, n.created_at
      from sales_credit_notes n where n.contract_id = p_contract
    union all
    select n.id, 'debit_note', 'DN-' || lpad(n.note_no::text, 6, '0'), n.note_date, n.subtotal, n.vat_amount,
           n.total, 'issued', null, n.reason, n.zatca_qr, n.created_at
      from sales_debit_notes n where n.contract_id = p_contract
    order by 12;
end $$;
grant execute on function contract_tax_documents(uuid) to authenticated;
