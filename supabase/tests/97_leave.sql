-- Tests for 0070 (leave): managed types, accrued annual balance, server-side
-- validation (overlap / balance / eligibility / sick limit), cancel, payroll effect.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a3000000-0000-0000-0000-000000000002', 'hr3@test'),
  ('a3000000-0000-0000-0000-000000000004', 'sales3@test'),
  ('a3000000-0000-0000-0000-000000000005', 'emp3.self@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a3000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a3000000-0000-0000-0000-000000000004', 'نايف اليامي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('a3000000-0000-0000-0000-000000000005', 'هند القحطاني', 'accountant', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;

insert into employees (id, full_name, branch_id, basic_salary, nationality, hire_date, user_id) values
  ('e3000000-0000-0000-0000-00000000000a', 'هند القحطاني', 'b0000000-0000-0000-0000-00000000000a', 9000,
   'السعودية', '2021-01-01', 'a3000000-0000-0000-0000-000000000005'),
  ('e3000000-0000-0000-0000-00000000000b', 'ماجد الحربي', 'b0000000-0000-0000-0000-00000000000a', 6000,
   'السعودية', '2026-06-01', null)
on conflict (id) do nothing;
insert into employee_details (employee_id, gender) values
  ('e3000000-0000-0000-0000-00000000000a', 'female'),
  ('e3000000-0000-0000-0000-00000000000b', 'male')
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
-- expects the statement to fail with a message containing p_like
create or replace function pg_temp.rejects(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL (accepted): %', p_msg;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%' || p_like || '%' then
    raise exception 'FAIL: % — got «%»', p_msg, sqlerrm;
  end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- types are managed config ----------
select pg_temp.check((select count(*) from leave_types where is_active) >= 10, 'Saudi labour-law leave types seeded');
select pg_temp.check(leave_annual_accrued('2021-01-01', '2026-01-01') between 104.9 and 105.1,
  '5 years × 21 days = 105');
select pg_temp.check(leave_annual_accrued('2021-01-01', '2027-01-01') between 134.9 and 135.2,
  'after 5 years the rate is 30/yr: 105 + 30');
select pg_temp.login('a3000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) from leave_types) >= 10, 'any user can read the leave types');
update leave_types set entitlement_days = 60 where code = 'annual';
select pg_temp.logout();
select pg_temp.check((select entitlement_days from leave_types where code = 'annual') = 21, 'sales could not change leave rules');

-- ---------- HR: validation ----------
select pg_temp.login('a3000000-0000-0000-0000-000000000002');
-- new hire (2026-06-01): ~11 days accrued by mid-December
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date, status)
  values ('e3000000-0000-0000-0000-00000000000b', 'annual', '2026-12-10', '2026-12-24', 'approved')$$,
  'الرصيد السنوي غير كافٍ', 'annual leave beyond the accrued balance');
insert into leave_requests (employee_id, type, start_date, end_date, status)
values ('e3000000-0000-0000-0000-00000000000b', 'annual', '2026-12-10', '2026-12-14', 'approved');
select pg_temp.check((select days from leave_requests where employee_id = 'e3000000-0000-0000-0000-00000000000b'
                       and start_date = '2026-12-10') = 5, 'days computed by the server (inclusive)');
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e3000000-0000-0000-0000-00000000000b', 'emergency', '2026-12-13', '2026-12-15')$$,
  'تتداخل', 'overlapping leave');
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e3000000-0000-0000-0000-00000000000b', 'hajj', '2027-05-20', '2027-05-30')$$,
  'خدمة 24', 'hajj needs 2 years of service');
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e3000000-0000-0000-0000-00000000000b', 'maternity', '2027-01-01', '2027-02-01')$$,
  'لا تنطبق', 'maternity leave for a male employee');
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e3000000-0000-0000-0000-00000000000a', 'paternity', '2027-01-01', '2027-01-03')$$,
  'لا تنطبق', 'paternity leave for a female employee');
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e3000000-0000-0000-0000-00000000000a', 'marriage', '2027-03-01', '2027-03-08')$$,
  'الحد 5', 'marriage leave longer than 5 days');
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e3000000-0000-0000-0000-00000000000a', 'emergency', '2027-04-01', '2027-04-06')$$,
  'الحد 5', 'emergency leave over the yearly cap');
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e3000000-0000-0000-0000-00000000000a', 'sick', '2027-05-01', '2027-09-02')$$,
  'حد الإجازة المرضية', 'sick leave over 120 days a year');
select pg_temp.rejects($$insert into leave_requests (employee_id, type, start_date, end_date)
  values ('e3000000-0000-0000-0000-00000000000a', 'annual', '2027-01-10', '2027-01-05')$$,
  'قبل تاريخ البداية', 'end before start');

-- ---------- payroll effect ----------
insert into leave_requests (employee_id, type, start_date, end_date, status) values
  ('e3000000-0000-0000-0000-00000000000a', 'unpaid', '2026-11-03', '2026-11-07', 'approved'),
  ('e3000000-0000-0000-0000-00000000000a', 'sick', '2026-01-01', '2026-01-31', 'approved'),
  ('e3000000-0000-0000-0000-00000000000a', 'sick', '2026-02-01', '2026-02-10', 'approved');
select pg_temp.check((calculate_payslip('e3000000-0000-0000-0000-00000000000a', '2026-11')->>'leave_deduction')::numeric = 1500,
  'unpaid leave: 5 days × 9000/30 = 1500');
select pg_temp.check((calculate_payslip('e3000000-0000-0000-0000-00000000000a', '2026-01')->>'sick_deduction_days')::numeric = 0.25,
  'sick: day 31 of the year falls in the 75% tier');
select pg_temp.check((calculate_payslip('e3000000-0000-0000-0000-00000000000a', '2026-02')->>'leave_deduction')::numeric = 750,
  'sick: 10 days at 75% → 2.5 days × 300 deducted');
select pg_temp.check((leave_balance('e3000000-0000-0000-0000-00000000000a', '2026-11-07')->>'sick_used_this_year')::int = 41,
  'balance reports sick days used this year');
select pg_temp.logout();

-- ---------- employee: requests own leave, cancels while pending ----------
select pg_temp.login('a3000000-0000-0000-0000-000000000005');
insert into leave_requests (id, employee_id, type, start_date, end_date)
values ('f3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-00000000000a', 'annual', '2027-02-01', '2027-02-05');
update leave_requests set status = 'cancelled' where id = 'f3000000-0000-0000-0000-000000000001';
update leave_requests set status = 'cancelled' where employee_id = 'e3000000-0000-0000-0000-00000000000a' and type = 'unpaid';
select pg_temp.logout();
select pg_temp.check((select status from leave_requests where id = 'f3000000-0000-0000-0000-000000000001') = 'cancelled',
  'requester cancelled a pending request');
select pg_temp.check((select status from leave_requests where employee_id = 'e3000000-0000-0000-0000-00000000000a' and type = 'unpaid') = 'approved',
  'requester cannot cancel an approved leave');
select pg_temp.check((select (leave_annual_used('e3000000-0000-0000-0000-00000000000a', 'pending'))) = 0,
  'a cancelled request no longer reserves balance');
