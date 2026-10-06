-- =============================================================
-- Masiat Alsharq ERP — 0051 Contract renewal + expiry alert window
--
-- (1) مهلة تنبيه انتهاء العقود في app_config (كانت في بيانات العرض فقط).
--     on conflict do nothing: لا تُستبدل قيمة ضبطها الإداري.
-- (2) renew_contract(): تجديد العقد = نسخة جديدة مرتبطة بالأصل
--     (parent_contract_id + version) في معاملة واحدة ذرّية:
--     العقد + لقطة البنود + أول سجل حالة، أو لا شيء.
--     • الأصل لا يُعدَّل إطلاقًا (حالته، تواريخه، بنوده، توقيعاته، سجله).
--     • النسخة مسودة (draft) برقم عقد جديد؛ لا توقيع ولا تفعيل ولا سداد.
--     • نفس مدة الأصل (السعر مرتبط بالمدة)، تبدأ بعد نهايته.
--     • قفل صف الأصل (for update) + رفض وجود تجديد قائم = لا نسخ مكرّرة
--       عند الضغط المتكرر أو الطلبات المتزامنة.
--     • security definer على نمط transition_contract / set_musaned_contract_no:
--       تُفحص الصلاحية ونطاق الفرع صراحةً بنفس شروط سياسات RLS للعقود.
-- لا تعديل على الجداول أو سياسات RLS أو حالات العقود أو التسعير.
-- =============================================================

-- ---------- (1) expiry alert window ----------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('contract_expiry_alert_days', 'مهلة التنبيه قبل انتهاء العقد', 'العقود', 30, 'يوم', 8)
on conflict (key) do nothing;

-- ---------- (2a) term end — mirrors apps/web features/requests/lib/period.ts ----------
-- نهاية مدة بالأشهر: اليوم السابق لنفس التاريخ بعد N شهر؛ فإن لم يوجد ذلك التاريخ
-- (٣١ يناير + شهر) تنتهي في آخر يوم من الشهر. بالأيام: اليوم الأول محسوب.
create or replace function contract_term_end(p_start date, p_unit text, p_count integer)
returns date language sql immutable
as $$
  select case
    when p_unit = 'day' then p_start + (p_count - 1)
    when extract(day from (p_start + make_interval(months => p_count)))
         <> extract(day from p_start)
      then (p_start + make_interval(months => p_count))::date
    else (p_start + make_interval(months => p_count))::date - 1
  end
$$;

-- ---------- (2b) renew_contract ----------
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

  if v_parent.status <> 'active' then
    raise exception 'التجديد متاح للعقود السارية فقط';
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
  if p_start_date <= v_parent.end_date then
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
  insert into contracts (
    contract_no, customer_id, worker_id, branch_id, service_type, service_code,
    template_id, start_date, end_date, base_amount, payment_method,
    status, version, parent_contract_id, created_by
  ) values (
    generate_contract_no(), v_parent.customer_id, v_parent.worker_id, v_parent.branch_id,
    v_parent.service_type, v_parent.service_code, v_parent.template_id,
    p_start_date, p_end_date, v_parent.base_amount, v_parent.payment_method,
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

  return v_row;
end $$;

revoke all on function renew_contract(uuid, date, date) from public, anon;
grant execute on function renew_contract(uuid, date, date) to authenticated;
