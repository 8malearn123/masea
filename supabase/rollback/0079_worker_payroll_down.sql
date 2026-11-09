-- Rollback for 0079_worker_payroll.sql.
-- Restores the staff-only functions of 0071. Worker runs, payslips and their journal
-- entries are real records: the worker runs are removed only if none was posted.
do $$
begin
  if exists (select 1 from payroll_runs where kind = 'workers' and posted_entry_id is not null) then
    raise exception 'يوجد مسير عاملات مُرحَّل — لا يُتراجع عن 0079 قبل عكس قيوده';
  end if;
end $$;
drop trigger if exists trg_guard_frozen_run on payroll_runs;
delete from payroll_runs where kind = 'workers';
create trigger trg_guard_frozen_run before update or delete on payroll_runs
  for each row execute function guard_frozen_run();
drop table if exists worker_payslips;
drop function if exists guard_frozen_worker_payslip();
drop function if exists calculate_worker_payroll_run(text);
drop function if exists propose_worker_absences(text);
drop function if exists worker_eligible_days(uuid, text);
create or replace function post_payroll_run(p_run_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r payroll_runs%rowtype; v_entry uuid; v_period uuid; v_d date; v_payable numeric;
begin
  if not has_acc_perm('gl','post') then
    raise exception 'ترحيل قيد الرواتب من صلاحية المحاسبة' using errcode = '42501';
  end if;
  select * into r from payroll_runs where id = p_run_id for update;
  if not found then raise exception 'مسير الرواتب غير موجود'; end if;
  if r.status not in ('approved','paid') then raise exception 'لا يُرحَّل إلا مسير معتمد'; end if;
  if r.posted_entry_id is not null then return r.posted_entry_id; end if;

  v_d := (to_date(r.period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  v_period := ensure_period(v_d);
  v_payable := round(r.total_earnings - r.total_gosi_employee - r.total_advances - r.total_penalties, 2);

  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (v_d, v_period, r.branch_id, 'قيد استحقاق رواتب ' || r.period, 'PAYROLL-' || r.period, 'payroll', p_run_id)
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id('5100'), r.total_earnings, 0, r.branch_id, 'مصروف الرواتب');
  if r.total_gosi_employer > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('5200'), r.total_gosi_employer, 0, r.branch_id, 'حصة الشركة من التأمينات');
  end if;
  if r.total_gosi_employee + r.total_gosi_employer > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('2140'), 0, round(r.total_gosi_employee + r.total_gosi_employer, 2), r.branch_id, 'تأمينات مستحقة (GOSI)');
  end if;
  if r.total_advances > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('1160'), 0, r.total_advances, r.branch_id, 'استرداد سلف الموظفين');
  end if;
  if r.total_penalties > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('2170'), 0, r.total_penalties, r.branch_id, 'جزاءات مقتطعة (لصالح العمال)');
  end if;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id('2130'), 0, v_payable, r.branch_id, 'رواتب مستحقة الدفع');

  update payroll_runs set posted_entry_id = v_entry, posted_at = now() where id = p_run_id;
  return v_entry;
end $$;

create or replace function pay_payroll_run(p_run_id uuid, p_paid_on date, p_bank_code text default '1112')
returns uuid language plpgsql security definer set search_path = public as $$
declare r payroll_runs%rowtype; v_entry uuid; v_payable numeric;
begin
  if not has_acc_perm('bank','post') then
    raise exception 'تسجيل صرف الرواتب من صلاحية المحاسبة' using errcode = '42501';
  end if;
  select * into r from payroll_runs where id = p_run_id for update;
  if not found then raise exception 'مسير الرواتب غير موجود'; end if;
  if r.posted_entry_id is null then raise exception 'رحّل قيد الاستحقاق أولاً'; end if;
  if r.status = 'paid' then return r.paid_entry_id; end if;
  if p_bank_code not like '111%' then raise exception 'اختر حساب بنك أو صندوق'; end if;
  v_payable := round(r.total_earnings - r.total_gosi_employee - r.total_advances - r.total_penalties, 2);

  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (p_paid_on, ensure_period(p_paid_on), r.branch_id, 'صرف رواتب ' || r.period,
          'PAYROLL-PAY-' || r.period, 'payroll', p_run_id)
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, acc_id('2130'), v_payable, 0, r.branch_id, 'إطفاء رواتب مستحقة'),
    (v_entry, acc_id(p_bank_code), 0, v_payable, r.branch_id, 'تحويل الرواتب (حماية الأجور)');
  update payroll_runs set status = 'paid', paid_at = p_paid_on, paid_entry_id = v_entry where id = p_run_id;
  return v_entry;
end $$;

create or replace function calculate_payroll_run(p_period text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_run payroll_runs%rowtype; v_emp uuid; s jsonb; e record;
begin
  if not has_perm('hr','manage') then
    raise exception 'إعداد المسير من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر غير صحيح'; end if;

  select * into v_run from payroll_runs where period = p_period and branch_id is null;
  if found and v_run.status in ('approved','paid') then
    raise exception 'مسير % معتمد — التصحيح يكون بتعديل في الشهر التالي', p_period;
  end if;
  if not found then
    insert into payroll_runs (period, status, run_by) values (p_period, 'calculated', auth.uid())
    returning * into v_run;
  end if;

  delete from payslips where run_id = v_run.id;
  for v_emp in select * from payroll_period_employees(p_period) loop
    s := calculate_payslip(v_emp, p_period);
    select e2.full_name, e2.employee_no, e2.nationality,
           coalesce(e2.national_id, d.iqama_no) as id_number, d.iban, d.bank_name
      into e from employees e2 left join employee_details d on d.employee_id = e2.id
     where e2.id = v_emp;
    insert into payslips (run_id, employee_id, employee_name, employee_no, nationality, id_number, iban, bank_name,
      basic, housing_allowance, transport_allowance, other_allowance, overtime_amount, additions,
      absence_deduction, late_deduction, gosi_employee, gosi_employer, manual_deductions,
      advance_deductions, penalty_deductions, leave_deduction, unpaid_leave_days, sick_deduction_days,
      gross, total_deductions, net, present_days, absent_days, overtime_hours, late_minutes,
      gosi_system, eligible_days, breakdown)
    values (v_run.id, v_emp, e.full_name, e.employee_no, e.nationality, e.id_number, e.iban, e.bank_name,
      (s->>'basic')::numeric, (s->>'housing_allowance')::numeric, (s->>'transport_allowance')::numeric,
      (s->>'other_allowance')::numeric, (s->>'overtime_amount')::numeric, (s->>'additions')::numeric,
      (s->>'absence_deduction')::numeric, (s->>'late_deduction')::numeric, (s->>'gosi_employee')::numeric,
      (s->>'gosi_employer')::numeric, (s->>'manual_deductions')::numeric,
      (s->>'advance_deductions')::numeric, (s->>'penalty_deductions')::numeric,
      (s->>'leave_deduction')::numeric, (s->>'unpaid_leave_days')::integer, (s->>'sick_deduction_days')::numeric,
      (s->>'gross')::numeric, (s->>'total_deductions')::numeric, (s->>'net')::numeric,
      (s->>'present_days')::integer, (s->>'absent_days')::integer, (s->>'overtime_hours')::numeric,
      (s->>'late_minutes')::numeric, s->>'gosi_system', (s->>'eligible_days')::integer, s);
  end loop;

  update payroll_runs r set
    status = 'calculated', run_by = auth.uid(), calculated_at = now(),
    employee_count = x.n, total_gross = x.gross, total_deductions = x.ded, total_net = x.net,
    total_earnings = x.earn, total_gosi_employee = x.ge, total_gosi_employer = x.gc,
    total_advances = x.adv, total_penalties = x.pen
  from (select count(*) n, coalesce(sum(gross),0) gross, coalesce(sum(total_deductions),0) ded,
               coalesce(sum(net),0) net,
               coalesce(sum(gross - absence_deduction - late_deduction - leave_deduction),0) earn,
               coalesce(sum(gosi_employee),0) ge, coalesce(sum(gosi_employer),0) gc,
               coalesce(sum(advance_deductions),0) adv, coalesce(sum(penalty_deductions),0) pen
          from payslips where run_id = v_run.id) x
  where r.id = v_run.id;
  return v_run.id;
end $$;

create or replace function guard_adjustment_period() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from payroll_runs where period = new.period and status in ('approved','paid')) then
    raise exception 'مسير % معتمد — ارفع التعديل على الشهر التالي', new.period using errcode = '42501';
  end if;
  return new;
end $$;

drop function if exists post_worker_payroll(payroll_runs);
drop function if exists pay_worker_payroll(payroll_runs, date, text);
delete from payroll_adjustments where worker_id is not null;
drop policy if exists payadj_read on payroll_adjustments;
create policy payadj_read on payroll_adjustments for select to authenticated using (hr_can_see(employee_id));
drop policy if exists payadj_submit on payroll_adjustments;
create policy payadj_submit on payroll_adjustments for insert to authenticated
  with check (hr_in_scope(employee_id) and status = 'pending');
alter table payroll_adjustments drop constraint if exists payroll_adjustments_owner_chk;
alter table payroll_adjustments drop constraint if exists payroll_adjustments_source_chk;
alter table payroll_adjustments drop constraint if exists payroll_adjustments_type_check;
alter table payroll_adjustments add constraint payroll_adjustments_type_check
  check (type in ('bonus','penalty','advance','allowance','overtime'));
alter table payroll_adjustments drop column if exists worker_id;
alter table payroll_adjustments drop column if exists source;
alter table payroll_adjustments drop column if exists days;
alter table payroll_adjustments alter column employee_id set not null;
drop index if exists ux_payroll_runs_period_kind;
create unique index if not exists ux_payroll_runs_period on payroll_runs(period) where branch_id is null;
alter table payroll_runs drop constraint if exists payroll_runs_kind_chk;
alter table payroll_runs drop column if exists kind;
-- account 5120 stays (chart of accounts is append-only)
