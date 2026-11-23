-- =============================================================
-- 0090 — إلغاء العقد وتسويته · إرجاع العاملة · الاسترداد (المرحلتان 1 و 2)
--
-- فوق العقود (0016/0052/0087) والدفعات (0003/0089) والمحاسبة (0023/0057):
--   1) contract_lookups: أسباب الإلغاء/الإرجاع/الاستبدال وحالة العاملة عند
--      الاستلام — قوائم مرجعية يديرها الإداري (لا enums جامدة).
--   2) contract_settlement_terms: الأرقام المستخرجة من نص القالب المعتمد
--      (مثل 200 ﷼/يوم من البند الثالث/10) مربوطة برمز القالب ونسخته، مع رقم
--      البند — الحساب يقرأها ولا يكتب رقماً في الكود. لا شيء يُخترع: ما لا
--      ينص عليه العقد لا يُحسب آلياً، ويُضاف يدوياً برقم البند ويخضع للاعتماد.
--   3) contract_settlements: «تسوية وإلغاء عقد» — حساب في الخادم + مراجعة +
--      اعتماد مالي (شخص غير المُعِدّ) + تنفيذ: قيد إشعار دائن مرة واحدة، وتحديث
--      حالة العقد، وإنشاء طلب الاسترداد. العقد الأصلي لا يُحذف ولا يُعدَّل نصه.
--   4) worker_returns: إرجاع العاملة (السبب، الموظف المسؤول، السائق، الاستلام
--      الفعلي، حالتها) — لا تُتاح لعقد جديد إلا بعد الاستلام وتأكيد الجاهزية.
--   5) refunds + refund_allocations + refund_payouts: دورة الاسترداد الكاملة،
--      ربط بالدفعات الأصلية، صرف جزئي، منع الزيادة والتكرار، قيد لكل صرف.
--   6) contract_ops_events: سجل موحّد لكل إجراء وموافقة (لا يُعدَّل).
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 0) shared helpers --------------------------------------------------
create or replace function contract_in_my_scope(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contracts c where c.id = p_contract
                   and (is_cross_branch() or in_my_branch(c.branch_id)))
$$;

create or replace function ops_cfg(p_key text, p_default numeric) returns numeric
language sql stable as $$
  select coalesce((select value from app_config where key = p_key), p_default)
$$;

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('settlement_count_return_day', 'احتساب يوم الإرجاع ضمن الأيام المستهلكة (1 = نعم، 0 = لا)',
   'تسوية العقود', 1, 'مفتاح', 10)
on conflict (key) do nothing;

alter table contract_status_history add column if not exists note text;

-- ---------- 1) reference lists -------------------------------------------------
create table if not exists contract_lookups (
  kind       text not null check (kind in
               ('cancel_reason','return_reason','worker_condition','replacement_reason','trial_requirement')),
  code       text not null default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  name_ar    text not null check (length(btrim(name_ar)) between 1 and 80),
  -- worker_condition: هل تحتاج العاملة متابعة طبية قبل إتاحتها؟
  -- replacement_reason: هل السبب استثناء تعاقدي (البند الثاني/4) لا يُحتسب من الحد؟
  -- trial_requirement: هل المتطلب إلزامي قبل التسليم؟
  flag       boolean not null default false,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (kind, code)
);
create unique index if not exists contract_lookups_name_uq on contract_lookups (kind, btrim(name_ar));
alter table contract_lookups enable row level security;
drop policy if exists cl_read on contract_lookups;
create policy cl_read on contract_lookups for select to authenticated using (true);
drop policy if exists cl_write on contract_lookups;
create policy cl_write on contract_lookups for insert to authenticated
  with check (has_perm('contracts', 'approve'));
drop policy if exists cl_update on contract_lookups;
create policy cl_update on contract_lookups for update to authenticated
  using (has_perm('contracts', 'approve')) with check (has_perm('contracts', 'approve'));

insert into contract_lookups (kind, code, name_ar, flag, sort_order) values
  ('cancel_reason', 'customer_request', 'رغبة العميل', false, 1),
  ('cancel_reason', 'customer_travel', 'سفر العميل', false, 2),
  ('cancel_reason', 'worker_refused', 'رفض العاملة العمل', false, 3),
  ('cancel_reason', 'worker_sick', 'مرض العاملة', false, 4),
  ('cancel_reason', 'contract_breach', 'إخلال بشروط العقد', false, 5),
  ('cancel_reason', 'company_unable', 'تعذّر توفير العاملة من الشركة', false, 6),
  ('return_reason', 'contract_end', 'نهاية مدة العقد', false, 1),
  ('return_reason', 'early_cancel', 'إلغاء العقد قبل نهايته', false, 2),
  ('return_reason', 'replacement', 'استبدال العاملة', false, 3),
  ('return_reason', 'worker_refused', 'رفض العاملة العمل', false, 4),
  ('return_reason', 'worker_sick', 'مرض العاملة', false, 5),
  ('return_reason', 'customer_complaint', 'شكوى العميل من الأداء', false, 6),
  ('worker_condition', 'good', 'سليمة وجاهزة', false, 1),
  ('worker_condition', 'tired', 'مرهقة — تحتاج راحة', false, 2),
  ('worker_condition', 'sick', 'مريضة — تحتاج متابعة طبية', true, 3),
  ('worker_condition', 'injured', 'مصابة — تحتاج متابعة طبية', true, 4),
  ('worker_condition', 'complaint', 'لديها شكوى ضد صاحب العمل', false, 5),
  ('replacement_reason', 'worker_refused', 'رفض العاملة العمل', true, 1),
  ('replacement_reason', 'worker_sick', 'مرض العاملة', true, 2),
  ('replacement_reason', 'performance', 'عدم ملاءمة الأداء', false, 3),
  ('replacement_reason', 'customer_preference', 'رغبة العميل', false, 4),
  ('replacement_reason', 'compatibility', 'عدم التوافق مع الأسرة', false, 5)
on conflict do nothing;

-- ---------- 2) settlement terms read from the approved template text -----------
create table if not exists contract_settlement_terms (
  id               uuid primary key default gen_random_uuid(),
  template_code    text not null,
  template_version integer not null,
  term_key         text not null check (term_key in
                     ('cancel_daily_deduction','refund_within_days','late_return_daily','delivery_fee_min')),
  value            numeric(12,2) not null check (value >= 0),
  clause_ref       text not null check (length(btrim(clause_ref)) > 0),
  label_ar         text not null,
  -- غير مفعّل = لا يُطبَّق آلياً (مثلاً بند يحتاج مراجعة قانونية)
  is_active        boolean not null default true,
  note             text,
  updated_at       timestamptz not null default now(),
  unique (template_code, template_version, term_key)
);
alter table contract_settlement_terms enable row level security;
drop policy if exists cst_read on contract_settlement_terms;
create policy cst_read on contract_settlement_terms for select to authenticated using (true);
drop policy if exists cst_insert on contract_settlement_terms;
create policy cst_insert on contract_settlement_terms for insert to authenticated
  with check (has_perm('contracts', 'approve'));
drop policy if exists cst_update on contract_settlement_terms;
create policy cst_update on contract_settlement_terms for update to authenticated
  using (has_perm('contracts', 'approve')) with check (has_perm('contracts', 'approve'));

insert into contract_settlement_terms
  (template_code, template_version, term_key, value, clause_ref, label_ar, is_active, note) values
  ('rental_labor_services', 1, 'cancel_daily_deduction', 200, 'البند الثالث/10',
   'خصم عن كل يوم عملت العمالة عند الإلغاء قبل انتهاء المدة', true, null),
  ('rental_labor_services', 1, 'refund_within_days', 7, 'البند الثالث/12',
   'مهلة استرجاع المبلغ عند الإلغاء والإرجاع دون استبدال', true, null),
  ('rental_labor_services', 1, 'delivery_fee_min', 50, 'البند الثالث/11',
   'رسوم التوصيل (حد أدنى) عند عدم تسليم العاملة في مقر الشركة', false,
   'تُضاف يدوياً عند انطباقها — تُقدَّر حسب الموقع ووقت التسليم'),
  ('rental_labor_services', 1, 'late_return_daily', 300, 'البند الثالث/11',
   'مبلغ عن كل يوم تأخير في إرجاع العاملة', false,
   'غير مفعّل: النص يُلزم «الطرف الأول» بالدفع — بانتظار المراجعة القانونية (compliance.v1)')
on conflict (template_code, template_version, term_key) do nothing;

-- the term that applies to a contract (by its pinned template version), if active
create or replace function contract_term_value(p_contract uuid, p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select t.value from contracts c
    join contract_templates ct on ct.id = c.template_id
    join contract_settlement_terms t
      on t.template_code = ct.template_code
     and t.template_version = coalesce(c.template_version, ct.version)
     and t.term_key = p_key and t.is_active
   where c.id = p_contract
$$;
create or replace function contract_term_ref(p_contract uuid, p_key text) returns text
language sql stable security definer set search_path = public as $$
  select t.clause_ref from contracts c
    join contract_templates ct on ct.id = c.template_id
    join contract_settlement_terms t
      on t.template_code = ct.template_code
     and t.template_version = coalesce(c.template_version, ct.version)
     and t.term_key = p_key and t.is_active
   where c.id = p_contract
$$;

-- ---------- 3) unified operations log -----------------------------------------
create table if not exists contract_ops_events (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete restrict,
  entity      text not null check (entity in ('settlement','return','refund','replacement','trial')),
  entity_id   uuid not null,
  action      text not null,
  from_status text,
  to_status   text,
  note        text,
  actor       uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_coe_contract on contract_ops_events(contract_id, created_at);
create index if not exists idx_coe_entity on contract_ops_events(entity, entity_id);
alter table contract_ops_events enable row level security;
drop policy if exists coe_read on contract_ops_events;
create policy coe_read on contract_ops_events for select to authenticated
  using (has_perm('contracts', 'view') and contract_in_my_scope(contract_id));

create or replace function guard_ops_events() returns trigger language plpgsql as $$
begin raise exception 'سجل العمليات لا يُعدَّل ولا يُحذف'; end $$;
drop trigger if exists trg_guard_ops_events on contract_ops_events;
create trigger trg_guard_ops_events before update or delete on contract_ops_events
  for each row execute function guard_ops_events();

create or replace function log_contract_op(p_contract uuid, p_entity text, p_id uuid, p_action text,
  p_from text, p_to text, p_note text default null) returns void
language sql security definer set search_path = public as $$
  insert into contract_ops_events (contract_id, entity, entity_id, action, from_status, to_status, note, actor)
  values (p_contract, p_entity, p_id, p_action, p_from, p_to, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
$$;
revoke execute on function log_contract_op(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function next_ops_no(p_prefix text) returns text
language plpgsql as $$
declare v_seq text := 'seq_ops_' || lower(p_prefix); v_n bigint;
begin
  execute format('create sequence if not exists %I', v_seq);
  execute format('select nextval(%L)', v_seq) into v_n;
  return p_prefix || '-' || extract(year from current_date)::int || '-' || lpad(v_n::text, 4, '0');
end $$;

-- ---------- 4) settlements -----------------------------------------------------
create table if not exists contract_settlements (
  id               uuid primary key default gen_random_uuid(),
  settlement_no    text unique,
  contract_id      uuid not null references contracts(id) on delete restrict,
  kind             text not null check (kind in ('cancel_before_start','cancel_after_start','return','trial_end')),
  reason_code      text,
  reason_note      text,
  effective_date   date not null,
  delivered        boolean not null,             -- هل سُلِّمت العاملة (العقد كان نشطاً)
  days_total       integer,
  days_used        integer not null default 0,
  days_remaining   integer,
  contract_value   numeric(12,2) not null,       -- إجمالي العقد شامل الضريبة (لقطة)
  amount_paid      numeric(12,2) not null,       -- المحصّل وقت الإعداد (لقطة)
  service_due      numeric(12,2) not null,       -- قيمة الخدمة المستحقة
  due_basis        text not null check (due_basis in ('none','contract_term','prorata','manual')),
  due_basis_ref    text,                         -- رقم البند أو «تناسبي حسب المدة»
  fees             jsonb not null default '[]'::jsonb,   -- [{label, amount, clause_ref}]
  fees_total       numeric(12,2) not null default 0,
  balance          numeric(12,2) not null,       -- + للعميل (استرداد) / − على العميل
  refund_due_by    date,
  status           text not null default 'draft' check (status in
                     ('draft','pending_review','pending_finance','approved','settled','rejected','cancelled')),
  return_id        uuid,
  prepared_by      uuid references auth.users(id) on delete set null,
  reviewed_by      uuid references auth.users(id) on delete set null,
  approved_by      uuid references auth.users(id) on delete set null,
  settled_by       uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  approved_at      timestamptz,
  settled_at       timestamptz,
  journal_entry_id uuid references journal_entries(id) on delete restrict,
  posting_note     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists ux_settlement_live on contract_settlements(contract_id)
  where status not in ('rejected','cancelled');
create index if not exists idx_settlements_status on contract_settlements(status);
alter table contract_settlements enable row level security;
drop policy if exists cs_read on contract_settlements;
create policy cs_read on contract_settlements for select to authenticated
  using ((has_perm('contracts', 'view') or has_perm('payments', 'view')) and contract_in_my_scope(contract_id));

-- pure computation (preview) — no writes
create or replace function compute_contract_settlement(
  p_contract uuid, p_effective date, p_fees jsonb default '[]'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c contracts; v_delivered boolean; v_total int; v_used int := 0; v_incl int;
  v_rate numeric; v_ref text; v_due numeric := 0; v_basis text := 'none'; v_basis_ref text;
  v_fees numeric := 0; f jsonb; v_kind text; v_refund_days numeric;
begin
  select * into c from contracts where id = p_contract;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not has_perm('contracts', 'view') or not contract_in_my_scope(p_contract) then
    raise exception 'لا تملك صلاحية على هذا العقد';
  end if;
  if p_effective is null then raise exception 'حدّد تاريخ الإلغاء الفعلي'; end if;

  -- سُلِّمت العاملة إن كان العقد نشطاً أو انتهى بعد التفعيل
  v_delivered := c.status = 'active' or (c.status in ('completed','cancelled') and exists (
    select 1 from contract_status_history h where h.contract_id = c.id and h.to_status = 'active'));
  v_kind := case when v_delivered then 'cancel_after_start' else 'cancel_before_start' end;
  v_incl := ops_cfg('settlement_count_return_day', 1)::int;

  if c.start_date is not null and c.end_date is not null then
    v_total := (c.end_date - c.start_date) + 1;
  end if;
  if v_delivered and c.start_date is not null then
    v_used := greatest(0, (least(p_effective, coalesce(c.end_date, p_effective)) - c.start_date) + v_incl);
    if v_total is not null then v_used := least(v_used, v_total); end if;
  end if;

  if v_used > 0 then
    v_rate := contract_term_value(p_contract, 'cancel_daily_deduction');
    if v_rate is not null then
      v_due := least(round(v_used * v_rate, 2), c.total_amount);
      v_basis := 'contract_term';
      v_basis_ref := contract_term_ref(p_contract, 'cancel_daily_deduction');
    elsif v_total is not null and v_total > 0 then
      v_due := round(c.total_amount * v_used / v_total, 2);
      v_basis := 'prorata';
      v_basis_ref := 'تناسبي حسب المدة المستهلكة (لا ينص العقد على خصم يومي)';
    else
      v_basis := 'manual';
      v_basis_ref := 'عقد مفتوح المدة — تُحدَّد القيمة المستحقة يدوياً برقم البند';
    end if;
  end if;

  for f in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    if coalesce((f->>'amount')::numeric, 0) <= 0 then raise exception 'مبلغ الرسم يجب أن يكون أكبر من صفر'; end if;
    if nullif(btrim(coalesce(f->>'label', '')), '') is null then raise exception 'اكتب وصف الرسم'; end if;
    if nullif(btrim(coalesce(f->>'clause_ref', '')), '') is null then
      raise exception 'كل رسم يجب أن يستند إلى بند في العقد المعتمد أو سياسة معتمدة';
    end if;
    v_fees := v_fees + (f->>'amount')::numeric;
  end loop;

  v_refund_days := contract_term_value(p_contract, 'refund_within_days');
  return jsonb_build_object(
    'kind', v_kind, 'delivered', v_delivered,
    'days_total', v_total, 'days_used', v_used,
    'days_remaining', case when v_total is null then null else greatest(v_total - v_used, 0) end,
    'contract_value', c.total_amount, 'amount_paid', c.amount_paid,
    'service_due', v_due, 'due_basis', v_basis, 'due_basis_ref', v_basis_ref,
    'fees_total', v_fees,
    'balance', c.amount_paid - v_due - v_fees,
    'refund_within_days', v_refund_days,
    'refund_within_ref', contract_term_ref(p_contract, 'refund_within_days'));
end $$;
grant execute on function compute_contract_settlement(uuid, date, jsonb) to authenticated;

create or replace function prepare_contract_settlement(
  p_contract uuid, p_effective date, p_reason_code text, p_reason_note text default null,
  p_fees jsonb default '[]'::jsonb, p_return_id uuid default null)
returns contract_settlements language plpgsql security definer set search_path = public as $$
declare c contracts; v jsonb; v_row contract_settlements;
begin
  if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية إعداد التسوية'; end if;
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not contract_in_my_scope(p_contract) then raise exception 'هذا العقد خارج نطاق فرعك'; end if;
  if c.status = 'draft' then raise exception 'المسودة تُلغى مباشرة — لا تحتاج تسوية'; end if;
  if c.status = 'cancelled' and p_return_id is null then raise exception 'العقد ملغى مسبقاً'; end if;
  if nullif(btrim(coalesce(p_reason_code, '')), '') is null then raise exception 'اختر سبب الإلغاء'; end if;
  if c.start_date is not null and p_effective < least(c.start_date, c.created_at::date) then
    raise exception 'تاريخ الإلغاء قبل تاريخ العقد';
  end if;
  if exists (select 1 from contract_settlements where contract_id = p_contract
              and status not in ('rejected','cancelled')) then
    raise exception 'توجد تسوية قائمة لهذا العقد';
  end if;
  v := compute_contract_settlement(p_contract, p_effective, p_fees);

  insert into contract_settlements (settlement_no, contract_id, kind, reason_code, reason_note, effective_date,
    delivered, days_total, days_used, days_remaining, contract_value, amount_paid, service_due, due_basis,
    due_basis_ref, fees, fees_total, balance, return_id, prepared_by)
  values (next_ops_no('ST'), p_contract,
    case when p_return_id is not null then 'return' else v->>'kind' end,
    p_reason_code, nullif(btrim(coalesce(p_reason_note, '')), ''), p_effective,
    (v->>'delivered')::boolean, (v->>'days_total')::int, (v->>'days_used')::int, (v->>'days_remaining')::int,
    (v->>'contract_value')::numeric, (v->>'amount_paid')::numeric, (v->>'service_due')::numeric,
    v->>'due_basis', v->>'due_basis_ref', coalesce(p_fees, '[]'::jsonb), (v->>'fees_total')::numeric,
    (v->>'balance')::numeric, p_return_id, auth.uid())
  returning * into v_row;
  perform log_contract_op(p_contract, 'settlement', v_row.id, 'prepare', null, 'draft', p_reason_note);
  return v_row;
end $$;
grant execute on function prepare_contract_settlement(uuid, date, text, text, jsonb, uuid) to authenticated;

-- manual service value for open-ended contracts (draft only, with the clause)
create or replace function set_settlement_manual_due(p_id uuid, p_due numeric, p_ref text)
returns contract_settlements language plpgsql security definer set search_path = public as $$
declare s contract_settlements;
begin
  select * into s from contract_settlements where id = p_id for update;
  if not found then raise exception 'التسوية غير موجودة'; end if;
  if not has_perm('contracts', 'edit') or not contract_in_my_scope(s.contract_id) then
    raise exception 'لا تملك صلاحية تعديل التسوية';
  end if;
  if s.status <> 'draft' then raise exception 'تُعدَّل التسوية في المسودة فقط'; end if;
  if p_due < 0 or p_due > s.contract_value then raise exception 'القيمة المستحقة بين صفر وقيمة العقد'; end if;
  if nullif(btrim(coalesce(p_ref, '')), '') is null then raise exception 'اذكر البند أو السياسة المعتمدة'; end if;
  update contract_settlements set service_due = p_due, due_basis = 'manual', due_basis_ref = p_ref,
    balance = amount_paid - p_due - fees_total, updated_at = now()
   where id = p_id returning * into s;
  perform log_contract_op(s.contract_id, 'settlement', s.id, 'manual_due', 'draft', 'draft', p_ref);
  return s;
end $$;
grant execute on function set_settlement_manual_due(uuid, numeric, text) to authenticated;

create or replace function settlement_step(p_id uuid, p_action text, p_note text default null)
returns contract_settlements language plpgsql security definer set search_path = public as $$
declare s contract_settlements; v_to text;
begin
  select * into s from contract_settlements where id = p_id for update;
  if not found then raise exception 'التسوية غير موجودة'; end if;
  if not contract_in_my_scope(s.contract_id) then raise exception 'هذه التسوية خارج نطاق فرعك'; end if;

  if p_action = 'submit' then
    if s.status <> 'draft' then raise exception 'تُرسل المسودة فقط للمراجعة'; end if;
    if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية إرسال التسوية'; end if;
    v_to := 'pending_review';
  elsif p_action = 'review' then
    if s.status <> 'pending_review' then raise exception 'التسوية ليست بانتظار المراجعة'; end if;
    if not has_perm('contracts', 'approve') then raise exception 'المراجعة لمن يملك اعتماد العقود'; end if;
    if s.prepared_by = auth.uid() then raise exception 'لا يراجع المُعِدّ تسويته (أربع أعين)'; end if;
    v_to := 'pending_finance';
    update contract_settlements set reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  elsif p_action = 'approve' then
    if s.status <> 'pending_finance' then raise exception 'التسوية ليست بانتظار الاعتماد المالي'; end if;
    if not has_perm('payments', 'approve') then raise exception 'الاعتماد المالي لمن يملك اعتماد المدفوعات'; end if;
    if s.prepared_by = auth.uid() then raise exception 'لا يعتمد المُعِدّ تسويته (أربع أعين)'; end if;
    v_to := 'approved';
    update contract_settlements set approved_by = auth.uid(), approved_at = now() where id = p_id;
  elsif p_action = 'reject' then
    if s.status not in ('pending_review','pending_finance') then raise exception 'لا يمكن رفض التسوية في حالتها الحالية'; end if;
    if not (has_perm('contracts', 'approve') or has_perm('payments', 'approve')) then
      raise exception 'لا تملك صلاحية الرفض';
    end if;
    if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'اكتب سبب الرفض'; end if;
    v_to := 'rejected';
  elsif p_action = 'withdraw' then
    if s.status not in ('draft','pending_review') then raise exception 'لا تُسحب التسوية بعد مراجعتها'; end if;
    if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية سحب التسوية'; end if;
    v_to := 'cancelled';
  else
    raise exception 'إجراء غير معروف';
  end if;

  update contract_settlements set status = v_to, updated_at = now() where id = p_id returning * into s;
  perform log_contract_op(s.contract_id, 'settlement', s.id, p_action, case p_action
    when 'submit' then 'draft' when 'review' then 'pending_review' when 'approve' then 'pending_finance'
    else null end, v_to, p_note);
  return s;
end $$;
grant execute on function settlement_step(uuid, text, text) to authenticated;

-- execution: credit-note posting (once), contract status, refund request
create or replace function settle_contract_settlement(p_id uuid)
returns contract_settlements language plpgsql security definer set search_path = public as $$
declare
  s contract_settlements; c contracts; v_r numeric; v_net numeric; v_vat numeric; v_entry uuid;
  v_rev uuid; v_refund uuid; v_note text; v_days numeric;
begin
  select * into s from contract_settlements where id = p_id for update;
  if not found then raise exception 'التسوية غير موجودة'; end if;
  if s.status <> 'approved' then raise exception 'تُنفَّذ التسوية بعد اعتمادها مالياً فقط'; end if;
  if not has_perm('payments', 'approve') or not contract_in_my_scope(s.contract_id) then
    raise exception 'لا تملك صلاحية تنفيذ التسوية';
  end if;
  select * into c from contracts where id = s.contract_id for update;

  -- the paid amount may have changed since preparation → recompute the balance
  s.amount_paid := c.amount_paid;
  s.balance := c.amount_paid - s.service_due - s.fees_total;

  -- 1) accounting: the customer's final obligation is service_due + fees.
  --    R = contract value − obligation is credited back (إشعار دائن); a negative R is extra revenue.
  if exists (select 1 from journal_entries where idempotency_key = 'CS-' || c.id and status = 'posted') then
    v_r := s.contract_value - s.service_due - s.fees_total;
    if v_r <> 0 and c.total_amount > 0 then
      v_net := round(abs(v_r) * c.base_amount / c.total_amount, 2);
      v_vat := abs(v_r) - v_net;
      v_rev := case when c.service_code is not null then revenue_account_for_code(c.service_code)
                    else revenue_account_for(c.service_type) end;
      insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type,
                                   source_id, status, kind, idempotency_key, posted_at)
      values (current_date, ensure_period(current_date), c.branch_id,
              case when v_r > 0 then 'إشعار دائن — تسوية وإلغاء العقد ' else 'رسوم تسوية العقد ' end
                || coalesce(c.contract_no, c.contract_number::text),
              s.settlement_no, 'credit_note', s.id, 'posted', 'adjusting', 'ST-' || s.id, now())
      returning id into v_entry;
      if v_r > 0 then
        insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
        select v_entry, a, d, cr, c.branch_id, ds from (values
          (v_rev, v_net, 0::numeric, 'عكس الإيراد غير المستحق'),
          (acc_id('2120'), v_vat, 0::numeric, 'عكس ضريبة المخرجات'),
          (acc_id('1120'), 0::numeric, abs(v_r), 'تخفيض ذمة العميل')) l(a, d, cr, ds)
        where d > 0 or cr > 0;
      else
        insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
        select v_entry, a, d, cr, c.branch_id, ds from (values
          (acc_id('1120'), abs(v_r), 0::numeric, 'رسوم مستحقة على العميل'),
          (v_rev, 0::numeric, v_net, 'إيراد رسوم التسوية'),
          (acc_id('2120'), 0::numeric, v_vat, 'ضريبة المخرجات على الرسوم')) l(a, d, cr, ds)
        where d > 0 or cr > 0;
      end if;
    end if;
  else
    v_note := 'لم يُرحَّل قيد للعقد عند توقيعه — لا يُنشأ إشعار دائن آلياً (يرحّله المحاسب يدوياً)';
  end if;

  -- 2) contract status (the original is never deleted; its text stays frozen)
  if c.status not in ('cancelled','completed') then
    perform set_config('masea.settling', 'on', true);
    update contracts set status = 'cancelled', updated_at = now() where id = c.id;
    perform set_config('masea.settling', 'off', true);
    insert into contract_status_history (contract_id, from_status, to_status, changed_by, note)
    values (c.id, c.status::text, 'cancelled', auth.uid(), 'تسوية ' || s.settlement_no);
  end if;

  update contract_settlements set amount_paid = s.amount_paid, balance = s.balance where id = p_id;

  -- 3) refund request (its own approval cycle) when the customer has a balance
  if s.balance > 0 then
    v_days := contract_term_value(c.id, 'refund_within_days');
    insert into refunds (refund_no, settlement_id, contract_id, customer_id, amount, due_by, created_by)
    values (next_ops_no('RF'), s.id, c.id, c.customer_id, s.balance,
            case when v_days is null then null else current_date + v_days::int end, auth.uid())
    returning id into v_refund;
    perform allocate_refund(v_refund);
    perform log_contract_op(c.id, 'refund', v_refund, 'create', null, 'draft', 'من التسوية ' || s.settlement_no);
  end if;

  update contract_settlements set status = 'settled', settled_by = auth.uid(), settled_at = now(),
    amount_paid = s.amount_paid, balance = s.balance, journal_entry_id = v_entry, posting_note = v_note,
    refund_due_by = case when v_days is null then null else current_date + v_days::int end,
    updated_at = now()
   where id = p_id returning * into s;
  perform log_contract_op(c.id, 'settlement', s.id, 'settle', 'approved', 'settled', v_note);
  return s;
end $$;
grant execute on function settle_contract_settlement(uuid) to authenticated;

-- ---------- 5) worker returns --------------------------------------------------
create table if not exists worker_returns (
  id                      uuid primary key default gen_random_uuid(),
  return_no               text unique,
  contract_id             uuid not null references contracts(id) on delete restrict,
  worker_profile_id       uuid not null references worker_profiles(id) on delete restrict,
  requested_date          date not null,
  actual_date             date,
  reason_code             text not null,
  reason_note             text,
  condition_code          text,
  condition_note          text,
  responsible_employee_id uuid references employees(id) on delete set null,
  driver_id               uuid references drivers(id) on delete set null,
  notes                   text,
  attachments             jsonb not null default '[]'::jsonb,   -- [{name, path}] في مخزن الملفات
  replacement_id          uuid,                                  -- إرجاع ضمن استبدال (0091)
  status                  text not null default 'requested' check (status in
                            ('requested','scheduled','received','ready','cancelled')),
  created_by              uuid references auth.users(id) on delete set null,
  received_by             uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index if not exists ux_return_live on worker_returns(contract_id, worker_profile_id)
  where status in ('requested','scheduled','received');
alter table worker_returns enable row level security;
drop policy if exists wr_read on worker_returns;
create policy wr_read on worker_returns for select to authenticated
  using (has_perm('contracts', 'view') and contract_in_my_scope(contract_id));

alter table contract_settlements drop constraint if exists contract_settlements_return_fk;
alter table contract_settlements add constraint contract_settlements_return_fk
  foreign key (return_id) references worker_returns(id) on delete restrict;

create or replace function request_worker_return(
  p_contract uuid, p_requested date, p_reason_code text, p_reason_note text default null,
  p_responsible uuid default null, p_driver uuid default null, p_notes text default null,
  p_worker uuid default null)
returns worker_returns language plpgsql security definer set search_path = public as $$
declare c contracts; v_worker uuid; v_row worker_returns; v_wstatus text;
begin
  if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية طلب الإرجاع'; end if;
  select * into c from contracts where id = p_contract;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not contract_in_my_scope(p_contract) then raise exception 'هذا العقد خارج نطاق فرعك'; end if;
  v_worker := coalesce(p_worker, c.worker_profile_id);
  if v_worker is null then raise exception 'لا توجد عاملة مرتبطة بهذا العقد'; end if;
  select status into v_wstatus from worker_profiles where id = v_worker;
  if v_wstatus not in ('on_service','returning') then
    raise exception 'العاملة ليست لدى العميل — لا يوجد ما يُرجَع';
  end if;
  if nullif(btrim(coalesce(p_reason_code, '')), '') is null then raise exception 'اختر سبب الإرجاع'; end if;
  if p_requested is null then raise exception 'حدّد تاريخ الإرجاع المطلوب'; end if;
  insert into worker_returns (return_no, contract_id, worker_profile_id, requested_date, reason_code,
    reason_note, responsible_employee_id, driver_id, notes, created_by)
  values (next_ops_no('WR'), p_contract, v_worker, p_requested, p_reason_code,
    nullif(btrim(coalesce(p_reason_note, '')), ''), p_responsible, p_driver,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_row;
  perform log_contract_op(p_contract, 'return', v_row.id, 'request', null, 'requested', p_reason_note);
  return v_row;
exception when unique_violation then
  raise exception 'يوجد طلب إرجاع قائم لهذه العاملة على هذا العقد';
end $$;
grant execute on function request_worker_return(uuid, date, text, text, uuid, uuid, text, uuid) to authenticated;

create or replace function worker_return_step(
  p_id uuid, p_action text, p_date date default null, p_condition text default null,
  p_note text default null, p_driver uuid default null)
returns worker_returns language plpgsql security definer set search_path = public as $$
declare r worker_returns; v_to text; v_flag boolean; v_contract contract_status;
begin
  select * into r from worker_returns where id = p_id for update;
  if not found then raise exception 'طلب الإرجاع غير موجود'; end if;
  if not has_perm('contracts', 'edit') or not contract_in_my_scope(r.contract_id) then
    raise exception 'لا تملك صلاحية على طلب الإرجاع';
  end if;

  if p_action = 'schedule' then
    if r.status not in ('requested','scheduled') then raise exception 'لا تُجدول الإرجاع بعد الاستلام'; end if;
    v_to := 'scheduled';
    update worker_returns set requested_date = coalesce(p_date, requested_date),
      driver_id = coalesce(p_driver, driver_id) where id = p_id;
  elsif p_action = 'receive' then
    if r.status not in ('requested','scheduled') then raise exception 'سبق استلام العاملة'; end if;
    if p_date is null then raise exception 'حدّد تاريخ الإرجاع الفعلي'; end if;
    if p_date > current_date then raise exception 'تاريخ الاستلام الفعلي لا يكون في المستقبل'; end if;
    if nullif(btrim(coalesce(p_condition, '')), '') is null then raise exception 'حدّد حالة العاملة عند الاستلام'; end if;
    v_to := 'received';
    update worker_returns set actual_date = p_date, condition_code = p_condition,
      condition_note = nullif(btrim(coalesce(p_note, '')), ''), received_by = auth.uid() where id = p_id;
    update worker_profiles set status = 'returning' where id = r.worker_profile_id;
  elsif p_action = 'ready' then
    if r.status <> 'received' then raise exception 'تُؤكَّد الجاهزية بعد الاستلام'; end if;
    select status into v_contract from contracts where id = r.contract_id;
    -- لا تُتاح العاملة وهي ما زالت مخصّصة لعقد نشط (إلا ضمن استبدال يغيّر التخصيص)
    if r.replacement_id is null and contract_status_is_live(v_contract)
       and exists (select 1 from contracts where id = r.contract_id and worker_profile_id = r.worker_profile_id) then
      raise exception 'سوِّ العقد أولاً (إلغاء وتسوية) — العاملة ما زالت مخصّصة لعقد نشط';
    end if;
    select flag into v_flag from contract_lookups where kind = 'worker_condition' and code = r.condition_code;
    v_to := 'ready';
    update worker_profiles set status = case when coalesce(v_flag, false) then 'medical' else 'available' end
     where id = r.worker_profile_id
       and not exists (select 1 from contracts x where x.worker_profile_id = r.worker_profile_id
                        and x.status = 'active');
  elsif p_action = 'cancel' then
    if r.status not in ('requested','scheduled') then raise exception 'لا يُلغى طلب إرجاع بعد الاستلام'; end if;
    v_to := 'cancelled';
  else
    raise exception 'إجراء غير معروف';
  end if;

  update worker_returns set status = v_to, updated_at = now() where id = p_id returning * into r;
  perform log_contract_op(r.contract_id, 'return', r.id, p_action, null, v_to, p_note);
  return r;
end $$;
grant execute on function worker_return_step(uuid, text, date, text, text, uuid) to authenticated;

-- ---------- 6) refunds ---------------------------------------------------------
create table if not exists refunds (
  id               uuid primary key default gen_random_uuid(),
  refund_no        text unique,
  settlement_id    uuid not null references contract_settlements(id) on delete restrict,
  contract_id      uuid not null references contracts(id) on delete restrict,
  customer_id      uuid not null references customers(id) on delete restrict,
  amount           numeric(12,2) not null check (amount > 0),
  paid_total       numeric(12,2) not null default 0,
  method           text check (method in ('transfer','cash','card_reversal')),
  beneficiary_name text,
  customer_iban    text check (customer_iban is null or customer_iban ~ '^SA[0-9]{22}$'),
  bank_name        text,
  due_by           date,
  status           text not null default 'draft' check (status in
                     ('draft','pending_review','pending_finance','approved','pending_payout',
                      'partially_refunded','refunded','rejected')),
  note             text,
  created_by       uuid references auth.users(id) on delete set null,
  submitted_by     uuid references auth.users(id) on delete set null,
  reviewed_by      uuid references auth.users(id) on delete set null,
  approved_by      uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (paid_total <= amount)
);
create unique index if not exists ux_refund_live on refunds(settlement_id) where status <> 'rejected';
alter table refunds enable row level security;
drop policy if exists rf_read_all on refunds;
create policy rf_read_all on refunds for select to authenticated
  using ((has_perm('contracts', 'view') or has_perm('payments', 'view')) and contract_in_my_scope(contract_id));

create table if not exists refund_allocations (
  refund_id  uuid not null references refunds(id) on delete restrict,
  payment_id uuid not null references payments(id) on delete restrict,
  amount     numeric(12,2) not null check (amount > 0),
  primary key (refund_id, payment_id)
);
alter table refund_allocations enable row level security;
drop policy if exists ra_read on refund_allocations;
create policy ra_read on refund_allocations for select to authenticated
  using (exists (select 1 from refunds r where r.id = refund_id
                  and (has_perm('contracts', 'view') or has_perm('payments', 'view'))
                  and contract_in_my_scope(r.contract_id)));

create table if not exists refund_payouts (
  id           uuid primary key default gen_random_uuid(),
  refund_id    uuid not null references refunds(id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  transfer_ref text not null check (length(btrim(transfer_ref)) > 0),
  paid_on      date not null,
  bank_code    text not null,
  journal_entry_id uuid references journal_entries(id) on delete restrict,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists ux_refund_payout_ref on refund_payouts(lower(btrim(transfer_ref)));
alter table refund_payouts enable row level security;
drop policy if exists rp_read on refund_payouts;
create policy rp_read on refund_payouts for select to authenticated
  using (exists (select 1 from refunds r where r.id = refund_id
                  and (has_perm('contracts', 'view') or has_perm('payments', 'view'))
                  and contract_in_my_scope(r.contract_id)));

create or replace function guard_refund_ledgers() returns trigger language plpgsql as $$
begin raise exception 'سجلات الصرف والتخصيص لا تُعدَّل ولا تُحذف — الخطأ يُصحَّح بقيد عكسي'; end $$;
drop trigger if exists trg_guard_refund_payouts on refund_payouts;
create trigger trg_guard_refund_payouts before update or delete on refund_payouts
  for each row execute function guard_refund_ledgers();
drop trigger if exists trg_guard_refund_alloc on refund_allocations;
create trigger trg_guard_refund_alloc before update or delete on refund_allocations
  for each row execute function guard_refund_ledgers();

-- a payment can never be refunded beyond its amount, a contract beyond what it collected
create or replace function guard_refund_totals() returns trigger language plpgsql as $$
declare v_paid numeric; v_alloc numeric; v_cap numeric; v_refunds numeric;
begin
  if tg_table_name = 'refund_allocations' then
    select amount into v_paid from payments where id = new.payment_id;
    select coalesce(sum(a.amount), 0) into v_alloc from refund_allocations a
      join refunds r on r.id = a.refund_id and r.status <> 'rejected'
     where a.payment_id = new.payment_id;
    if v_alloc + new.amount > v_paid then raise exception 'التخصيص يتجاوز مبلغ الدفعة الأصلية'; end if;
  else
    select amount_paid into v_cap from contracts where id = new.contract_id;
    select coalesce(sum(amount), 0) into v_refunds from refunds
     where contract_id = new.contract_id and status <> 'rejected' and id <> new.id;
    if v_refunds + new.amount > v_cap then
      raise exception 'مجموع الاستردادات يتجاوز المبالغ المحصّلة على العقد';
    end if;
    if new.amount > (select balance from contract_settlements where id = new.settlement_id) then
      raise exception 'مبلغ الاسترداد يتجاوز الرصيد القابل للاسترداد في التسوية';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_refund_totals on refunds;
create trigger trg_guard_refund_totals before insert or update of amount on refunds
  for each row execute function guard_refund_totals();
drop trigger if exists trg_guard_alloc_totals on refund_allocations;
create trigger trg_guard_alloc_totals before insert on refund_allocations
  for each row execute function guard_refund_totals();

-- spread the refund over the original payments, newest first
create or replace function allocate_refund(p_refund uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r refunds; p record; v_left numeric; v_take numeric; v_free numeric;
begin
  select * into r from refunds where id = p_refund;
  v_left := r.amount - coalesce((select sum(amount) from refund_allocations where refund_id = p_refund), 0);
  for p in select * from payments where contract_id = r.contract_id and amount > 0
           order by paid_at desc, id loop
    exit when v_left <= 0;
    select p.amount - coalesce(sum(a.amount), 0) into v_free from refund_allocations a
      join refunds x on x.id = a.refund_id and x.status <> 'rejected' where a.payment_id = p.id;
    v_take := least(v_left, coalesce(v_free, p.amount));
    if v_take > 0 then
      insert into refund_allocations (refund_id, payment_id, amount) values (p_refund, p.id, v_take);
      v_left := v_left - v_take;
    end if;
  end loop;
  if v_left > 0 then raise exception 'لا توجد دفعات كافية لتغطية الاسترداد'; end if;
end $$;
revoke execute on function allocate_refund(uuid) from public, anon, authenticated;

create or replace function update_refund_details(
  p_id uuid, p_method text, p_beneficiary text, p_iban text, p_bank text, p_note text default null)
returns refunds language plpgsql security definer set search_path = public as $$
declare r refunds; v_iban text := upper(replace(coalesce(p_iban, ''), ' ', ''));
begin
  select * into r from refunds where id = p_id for update;
  if not found then raise exception 'طلب الاسترداد غير موجود'; end if;
  if not has_perm('contracts', 'edit') or not contract_in_my_scope(r.contract_id) then
    raise exception 'لا تملك صلاحية تعديل الاسترداد';
  end if;
  if r.status <> 'draft' then raise exception 'تُعدَّل بيانات الاسترداد في المسودة فقط'; end if;
  if p_method not in ('transfer','cash','card_reversal') then raise exception 'اختر وسيلة الاسترداد'; end if;
  if p_method = 'transfer' and v_iban !~ '^SA[0-9]{22}$' then
    raise exception 'رقم الآيبان غير صحيح — يبدأ بـ SA ويتكون من 24 خانة';
  end if;
  update refunds set method = p_method, beneficiary_name = nullif(btrim(coalesce(p_beneficiary, '')), ''),
    customer_iban = case when p_method = 'transfer' then v_iban end,
    bank_name = nullif(btrim(coalesce(p_bank, '')), ''), note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at = now()
   where id = p_id returning * into r;
  perform log_contract_op(r.contract_id, 'refund', r.id, 'details', 'draft', 'draft', null);
  return r;
end $$;
grant execute on function update_refund_details(uuid, text, text, text, text, text) to authenticated;

create or replace function refund_step(p_id uuid, p_action text, p_note text default null)
returns refunds language plpgsql security definer set search_path = public as $$
declare r refunds; v_to text; v_from text;
begin
  select * into r from refunds where id = p_id for update;
  if not found then raise exception 'طلب الاسترداد غير موجود'; end if;
  if not contract_in_my_scope(r.contract_id) then raise exception 'هذا الاسترداد خارج نطاق فرعك'; end if;
  v_from := r.status;
  if p_action = 'submit' then
    if r.status <> 'draft' then raise exception 'يُرسل الاسترداد من المسودة فقط'; end if;
    if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية إرسال الاسترداد'; end if;
    if r.method is null then raise exception 'حدّد وسيلة الاسترداد أولاً'; end if;
    v_to := 'pending_review';
    update refunds set submitted_by = auth.uid() where id = p_id;
  elsif p_action = 'review' then
    if r.status <> 'pending_review' then raise exception 'الاسترداد ليس بانتظار المراجعة'; end if;
    if not has_perm('contracts', 'approve') then raise exception 'المراجعة لمن يملك اعتماد العقود'; end if;
    if r.submitted_by = auth.uid() then raise exception 'لا يراجع مقدّم الطلب طلبه (أربع أعين)'; end if;
    v_to := 'pending_finance';
    update refunds set reviewed_by = auth.uid() where id = p_id;
  elsif p_action = 'approve' then
    if r.status <> 'pending_finance' then raise exception 'الاسترداد ليس بانتظار الاعتماد المالي'; end if;
    if not has_perm('payments', 'approve') then raise exception 'الاعتماد المالي لمن يملك اعتماد المدفوعات'; end if;
    if r.submitted_by = auth.uid() then raise exception 'لا يعتمد مقدّم الطلب طلبه (أربع أعين)'; end if;
    v_to := 'approved';
    update refunds set approved_by = auth.uid() where id = p_id;
  elsif p_action = 'queue' then
    if r.status <> 'approved' then raise exception 'يُرسل للصرف بعد الاعتماد المالي'; end if;
    if not has_perm('payments', 'create') then raise exception 'لا تملك صلاحية الصرف'; end if;
    v_to := 'pending_payout';
  elsif p_action = 'reject' then
    if r.status not in ('pending_review','pending_finance','approved') then
      raise exception 'لا يمكن رفض الاسترداد في حالته الحالية';
    end if;
    if not (has_perm('contracts', 'approve') or has_perm('payments', 'approve')) then
      raise exception 'لا تملك صلاحية الرفض';
    end if;
    if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'اكتب سبب الرفض'; end if;
    v_to := 'rejected';
  else
    raise exception 'إجراء غير معروف';
  end if;
  update refunds set status = v_to, updated_at = now() where id = p_id returning * into r;
  perform log_contract_op(r.contract_id, 'refund', r.id, p_action, v_from, v_to, p_note);
  return r;
end $$;
grant execute on function refund_step(uuid, text, text) to authenticated;

create or replace function record_refund_payout(
  p_id uuid, p_amount numeric, p_transfer_ref text, p_paid_on date, p_bank_code text default '1112')
returns refunds language plpgsql security definer set search_path = public as $$
declare r refunds; c contracts; v_payout uuid; v_entry uuid; v_to text; v_from text;
begin
  select * into r from refunds where id = p_id for update;
  if not found then raise exception 'طلب الاسترداد غير موجود'; end if;
  if not has_perm('payments', 'create') or not contract_in_my_scope(r.contract_id) then
    raise exception 'لا تملك صلاحية تسجيل الصرف';
  end if;
  if r.status not in ('pending_payout','partially_refunded') then
    raise exception 'لا يُصرف إلا استرداد معتمد ومُرسَل للصرف';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'مبلغ الصرف يجب أن يكون أكبر من صفر'; end if;
  if r.paid_total + p_amount > r.amount then
    raise exception 'المبلغ يتجاوز المتبقي من الاسترداد (%)', r.amount - r.paid_total;
  end if;
  if p_paid_on is null or p_paid_on > current_date then raise exception 'تاريخ الصرف غير صحيح'; end if;
  if p_bank_code not like '111%' or acc_id(p_bank_code) is null then
    raise exception 'حساب الصرف يجب أن يكون صندوقاً أو بنكاً (111x)';
  end if;
  if exists (select 1 from refund_payouts where lower(btrim(transfer_ref)) = lower(btrim(p_transfer_ref))) then
    raise exception 'رقم مرجع التحويل مسجّل مسبقاً — لا صرف مكرر';
  end if;
  select * into c from contracts where id = r.contract_id;

  v_payout := gen_random_uuid();
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type,
                               source_id, status, kind, idempotency_key, posted_at)
  values (p_paid_on, ensure_period(p_paid_on), c.branch_id,
          'صرف استرداد ' || r.refund_no || ' للعقد ' || coalesce(c.contract_no, c.contract_number::text),
          btrim(p_transfer_ref), 'payment', v_payout, 'posted', 'auto', 'RFP-' || v_payout, now())
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, acc_id('1120'), p_amount, 0, c.branch_id, 'رد مبلغ للعميل'),
    (v_entry, acc_id(p_bank_code), 0, p_amount, c.branch_id, 'صرف الاسترداد');
  insert into refund_payouts (id, refund_id, amount, transfer_ref, paid_on, bank_code, journal_entry_id, created_by)
  values (v_payout, p_id, p_amount, btrim(p_transfer_ref), p_paid_on, p_bank_code, v_entry, auth.uid());

  v_from := r.status;
  v_to := case when r.paid_total + p_amount >= r.amount then 'refunded' else 'partially_refunded' end;
  update refunds set paid_total = paid_total + p_amount, status = v_to, updated_at = now()
   where id = p_id returning * into r;
  perform log_contract_op(r.contract_id, 'refund', r.id, 'payout', v_from, v_to,
                          p_amount || ' ﷼ — مرجع ' || btrim(p_transfer_ref));
  return r;
end $$;
grant execute on function record_refund_payout(uuid, numeric, text, date, text) to authenticated;

-- ---------- 7) audit on every new table ----------------------------------------
do $$
declare t text;
begin
  foreach t in array array['contract_lookups','contract_settlement_terms','contract_settlements',
                           'worker_returns','refunds','refund_payouts'] loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on %I
                    for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ---------- 8) a signed / paid contract is cancelled only through its settlement ----
create or replace function guard_contract_cancel() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled'
     and coalesce(current_setting('masea.settling', true), '') <> 'on'
     and (old.status::text in ('signed','musaned_signed','active') or coalesce(old.amount_paid, 0) > 0) then
    raise exception 'إلغاء عقد موقّع أو مدفوع يتم عبر «إلغاء العقد وتسويته» فقط';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_contract_cancel on contracts;
create trigger trg_guard_contract_cancel before update of status on contracts
  for each row execute function guard_contract_cancel();
