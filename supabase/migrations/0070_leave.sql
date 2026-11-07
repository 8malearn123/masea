-- =============================================================
-- Masiat Alsharq ERP — 0070 Leave (المرحلة هـ)
-- يُبنى فوق leave_requests (0004) وسياسات 0068 و calculate_payslip (0022/0068):
--   1) leave_types — أنواع الإجازات وقواعدها في جدول يُدار من الإعدادات (لا enum ولا
--      أرقام في الكود). القيم الافتراضية وفق نظام العمل السعودي:
--      سنوية 21 يوماً ثم 30 بعد 5 سنوات (م109) · مرضية 30 كامل + 60 بـ75٪ + 30 بلا أجر
--      (م117) · زواج 5 · وفاة قريب 5 · مولود 3 (م113) · حج حتى 15 مرة واحدة بعد سنتين
--      (م114) · وضع 12 أسبوعاً (م151) · عدة 130 يوماً (م160) · اضطرارية من الرصيد السنوي.
--   2) الرصيد السنوي تراكمي من تاريخ التعيين بلا سقف — لا يجوز التنازل عنه ويُصرف
--      بدله عند نهاية الخدمة (م111). الأيام تقويمية (شاملة).
--   3) تحقق في الخادم عند الطلب والاعتماد: تداخل، رصيد، أهلية (جنس/مدة خدمة/مرة واحدة).
--   4) الإلغاء = حالة cancelled (مسار تصحيح) — لا حذف.
--   5) الراتب: الإجازة بدون أجر تُخصم، والمرضية حسب شريحتها (75٪ ثم بلا أجر).
-- =============================================================

alter type leave_status add value if not exists 'cancelled';

-- ---------- 1) leave types ------------------------------------------------
create table if not exists leave_types (
  code                 text primary key,
  name_ar              text not null,
  category             text not null check (category in ('annual','sick','statutory','unpaid','other')),
  entitlement_days     integer check (entitlement_days is null or entitlement_days >= 0),
  entitlement_days_after integer check (entitlement_days_after is null or entitlement_days_after >= 0),
  after_years          integer check (after_years is null or after_years >= 0),
  sick_partial_days    integer check (sick_partial_days is null or sick_partial_days >= 0),
  sick_partial_pay_pct numeric(5,2) check (sick_partial_pay_pct is null or sick_partial_pay_pct between 0 and 100),
  sick_unpaid_days     integer check (sick_unpaid_days is null or sick_unpaid_days >= 0),
  paid                 boolean not null default true,
  deducts_from_annual  boolean not null default false,
  gender               text check (gender is null or gender in ('male','female')),
  min_service_months   integer not null default 0 check (min_service_months >= 0),
  once_per_service     boolean not null default false,
  requires_attachment  boolean not null default false,
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  updated_at           timestamptz not null default now()
);

insert into leave_types (code, name_ar, category, entitlement_days, entitlement_days_after, after_years,
  sick_partial_days, sick_partial_pay_pct, sick_unpaid_days, paid, deducts_from_annual, gender,
  min_service_months, once_per_service, requires_attachment, sort_order) values
  ('annual',      'سنوية',                 'annual',    21, 30, 5,  null, null, null, true,  false, null,     0,  false, false, 1),
  ('sick',        'مرضية',                 'sick',      30, null, null, 60, 75, 30,   true,  false, null,     0,  false, true,  2),
  ('emergency',   'اضطرارية',              'other',     5,  null, null, null, null, null, true, true, null,    0,  false, false, 3),
  ('marriage',    'زواج',                  'statutory', 5,  null, null, null, null, null, true, false, null,   0,  false, true,  4),
  ('bereavement', 'وفاة قريب',             'statutory', 5,  null, null, null, null, null, true, false, null,   0,  false, false, 5),
  ('paternity',   'مولود',                 'statutory', 3,  null, null, null, null, null, true, false, 'male', 0,  false, false, 6),
  ('hajj',        'حج',                    'statutory', 15, null, null, null, null, null, true, false, null,   24, true,  false, 7),
  ('maternity',   'وضع (أمومة)',           'statutory', 84, null, null, null, null, null, true, false, 'female', 0, false, true, 8),
  ('iddah',       'عدة (وفاة الزوج)',      'statutory', 130, null, null, null, null, null, true, false, 'female', 0, false, true, 9),
  ('unpaid',      'بدون راتب',             'unpaid',    null, null, null, null, null, null, false, false, null,  0,  false, false, 10)
on conflict (code) do nothing;

alter table leave_types enable row level security;
drop policy if exists leave_types_read on leave_types;
create policy leave_types_read on leave_types for select to authenticated using (true);
drop policy if exists leave_types_write on leave_types;
create policy leave_types_write on leave_types for all to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));
drop trigger if exists trg_audit_row on leave_types;
create trigger trg_audit_row after insert or update or delete on leave_types
  for each row execute function audit_row_change();

-- ---------- 2) leave_requests: days + decision trail -----------------------
alter table leave_requests
  add column if not exists days          integer,
  add column if not exists decided_by    uuid references auth.users(id) on delete set null,
  add column if not exists decided_at    timestamptz,
  add column if not exists decision_note text,
  add column if not exists created_by    uuid references auth.users(id) on delete set null default auth.uid();
update leave_requests set days = (end_date - start_date) + 1
 where days is null and start_date is not null and end_date is not null;
-- legacy free-text types map to a managed type; unknown ones stay as written (FK not valid)
alter table leave_requests drop constraint if exists leave_requests_type_fk;
alter table leave_requests add constraint leave_requests_type_fk
  foreign key (type) references leave_types(code) not valid;
create index if not exists idx_leave_emp_dates on leave_requests(employee_id, start_date, end_date);

-- ---------- 3) balance -----------------------------------------------------
-- annual days accrued from hire to p_as_of (21/yr, 30/yr after 5 years — from leave_types)
create or replace function leave_annual_accrued(p_hire date, p_as_of date)
returns numeric language plpgsql stable set search_path = public as $$
declare t leave_types%rowtype; v_years numeric;
begin
  select * into t from leave_types where code = 'annual';
  if p_hire is null or p_as_of is null or p_as_of < p_hire or not found then return 0; end if;
  v_years := (p_as_of - p_hire) / 365.25;
  if t.after_years is null or v_years <= t.after_years then
    return round(v_years * coalesce(t.entitlement_days, 0), 2);
  end if;
  return round(t.after_years * coalesce(t.entitlement_days, 0)
               + (v_years - t.after_years) * coalesce(t.entitlement_days_after, t.entitlement_days, 0), 2);
end $$;

-- days already taken / reserved against the annual balance (annual + types that deduct from it)
create or replace function leave_annual_used(p_employee_id uuid, p_status leave_status, p_exclude uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(lr.days), 0)::integer
    from leave_requests lr join leave_types t on t.code = lr.type
   where lr.employee_id = p_employee_id and lr.status = p_status
     and (t.category = 'annual' or t.deducts_from_annual)
     and (p_exclude is null or lr.id <> p_exclude)
$$;

create or replace function leave_balance(p_employee_id uuid, p_as_of date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hire date; v_acc numeric; v_used integer; v_pend integer; v_sick integer; s leave_types%rowtype;
begin
  if not hr_can_see(p_employee_id) then
    raise exception 'غير مصرّح برصيد هذا الموظف' using errcode = '42501';
  end if;
  select hire_date into v_hire from employees where id = p_employee_id;
  v_acc  := leave_annual_accrued(v_hire, p_as_of);
  v_used := leave_annual_used(p_employee_id, 'approved');
  v_pend := leave_annual_used(p_employee_id, 'pending');
  select * into s from leave_types where code = 'sick';
  select coalesce(sum(lr.days), 0) into v_sick
    from leave_requests lr join leave_types t on t.code = lr.type
   where lr.employee_id = p_employee_id and lr.status = 'approved' and t.category = 'sick'
     and extract(year from lr.start_date) = extract(year from p_as_of);
  return jsonb_build_object(
    'annual_accrued', v_acc, 'annual_used', v_used, 'annual_pending', v_pend,
    'annual_remaining', round(v_acc - v_used, 2),
    'sick_used_this_year', v_sick,
    'sick_full_left', greatest(coalesce(s.entitlement_days,0) - v_sick, 0),
    'sick_total_limit', coalesce(s.entitlement_days,0) + coalesce(s.sick_partial_days,0) + coalesce(s.sick_unpaid_days,0));
end $$;
grant execute on function leave_balance(uuid, date) to authenticated;

-- ---------- 4) server-side validation (request + approval) ---------------
create or replace function validate_leave_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t leave_types%rowtype; e employees%rowtype; v_gender text;
  v_avail numeric; v_used integer; v_limit integer;
begin
  if new.start_date is null or new.end_date is null then
    raise exception 'تاريخا البداية والنهاية مطلوبان';
  end if;
  if new.end_date < new.start_date then
    raise exception 'تاريخ النهاية قبل تاريخ البداية';
  end if;
  new.days := (new.end_date - new.start_date) + 1;

  -- only live requests are validated; reject / cancel is always allowed
  if new.status not in ('pending','approved') then
    if new.status is distinct from old.status then
      new.decided_at := now(); new.decided_by := auth.uid();
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = old.status and new.start_date = old.start_date
     and new.end_date = old.end_date and new.type = old.type then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status <> 'approved' then
    new.decided_at := now(); new.decided_by := auth.uid();
  end if;

  select * into t from leave_types where code = new.type;
  if not found or not t.is_active then raise exception 'نوع الإجازة غير متاح'; end if;
  select * into e from employees where id = new.employee_id;
  if not e.is_active then raise exception 'الموظف منتهي الخدمة'; end if;
  select gender into v_gender from employee_details where employee_id = new.employee_id;

  if t.gender is not null and v_gender is not null and t.gender <> v_gender then
    raise exception 'إجازة «%» لا تنطبق على هذا الموظف', t.name_ar;
  end if;
  if t.min_service_months > 0 and (e.hire_date is null
      or new.start_date < (e.hire_date + make_interval(months => t.min_service_months))::date) then
    raise exception 'إجازة «%» تتطلب خدمة % شهراً على الأقل', t.name_ar, t.min_service_months;
  end if;
  if t.once_per_service and exists (
      select 1 from leave_requests x where x.employee_id = new.employee_id and x.type = new.type
         and x.status = 'approved' and x.id <> new.id) then
    raise exception 'إجازة «%» تُمنح مرة واحدة طوال الخدمة', t.name_ar;
  end if;
  if exists (
      select 1 from leave_requests x
       where x.employee_id = new.employee_id and x.id <> new.id
         and x.status in ('pending','approved')
         and daterange(x.start_date, x.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'تتداخل مع إجازة أخرى للموظف في نفس الفترة';
  end if;

  if t.category = 'annual' or t.deducts_from_annual then
    v_avail := leave_annual_accrued(e.hire_date, new.end_date)
             - leave_annual_used(new.employee_id, 'approved', new.id)
             - case when new.status = 'pending' then leave_annual_used(new.employee_id, 'pending', new.id) else 0 end;
    if new.days > floor(v_avail) then
      raise exception 'الرصيد السنوي غير كافٍ: المتاح % يوم والمطلوب % يوم', greatest(floor(v_avail), 0), new.days;
    end if;
  end if;
  if t.category in ('statutory','other') and t.entitlement_days is not null then
    if t.category = 'other' then
      select coalesce(sum(x.days), 0) into v_used from leave_requests x
       where x.employee_id = new.employee_id and x.type = new.type and x.id <> new.id
         and x.status in ('pending','approved')
         and extract(year from x.start_date) = extract(year from new.start_date);
    else
      v_used := 0;
    end if;
    if v_used + new.days > t.entitlement_days then
      raise exception 'إجازة «%»: الحد % يوم', t.name_ar, t.entitlement_days;
    end if;
  end if;
  if t.category = 'sick' then
    v_limit := coalesce(t.entitlement_days,0) + coalesce(t.sick_partial_days,0) + coalesce(t.sick_unpaid_days,0);
    select coalesce(sum(x.days), 0) into v_used from leave_requests x
      join leave_types xt on xt.code = x.type and xt.category = 'sick'
     where x.employee_id = new.employee_id and x.id <> new.id and x.status in ('pending','approved')
       and extract(year from x.start_date) = extract(year from new.start_date);
    if v_used + new.days > v_limit then
      raise exception 'تجاوز حد الإجازة المرضية السنوي (% يوم)', v_limit;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_validate_leave on leave_requests;
create trigger trg_validate_leave before insert or update on leave_requests
  for each row execute function validate_leave_request();

-- cancel = correction path (approver, or the requester while still pending)
drop policy if exists leave_cancel_own on leave_requests;
create policy leave_cancel_own on leave_requests for update to authenticated
  using (status = 'pending' and (created_by = auth.uid() or owns_employee(employee_id)))
  with check (status in ('pending','cancelled'));

-- ---------- 5) payroll: unpaid + sick tiers -------------------------------
create or replace function calculate_payslip(p_employee_id uuid, p_period text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg   payroll_config%rowtype;
  v_gosi  gosi_config%rowtype;
  v_emp   employees%rowtype;
  v_basic numeric := 0; v_transport numeric := 0; v_housing numeric := 0; v_other numeric := 0;
  v_saudi boolean; v_gosi_sys text := 'new'; v_counts boolean;
  v_start date; v_end date;
  v_absent integer := 0; v_late_min numeric := 0; v_ot_hours numeric := 0; v_present integer := 0;
  v_daily_wage numeric; v_hourly numeric;
  v_ot_amt numeric; v_absence_ded numeric; v_late_ded numeric;
  v_additions numeric := 0; v_manual numeric := 0;
  v_gosi_base numeric; v_gosi_rate numeric; v_gosi_emp numeric;
  v_gross numeric; v_ded numeric; v_net numeric;
  v_unpaid_days integer := 0; v_sick_ded_days numeric := 0; v_leave_ded numeric := 0;
  v_sick leave_types%rowtype;
begin
  if not hr_can_see(p_employee_id) then
    raise exception 'غير مصرّح بحساب راتب هذا الموظف' using errcode = '42501';
  end if;

  select * into v_cfg from payroll_config where id = 1;
  select * into v_gosi from gosi_config where id = 1;
  select * into v_emp from employees where id = p_employee_id;

  v_basic := coalesce(v_emp.basic_salary, 0);
  v_transport := coalesce(v_emp.transport_allowance, 0);
  v_saudi := (v_emp.nationality = 'السعودية');
  select coalesce(housing_allowance,0), coalesce(other_allowance,0), coalesce(gosi_system,'new'),
         coalesce(counts_in_saudization, v_saudi)
    into v_housing, v_other, v_gosi_sys, v_counts
  from employee_details where employee_id = p_employee_id;

  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;

  -- attendance-driven figures
  select
    count(*) filter (where status = 'present' or status = 'late'),
    count(*) filter (where status = 'absent'),
    coalesce(sum(case when check_in is not null and check_out is not null
                 then greatest(extract(epoch from (check_out - check_in))/3600.0 - v_cfg.daily_hours, 0) else 0 end), 0),
    coalesce(sum(case when status = 'late' and check_in is not null
                 then greatest(extract(epoch from (check_in at time zone 'Asia/Riyadh')::time)/60.0
                               - v_cfg.shift_start_hour * 60 - v_cfg.late_grace_minutes, 0)
                 else 0 end), 0)
    into v_present, v_absent, v_ot_hours, v_late_min
  from attendance where employee_id = p_employee_id and date between v_start and v_end;

  v_daily_wage := round(v_basic / nullif(v_cfg.standard_work_days,0), 2);
  v_hourly     := round(v_basic / nullif(v_cfg.standard_work_days * v_cfg.daily_hours,0), 4);
  v_ot_amt     := round(v_ot_hours * v_hourly * v_cfg.overtime_multiplier, 2);
  v_absence_ded := round(v_daily_wage * v_absent, 2);
  v_late_ded   := round((v_late_min / 60.0) * v_hourly, 2);

  -- approved adjustments only
  select coalesce(sum(amount) filter (where type in ('bonus','allowance','overtime')), 0),
         coalesce(sum(amount) filter (where type in ('penalty','advance')), 0)
    into v_additions, v_manual
  from payroll_adjustments where employee_id = p_employee_id and period = p_period and status = 'approved';

  -- GOSI: base = basic + housing, capped; employee rate by system; expat = 0
  v_gosi_base := least(v_basic + v_housing, v_gosi.ceiling);
  if v_saudi then
    v_gosi_rate := case when v_gosi_sys = 'old' then v_gosi.saudi_old_employee else v_gosi.saudi_new_employee end;
  else
    v_gosi_rate := 0;
  end if;
  v_gosi_emp := round(v_gosi_base * v_gosi_rate, 2);

  -- approved leave in the period: unpaid days, and sick days by their yearly tier
  select coalesce(sum(least(lr.end_date, v_end) - greatest(lr.start_date, v_start) + 1), 0)
    into v_unpaid_days
    from leave_requests lr join leave_types t on t.code = lr.type
   where lr.employee_id = p_employee_id and lr.status = 'approved' and not t.paid
     and lr.start_date <= v_end and lr.end_date >= v_start;
  select * into v_sick from leave_types where code = 'sick';
  with days as (
    select gs::date as d
      from leave_requests lr join leave_types t on t.code = lr.type and t.category = 'sick',
           generate_series(lr.start_date, lr.end_date, interval '1 day') gs
     where lr.employee_id = p_employee_id and lr.status = 'approved'
       and extract(year from gs) = extract(year from v_start)
  ), ranked as (select d, row_number() over (order by d) as n from days)
  select coalesce(sum(case
           when n <= coalesce(v_sick.entitlement_days, 0) then 0
           when n <= coalesce(v_sick.entitlement_days, 0) + coalesce(v_sick.sick_partial_days, 0)
             then 1 - coalesce(v_sick.sick_partial_pay_pct, 100) / 100.0
           else 1 end), 0)
    into v_sick_ded_days
    from ranked where d between v_start and v_end;
  v_leave_ded := round(v_daily_wage * (v_unpaid_days + v_sick_ded_days), 2);

  v_gross := round(v_basic + v_housing + v_transport + v_other + v_ot_amt + v_additions, 2);
  v_ded   := round(v_absence_ded + v_late_ded + v_gosi_emp + v_manual + v_leave_ded, 2);
  v_net   := round(v_gross - v_ded, 2);

  return jsonb_build_object(
    'basic', v_basic, 'housing_allowance', v_housing, 'transport_allowance', v_transport,
    'other_allowance', v_other, 'overtime_hours', round(v_ot_hours,2), 'overtime_amount', v_ot_amt,
    'additions', v_additions, 'present_days', v_present, 'absent_days', v_absent,
    'absence_deduction', v_absence_ded, 'late_minutes', round(v_late_min,1), 'late_deduction', v_late_ded,
    'gosi_system', v_gosi_sys, 'gosi_employee', v_gosi_emp, 'manual_deductions', v_manual,
    'unpaid_leave_days', v_unpaid_days, 'sick_deduction_days', round(v_sick_ded_days, 2),
    'leave_deduction', v_leave_ded,
    'gross', v_gross, 'total_deductions', v_ded, 'net', v_net
  );
end;
$$;

