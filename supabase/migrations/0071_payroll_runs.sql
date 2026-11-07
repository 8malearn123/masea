-- =============================================================
-- Masiat Alsharq ERP — 0071 Payroll runs (المرحلة و)
-- يُبنى فوق payroll_runs / payslips (0022) و post_payroll_run (0030) و calculate_payslip:
--   1) دورة المسير: احتساب (لقطة مجمّدة في payslips) ← اعتماد بشخص غير المُعِدّ
--      (مبدأ الأربع أعين: الموارد البشرية تُعدّ والمدير العام يعتمد) ← ترحيل محاسبي
--      ← صرف. بعد الاعتماد لا يتغير شيء — التصحيح بتعديل في الشهر التالي.
--   2) calculate_payslip: احتساب جزئي للشهر (تعيين/إنهاء خدمة في منتصفه)، فصل
--      السلف عن الجزاءات، حصة المنشأة في التأمينات، وإصلاح NULL عند غياب employee_details.
--   3) ترحيل صحيح: الإجازات والغياب تخفض المصروف؛ السلف تُسترد (1160)؛ الجزاءات
--      لصالح العمال لا إيراداً للمنشأة (2170)؛ الصافي = رواتب مستحقة (2130). وقيد صرف
--      يُطفئ المستحق من البنك.
--   4) سدّ ثغرات: post_payroll_run بلا تحقق صلاحية ولا حالة؛ مدير الفرع يقرأ قسائم
--      كل الفروع؛ لا قفل على تعديلات شهر معتمد.
-- =============================================================

-- ---------- 1) accounts ------------------------------------------------------
insert into chart_of_accounts (code, name_ar, type, parent_id, normal_balance) values
  ('1160', 'سلف الموظفين',                     'asset',     acc_id('1100'), 'debit'),
  ('2170', 'غرامات الموظفين (لصالح العمال)',     'liability', acc_id('2100'), 'credit')
on conflict (code) do nothing;

-- ---------- 2) run + snapshot columns ---------------------------------------
alter table payroll_runs
  add column if not exists calculated_at    timestamptz,
  add column if not exists approved_by      uuid references auth.users(id) on delete set null,
  add column if not exists approved_at      timestamptz,
  add column if not exists posted_entry_id  uuid,
  add column if not exists posted_at        timestamptz,
  add column if not exists paid_at          date,
  add column if not exists paid_entry_id    uuid,
  add column if not exists employee_count   integer not null default 0,
  add column if not exists total_earnings   numeric(14,2) not null default 0, -- expense: gross − absence − late − leave
  add column if not exists total_gosi_employee numeric(14,2) not null default 0,
  add column if not exists total_gosi_employer numeric(14,2) not null default 0,
  add column if not exists total_advances   numeric(14,2) not null default 0,
  add column if not exists total_penalties  numeric(14,2) not null default 0;
create unique index if not exists ux_payroll_runs_period
  on payroll_runs(period) where branch_id is null;

alter table payslips
  add column if not exists employee_name       text,
  add column if not exists employee_no         text,
  add column if not exists nationality         text,
  add column if not exists id_number           text,
  add column if not exists iban                text,
  add column if not exists bank_name           text,
  add column if not exists gosi_system         text,
  add column if not exists gosi_employer       numeric(12,2) not null default 0,
  add column if not exists late_minutes        numeric(8,1)  not null default 0,
  add column if not exists leave_deduction     numeric(12,2) not null default 0,
  add column if not exists unpaid_leave_days   integer       not null default 0,
  add column if not exists sick_deduction_days numeric(6,2)  not null default 0,
  add column if not exists advance_deductions  numeric(12,2) not null default 0,
  add column if not exists penalty_deductions  numeric(12,2) not null default 0,
  add column if not exists eligible_days       integer       not null default 0;
create unique index if not exists ux_payslips_run_emp on payslips(run_id, employee_id);

-- ---------- 3) calculate_payslip v3 -----------------------------------------
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

-- ---------- 4) run lifecycle -------------------------------------------------
-- employees paid in a period: hired by its end, and not terminated before its start
create or replace function payroll_period_employees(p_period text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select e.id from employees e
   where coalesce(e.hire_date, '1900-01-01') <= (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
     and (e.is_active or e.termination_date >= to_date(p_period || '-01', 'YYYY-MM-DD'))
$$;

-- calculate (or recalculate while not approved): frozen snapshot of every payslip
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

-- four eyes: whoever approves did not prepare it
create or replace function approve_payroll_run(p_run_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r payroll_runs%rowtype;
begin
  if not has_perm('hr','manage') then
    raise exception 'اعتماد المسير من صلاحية الإدارة' using errcode = '42501';
  end if;
  select * into r from payroll_runs where id = p_run_id for update;
  if not found then raise exception 'مسير الرواتب غير موجود'; end if;
  if r.status <> 'calculated' then raise exception 'المسير ليس بانتظار الاعتماد'; end if;
  if r.run_by = auth.uid() then
    raise exception 'لا يعتمد المسيرَ من أعدّه — يعتمده شخص آخر (مبدأ الأربع أعين)' using errcode = '42501';
  end if;
  update payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_run_id;
end $$;

-- accrual entry from the frozen totals (replaces 0030: permission, state, all deductions)
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

-- salaries transferred (WPS): settle the payable from the bank
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

grant execute on function calculate_payroll_run(text), approve_payroll_run(uuid),
  post_payroll_run(uuid), pay_payroll_run(uuid, date, text), payroll_period_employees(text)
  to authenticated;

-- ---------- 5) guards: an approved run is frozen ---------------------------
create or replace function guard_frozen_payslip() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from payroll_runs where id = coalesce(new.run_id, old.run_id);
  if v_status in ('approved','paid') then
    raise exception 'قسيمة في مسير معتمد لا تتغير — التصحيح في الشهر التالي' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_frozen_payslip on payslips;
create trigger trg_guard_frozen_payslip before insert or update or delete on payslips
  for each row execute function guard_frozen_payslip();

create or replace function guard_frozen_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('approved','paid') then
      raise exception 'لا يُحذف مسير معتمد' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status in ('approved','paid') and (
       new.period is distinct from old.period or new.total_net is distinct from old.total_net
       or new.total_gross is distinct from old.total_gross or new.employee_count is distinct from old.employee_count
       or new.status not in ('approved','paid')) then
    raise exception 'المسير المعتمد مجمّد' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_frozen_run on payroll_runs;
create trigger trg_guard_frozen_run before update or delete on payroll_runs
  for each row execute function guard_frozen_run();

-- no new / changed adjustment for an approved month
create or replace function guard_adjustment_period() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from payroll_runs where period = new.period and status in ('approved','paid')) then
    raise exception 'مسير % معتمد — ارفع التعديل على الشهر التالي', new.period using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_adjustment_period on payroll_adjustments;
create trigger trg_guard_adjustment_period before insert or update on payroll_adjustments
  for each row execute function guard_adjustment_period();

-- ---------- 6) RLS -------------------------------------------------------------
-- runs (company totals): HR managers + accounting (posts from totals, not payslips)
drop policy if exists payruns_read on payroll_runs;
create policy payruns_read on payroll_runs for select to authenticated
  using (has_perm('hr','manage') or has_perm('accounting','view'));
-- payslips: per employee, in scope (a branch manager no longer reads every branch)
drop policy if exists payslips_read on payslips;
create policy payslips_read on payslips for select to authenticated
  using (hr_can_see(employee_id));
-- writes happen only through the functions above
drop policy if exists payruns_write on payroll_runs;
drop policy if exists payslips_write on payslips;

drop trigger if exists trg_audit_row on payroll_runs;
create trigger trg_audit_row after insert or update or delete on payroll_runs
  for each row execute function audit_row_change();
