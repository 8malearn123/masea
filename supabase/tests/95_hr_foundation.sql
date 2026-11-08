-- RLS tests for 0067 (payroll settings) + 0068 (HR foundation):
-- who may read/write employees, leave, attendance, adjustments, reviews,
-- payroll config and the payslip engine — per role and per branch.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------- fixtures (as the table owner) ----------
insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'gm.hr@test'),
  ('a1000000-0000-0000-0000-000000000002', 'hr.officer@test'),
  ('a1000000-0000-0000-0000-000000000003', 'bm.najran.hr@test'),
  ('a1000000-0000-0000-0000-000000000004', 'sales.najran.hr@test'),
  ('a1000000-0000-0000-0000-000000000005', 'emp.self@test')
on conflict (id) do nothing;

insert into user_profiles (id, full_name, role, branch_id) values
  ('a1000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', null),
  ('a1000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a1000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a1000000-0000-0000-0000-000000000004', 'نورة العتيبي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('a1000000-0000-0000-0000-000000000005', 'بدر المالكي', 'accountant', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;

insert into employees (id, full_name, role, job_title, branch_id, basic_salary, transport_allowance, nationality, hire_date, user_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'فهد الشهري', 'operations_manager', 'مدير العمليات',
   'b0000000-0000-0000-0000-00000000000a', 18000, 1000, 'السعودية', '2023-03-01', null),
  ('e1000000-0000-0000-0000-00000000000b', 'ريم الزهراني', 'call_center', 'موظفة مركز اتصال',
   'b0000000-0000-0000-0000-00000000000b', 6500, 500, 'السعودية', '2024-04-20', null),
  ('e1000000-0000-0000-0000-00000000000c', 'بدر المالكي', 'accountant', 'محاسب',
   'b0000000-0000-0000-0000-00000000000a', 12000, 800, 'السعودية', '2023-09-05',
   'a1000000-0000-0000-0000-000000000005')
on conflict (id) do nothing;
insert into employee_details (employee_id, department, iban, bank_name, housing_allowance) values
  ('e1000000-0000-0000-0000-00000000000a', 'العمليات', 'SA0380000000608010167519', 'الراجحي', 2000),
  ('e1000000-0000-0000-0000-00000000000b', 'مركز الاتصال', 'SA4420000001234567891234', 'الأهلي', 500),
  ('e1000000-0000-0000-0000-00000000000c', 'المالية', 'SA1180000000608010000001', 'الإنماء', 1200)
on conflict (employee_id) do nothing;

create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_msg; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- sales (no HR permission): sees nothing, writes nothing ----------
select pg_temp.login('a1000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) from employees where id::text like 'e1000000%') = 0,
  'sales cannot read colleagues (salaries) even in own branch');
select pg_temp.check((select count(*) from employee_details where employee_id::text like 'e1000000%') = 0,
  'sales cannot read IBAN/allowances');
do $$ begin
  insert into payroll_adjustments (employee_id, type, amount, period)
  values ('e1000000-0000-0000-0000-00000000000a', 'bonus', 5000, '2026-11');
  raise exception 'FAIL: sales submitted a payroll adjustment';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform calculate_payslip('e1000000-0000-0000-0000-00000000000a', '2026-11');
  raise exception 'FAIL: sales computed a colleague payslip';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e1000000-0000-0000-0000-00000000000a', 'annual', '2026-12-01', '2026-12-03');
  raise exception 'FAIL: sales filed leave for a colleague';
exception when insufficient_privilege then null;
end $$;
select pg_temp.logout();

-- ---------- employee self (accountant, linked user): own record only ----------
select pg_temp.login('a1000000-0000-0000-0000-000000000005');
select pg_temp.check((select count(*) from employees where id::text like 'e1000000%') = 1,
  'employee sees own record only');
select pg_temp.check((select (calculate_payslip('e1000000-0000-0000-0000-00000000000c', '2026-11')->>'basic')::numeric) = 12000,
  'employee can compute own payslip');
insert into leave_requests (employee_id, type, start_date, end_date, status)
values ('e1000000-0000-0000-0000-00000000000c', 'annual', '2026-12-10', '2026-12-12', 'pending');
do $$ begin
  insert into leave_requests (employee_id, type, start_date, end_date, status)
  values ('e1000000-0000-0000-0000-00000000000c', 'annual', '2026-12-20', '2026-12-22', 'approved');
  raise exception 'FAIL: employee self-approved a leave';
exception when insufficient_privilege then null;
end $$;
select pg_temp.logout();

-- ---------- branch manager (Najran): own branch; approves leave, not pay ----------
select pg_temp.login('a1000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from employees where id::text like 'e1000000%') = 2,
  'BM sees Najran employees only');
select pg_temp.check(not exists (select 1 from employee_details where employee_id = 'e1000000-0000-0000-0000-00000000000b'),
  'BM cannot read Jazan employee details');
insert into leave_requests (employee_id, type, start_date, end_date, status)
values ('e1000000-0000-0000-0000-00000000000a', 'annual', '2026-12-01', '2026-12-03', 'pending');
insert into payroll_adjustments (employee_id, type, amount, period, status)
values ('e1000000-0000-0000-0000-00000000000a', 'bonus', 750, '2026-11', 'pending');
do $$ begin
  insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e1000000-0000-0000-0000-00000000000b', 'annual', '2026-12-01', '2026-12-03');
  raise exception 'FAIL: BM filed leave for another branch';
exception when insufficient_privilege then null;
end $$;
-- approves own-branch leave (existing matrix 0036)
update leave_requests set status = 'approved'
 where employee_id = 'e1000000-0000-0000-0000-00000000000a' and start_date = '2026-12-01';
-- edits the team, not the money
update employees set job_title = 'مدير عمليات الفرع' where id = 'e1000000-0000-0000-0000-00000000000a';
do $$ begin
  update employees set basic_salary = 99999 where id = 'e1000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL: BM changed a salary directly';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into employees (full_name, branch_id, basic_salary) values ('موظف جديد', 'b0000000-0000-0000-0000-00000000000a', 9000);
  raise exception 'FAIL: BM hired with a salary (pay is HR)';
exception when insufficient_privilege then null;
end $$;
-- cannot decide a salary adjustment (hr.manage) nor touch another branch
update payroll_adjustments set status = 'approved' where employee_id = 'e1000000-0000-0000-0000-00000000000a';
do $$ begin
  perform save_performance_review(null, 'e1000000-0000-0000-0000-00000000000b', 'الربع الرابع 2026', '2026-10-01', '2026-12-31', '{"quality":90,"teamwork":90,"customers":90}');
  raise exception 'FAIL: BM reviewed another branch employee';
exception when insufficient_privilege then null;
end $$;
select save_performance_review(null, 'e1000000-0000-0000-0000-00000000000a', 'الربع الرابع 2026', '2026-10-01', '2026-12-31', '{"quality":91,"teamwork":91,"customers":91}');
update payroll_config set overtime_multiplier = 3 where id = 1;
select pg_temp.logout();

select pg_temp.check((select status from leave_requests where employee_id = 'e1000000-0000-0000-0000-00000000000a'
                       and start_date = '2026-12-01') = 'approved', 'BM approved own-branch leave');
select pg_temp.check((select basic_salary from employees where id = 'e1000000-0000-0000-0000-00000000000a') = 18000,
  'salary unchanged by BM');
select pg_temp.check((select status from payroll_adjustments where employee_id = 'e1000000-0000-0000-0000-00000000000a') = 'pending',
  'BM could not approve a salary adjustment');
select pg_temp.check((select overtime_multiplier from payroll_config where id = 1) = 1.5,
  'BM could not change payroll settings');

-- ---------- HR officer: all branches, approve, edit, settings ----------
select pg_temp.login('a1000000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) from employees where id::text like 'e1000000%') = 3,
  'HR sees every branch');
update leave_requests set status = 'approved' where employee_id = 'e1000000-0000-0000-0000-00000000000c';
update employees set basic_salary = 18500 where id = 'e1000000-0000-0000-0000-00000000000a';
update employees set job_title = 'مدير العمليات الإقليمي' where id = 'e1000000-0000-0000-0000-00000000000a';
select save_performance_review(null, 'e1000000-0000-0000-0000-00000000000b', 'الربع الرابع 2026', '2026-10-01', '2026-12-31', '{"quality":88,"teamwork":88,"customers":88}');
update payroll_adjustments set status = 'approved', decided_at = now()
 where employee_id = 'e1000000-0000-0000-0000-00000000000a' and period = '2026-11';
update payroll_config set late_grace_minutes = 20 where id = 1;
update gosi_config set saudi_new_employee = 0.105 where id = 1;
select pg_temp.check((select (calculate_payslip('e1000000-0000-0000-0000-00000000000a', '2026-11')->>'additions')::numeric) = 750,
  'approved adjustment flows into the payslip');
select pg_temp.check((select (calculate_payslip('e1000000-0000-0000-0000-00000000000a', '2026-11')->>'gosi_employee')::numeric) = 2152.5,
  'GOSI setting flows into the payslip: (18500+2000) × 10.5%');
do $$ begin
  update payroll_config set standard_work_days = 45 where id = 1;
  raise exception 'FAIL: payroll_config accepted 45 work days';
exception when check_violation then null;
end $$;
select pg_temp.logout();

select pg_temp.check((select status from leave_requests where employee_id = 'e1000000-0000-0000-0000-00000000000c') = 'approved',
  'HR approved the leave');
select pg_temp.check((select basic_salary from employees where id = 'e1000000-0000-0000-0000-00000000000a') = 18500,
  'HR changed the salary');
select pg_temp.check((select late_grace_minutes from payroll_config where id = 1) = 20, 'HR changed payroll settings');

-- ---------- audit trail ----------
select pg_temp.check(exists (select 1 from audit_log where table_name = 'payroll_config' and action = 'update'
                              and new_data ? 'late_grace_minutes' and not (new_data ? 'daily_hours')),
  'payroll setting change audited (changed field only)');
select pg_temp.check(exists (select 1 from audit_log where table_name = 'gosi_config' and action = 'update'),
  'GOSI change audited');
select pg_temp.check(exists (select 1 from audit_log where table_name = 'employees' and action = 'update'
                              and record_id = 'e1000000-0000-0000-0000-00000000000a'),
  'employee edit audited');
select pg_temp.check(exists (select 1 from audit_log where table_name = 'leave_requests' and action = 'update'),
  'leave approval audited');

-- restore shared config for later test files
update payroll_config set late_grace_minutes = 15 where id = 1;
update gosi_config set saudi_new_employee = 0.10 where id = 1;
