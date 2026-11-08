-- Rollback for 0072_attendance.sql.
-- Data stays: attendance rows (and their new detail columns), holidays, branch
-- locations/tokens and the config row are kept; behaviour reverts: functions,
-- guards and audit triggers go; log_housing_scan / calculate_payslip return to 0039 / 0071.
drop trigger if exists trg_guard_housing_presence on housing_attendance;
drop function if exists guard_housing_presence();
do $$
declare t text;
begin
  foreach t in array array['attendance','attendance_config','public_holidays'] loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
  end loop;
end $$;
drop function if exists attendance_check(text, numeric, numeric, text);
drop function if exists manual_attendance(uuid, date, attendance_status, time, time, text);
drop function if exists close_attendance_day(date);
drop function if exists set_branch_attendance(uuid, numeric, numeric, boolean);
drop function if exists branch_attendance_settings();
drop function if exists attendance_late_minutes(uuid, timestamptz);
drop function if exists is_workday(date);
drop function if exists distance_m(numeric, numeric, numeric, numeric);
create or replace function log_housing_scan(p_barcode text, p_direction text, p_note text default null)
returns workers language plpgsql security definer set search_path = public
as $$
declare v_worker workers; v_dorm uuid;
begin
  if not has_perm('housing','view') then
    raise exception 'لا تملك صلاحية السكن';
  end if;
  if p_direction not in ('in','out') then
    raise exception 'اتجاه غير صحيح';
  end if;
  select * into v_worker from workers where barcode = p_barcode;
  if not found then
    raise exception 'لا توجد عاملة بهذا الباركود';
  end if;
  if not (is_cross_branch() or v_worker.branch_id = get_my_branch()) then
    raise exception 'هذه العاملة خارج نطاق فرعك';
  end if;
  -- attach the most recent dorm the worker was recorded in (if any)
  select dorm_id into v_dorm from housing_attendance
    where worker_id = v_worker.id order by date desc limit 1;

  insert into housing_scans (worker_id, dorm_id, direction, note, scanned_by)
  values (v_worker.id, v_dorm, p_direction, nullif(btrim(coalesce(p_note,'')), ''), auth.uid());

  return v_worker;
end $$;
create or replace function calculate_payslip(p_employee_id uuid, p_period text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg   payroll_config%rowtype;
  v_gosi  gosi_config%rowtype;
  v_emp   employees%rowtype;
  v_sick  leave_types%rowtype;
  v_basic numeric := 0; v_transport numeric := 0; v_housing numeric := 0; v_other numeric := 0;
  v_saudi boolean; v_gosi_sys text;
  v_start date; v_end date; v_from date; v_to date;
  v_month_days integer; v_elig integer; v_factor numeric := 1;
  v_absent integer := 0; v_late_min numeric := 0; v_ot_hours numeric := 0; v_present integer := 0;
  v_daily_wage numeric; v_hourly numeric;
  v_ot_amt numeric; v_absence_ded numeric; v_late_ded numeric;
  v_additions numeric := 0; v_advances numeric := 0; v_penalties numeric := 0;
  v_gosi_base numeric; v_gosi_rate numeric; v_gosi_emp numeric; v_gosi_co numeric;
  v_unpaid_days integer := 0; v_sick_ded_days numeric := 0; v_leave_ded numeric := 0;
  v_gross numeric; v_ded numeric; v_net numeric;
begin
  if not hr_can_see(p_employee_id) then
    raise exception 'غير مصرّح بحساب راتب هذا الموظف' using errcode = '42501';
  end if;

  select * into v_cfg from payroll_config where id = 1;
  select * into v_gosi from gosi_config where id = 1;
  select * into v_emp from employees where id = p_employee_id;
  select * into v_sick from leave_types where code = 'sick';

  v_saudi := (v_emp.nationality = 'السعودية');
  select housing_allowance, other_allowance, gosi_system
    into v_housing, v_other, v_gosi_sys
    from employee_details where employee_id = p_employee_id;
  -- a missing details row must not turn the whole salary into NULL
  v_housing := coalesce(v_housing, 0);
  v_other := coalesce(v_other, 0);
  v_gosi_sys := coalesce(v_gosi_sys, 'new');

  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;

  -- partial month: hired / terminated inside the period → salary ÷ 30 × days
  v_month_days := (v_end - v_start) + 1;
  v_from := greatest(v_start, coalesce(v_emp.hire_date, v_start));
  v_to   := least(v_end, coalesce(v_emp.termination_date, v_end));
  v_elig := greatest((v_to - v_from) + 1, 0);
  if v_elig < v_month_days then
    v_factor := least(v_elig::numeric / nullif(v_cfg.standard_work_days, 0), 1);
  end if;

  v_daily_wage := round(coalesce(v_emp.basic_salary, 0) / nullif(v_cfg.standard_work_days,0), 2);
  v_hourly     := round(coalesce(v_emp.basic_salary, 0) / nullif(v_cfg.standard_work_days * v_cfg.daily_hours,0), 4);
  v_basic     := round(coalesce(v_emp.basic_salary, 0) * v_factor, 2);
  v_transport := round(coalesce(v_emp.transport_allowance, 0) * v_factor, 2);
  v_housing   := round(v_housing * v_factor, 2);
  v_other     := round(v_other * v_factor, 2);

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

  v_ot_amt      := round(v_ot_hours * v_hourly * v_cfg.overtime_multiplier, 2);
  v_absence_ded := round(v_daily_wage * v_absent, 2);
  v_late_ded    := round((v_late_min / 60.0) * v_hourly, 2);

  -- approved adjustments only; advances (recovered) and penalties (workers' fund) apart
  select coalesce(sum(amount) filter (where type in ('bonus','allowance','overtime')), 0),
         coalesce(sum(amount) filter (where type = 'advance'), 0),
         coalesce(sum(amount) filter (where type = 'penalty'), 0)
    into v_additions, v_advances, v_penalties
  from payroll_adjustments where employee_id = p_employee_id and period = p_period and status = 'approved';

  -- GOSI on the month's insurable wage (basic + housing), capped
  v_gosi_base := least(v_basic + v_housing, v_gosi.ceiling);
  v_gosi_rate := case when not v_saudi then 0
                      when v_gosi_sys = 'old' then v_gosi.saudi_old_employee
                      else v_gosi.saudi_new_employee end;
  v_gosi_emp := round(v_gosi_base * v_gosi_rate, 2);
  v_gosi_co  := round(v_gosi_base * case when not v_saudi then v_gosi.nonsaudi_company
                                         when v_gosi_sys = 'old' then v_gosi.saudi_old_company
                                         else v_gosi.saudi_new_company end, 2);

  -- approved leave: unpaid days, and sick days by their yearly tier (0070)
  select coalesce(sum(least(lr.end_date, v_end) - greatest(lr.start_date, v_start) + 1), 0)
    into v_unpaid_days
    from leave_requests lr join leave_types t on t.code = lr.type
   where lr.employee_id = p_employee_id and lr.status = 'approved' and not t.paid
     and lr.start_date <= v_end and lr.end_date >= v_start;
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
  v_ded   := round(v_absence_ded + v_late_ded + v_gosi_emp + v_advances + v_penalties + v_leave_ded, 2);
  v_net   := round(v_gross - v_ded, 2);

  return jsonb_build_object(
    'basic', v_basic, 'housing_allowance', v_housing, 'transport_allowance', v_transport,
    'other_allowance', v_other, 'overtime_hours', round(v_ot_hours,2), 'overtime_amount', v_ot_amt,
    'additions', v_additions, 'present_days', v_present, 'absent_days', v_absent,
    'absence_deduction', v_absence_ded, 'late_minutes', round(v_late_min,1), 'late_deduction', v_late_ded,
    'gosi_system', v_gosi_sys, 'gosi_employee', v_gosi_emp, 'gosi_employer', v_gosi_co,
    'manual_deductions', round(v_advances + v_penalties, 2),
    'advance_deductions', v_advances, 'penalty_deductions', v_penalties,
    'unpaid_leave_days', v_unpaid_days, 'sick_deduction_days', round(v_sick_ded_days, 2),
    'leave_deduction', v_leave_ded,
    'eligible_days', v_elig, 'month_days', v_month_days,
    'gross', v_gross, 'total_deductions', v_ded, 'net', v_net
  );
end;
$$;
