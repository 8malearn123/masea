-- =============================================================
-- 0091 — استبدال العاملة (المرحلة 3)
--
-- فوق 0089 (تخصيص العاملة ومنع التداخل) و 0090 (الإرجاع وسجل العمليات):
--   1) سياسة «الاستبدال مرتين» تشغيلية قابلة للإعداد (app_config) ومُعطّلة
--      افتراضياً حتى تعتمدها الشركة. تُثبَّت على العقد لحظة توقيعه
--      (contracts.replacement_policy) ← لا أثر رجعي على العقود السابقة.
--   2) contract_replacements: طلب ← أهلية (العدّاد والاستثناء) ← اختيار البديلة
--      وجدولة الاستلام والتسليم ← تنفيذ في معاملة واحدة يغيّر تخصيص العاملتين.
--   3) أسباب البند الثاني/4 (رفض العاملة العمل أو مرضها) استثناء تعاقدي لا
--      يُحتسب من الحد (علامة flag في contract_lookups). الاستثناء النظامي/الإداري
--      يعتمده من يملك contracts.approve مع ذكر الأساس.
--   4) العاملة السابقة تدخل مسار الإرجاع (0090) بحالة «استُلمت» ولا تُتاح
--      لعقد جديد إلا بعد تأكيد جاهزيتها. نص العقد الأصلي لا يتغيّر.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) policy (operational, opt-in) ------------------------------------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('replacement_policy_active',
   'تفعيل حد الاستبدالات الاعتيادية للعقود الجديدة (1 = مفعّل، 0 = غير مفعّل)',
   'سياسة الاستبدال', 0, 'مفتاح', 59)
on conflict (key) do nothing;
update app_config
   set label_ar = 'الحد الأقصى للاستبدالات الاعتيادية لكل عقد (سياسة تشغيلية — لا تُطبَّق إلا عند تفعيلها)',
       grp = 'سياسة الاستبدال'
 where key = 'replacement_max_proposed';

alter table contracts add column if not exists replacement_policy jsonb;
comment on column contracts.replacement_policy is
  'لقطة سياسة الاستبدال وقت التوقيع {active, max}. null = عقد قبل السياسة (لا حد).';

create or replace function contracts_pin_replacement_policy() returns trigger
language plpgsql as $$
begin
  if new.status::text in ('signed','musaned_signed') and new.replacement_policy is null
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.replacement_policy := jsonb_build_object(
      'active', ops_cfg('replacement_policy_active', 0) = 1,
      'max', ops_cfg('replacement_max_proposed', 2)::int);
  end if;
  return new;
end $$;
drop trigger if exists trg_contracts_pin_replacement_policy on contracts;
create trigger trg_contracts_pin_replacement_policy before insert or update of status on contracts
  for each row execute function contracts_pin_replacement_policy();

-- ---------- 2) replacements ----------------------------------------------------
create table if not exists contract_replacements (
  id                      uuid primary key default gen_random_uuid(),
  replacement_no          text unique,
  contract_id             uuid not null references contracts(id) on delete restrict,
  seq                     integer not null,
  old_worker_profile_id   uuid not null references worker_profiles(id) on delete restrict,
  new_worker_profile_id   uuid references worker_profiles(id) on delete restrict,
  reason_code             text not null,
  reason_note             text,
  requested_at            date not null,
  old_pickup_date         date,
  new_delivery_date       date,
  old_received_at         date,
  new_delivered_at        date,
  counts_toward_limit     boolean not null default true,
  is_exception            boolean not null default false,
  exception_basis         text check (exception_basis in ('contract_clause','regulatory','management')),
  exception_note          text,
  exception_approved_by   uuid references auth.users(id) on delete set null,
  pickup_driver_id        uuid references drivers(id) on delete set null,
  delivery_driver_id      uuid references drivers(id) on delete set null,
  responsible_employee_id uuid references employees(id) on delete set null,
  return_id               uuid references worker_returns(id) on delete restrict,
  status                  text not null default 'requested' check (status in
                            ('requested','pending_exception','eligible','scheduled','completed','rejected','cancelled')),
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (contract_id, seq)
);
create unique index if not exists ux_replacement_live on contract_replacements(contract_id)
  where status in ('requested','pending_exception','eligible','scheduled');
alter table contract_replacements enable row level security;
drop policy if exists crp_read on contract_replacements;
create policy crp_read on contract_replacements for select to authenticated
  using (has_perm('contracts', 'view') and contract_in_my_scope(contract_id));

alter table worker_returns drop constraint if exists worker_returns_replacement_fk;
alter table worker_returns add constraint worker_returns_replacement_fk
  foreign key (replacement_id) references contract_replacements(id) on delete restrict;

drop trigger if exists trg_audit_row on contract_replacements;
create trigger trg_audit_row after insert or update or delete on contract_replacements
  for each row execute function audit_row_change();

-- quota as the contract signed it (no policy snapshot = no limit)
create or replace function replacement_quota(p_contract uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'active', coalesce((c.replacement_policy->>'active')::boolean, false),
    'max', (c.replacement_policy->>'max')::int,
    'used', (select count(*) from contract_replacements r
              where r.contract_id = c.id and r.status = 'completed' and r.counts_toward_limit),
    'remaining', case when coalesce((c.replacement_policy->>'active')::boolean, false)
      then greatest((c.replacement_policy->>'max')::int - (select count(*) from contract_replacements r
              where r.contract_id = c.id and r.status = 'completed' and r.counts_toward_limit), 0)
      end,
    'total_done', (select count(*) from contract_replacements r where r.contract_id = c.id and r.status = 'completed'))
  from contracts c where c.id = p_contract
$$;
grant execute on function replacement_quota(uuid) to authenticated;

create or replace function request_worker_replacement(
  p_contract uuid, p_reason_code text, p_reason_note text default null,
  p_requested date default current_date, p_responsible uuid default null,
  p_exception_basis text default null, p_exception_note text default null)
returns contract_replacements language plpgsql security definer set search_path = public as $$
declare
  c contracts; q jsonb; v_contractual boolean; v_counts boolean; v_status text;
  v_row contract_replacements; v_seq int;
begin
  if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية طلب الاستبدال'; end if;
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not contract_in_my_scope(p_contract) then raise exception 'هذا العقد خارج نطاق فرعك'; end if;
  if c.status <> 'active' then raise exception 'الاستبدال لعقد نشط سُلِّمت فيه العاملة'; end if;
  if c.worker_profile_id is null then raise exception 'لا توجد عاملة مرتبطة بهذا العقد'; end if;
  if nullif(btrim(coalesce(p_reason_code, '')), '') is null then raise exception 'اختر سبب الاستبدال'; end if;
  if exists (select 1 from contract_settlements where contract_id = p_contract
              and status not in ('rejected','cancelled')) then
    raise exception 'يوجد إلغاء/تسوية قائمة لهذا العقد — لا استبدال';
  end if;

  select coalesce(flag, false) into v_contractual from contract_lookups
   where kind = 'replacement_reason' and code = p_reason_code;
  v_contractual := coalesce(v_contractual, false);
  q := replacement_quota(p_contract);
  v_counts := not v_contractual and p_exception_basis is null;

  if v_contractual then
    v_status := 'eligible';                       -- البند الثاني/4: التزام تعاقدي
  elsif p_exception_basis is not null then
    if nullif(btrim(coalesce(p_exception_note, '')), '') is null then
      raise exception 'اذكر أساس الاستثناء (البند أو النظام أو قرار الإدارة)';
    end if;
    v_status := 'pending_exception';
  elsif (q->>'active')::boolean and (q->>'remaining')::int <= 0 then
    raise exception 'استُنفد حد الاستبدالات الاعتيادية لهذا العقد (%) — يلزم استثناء معتمد', q->>'max';
  else
    v_status := 'eligible';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq from contract_replacements where contract_id = p_contract;
  insert into contract_replacements (replacement_no, contract_id, seq, old_worker_profile_id, reason_code,
    reason_note, requested_at, counts_toward_limit, is_exception, exception_basis, exception_note,
    responsible_employee_id, status, created_by)
  values (next_ops_no('RP'), p_contract, v_seq, c.worker_profile_id, p_reason_code,
    nullif(btrim(coalesce(p_reason_note, '')), ''), coalesce(p_requested, current_date), v_counts,
    v_contractual or p_exception_basis is not null,
    case when v_contractual then 'contract_clause' else p_exception_basis end,
    case when v_contractual then 'البند الثاني/4 — التزام الطرف الأول بتوفير البديل' else p_exception_note end,
    p_responsible, v_status, auth.uid())
  returning * into v_row;
  perform log_contract_op(p_contract, 'replacement', v_row.id, 'request', null, v_status, p_reason_note);
  return v_row;
exception when unique_violation then
  raise exception 'يوجد طلب استبدال قائم لهذا العقد';
end $$;
grant execute on function request_worker_replacement(uuid, text, text, date, uuid, text, text) to authenticated;

create or replace function replacement_step(p_id uuid, p_action text, p_note text default null)
returns contract_replacements language plpgsql security definer set search_path = public as $$
declare r contract_replacements; v_to text; v_from text;
begin
  select * into r from contract_replacements where id = p_id for update;
  if not found then raise exception 'طلب الاستبدال غير موجود'; end if;
  if not contract_in_my_scope(r.contract_id) then raise exception 'هذا الطلب خارج نطاق فرعك'; end if;
  v_from := r.status;
  if p_action = 'approve_exception' then
    if r.status <> 'pending_exception' then raise exception 'الطلب ليس بانتظار اعتماد استثناء'; end if;
    if not has_perm('contracts', 'approve') then raise exception 'اعتماد الاستثناء لمن يملك اعتماد العقود'; end if;
    if r.created_by = auth.uid() then raise exception 'لا يعتمد مقدّم الطلب استثناءه (أربع أعين)'; end if;
    update contract_replacements set exception_approved_by = auth.uid(), counts_toward_limit = false where id = p_id;
    v_to := 'eligible';
  elsif p_action = 'reject' then
    if r.status not in ('requested','pending_exception','eligible') then raise exception 'لا يُرفض الطلب في حالته الحالية'; end if;
    if not has_perm('contracts', 'approve') then raise exception 'الرفض لمن يملك اعتماد العقود'; end if;
    if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'اكتب سبب الرفض'; end if;
    v_to := 'rejected';
  elsif p_action = 'cancel' then
    if r.status not in ('requested','pending_exception','eligible','scheduled') then raise exception 'لا يُلغى بعد التنفيذ'; end if;
    if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية إلغاء الطلب'; end if;
    -- حرّر حجز البديلة إن وُجد
    if r.new_worker_profile_id is not null then
      update worker_profiles set status = 'available' where id = r.new_worker_profile_id and status = 'reserved';
    end if;
    v_to := 'cancelled';
  else
    raise exception 'إجراء غير معروف';
  end if;
  update contract_replacements set status = v_to, updated_at = now() where id = p_id returning * into r;
  perform log_contract_op(r.contract_id, 'replacement', r.id, p_action, v_from, v_to, p_note);
  return r;
end $$;
grant execute on function replacement_step(uuid, text, text) to authenticated;

-- choose the substitute among available workers and schedule both legs
create or replace function schedule_worker_replacement(
  p_id uuid, p_new_worker uuid, p_pickup date, p_delivery date,
  p_pickup_driver uuid default null, p_delivery_driver uuid default null)
returns contract_replacements language plpgsql security definer set search_path = public as $$
declare r contract_replacements; c contracts; v_status text; v_hit contracts; v_name text;
begin
  select * into r from contract_replacements where id = p_id for update;
  if not found then raise exception 'طلب الاستبدال غير موجود'; end if;
  if not has_perm('contracts', 'edit') or not contract_in_my_scope(r.contract_id) then
    raise exception 'لا تملك صلاحية جدولة الاستبدال';
  end if;
  if r.status not in ('eligible','scheduled') then raise exception 'الطلب غير مؤهل للجدولة بعد'; end if;
  if p_new_worker = r.old_worker_profile_id then raise exception 'اختر عاملة غير العاملة الحالية'; end if;
  if p_pickup is null or p_delivery is null then raise exception 'حدّد موعدي الاستلام والتسليم'; end if;
  select * into c from contracts where id = r.contract_id;
  select status, full_name into v_status, v_name from worker_profiles where id = p_new_worker and is_active;
  if v_status is null then raise exception 'العاملة البديلة غير موجودة أو معطّلة'; end if;
  if v_status <> 'available' and p_new_worker is distinct from r.new_worker_profile_id then
    raise exception 'العاملة % غير متاحة', v_name;
  end if;
  v_hit := worker_contract_conflict(p_new_worker, greatest(p_delivery, c.start_date), c.end_date, c.id);
  if v_hit.id is not null then
    raise exception 'العاملة % محجوزة على العقد % في الفترة المتبقية', v_name, coalesce(v_hit.contract_no, v_hit.id::text);
  end if;
  -- تحرير بديلة سابقة عند التغيير، وحجز الجديدة
  if r.new_worker_profile_id is not null and r.new_worker_profile_id <> p_new_worker then
    update worker_profiles set status = 'available' where id = r.new_worker_profile_id and status = 'reserved';
  end if;
  update worker_profiles set status = 'reserved' where id = p_new_worker;
  update contract_replacements set new_worker_profile_id = p_new_worker, old_pickup_date = p_pickup,
    new_delivery_date = p_delivery, pickup_driver_id = p_pickup_driver, delivery_driver_id = p_delivery_driver,
    status = 'scheduled', updated_at = now()
   where id = p_id returning * into r;
  perform log_contract_op(r.contract_id, 'replacement', r.id, 'schedule', 'eligible', 'scheduled', v_name);
  return r;
end $$;
grant execute on function schedule_worker_replacement(uuid, uuid, date, date, uuid, uuid) to authenticated;

-- execution: one transaction swaps the assignment and opens the old worker's return
create or replace function complete_worker_replacement(
  p_id uuid, p_old_received date, p_new_delivered date, p_condition text, p_note text default null)
returns contract_replacements language plpgsql security definer set search_path = public as $$
declare r contract_replacements; v_ret uuid;
begin
  select * into r from contract_replacements where id = p_id for update;
  if not found then raise exception 'طلب الاستبدال غير موجود'; end if;
  if not has_perm('contracts', 'edit') or not contract_in_my_scope(r.contract_id) then
    raise exception 'لا تملك صلاحية تنفيذ الاستبدال';
  end if;
  if r.status <> 'scheduled' then raise exception 'نفّذ الاستبدال بعد اختيار البديلة وجدولته'; end if;
  if p_old_received is null or p_new_delivered is null then raise exception 'حدّد تاريخي الاستلام والتسليم الفعليين'; end if;
  if greatest(p_old_received, p_new_delivered) > current_date then raise exception 'التواريخ الفعلية لا تكون في المستقبل'; end if;
  if nullif(btrim(coalesce(p_condition, '')), '') is null then raise exception 'حدّد حالة العاملة السابقة عند الاستلام'; end if;

  -- العاملة السابقة: مسار الإرجاع (0090) بحالة «استُلمت» — الجاهزية خطوة مستقلة
  insert into worker_returns (return_no, contract_id, worker_profile_id, requested_date, actual_date,
    reason_code, reason_note, condition_code, condition_note, replacement_id, status, created_by, received_by)
  values (next_ops_no('WR'), r.contract_id, r.old_worker_profile_id, coalesce(r.old_pickup_date, p_old_received),
    p_old_received, 'replacement', r.reason_note, p_condition, nullif(btrim(coalesce(p_note, '')), ''), r.id,
    'received', auth.uid(), auth.uid())
  returning id into v_ret;

  -- تبديل التخصيص (قيد منع التداخل 0089 يتحقق للعاملة الجديدة)
  update contracts set worker_profile_id = r.new_worker_profile_id, updated_at = now() where id = r.contract_id;
  update worker_profiles set status = 'returning' where id = r.old_worker_profile_id;

  update contract_replacements set old_received_at = p_old_received, new_delivered_at = p_new_delivered,
    return_id = v_ret, status = 'completed', updated_at = now()
   where id = p_id returning * into r;
  perform log_contract_op(r.contract_id, 'replacement', r.id, 'complete', 'scheduled', 'completed', p_note);
  perform log_contract_op(r.contract_id, 'return', v_ret, 'receive', null, 'received', 'ضمن الاستبدال ' || r.replacement_no);
  insert into audit_log (user_id, action, table_name, record_id, details)
  values (auth.uid(), 'contract.replace_worker', 'contracts', r.contract_id,
          jsonb_build_object('from', r.old_worker_profile_id, 'to', r.new_worker_profile_id, 'replacement', r.replacement_no));
  return r;
end $$;
grant execute on function complete_worker_replacement(uuid, date, date, text, text) to authenticated;
