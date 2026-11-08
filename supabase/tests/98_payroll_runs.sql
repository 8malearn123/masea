-- Tests for 0071 (payroll runs): snapshot, proration, four-eyes approval, freeze,
-- correct accrual entry (advances / penalties / leave), payment, permissions.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a4000000-0000-0000-0000-000000000001', 'gm4@test'),
  ('a4000000-0000-0000-0000-000000000002', 'hr4@test'),
  ('a4000000-0000-0000-0000-000000000003', 'bm4@test'),
  ('a4000000-0000-0000-0000-000000000004', 'sales4@test'),
  ('a4000000-0000-0000-0000-000000000006', 'acc4@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a4000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', null),
  ('a4000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a4000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('a4000000-0000-0000-0000-000000000004', 'نايف اليامي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('a4000000-0000-0000-0000-000000000006', 'بدر المالكي', 'accountant', null)
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;

-- A: Saudi, new GOSI, full month · B: expat hired mid-month · C: left before the month · D: no details row
insert into employees (id, full_name, branch_id, basic_salary, transport_allowance, nationality, hire_date, is_active, termination_date) values
  ('e4000000-0000-0000-0000-00000000000a', 'فيصل العنزي', 'b0000000-0000-0000-0000-00000000000a', 10000, 1000, 'السعودية', '2024-01-01', true, null),
  ('e4000000-0000-0000-0000-00000000000b', 'أنيل شارما', 'b0000000-0000-0000-0000-00000000000b', 6000, 0, 'الهند', '2026-11-16', true, null),
  ('e4000000-0000-0000-0000-00000000000c', 'تركي السبيعي', 'b0000000-0000-0000-0000-00000000000a', 8000, 0, 'السعودية', '2023-01-01', false, '2026-10-31'),
  ('e4000000-0000-0000-0000-00000000000d', 'عبدالله القرني', 'b0000000-0000-0000-0000-00000000000a', 7000, 0, 'السعودية', '2025-02-01', true, null)
on conflict (id) do nothing;
insert into employee_details (employee_id, housing_allowance, gosi_system, iban, bank_name) values
  ('e4000000-0000-0000-0000-00000000000a', 2500, 'new', 'SA0380000000608010167519', 'الراجحي'),
  ('e4000000-0000-0000-0000-00000000000b', 600, 'new', null, null),
  ('e4000000-0000-0000-0000-00000000000c', 2000, 'old', null, null)
on conflict (employee_id) do nothing;
insert into payroll_adjustments (employee_id, type, amount, period, status) values
  ('e4000000-0000-0000-0000-00000000000a', 'advance', 1000, '2026-11', 'approved'),
  ('e4000000-0000-0000-0000-00000000000a', 'penalty', 200, '2026-11', 'approved');

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
create or replace function pg_temp.rejects(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL (accepted): %', p_msg;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%' || p_like || '%' then raise exception 'FAIL: % — got «%»', p_msg, sqlerrm; end if;
end $$;
create or replace function pg_temp.slip(p_emp uuid, p_col text) returns numeric language plpgsql as $$
declare v numeric;
begin
  execute format('select %I from payslips ps join payroll_runs r on r.id = ps.run_id
                   where r.period = ''2026-11'' and ps.employee_id = $1', p_col) into v using p_emp;
  return v;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- only HR / GM prepare ----------
select pg_temp.login('a4000000-0000-0000-0000-000000000004');
select pg_temp.rejects($$select calculate_payroll_run('2026-11')$$, 'صلاحية الموارد البشرية', 'sales prepared a payroll run');
select pg_temp.logout();

-- ---------- HR prepares the snapshot ----------
select pg_temp.login('a4000000-0000-0000-0000-000000000002');
select calculate_payroll_run('2026-11');
select calculate_payroll_run('2026-11'); -- recalculation is allowed before approval
select pg_temp.logout();
select pg_temp.check((select count(*) from payroll_runs where period = '2026-11') = 1, 'one run per period');
select pg_temp.check(pg_temp.slip('e4000000-0000-0000-0000-00000000000a', 'net') = 11050,
  'A: 13500 gross − 1250 GOSI − 1000 advance − 200 penalty');
select pg_temp.check(pg_temp.slip('e4000000-0000-0000-0000-00000000000a', 'advance_deductions') = 1000
                     and pg_temp.slip('e4000000-0000-0000-0000-00000000000a', 'penalty_deductions') = 200,
  'advance and penalty kept apart');
select pg_temp.check(pg_temp.slip('e4000000-0000-0000-0000-00000000000a', 'gosi_employer') = 1500, 'employer GOSI 12500 × 12%');
select pg_temp.check(pg_temp.slip('e4000000-0000-0000-0000-00000000000b', 'basic') = 3000
                     and pg_temp.slip('e4000000-0000-0000-0000-00000000000b', 'eligible_days') = 15,
  'B hired on the 16th: 15/30 of the salary');
select pg_temp.check(pg_temp.slip('e4000000-0000-0000-0000-00000000000c', 'net') is null, 'C (left in October) is not paid in November');
select pg_temp.check(pg_temp.slip('e4000000-0000-0000-0000-00000000000d', 'net') = 7000 - 700,
  'D without a details row gets a real salary, not NULL (7000 − 10% GOSI)');
select pg_temp.check((select iban from payslips where employee_id = 'e4000000-0000-0000-0000-00000000000a') = 'SA0380000000608010167519',
  'IBAN frozen into the snapshot for WPS');

-- ---------- four eyes ----------
select pg_temp.login('a4000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$select approve_payroll_run((select id from payroll_runs where period = '2026-11'))$$,
  'الأربع أعين', 'the preparer approved his own run');
select pg_temp.logout();
select pg_temp.login('a4000000-0000-0000-0000-000000000003');
select pg_temp.rejects($$select approve_payroll_run((select id from payroll_runs where period = '2026-11'))$$,
  'صلاحية الإدارة', 'a branch manager approved the run');
select pg_temp.check((select count(*) from payslips where employee_id = 'e4000000-0000-0000-0000-00000000000a') = 0,
  'BM (Jazan) cannot read a Najran payslip');
select pg_temp.check((select count(*) from payslips where employee_id = 'e4000000-0000-0000-0000-00000000000b') = 1,
  'BM reads his own branch payslip');
select pg_temp.logout();
select pg_temp.login('a4000000-0000-0000-0000-000000000001');
select approve_payroll_run((select id from payroll_runs where period = '2026-11'));
select pg_temp.logout();
select pg_temp.check((select status from payroll_runs where period = '2026-11') = 'approved', 'GM approved');

-- ---------- frozen after approval ----------
select pg_temp.login('a4000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$select calculate_payroll_run('2026-11')$$, 'معتمد', 'recalculated an approved run');
select pg_temp.rejects($$insert into payroll_adjustments (employee_id, type, amount, period)
  values ('e4000000-0000-0000-0000-00000000000a', 'bonus', 500, '2026-11')$$, 'الشهر التالي', 'adjustment on an approved month');
insert into payroll_adjustments (employee_id, type, amount, period)
values ('e4000000-0000-0000-0000-00000000000a', 'bonus', 500, '2026-12'); -- correction goes to the next month
select pg_temp.rejects($$select post_payroll_run((select id from payroll_runs where period = '2026-11'))$$,
  'صلاحية المحاسبة', 'HR posted to the ledger');
select pg_temp.logout();
select pg_temp.rejects($$update payslips set net = 1 where employee_id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'لا تتغير', 'a frozen payslip was edited (even by the owner)');

-- ---------- accounting posts and pays from the totals ----------
select pg_temp.login('a4000000-0000-0000-0000-000000000006');
select pg_temp.check((select count(*) from payroll_runs where period = '2026-11') = 1, 'accountant reads run totals');
select pg_temp.check((select count(*) from payslips where employee_id = 'e4000000-0000-0000-0000-00000000000a') = 0,
  'accountant does not open individual payslips');
select post_payroll_run((select id from payroll_runs where period = '2026-11'));
select pg_temp.check(post_payroll_run((select id from payroll_runs where period = '2026-11'))
                     = (select posted_entry_id from payroll_runs where period = '2026-11'), 'posting is idempotent');
select pay_payroll_run((select id from payroll_runs where period = '2026-11'), '2026-11-27', '1112');
select pg_temp.logout();

select pg_temp.check((select sum(debit) = sum(credit) from journal_entry_lines l join journal_entries j on j.id = l.entry_id
                       where j.reference = 'PAYROLL-2026-11'), 'accrual entry is balanced');
select pg_temp.check(exists (select 1 from journal_entry_lines l join journal_entries j on j.id = l.entry_id
                              where j.reference = 'PAYROLL-2026-11' and l.account_id = acc_id('1160') and l.credit >= 1000),
  'advances recovered to 1160');
select pg_temp.check(exists (select 1 from journal_entry_lines l join journal_entries j on j.id = l.entry_id
                              where j.reference = 'PAYROLL-2026-11' and l.account_id = acc_id('2170') and l.credit >= 200),
  'penalties to the workers fund 2170, not revenue');
select pg_temp.check((select sum(l.credit) from journal_entry_lines l join journal_entries j on j.id = l.entry_id
                       where j.reference = 'PAYROLL-2026-11' and l.account_id = acc_id('2130'))
                     = (select total_net from payroll_runs where period = '2026-11'),
  'salaries payable = the net actually paid');
select pg_temp.check((select coalesce(sum(l.credit - l.debit), 0) from journal_entry_lines l join journal_entries j on j.id = l.entry_id
                       where j.reference in ('PAYROLL-2026-11', 'PAYROLL-PAY-2026-11') and l.account_id = acc_id('2130')) = 0,
  'payment settles the payable');
select pg_temp.check((select status from payroll_runs where period = '2026-11') = 'paid', 'run marked paid');
