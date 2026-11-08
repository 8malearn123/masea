-- Rollback for 0068_hr_foundation.sql.
-- Data stays: performance_reviews rows and the added columns are kept
-- (dropping them would lose real records); only behaviour is reverted —
-- the policies return to 0021/0036/0061/0022 and calculate_payslip loses its guard.
do $$
declare t text;
begin
  foreach t in array array['employees','employee_details','employee_documents',
                           'employee_emergency_contacts','leave_requests',
                           'payroll_adjustments','performance_reviews','worker_profiles']
  loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
  end loop;
end $$;
drop trigger if exists trg_guard_employee_pay on employees;
drop function if exists guard_employee_pay();
drop policy if exists wp_hr_write on worker_profiles;

-- employees (0061)
drop policy if exists employees_read   on employees;
drop policy if exists employees_insert on employees;
drop policy if exists employees_update on employees;
create policy employees_b_read on employees for select to authenticated using (in_my_branch(branch_id));
create policy employees_b_write on employees for all to authenticated
  using (in_my_branch(branch_id)) with check (in_my_branch(branch_id));

-- profile children (0021)
drop policy if exists emp_details_read on employee_details;
create policy emp_details_read on employee_details for select
  using (has_perm('hr','view') or emp_in_my_branch(employee_id) or owns_employee(employee_id));
drop policy if exists emp_docs_read on employee_documents;
create policy emp_docs_read on employee_documents for select
  using (has_perm('hr','view') or owns_employee(employee_id));
drop policy if exists emp_emergency_read on employee_emergency_contacts;
create policy emp_emergency_read on employee_emergency_contacts for select
  using (has_perm('hr','view') or owns_employee(employee_id));

-- attendance / shifts / leave (0036)
drop policy if exists attendance_read on attendance;
drop policy if exists attendance_write on attendance;
drop policy if exists shifts_read on shifts;
drop policy if exists shifts_write on shifts;
drop policy if exists leave_read on leave_requests;
drop policy if exists leave_request on leave_requests;
drop policy if exists leave_decide on leave_requests;
do $$
declare t text;
begin
  foreach t in array array['attendance','leave_requests','shifts'] loop
    execute format($f$
      create policy %1$s_b on %1$s for all to authenticated
        using (is_cross_branch() or emp_in_my_branch(employee_id))
        with check (is_cross_branch() or emp_in_my_branch(employee_id));
    $f$, t);
  end loop;
end $$;

-- payroll adjustments (0022)
drop policy if exists payadj_read on payroll_adjustments;
drop policy if exists payadj_submit on payroll_adjustments;
create policy payadj_read on payroll_adjustments for select
  using (has_perm('hr','view') or emp_in_my_branch(employee_id) or owns_employee(employee_id));
create policy payadj_submit on payroll_adjustments for insert
  with check (has_perm('hr','manage') or emp_in_my_branch(employee_id));

-- performance reviews: keep rows, drop the new policies (RLS stays on → owner only)
drop policy if exists perf_read on performance_reviews;
drop policy if exists perf_write on performance_reviews;
drop policy if exists perf_update on performance_reviews;

drop function if exists hr_can_see(uuid);
drop function if exists hr_in_scope(uuid);

-- calculate_payslip without the permission guard (0022)
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
begin
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

  v_gross := round(v_basic + v_housing + v_transport + v_other + v_ot_amt + v_additions, 2);
  v_ded   := round(v_absence_ded + v_late_ded + v_gosi_emp + v_manual, 2);
  v_net   := round(v_gross - v_ded, 2);

  return jsonb_build_object(
    'basic', v_basic, 'housing_allowance', v_housing, 'transport_allowance', v_transport,
    'other_allowance', v_other, 'overtime_hours', round(v_ot_hours,2), 'overtime_amount', v_ot_amt,
    'additions', v_additions, 'present_days', v_present, 'absent_days', v_absent,
    'absence_deduction', v_absence_ded, 'late_minutes', round(v_late_min,1), 'late_deduction', v_late_ded,
    'gosi_system', v_gosi_sys, 'gosi_employee', v_gosi_emp, 'manual_deductions', v_manual,
    'gross', v_gross, 'total_deductions', v_ded, 'net', v_net
  );
end;
$$;
