-- Tests for 0077 (HR reports): the report dataset, scope, salary visibility,
-- payroll vs estimated cost, attendance/leave aggregation, nitaqat settings.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('aa000000-0000-0000-0000-000000000002', 'hr10@test'),
  ('aa000000-0000-0000-0000-000000000003', 'bmj10@test'),
  ('aa000000-0000-0000-0000-000000000004', 'sales10@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('aa000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('aa000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('aa000000-0000-0000-0000-000000000004', 'نايف اليامي', 'sales', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into employees (id, full_name, branch_id, basic_salary, transport_allowance, nationality, hire_date, termination_date, termination_reason) values
  ('ea000000-0000-0000-0000-00000000000a', 'فيصل الحربي', 'b0000000-0000-0000-0000-00000000000a', 6000, 500, 'السعودية', '2024-01-01', null, null),
  ('ea000000-0000-0000-0000-00000000000b', 'سارة القحطاني', 'b0000000-0000-0000-0000-00000000000b', 3000, 300, 'السعودية', '2025-05-01', null, null),
  ('ea000000-0000-0000-0000-00000000000c', 'رحمن علي', 'b0000000-0000-0000-0000-00000000000b', 2500, 0, 'بنغلاديش', '2023-02-01', '2026-02-15', 'resignation'),
  ('ea000000-0000-0000-0000-00000000000d', 'قديم جدًا', 'b0000000-0000-0000-0000-00000000000a', 2500, 0, 'مصر', '2020-01-01', '2025-01-31', 'contract_end')
on conflict (id) do nothing;
insert into employee_details (employee_id, department, housing_allowance, counts_in_saudization) values
  ('ea000000-0000-0000-0000-00000000000a', 'العمليات', 1500, true),
  ('ea000000-0000-0000-0000-00000000000b', 'المبيعات', 500, true),
  ('ea000000-0000-0000-0000-00000000000c', 'السكن', 0, false)
on conflict (employee_id) do update set department = excluded.department, housing_allowance = excluded.housing_allowance,
  counts_in_saudization = excluded.counts_in_saudization;
insert into attendance (employee_id, date, status, late_minutes) values
  ('ea000000-0000-0000-0000-00000000000a', '2026-01-05', 'present', 0),
  ('ea000000-0000-0000-0000-00000000000a', '2026-01-06', 'late', 25),
  ('ea000000-0000-0000-0000-00000000000a', '2026-01-07', 'absent', 0),
  ('ea000000-0000-0000-0000-00000000000b', '2026-01-05', 'absent', 0)
on conflict do nothing;
insert into leave_requests (employee_id, type, start_date, end_date, status)
values ('ea000000-0000-0000-0000-00000000000a', 'annual', '2026-01-28', '2026-02-03', 'approved');
-- an approved January run for فيصل: actual cost = gross + employer GOSI
insert into payroll_runs (id, period, status) values ('fa000000-0000-0000-0000-000000000001', '2026-01', 'approved')
on conflict (id) do nothing;
alter table payslips disable trigger user;
insert into payslips (run_id, employee_id, basic, gross, net, gosi_employer)
values ('fa000000-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-00000000000a', 6000, 8000, 7220, 940);
alter table payslips enable trigger user;

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
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- HR: everything in range ----------
select pg_temp.login('aa000000-0000-0000-0000-000000000002');
create temp table t_r as select * from hr_report_rows('2026-01-01', '2026-03-31') where employee_id::text like 'ea%';
select pg_temp.check((select count(*) from t_r) = 3, 'in range: 2 active + 1 who left in the range (old leaver excluded)');
select pg_temp.check((select status = 'terminated' and termination_reason = 'resignation' from t_r where full_name = 'رحمن علي'),
  'leaver flagged with reason');
select pg_temp.check((select present_days = 1 and late_days = 1 and absent_days = 1 and late_minutes = 25 and leave_days = 7
  from t_r where full_name = 'فيصل الحربي'), 'attendance + approved leave inside the range');
select pg_temp.check((select department = 'العمليات' and branch = 'نجران' and nitaqat_wage = 7500 and is_saudi
  from t_r where full_name = 'فيصل الحربي'), 'dimensions + nitaqat wage (basic + housing)');
select pg_temp.check((select cost > 8940 and cost_estimated from t_r where full_name = 'فيصل الحربي'),
  'January from the approved run (8,940) + Feb/Mar estimated by the payslip engine');
select pg_temp.check((select cost is not null from t_r where full_name = 'رحمن علي'), 'leaver cost until he left');
select pg_temp.rejects($$ select * from hr_report_rows('2026-03-01', '2026-01-01') $$, 'غير صحيحة', 'period order');
select pg_temp.rejects($$ select * from hr_report_rows('2020-01-01', '2026-01-01') $$, 'سنتين', 'range cap');
-- HR manages the nitaqat bands and the counting rules
update nitaqat_bands set min_pct = 25 where code = 'green_mid';
update app_config set value = 3500 where key = 'saudization_full_wage';
select pg_temp.check((select min_pct from nitaqat_bands where code = 'green_mid') = 25, 'HR edits nitaqat bands');
select pg_temp.check((select value from app_config where key = 'saudization_full_wage') = 3500, 'HR edits the counting wage');
select pg_temp.rejects($$ update app_config set value = 2 where key = 'saudization_half_weight' $$, 'app_config_saudization_chk', 'weight 0..1');
select pg_temp.logout();

-- ---------- branch manager: own branch, no salaries ----------
select pg_temp.login('aa000000-0000-0000-0000-000000000003');
create temp table t_bm as select * from hr_report_rows('2026-01-01', '2026-03-31') where employee_id::text like 'ea%';
select pg_temp.check((select count(*) from t_bm) = 2 and (select bool_and(branch = 'جازان') from t_bm), 'BM: Jazan only');
select pg_temp.check((select bool_and(cost is null) from t_bm), 'BM sees no cost (salaries)');
update nitaqat_bands set min_pct = 1 where code = 'red';
select pg_temp.logout();
select pg_temp.check((select min_pct from nitaqat_bands where code = 'red') = 0, 'BM cannot edit bands');

-- ---------- sales: no HR reports ----------
select pg_temp.login('aa000000-0000-0000-0000-000000000004');
select pg_temp.rejects($$ select * from hr_report_rows('2026-01-01', '2026-03-31') $$, 'صلاحية', 'sales has no HR reports');
select pg_temp.logout();
select pg_temp.check(exists (select 1 from audit_log where table_name = 'nitaqat_bands'), 'bands audited');
\echo 'OK 99f_hr_reports'
