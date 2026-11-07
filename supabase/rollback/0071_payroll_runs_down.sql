-- Rollback for 0071_payroll_runs.sql.
-- Data stays: runs, frozen payslips, journal entries and the two accounts are
-- kept (real records). Behaviour returns to 0030/0070: functions and guards go,
-- write policies come back, calculate_payslip returns to its 0070 form.
drop trigger if exists trg_audit_row on payroll_runs;
drop trigger if exists trg_guard_adjustment_period on payroll_adjustments;
drop function if exists guard_adjustment_period();
drop trigger if exists trg_guard_frozen_run on payroll_runs;
drop function if exists guard_frozen_run();
drop trigger if exists trg_guard_frozen_payslip on payslips;
drop function if exists guard_frozen_payslip();
drop function if exists pay_payroll_run(uuid, date, text);
drop function if exists approve_payroll_run(uuid);
drop function if exists calculate_payroll_run(text);
drop function if exists payroll_period_employees(text);
drop policy if exists payruns_read on payroll_runs;
drop policy if exists payslips_read on payslips;
create policy payruns_read on payroll_runs for select using (has_perm('hr','view'));
create policy payruns_write on payroll_runs for all using (has_perm('hr','manage')) with check (has_perm('hr','manage'));
create policy payslips_read on payslips for select using (has_perm('hr','view') or owns_employee(employee_id));
create policy payslips_write on payslips for all using (has_perm('hr','manage')) with check (has_perm('hr','manage'));
create or replace function post_payroll_run(p_run_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r        payroll_runs%rowtype;
  v_entry  uuid;
  v_period uuid;
  v_earn   numeric := 0;  -- gross − absence − late (earned salaries expense)
  v_empg   numeric := 0;  -- employees' GOSI share (withheld)
  v_compg  numeric := 0;  -- employer GOSI expense
  v_payable numeric := 0; -- salaries payable (earn − employee GOSI)
begin
  select * into r from payroll_runs where id = p_run_id;
  if not found then raise exception 'مسير الرواتب غير موجود'; end if;

  select id into v_entry from journal_entries where reference = 'PAYROLL-' || r.period;
  if v_entry is not null then return v_entry; end if;

  select
    coalesce(sum(basic + housing_allowance + transport_allowance + other_allowance
                 + overtime_amount + additions - absence_deduction - late_deduction), 0),
    coalesce(sum(gosi_employee), 0)
    into v_earn, v_empg
  from payslips where run_id = p_run_id;

  -- employer GOSI per employee from gosi_config (Saudi old/new vs expat)
  select coalesce(sum(round(
           least(ps.basic + ps.housing_allowance, g.ceiling) *
           case when e.nationality = 'السعودية'
                then case when coalesce(d.gosi_system, 'new') = 'old'
                          then g.saudi_old_company else g.saudi_new_company end
                else g.nonsaudi_company end, 2)), 0)
    into v_compg
  from payslips ps
    join employees e on e.id = ps.employee_id
    left join employee_details d on d.employee_id = ps.employee_id
    cross join gosi_config g
  where ps.run_id = p_run_id and g.id = 1;

  v_payable := round(v_earn - v_empg, 2);
  v_period := ensure_period(to_date(r.period || '-01', 'YYYY-MM-DD'));

  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (to_date(r.period || '-01', 'YYYY-MM-DD'), v_period, r.branch_id,
          'قيد رواتب ' || r.period, 'PAYROLL-' || r.period, 'payroll', p_run_id)
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id('5100'), v_earn, 0, r.branch_id, 'مصروف الرواتب');
  if v_compg > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('5200'), v_compg, 0, r.branch_id, 'حصة الشركة من التأمينات');
  end if;
  if v_empg + v_compg > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('2140'), 0, round(v_empg + v_compg, 2), r.branch_id, 'تأمينات مستحقة (GOSI)');
  end if;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id('2130'), 0, v_payable, r.branch_id, 'رواتب مستحقة الدفع');

  update payroll_runs set status = 'approved' where id = p_run_id;
  return v_entry;
end;
$$;
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
