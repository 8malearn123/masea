-- =============================================================
-- 0098 — مصدر العميل: من العميل المحتمل إلى العميل والعقد والمبيعات
-- (docs/plans/marketing-attribution-plan.md — المرحلة 1)
--
--   * القائمة نفسها lead_sources (تُدار من الإعدادات) توسَّع بالمنصات، مع
--     requires_note («أخرى» تتطلب توضيحاً). «حملة تسويقية» تُعطَّل للإدخال الجديد
--     فقط (الحملة صارت حقلاً مستقلاً) — السجلات القديمة تحتفظ بها.
--   * مصدر الاكتساب الأصلي على العميل — يُسجَّل مرة، وتغييره بصلاحية إدارية
--     وسبب مع سجل. مصدر العقد والحملة مستقلان على كل عقد، والعقد يحفظ لقطة من
--     مصدر الاكتساب وتاريخ أول تواصل وقت إنشائه.
--   * convert_lead_to_customer ينقل المصدر والحملة وتاريخ أول تواصل.
--   * العملاء القدامى: يُملأ المصدر فقط من عميل محتمل محوَّل له مصدر مسجّل
--     (دليل في النظام)؛ الباقي يبقى فارغاً = «غير محدد». لا تخمين.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) sources -------------------------------------------------------------
alter table lead_sources add column if not exists requires_note boolean not null default false;
alter table lead_sources add column if not exists kind text not null default 'other';
alter table lead_sources drop constraint if exists lead_sources_kind_check;
alter table lead_sources add constraint lead_sources_kind_check
  check (kind in ('platform', 'direct', 'referral', 'other'));

insert into lead_sources (code, name_ar, sort_order, kind, requires_note) values
  ('snapchat',    'سناب شات',        10, 'platform', false),
  ('tiktok',      'تيك توك',         11, 'platform', false),
  ('facebook',    'فيسبوك',          12, 'platform', false),
  ('x',           'منصة إكس',        13, 'platform', false),
  ('whatsapp',    'واتساب',          14, 'platform', false),
  ('instagram',   'إنستغرام',        15, 'platform', false),
  ('google',      'جوجل',            16, 'platform', false),
  ('direct_call', 'اتصال مباشر',     17, 'direct',   false),
  ('other',       'أخرى',            99, 'other',    true)
on conflict (code) do nothing;
update lead_sources set kind = 'direct' where code in ('walk_in', 'call_center', 'website') and kind = 'other';
update lead_sources set kind = 'referral', name_ar = 'توصية من عميل' where code = 'referral';
update lead_sources set name_ar = 'زيارة الفرع' where code = 'walk_in';
update lead_sources set is_active = false where code = 'campaign';

-- ملاحظة «أخرى» إلزامية
create or replace function source_note_ok(p_code text, p_note text) returns boolean
language sql stable as $$
  select p_code is null
      or not coalesce((select requires_note from lead_sources where code = p_code), false)
      or length(btrim(coalesce(p_note, ''))) >= 2
$$;

-- ---------- 2) columns -----------------------------------------------------------------
alter table customers add column if not exists acquisition_source_code text references lead_sources(code);
alter table customers add column if not exists acquisition_source_note text;
alter table customers add column if not exists acquisition_campaign_id uuid references campaigns(id) on delete set null;
alter table customers add column if not exists first_contact_at date;
alter table customers add column if not exists acquisition_set_by uuid references auth.users(id) on delete set null;
alter table customers add column if not exists acquisition_set_at timestamptz;
create index if not exists idx_customers_acq_source on customers(acquisition_source_code);

alter table leads add column if not exists source_note text;
alter table leads add column if not exists campaign_id uuid references campaigns(id) on delete set null;
alter table leads add column if not exists first_contact_at date default current_date;
create index if not exists idx_leads_campaign on leads(campaign_id);

alter table contracts add column if not exists source_code text references lead_sources(code);
alter table contracts add column if not exists source_note text;
alter table contracts add column if not exists campaign_id uuid references campaigns(id) on delete set null;
alter table contracts add column if not exists lead_id uuid references leads(id) on delete set null;
alter table contracts add column if not exists acquisition_source_code text references lead_sources(code);
alter table contracts add column if not exists first_contact_at date;
create index if not exists idx_contracts_source on contracts(source_code);
create index if not exists idx_contracts_campaign on contracts(campaign_id);
create index if not exists idx_contracts_acq_source on contracts(acquisition_source_code);

create table if not exists customer_acquisition_changes (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  old_source   text,
  new_source   text,
  old_note     text,
  new_note     text,
  reason       text not null,
  changed_by   uuid references auth.users(id) on delete set null default auth.uid(),
  changed_at   timestamptz not null default now()
);
alter table customer_acquisition_changes enable row level security;
drop policy if exists cac_read on customer_acquisition_changes;
create policy cac_read on customer_acquisition_changes for select to authenticated
  using (can_view_customers());

-- ---------- 3) guards --------------------------------------------------------------------
-- المصدر الأصلي لا يتغيّر بعد تسجيله إلا عبر change_customer_acquisition
create or replace function customers_guard_acquisition() returns trigger language plpgsql as $$
begin
  if old.acquisition_source_code is not null
     and (new.acquisition_source_code is distinct from old.acquisition_source_code
          or new.acquisition_source_note is distinct from old.acquisition_source_note)
     and coalesce(current_setting('masea.acq_change', true), 'off') <> 'on' then
    raise exception 'مصدر العميل الأصلي مسجّل — يُعدَّل بصلاحية إدارية وسبب';
  end if;
  if not source_note_ok(new.acquisition_source_code, new.acquisition_source_note) then
    raise exception 'وضّح المصدر عند اختيار «أخرى»';
  end if;
  return new;
end $$;
drop trigger if exists trg_customers_guard_acquisition on customers;
create trigger trg_customers_guard_acquisition before update or insert on customers
  for each row execute function customers_guard_acquisition();

create or replace function leads_guard_source() returns trigger language plpgsql as $$
begin
  if not source_note_ok(new.source_code, new.source_note) then
    raise exception 'وضّح المصدر عند اختيار «أخرى»';
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_guard_source on leads;
create trigger trg_leads_guard_source before insert or update of source_code, source_note on leads
  for each row execute function leads_guard_source();

-- العقد يحفظ لقطة من مصدر الاكتساب وتاريخ أول تواصل عند إنشائه، ولا تتغيّر اللقطة بعدها
create or replace function contracts_snapshot_acquisition() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.acquisition_source_code is null or new.first_contact_at is null then
      select coalesce(new.acquisition_source_code, c.acquisition_source_code),
             coalesce(new.first_contact_at, c.first_contact_at)
        into new.acquisition_source_code, new.first_contact_at
        from customers c where c.id = new.customer_id;
    end if;
  elsif old.acquisition_source_code is not null
        and new.acquisition_source_code is distinct from old.acquisition_source_code then
    raise exception 'لقطة مصدر الاكتساب على العقد لا تتغيّر';
  end if;
  if not source_note_ok(new.source_code, new.source_note) then
    raise exception 'وضّح مصدر العقد عند اختيار «أخرى»';
  end if;
  return new;
end $$;
drop trigger if exists trg_contracts_snapshot_acquisition on contracts;
create trigger trg_contracts_snapshot_acquisition before insert or update on contracts
  for each row execute function contracts_snapshot_acquisition();

-- ---------- 4) functions -------------------------------------------------------------------
-- تسجيل مصدر الاكتساب أول مرة (لا يكتب فوق مصدر موجود)
create or replace function apply_customer_acquisition(p_customer uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_cur text; v_src text := nullif(p->>'acquisition_source_code', '');
begin
  select acquisition_source_code into v_cur from customers where id = p_customer;
  if not found then raise exception 'العميل غير موجود'; end if;
  if v_cur is not null then return; end if;
  if v_src is null then raise exception 'حدّد مصدر العميل الأصلي قبل إكمال العقد'; end if;
  if not exists (select 1 from lead_sources where code = v_src and is_active) then
    raise exception 'مصدر العميل غير متاح';
  end if;
  update customers set acquisition_source_code = v_src,
         acquisition_source_note = nullif(btrim(coalesce(p->>'acquisition_source_note', '')), ''),
         acquisition_campaign_id = coalesce(acquisition_campaign_id, nullif(p->>'acquisition_campaign_id', '')::uuid),
         first_contact_at = coalesce(first_contact_at, nullif(p->>'first_contact_at', '')::date, current_date),
         acquisition_set_by = auth.uid(), acquisition_set_at = now()
   where id = p_customer;
end $$;
revoke execute on function apply_customer_acquisition(uuid, jsonb) from public, anon, authenticated;

create or replace function apply_contract_marketing(p_contract uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_src text; v_acq text;
begin
  select cu.acquisition_source_code into v_acq
    from contracts c join customers cu on cu.id = c.customer_id where c.id = p_contract;
  v_src := coalesce(nullif(p->>'source_code', ''), v_acq);
  if v_src is not null and not exists (select 1 from lead_sources where code = v_src) then
    raise exception 'مصدر العقد غير صحيح';
  end if;
  update contracts set
    source_code = v_src,
    source_note = nullif(btrim(coalesce(p->>'source_note', '')), ''),
    campaign_id = nullif(p->>'campaign_id', '')::uuid,
    lead_id = coalesce(contracts.lead_id, nullif(p->>'lead_id', '')::uuid),
    acquisition_source_code = coalesce(contracts.acquisition_source_code, v_acq),
    first_contact_at = coalesce(contracts.first_contact_at, (select cu.first_contact_at from customers cu
                                                     join contracts c on c.customer_id = cu.id where c.id = p_contract))
  where contracts.id = p_contract;
end $$;
revoke execute on function apply_contract_marketing(uuid, jsonb) from public, anon, authenticated;

-- تسجيل المصدر لعميل بلا مصدر (من ملفه أو من شاشة العقد)
create or replace function set_customer_acquisition(p_customer uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_perm('customers', 'edit') or has_perm('contracts', 'create') or has_perm('leads', 'create')) then
    raise exception 'لا تملك صلاحية تسجيل مصدر العميل';
  end if;
  if exists (select 1 from customers where id = p_customer and acquisition_source_code is not null) then
    raise exception 'مصدر العميل الأصلي مسجّل — استخدم «تصحيح المصدر» بصلاحية إدارية';
  end if;
  perform apply_customer_acquisition(p_customer, p);
end $$;
grant execute on function set_customer_acquisition(uuid, jsonb) to authenticated;

-- تصحيح مصدر مسجّل: مدير الفرع/العمليات/المدير العام، بسبب، مع سجل
create or replace function change_customer_acquisition(p_customer uuid, p_source text, p_note text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c customers%rowtype;
begin
  if not (is_admin() or get_my_role() in ('branch_manager', 'operations_manager')) then
    raise exception 'تصحيح مصدر العميل الأصلي لمدير الفرع أو العمليات أو المدير العام';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'سبب التصحيح مطلوب'; end if;
  select * into c from customers where id = p_customer for update;
  if not found then raise exception 'العميل غير موجود'; end if;
  if not exists (select 1 from lead_sources where code = p_source) then raise exception 'المصدر غير صحيح'; end if;
  insert into customer_acquisition_changes (customer_id, old_source, new_source, old_note, new_note, reason)
  values (p_customer, c.acquisition_source_code, p_source, c.acquisition_source_note, nullif(btrim(p_note), ''), btrim(p_reason));
  perform set_config('masea.acq_change', 'on', true);
  update customers set acquisition_source_code = p_source, acquisition_source_note = nullif(btrim(p_note), ''),
         acquisition_set_by = auth.uid(), acquisition_set_at = now()
   where id = p_customer;
  perform set_config('masea.acq_change', 'off', true);
end $$;
grant execute on function change_customer_acquisition(uuid, text, text, text) to authenticated;

-- مصدر العقد/الحملة بعد إنشائه (قبل الإلغاء) — للموظف بصلاحية تعديل العقود
create or replace function set_contract_marketing(p_contract uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_perm('contracts', 'edit') or has_perm('contracts', 'create')) or not contract_in_my_scope(p_contract) then
    raise exception 'لا تملك صلاحية تعديل البيانات التسويقية للعقد';
  end if;
  perform apply_contract_marketing(p_contract, p);
end $$;
grant execute on function set_contract_marketing(uuid, jsonb) to authenticated;

-- التحويل من عميل محتمل ينقل المصدر والحملة وتاريخ أول تواصل
create or replace function convert_lead_to_customer(p_lead_id uuid)
returns customers language plpgsql security definer set search_path = public
as $$
declare v_lead leads; v_customer customers;
begin
  select * into v_lead from leads where id = p_lead_id;
  if not found then raise exception 'العميل المحتمل غير موجود'; end if;
  if not (is_cross_branch() or (v_lead.branch_id = get_my_branch()
      and (v_lead.assigned_to = auth.uid() or get_my_role() = 'branch_manager'))) then
    raise exception 'هذا العميل المحتمل خارج نطاقك';
  end if;
  if v_lead.customer_id is not null then
    update customers set
      acquisition_source_code = v_lead.source_code,
      acquisition_source_note = v_lead.source_note,
      acquisition_campaign_id = v_lead.campaign_id,
      first_contact_at = coalesce(first_contact_at, v_lead.first_contact_at, v_lead.created_at::date),
      acquisition_set_by = auth.uid(), acquisition_set_at = now()
     where id = v_lead.customer_id and acquisition_source_code is null and v_lead.source_code is not null;
    select * into v_customer from customers where id = v_lead.customer_id;
    return v_customer;
  end if;
  insert into customers (full_name, phone, branch_id, acquisition_source_code, acquisition_source_note,
                         acquisition_campaign_id, first_contact_at, acquisition_set_by, acquisition_set_at)
  values (v_lead.full_name, v_lead.phone, v_lead.branch_id, v_lead.source_code, v_lead.source_note,
          v_lead.campaign_id, coalesce(v_lead.first_contact_at, v_lead.created_at::date),
          case when v_lead.source_code is not null then auth.uid() end,
          case when v_lead.source_code is not null then now() end)
  returning * into v_customer;
  update leads set customer_id = v_customer.id, updated_at = now() where id = p_lead_id;
  return v_customer;
end $$;
grant execute on function convert_lead_to_customer(uuid) to authenticated;

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

-- ---------- 5) existing data: evidence only ---------------------------------------------------
-- العميل المحوَّل من عميل محتمل له مصدر مسجّل → يُنقل مصدر أقدم عميل محتمل له
update customers c set
  acquisition_source_code = l.source_code,
  acquisition_source_note = l.source_note,
  acquisition_campaign_id = l.campaign_id,
  first_contact_at = coalesce(c.first_contact_at, l.first_contact_at, l.created_at::date),
  acquisition_set_at = now()
from (select distinct on (customer_id) customer_id, source_code, source_note, campaign_id, first_contact_at, created_at
        from leads where customer_id is not null and source_code is not null
       order by customer_id, created_at) l
where l.customer_id = c.id and c.acquisition_source_code is null;

-- العقد المرتبط بعرض سعر من عميل محتمل → رابط العميل المحتمل (حقيقة مسجّلة)، واللقطة من ملف العميل
update contracts k set lead_id = q.lead_id
  from quotes q where q.contract_id = k.id and q.lead_id is not null and k.lead_id is null;
update contracts k set acquisition_source_code = c.acquisition_source_code,
       first_contact_at = coalesce(k.first_contact_at, c.first_contact_at)
  from customers c where c.id = k.customer_id and k.acquisition_source_code is null and c.acquisition_source_code is not null;

drop trigger if exists trg_audit_row on customer_acquisition_changes;
create trigger trg_audit_row after insert on customer_acquisition_changes
  for each row execute function audit_row_change();
