-- =============================================================
-- Masiat Alsharq ERP — 0030 Payroll posting (Accounting ↔ HR module 05)
-- Posts a payroll run's accrual entry from the HR payslips (0022_payroll.sql):
--   DR مصروف الرواتب (5100) + DR حصة الشركة من التأمينات (5200)
--   / CR تأمينات مستحقة GOSI (2140) + CR رواتب مستحقة (2130)
-- Employer GOSI is derived from gosi_config + each employee's nationality/system.
-- This is the accounting half of the link with the HR/payroll team.
-- =============================================================

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

grant execute on function post_payroll_run(uuid) to authenticated;
