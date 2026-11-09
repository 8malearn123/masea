-- Tests for 0079 (worker payroll + WPS): approvable absence proposals, adjustments,
-- arrival-date proration, four eyes, per-branch posting/payment, freeze, kind isolation, RLS.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ac000000-0000-0000-0000-000000000001', 'gm12@test'),
  ('ac000000-0000-0000-0000-000000000002', 'hr12@test'),
  ('ac000000-0000-0000-0000-000000000003', 'bmj12@test'),
  ('ac000000-0000-0000-0000-000000000004', 'sales12@test'),
  ('ac000000-0000-0000-0000-000000000006', 'acc12@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ac000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', null),
  ('ac000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('ac000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('ac000000-0000-0000-0000-000000000004', 'نايف اليامي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('ac000000-0000-0000-0000-000000000006', 'بدر المالكي', 'accountant', null)
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;

-- workers: A (Najran, bank), B (Jazan, arrived mid-month), C (inactive), D (Najran, cash)
insert into worker_profiles (id, full_name, nationality, profession, monthly_salary, branch_id, is_active) values
  ('fc000000-0000-0000-0000-00000000000a', 'ماري جوي سانتوس', 'الفلبين', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000a', true),
  ('fc000000-0000-0000-0000-00000000000b', 'سيتي رحمة', 'إندونيسيا', 'طباخة', 1400, 'b0000000-0000-0000-0000-00000000000b', true),
  ('fc000000-0000-0000-0000-00000000000c', 'عاملة سابقة', 'كينيا', 'عاملة منزلية', 1300, 'b0000000-0000-0000-0000-00000000000a', false),
  ('fc000000-0000-0000-0000-00000000000d', 'روكسانا خاتون', 'بنغلاديش', 'عاملة نظافة', 1300, 'b0000000-0000-0000-0000-00000000000a', true)
on conflict (id) do nothing;
update worker_details set iqama_no = '2433000001', bank_name = 'مصرف الراجحي', iban = 'SA0380000000608010167519',
  arrival_date = '2025-01-10' where worker_id = 'fc000000-0000-0000-0000-00000000000a';
update worker_details set iqama_no = '2433000002', arrival_date = '2026-10-16', bank_name = 'مصرف الإنماء',
  iban = 'SA4405000068202873140000' where worker_id = 'fc000000-0000-0000-0000-00000000000b';
update worker_details set iqama_no = '2433000004', payment_method = 'cash', arrival_date = '2024-03-01'
 where worker_id = 'fc000000-0000-0000-0000-00000000000d';
-- 2 absences in the dorm for A (barcode scans → housing_attendance on her operational record)
insert into housing_attendance (worker_id, date, status)
select ops_worker_id, d, 'absent' from worker_details, (values (date '2026-10-05'), (date '2026-10-06')) v(d)
 where worker_id = 'fc000000-0000-0000-0000-00000000000a';
insert into employees (id, full_name, branch_id, basic_salary, nationality, hire_date) values
  ('ec000000-0000-0000-0000-00000000000a', 'تركي الشهراني', 'b0000000-0000-0000-0000-00000000000a', 6000, 'السعودية', '2024-01-01')
on conflict (id) do nothing;

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
create or replace function pg_temp.slip(p_worker text) returns worker_payslips language sql as $$
  select s.* from worker_payslips s join payroll_runs r on r.id = s.run_id
   where r.period = '2026-10' and r.kind = 'workers' and s.worker_id = p_worker::uuid
$$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.check(worker_eligible_days('fc000000-0000-0000-0000-00000000000b', '2026-10') = 16, 'arrived 16 Oct → 16 days');
select pg_temp.check(worker_eligible_days('fc000000-0000-0000-0000-00000000000c', '2026-10') = 0, 'inactive → not paid');

-- ---------- HR: absence becomes a proposal, not a deduction ----------
select pg_temp.login('ac000000-0000-0000-0000-000000000002');
select propose_worker_absences('2026-10');
select pg_temp.check((select status = 'pending' and amount = 100 and days = 2 and source = 'housing_absence'
  from payroll_adjustments where worker_id = 'fc000000-0000-0000-0000-00000000000a' and period = '2026-10'),
  'absence proposed: 2 days × 1500/30 = 100, pending approval');
select propose_worker_absences('2026-10');
select pg_temp.check((select count(*) from payroll_adjustments where worker_id = 'fc000000-0000-0000-0000-00000000000a'
  and source = 'housing_absence') = 1, 're-proposing does not duplicate');
insert into payroll_adjustments (worker_id, type, amount, reason, period, status)
values ('fc000000-0000-0000-0000-00000000000a', 'advance', 300, 'سلفة شخصية', '2026-10', 'pending'),
       ('fc000000-0000-0000-0000-00000000000d', 'bonus', 200, 'تقييم ممتاز من العميل', '2026-10', 'pending');
select calculate_worker_payroll_run('2026-10');
select pg_temp.check((select net = 1500 from pg_temp.slip('fc000000-0000-0000-0000-00000000000a')),
  'pending items do not touch the run');
update payroll_adjustments set status = 'approved', decided_at = now(), approved_by = auth.uid()
 where worker_id in ('fc000000-0000-0000-0000-00000000000a','fc000000-0000-0000-0000-00000000000d') and period = '2026-10';
select pg_temp.logout();

-- ---------- branch manager: proposes and submits in his branch, never approves ----------
select pg_temp.login('ac000000-0000-0000-0000-000000000003');
insert into payroll_adjustments (worker_id, type, amount, reason, period, status)
values ('fc000000-0000-0000-0000-00000000000b', 'allowance', 100, 'بدل مواصلات', '2026-10', 'pending');
select pg_temp.rejects($$ insert into payroll_adjustments (worker_id, type, amount, reason, period, status)
  values ('fc000000-0000-0000-0000-00000000000a', 'bonus', 50, 'x', '2026-10', 'pending') $$,
  'row-level security', 'BM cannot raise for another branch');
update payroll_adjustments set status = 'approved' where worker_id = 'fc000000-0000-0000-0000-00000000000b';
select pg_temp.rejects($$ select calculate_worker_payroll_run('2026-10') $$, 'صلاحية', 'BM cannot run payroll');
select pg_temp.logout();
select pg_temp.check((select status from payroll_adjustments where worker_id = 'fc000000-0000-0000-0000-00000000000b') = 'pending',
  'BM could not approve');

-- ---------- recalc + four eyes ----------
select pg_temp.login('ac000000-0000-0000-0000-000000000002');
select calculate_worker_payroll_run('2026-10');
select pg_temp.check((select gross = 1500 and absence_deduction = 100 and advance_deductions = 300 and net = 1100
  and iban = 'SA0380000000608010167519' from pg_temp.slip('fc000000-0000-0000-0000-00000000000a')),
  'A: 1500 − absence 100 − advance 300 = 1100, bank snapshot');
select pg_temp.check((select eligible_days = 16 and base_pay = 746.67 and net = 746.67 from pg_temp.slip('fc000000-0000-0000-0000-00000000000b')),
  'B: prorated 1400 × 16/30 = 746.67 (her pending allowance not included)');
select pg_temp.check((select net = 1500 and payment_method = 'cash' from pg_temp.slip('fc000000-0000-0000-0000-00000000000d')),
  'D: 1300 + approved bonus 200 = 1500, cash flagged');
select pg_temp.check((select count(*) from worker_payslips where worker_id = 'fc000000-0000-0000-0000-00000000000c') = 0, 'inactive worker excluded');
select pg_temp.rejects($$ select approve_payroll_run((select id from payroll_runs where period = '2026-10' and kind = 'workers')) $$,
  'الأربع أعين', 'the preparer cannot approve');
-- the staff run of the same month is independent
select calculate_payroll_run('2026-10');
select pg_temp.check((select count(*) from payroll_runs where period = '2026-10') = 2, 'staff + workers runs side by side');
select pg_temp.logout();

select pg_temp.login('ac000000-0000-0000-0000-000000000001');
select approve_payroll_run((select id from payroll_runs where period = '2026-10' and kind = 'workers'));
select pg_temp.logout();

-- ---------- frozen after approval; staff month still open ----------
select pg_temp.login('ac000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select calculate_worker_payroll_run('2026-10') $$, 'معتمد', 'approved run is frozen');
select pg_temp.rejects($$ insert into payroll_adjustments (worker_id, type, amount, reason, period, status)
  values ('fc000000-0000-0000-0000-00000000000a', 'bonus', 50, 'x', '2026-10', 'pending') $$,
  'معتمد', 'no new worker adjustment for an approved month');
insert into payroll_adjustments (employee_id, type, amount, reason, period, status)
values ('ec000000-0000-0000-0000-00000000000a', 'bonus', 500, 'مكافأة', '2026-10', 'pending');
select pg_temp.check(exists (select 1 from payroll_adjustments where employee_id = 'ec000000-0000-0000-0000-00000000000a'),
  'staff adjustments for the same month still open (kind isolation)');
select pg_temp.rejects($$ select post_payroll_run((select id from payroll_runs where period = '2026-10' and kind = 'workers')) $$,
  'المحاسبة', 'HR cannot post');
select pg_temp.logout();
select pg_temp.rejects($$ update worker_payslips set net = 1 where worker_id = 'fc000000-0000-0000-0000-00000000000a' $$,
  'مسير معتمد', 'payslip frozen');

-- ---------- accounting: posting and payment split by branch ----------
select pg_temp.login('ac000000-0000-0000-0000-000000000006');
create temp table t_post as select post_payroll_run((select id from payroll_runs where period = '2026-10' and kind = 'workers')) id;
create temp table t_pay as select pay_payroll_run((select id from payroll_runs where period = '2026-10' and kind = 'workers'), '2026-11-02', '1112') id;
select pg_temp.logout();
select pg_temp.check((select sum(debit) = sum(credit) from journal_entry_lines where entry_id = (select id from t_post)), 'accrual balanced');
select pg_temp.check((select sum(debit) - sum(credit) from journal_entry_lines where entry_id = (select id from t_post)
  and account_id = acc_id('5120') and branch_id = 'b0000000-0000-0000-0000-00000000000a')
  = (select sum(gross - absence_deduction) from worker_payslips s join payroll_runs r on r.id = s.run_id
      where r.period = '2026-10' and r.kind = 'workers' and s.branch_id = 'b0000000-0000-0000-0000-00000000000a'),
  'Najran expense charged to Najran');
select pg_temp.check((select sum(debit) from journal_entry_lines where entry_id = (select id from t_post)
  and account_id = acc_id('5120') and branch_id = 'b0000000-0000-0000-0000-00000000000b') = 746.67,
  'Jazan expense charged to Jazan');
select pg_temp.check((select sum(credit) from journal_entry_lines where entry_id = (select id from t_post)
  and account_id = acc_id('1160')) = 300, 'advance recovered');
select pg_temp.check((select sum(debit) = sum(credit) from journal_entry_lines where entry_id = (select id from t_pay)), 'payment balanced');
select pg_temp.check((select sum(credit) from journal_entry_lines where entry_id = (select id from t_pay) and account_id = acc_id('1112'))
  = (select total_net from payroll_runs where period = '2026-10' and kind = 'workers'), 'bank pays the run net');
select pg_temp.check((select status from payroll_runs where period = '2026-10' and kind = 'workers') = 'paid', 'run paid');

-- ---------- who reads worker payslips ----------
select pg_temp.login('ac000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from worker_payslips where worker_id::text like 'fc%') = 1, 'BM reads his branch slip only');
select pg_temp.logout();
select pg_temp.login('ac000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) from worker_payslips) = 0, 'sales reads none');
select pg_temp.logout();
\echo 'OK 99h_worker_payroll'
