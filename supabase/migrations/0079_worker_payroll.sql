-- =============================================================
-- 0079 — مسير رواتب العاملات وملف حماية الأجور (WPS)
-- يُبنى فوق دورة مسير الرواتب القائمة (0071) — لا مسار ثانٍ للاعتماد:
--   1) payroll_runs.kind: مسير للموظفين ('staff') ومسير للعاملات ('workers') لكل شهر؛
--      نفس الإعداد ← الاعتماد بشخص آخر (الأربع أعين) ← الترحيل ← الصرف.
--   2) payroll_adjustments تقبل العاملة (worker_id): إضافات وخصومات وسلف وجزاءات
--      ترفع «بانتظار الاعتماد» ولا تدخل المسير إلا بعد اعتمادها.
--   3) غياب السكن (التحضير بالباركود) يُقترح خصمًا قابلًا للاعتماد — لا يُخصم آليًا.
--   4) احتساب جزئي من تاريخ الوصول (نفس قاعدة الموظفين: الأيام ÷ أيام الشهر القياسية).
--   5) worker_payslips: لقطة مجمّدة لكل عاملة (البنك والآيبان وقت الاحتساب).
--   6) الترحيل والصرف مقسّمان على الفروع (مركز تكلفة لكل فرع)، مصروف رواتب العمالة
--      في حساب مستقل 5120.
-- =============================================================

-- ---------- 1) one run per period per kind ------------------------------------------
alter table payroll_runs add column if not exists kind text not null default 'staff';
alter table payroll_runs drop constraint if exists payroll_runs_kind_chk;
alter table payroll_runs add constraint payroll_runs_kind_chk check (kind in ('staff','workers'));
drop index if exists ux_payroll_runs_period;
create unique index if not exists ux_payroll_runs_period_kind on payroll_runs(period, kind) where branch_id is null;

insert into chart_of_accounts (code, name_ar, type, parent_id, normal_balance) values
  ('5120', 'رواتب العمالة المنزلية', 'expense', acc_id('5000'), 'debit')
on conflict (code) do nothing;

-- ---------- 2) approvable adjustments for workers ------------------------------------
alter table payroll_adjustments alter column employee_id drop not null;
alter table payroll_adjustments
  add column if not exists worker_id uuid references worker_profiles(id) on delete cascade,
  add column if not exists source    text not null default 'manual',
  add column if not exists days      numeric(5,1);
alter table payroll_adjustments drop constraint if exists payroll_adjustments_owner_chk;
alter table payroll_adjustments add constraint payroll_adjustments_owner_chk
  check (num_nonnulls(employee_id, worker_id) = 1);
alter table payroll_adjustments drop constraint if exists payroll_adjustments_source_chk;
alter table payroll_adjustments add constraint payroll_adjustments_source_chk
  check (source in ('manual','housing_absence'));
alter table payroll_adjustments drop constraint if exists payroll_adjustments_type_check;
alter table payroll_adjustments add constraint payroll_adjustments_type_check
  check (type in ('bonus','penalty','advance','allowance','overtime','absence'));
create index if not exists idx_payadj_worker_period on payroll_adjustments(worker_id, period) where worker_id is not null;

drop policy if exists payadj_read on payroll_adjustments;
create policy payadj_read on payroll_adjustments for select to authenticated using (
  (employee_id is not null and hr_can_see(employee_id))
  or (worker_id is not null and has_perm('hr','view') and worker_in_my_branch(worker_id)));
drop policy if exists payadj_submit on payroll_adjustments;
create policy payadj_submit on payroll_adjustments for insert to authenticated with check (
  status = 'pending' and (
    (employee_id is not null and hr_in_scope(employee_id))
    or (worker_id is not null and has_perm('hr','edit') and worker_in_my_branch(worker_id))));
-- payadj_decide (hr.manage) stays: approving a deduction is a manager's call

-- an approved month is closed for its own kind only
create or replace function guard_adjustment_period() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from payroll_runs
              where period = new.period and status in ('approved','paid')
                and kind = case when new.worker_id is not null then 'workers' else 'staff' end) then
    raise exception 'مسير % معتمد — ارفع التعديل على الشهر التالي', new.period using errcode = '42501';
  end if;
  return new;
end $$;

-- the staff run ignores worker runs of the same month
create or replace function calculate_payroll_run(p_period text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_run payroll_runs%rowtype; v_emp uuid; s jsonb; e record;
begin
  if not has_perm('hr','manage') then
    raise exception 'إعداد المسير من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر غير صحيح'; end if;

  select * into v_run from payroll_runs where period = p_period and branch_id is null and kind = 'staff';
  if found and v_run.status in ('approved','paid') then
    raise exception 'مسير % معتمد — التصحيح يكون بتعديل في الشهر التالي', p_period;
  end if;
  if not found then
    insert into payroll_runs (period, status, run_by, kind) values (p_period, 'calculated', auth.uid(), 'staff')
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

-- ---------- 3) worker payslips (frozen snapshot) --------------------------------------
create table if not exists worker_payslips (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references payroll_runs(id) on delete cascade,
  worker_id          uuid not null references worker_profiles(id) on delete restrict,
  worker_name        text not null,
  nationality        text,
  iqama_no           text,
  passport_no        text,
  branch_id          uuid references branches(id) on delete set null,
  payment_method     text not null default 'bank',
  bank_name          text,
  iban               text,
  monthly_salary     numeric(12,2) not null default 0,
  eligible_days      integer not null default 0,
  base_pay           numeric(12,2) not null default 0,
  additions          numeric(12,2) not null default 0,
  absence_days       numeric(5,1)  not null default 0,
  absence_deduction  numeric(12,2) not null default 0,
  penalty_deductions numeric(12,2) not null default 0,
  advance_deductions numeric(12,2) not null default 0,
  gross              numeric(12,2) not null default 0,
  total_deductions   numeric(12,2) not null default 0,
  net                numeric(12,2) not null default 0,
  created_at         timestamptz not null default now()
);
create unique index if not exists ux_worker_payslips_run on worker_payslips(run_id, worker_id);

create or replace function guard_frozen_worker_payslip() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from payroll_runs where id = coalesce(new.run_id, old.run_id);
  if v_status in ('approved','paid') then
    raise exception 'قسيمة في مسير معتمد لا تتغير — التصحيح في الشهر التالي' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_frozen_worker_payslip on worker_payslips;
create trigger trg_guard_frozen_worker_payslip before insert or update or delete on worker_payslips
  for each row execute function guard_frozen_worker_payslip();

alter table worker_payslips enable row level security;
drop policy if exists wslips_read on worker_payslips;
create policy wslips_read on worker_payslips for select to authenticated
  using (has_perm('hr','view') and worker_in_my_branch(worker_id));
-- writes only through calculate_worker_payroll_run

-- ---------- 4) who is paid, for how many days ------------------------------------------
create or replace function worker_eligible_days(p_worker uuid, p_period text) returns integer
language sql stable security definer set search_path = public as $$
  select case
    when not p.is_active then 0
    when d.arrival_date is null or d.arrival_date <= to_date(p_period || '-01', 'YYYY-MM-DD') then 30
    when d.arrival_date > (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date then 0
    else ((to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date - d.arrival_date) + 1
  end
  from worker_profiles p left join worker_details d on d.worker_id = p.id
  where p.id = p_worker
$$;

-- ---------- 5) housing absence → proposed deductions (pending approval) ---------------
create or replace function propose_worker_absences(p_period text) returns integer
language plpgsql security definer set search_path = public as $$
declare w record; v_days numeric; v_daily numeric; v_n integer := 0; v_cfg payroll_config%rowtype;
  v_start date; v_end date;
begin
  if not has_perm('hr','edit') then
    raise exception 'اقتراح خصومات الغياب من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر غير صحيح'; end if;
  if exists (select 1 from payroll_runs where period = p_period and kind = 'workers' and status in ('approved','paid')) then
    raise exception 'مسير العاملات % معتمد', p_period;
  end if;
  select * into v_cfg from payroll_config where id = 1;
  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  for w in
    select p.id, p.full_name, p.monthly_salary, d.ops_worker_id
      from worker_profiles p join worker_details d on d.worker_id = p.id
     where p.is_active and worker_in_my_branch(p.id) and d.ops_worker_id is not null
  loop
    select count(*) into v_days from housing_attendance
     where worker_id = w.ops_worker_id and status = 'absent' and date between v_start and v_end;
    -- a decided proposal stays as decided; pending ones follow the latest attendance
    delete from payroll_adjustments
     where worker_id = w.id and period = p_period and source = 'housing_absence' and status = 'pending';
    if v_days > 0 and not exists (select 1 from payroll_adjustments
        where worker_id = w.id and period = p_period and source = 'housing_absence' and status <> 'pending') then
      v_daily := round(coalesce(w.monthly_salary, 0) / nullif(v_cfg.standard_work_days, 0), 2);
      insert into payroll_adjustments (worker_id, type, amount, reason, period, submitted_by, status, source, days)
      values (w.id, 'absence', round(v_daily * v_days, 2),
              'غياب ' || v_days || ' يوم من السكن (التحضير بالباركود)', p_period, auth.uid(), 'pending',
              'housing_absence', v_days);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ---------- 6) calculate the workers run -----------------------------------------------
create or replace function calculate_worker_payroll_run(p_period text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_run payroll_runs%rowtype; w record; v_cfg payroll_config%rowtype;
  v_days integer; v_base numeric; v_add numeric; v_abs numeric; v_abs_days numeric; v_pen numeric; v_adv numeric;
  v_gross numeric; v_ded numeric;
begin
  if not has_perm('hr','manage') then
    raise exception 'إعداد المسير من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر غير صحيح'; end if;
  select * into v_cfg from payroll_config where id = 1;

  select * into v_run from payroll_runs where period = p_period and branch_id is null and kind = 'workers';
  if found and v_run.status in ('approved','paid') then
    raise exception 'مسير العاملات % معتمد — التصحيح يكون بتعديل في الشهر التالي', p_period;
  end if;
  if not found then
    insert into payroll_runs (period, status, run_by, kind) values (p_period, 'calculated', auth.uid(), 'workers')
    returning * into v_run;
  end if;

  delete from worker_payslips where run_id = v_run.id;
  for w in
    select p.id, p.full_name, p.nationality, p.branch_id, p.monthly_salary,
           d.iqama_no, d.passport_no, d.payment_method, d.bank_name, d.iban
      from worker_profiles p left join worker_details d on d.worker_id = p.id
     where p.is_active
  loop
    v_days := least(worker_eligible_days(w.id, p_period), v_cfg.standard_work_days);
    continue when v_days <= 0;
    v_base := round(coalesce(w.monthly_salary, 0) * least(v_days::numeric / nullif(v_cfg.standard_work_days, 0), 1), 2);
    select coalesce(sum(amount) filter (where type in ('bonus','allowance','overtime')), 0),
           coalesce(sum(amount) filter (where type = 'absence'), 0),
           coalesce(sum(days)   filter (where type = 'absence'), 0),
           coalesce(sum(amount) filter (where type = 'penalty'), 0),
           coalesce(sum(amount) filter (where type = 'advance'), 0)
      into v_add, v_abs, v_abs_days, v_pen, v_adv
      from payroll_adjustments
     where worker_id = w.id and period = p_period and status = 'approved';
    v_gross := v_base + v_add;
    v_ded := v_abs + v_pen + v_adv;
    if v_ded > v_gross then
      raise exception 'خصومات «%» (%) تتجاوز مستحقها (%) — راجع التعديلات المعتمدة', w.full_name, v_ded, v_gross;
    end if;
    insert into worker_payslips (run_id, worker_id, worker_name, nationality, iqama_no, passport_no, branch_id,
      payment_method, bank_name, iban, monthly_salary, eligible_days, base_pay, additions,
      absence_days, absence_deduction, penalty_deductions, advance_deductions, gross, total_deductions, net)
    values (v_run.id, w.id, w.full_name, w.nationality, w.iqama_no, w.passport_no, w.branch_id,
      coalesce(w.payment_method, 'bank'), w.bank_name, w.iban, coalesce(w.monthly_salary, 0), v_days, v_base, v_add,
      v_abs_days, v_abs, v_pen, v_adv, v_gross, v_ded, v_gross - v_ded);
  end loop;

  update payroll_runs r set
    status = 'calculated', run_by = auth.uid(), calculated_at = now(),
    employee_count = x.n, total_gross = x.gross, total_deductions = x.ded, total_net = x.net,
    total_earnings = x.earn, total_gosi_employee = 0, total_gosi_employer = 0,
    total_advances = x.adv, total_penalties = x.pen
  from (select count(*) n, coalesce(sum(gross),0) gross, coalesce(sum(total_deductions),0) ded,
               coalesce(sum(net),0) net, coalesce(sum(gross - absence_deduction),0) earn,
               coalesce(sum(advance_deductions),0) adv, coalesce(sum(penalty_deductions),0) pen
          from worker_payslips where run_id = v_run.id) x
  where r.id = v_run.id;
  return v_run.id;
end $$;

-- ---------- 7) posting + payment, split by branch --------------------------------------
create or replace function post_worker_payroll(r payroll_runs) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_d date; b record;
begin
  v_d := (to_date(r.period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (v_d, ensure_period(v_d), null, 'قيد استحقاق رواتب العاملات ' || r.period, 'PAYROLL-W-' || r.period, 'payroll', r.id)
  returning id into v_entry;
  for b in
    select branch_id, sum(gross - absence_deduction) earn, sum(advance_deductions) adv,
           sum(penalty_deductions) pen, sum(net) net
      from worker_payslips where run_id = r.id group by branch_id
  loop
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('5120'), b.earn, 0, b.branch_id, 'رواتب العمالة المنزلية');
    if b.adv > 0 then
      insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
      values (v_entry, acc_id('1160'), 0, b.adv, b.branch_id, 'استرداد سلف العاملات');
    end if;
    if b.pen > 0 then
      insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
      values (v_entry, acc_id('2170'), 0, b.pen, b.branch_id, 'جزاءات مقتطعة (لصالح العمال)');
    end if;
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('2130'), 0, b.net, b.branch_id, 'رواتب عاملات مستحقة الدفع');
  end loop;
  update payroll_runs set posted_entry_id = v_entry, posted_at = now() where id = r.id;
  return v_entry;
end $$;

create or replace function pay_worker_payroll(r payroll_runs, p_paid_on date, p_bank_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_entry uuid; b record;
begin
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (p_paid_on, ensure_period(p_paid_on), null, 'صرف رواتب العاملات ' || r.period,
          'PAYROLL-W-PAY-' || r.period, 'payroll', r.id)
  returning id into v_entry;
  for b in select branch_id, sum(net) net from worker_payslips where run_id = r.id group by branch_id loop
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
      (v_entry, acc_id('2130'), b.net, 0, b.branch_id, 'إطفاء رواتب العاملات المستحقة'),
      (v_entry, acc_id(p_bank_code), 0, b.net, b.branch_id, 'تحويل رواتب العاملات (حماية الأجور)');
  end loop;
  update payroll_runs set status = 'paid', paid_at = p_paid_on, paid_entry_id = v_entry where id = r.id;
  return v_entry;
end $$;
revoke execute on function post_worker_payroll(payroll_runs), pay_worker_payroll(payroll_runs, date, text)
  from public, anon, authenticated;

-- the shared entry points dispatch by kind (permission + state checks stay in one place)
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
  if r.kind = 'workers' then return post_worker_payroll(r); end if;

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
  if r.kind = 'workers' then return pay_worker_payroll(r, p_paid_on, p_bank_code); end if;
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

grant execute on function worker_eligible_days(uuid, text), propose_worker_absences(text),
  calculate_worker_payroll_run(text) to authenticated;

drop trigger if exists trg_audit_row on worker_payslips;
create trigger trg_audit_row after insert or update or delete on worker_payslips
  for each row execute function audit_row_change();
