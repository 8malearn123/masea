-- Tests for 0095: worker candidates with real availability, worker history, driver tasks
-- with the no-overlap rule, driver availability, the driver's own task updates.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9500000-0000-0000-0000-000000000001', 'bm95@test'),
  ('a9500000-0000-0000-0000-000000000002', 'drv95@test'),
  ('a9500000-0000-0000-0000-000000000003', 'drv95b@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9500000-0000-0000-0000-000000000001', 'مانع آل سدران', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9500000-0000-0000-0000-000000000002', 'ماجد الحربي', 'driver', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9500000-0000-0000-0000-000000000003', 'ياسر الحازمي', 'driver', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into drivers (id, full_name, phone, branch_id, user_id) values
  ('e9500000-0000-0000-0000-000000000001', 'ماجد الحربي', '0551239501', 'b0000000-0000-0000-0000-00000000000a', 'a9500000-0000-0000-0000-000000000002'),
  ('e9500000-0000-0000-0000-000000000002', 'ياسر الحازمي', '0551239502', 'b0000000-0000-0000-0000-00000000000a', 'a9500000-0000-0000-0000-000000000003')
on conflict (id) do nothing;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c9500000-0000-0000-0000-000000000001', 'سعود آل فطيح', '0551239510', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f9500000-0000-0000-0000-000000000001', 'ليلى سانتوس', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f9500000-0000-0000-0000-000000000002', 'أمينة نالوبيغا', 'أوغندا', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date, worker_profile_id)
values ('d9500000-0000-0000-0000-00000000000a', 'c9500000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
        'monthly_rental', 2200, 'draft', 'MR-95-A', current_date + 1, current_date + 30, 'f9500000-0000-0000-0000-000000000001')
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
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login('a9500000-0000-0000-0000-000000000001');
select transition_contract('d9500000-0000-0000-0000-00000000000a', 'pending_approval');

-- ---------- candidates: real availability for the period ----------
select pg_temp.check((select not available and reason like '%MR-95-A%' from contract_worker_candidates(
                        'monthly_rental', current_date + 10, current_date + 20)
                       where id = 'f9500000-0000-0000-0000-000000000001'),
  'a worker held on an overlapping live contract is shown as NOT available, with the contract');
select pg_temp.check((select available and internal_no like 'MAS-W-%' from contract_worker_candidates(
                        'monthly_rental', current_date + 10, current_date + 20)
                       where id = 'f9500000-0000-0000-0000-000000000002'),
  'a free worker is available and carries her internal number');
select pg_temp.check((select available from contract_worker_candidates('monthly_rental', current_date + 40, current_date + 60)
                       where id = 'f9500000-0000-0000-0000-000000000001'),
  'the same worker is available for a later, non-overlapping period');
select pg_temp.check((select count(*) >= 1 from worker_contract_history('f9500000-0000-0000-0000-000000000001')
                       where kind = 'contract' and contract_no = 'MR-95-A'), 'worker history lists her contracts');

-- ---------- driver tasks ----------
select create_driver_task('d9500000-0000-0000-0000-00000000000a', 'delivery',
  (current_date + 1) + time '09:00', (current_date + 1) + time '10:00', null, 'نجران — حي الفيصلية');
select pg_temp.check((select status = 'pending' and driver_id is null from driver_tasks
                       where contract_id = 'd9500000-0000-0000-0000-00000000000a'), 'a task can wait for a driver');
select driver_task_step((select id from driver_tasks where contract_id = 'd9500000-0000-0000-0000-00000000000a'),
  'assign', 'e9500000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select create_driver_task('d9500000-0000-0000-0000-00000000000a', 'pickup',
                          (current_date + 1) + time '09:30', (current_date + 1) + time '11:00',
                          'e9500000-0000-0000-0000-000000000001')$$,
  'مشغول', 'the same driver cannot take two overlapping tasks');
select create_driver_task('d9500000-0000-0000-0000-00000000000a', 'pickup',
  (current_date + 1) + time '10:00', (current_date + 1) + time '11:00', 'e9500000-0000-0000-0000-000000000001');
select pg_temp.check((select busy and busy_task_no is not null from driver_availability(
                        (current_date + 1) + time '09:15', (current_date + 1) + time '09:45')
                       where id = 'e9500000-0000-0000-0000-000000000001')
                     and (select not busy from driver_availability(
                        (current_date + 1) + time '09:15', (current_date + 1) + time '09:45')
                       where id = 'e9500000-0000-0000-0000-000000000002'),
  'availability shows who is busy and who is free in a window');
select pg_temp.logout();

-- the driver updates his own task; another driver cannot
select pg_temp.login('a9500000-0000-0000-0000-000000000003');
select pg_temp.rejects($$select driver_task_step((select id from driver_tasks where kind = 'delivery'
                          and contract_id = 'd9500000-0000-0000-0000-00000000000a'), 'start')$$,
  'غير موجودة', 'another driver cannot even see the task');
select pg_temp.logout();
select pg_temp.login('a9500000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) = 2 from driver_tasks), 'the driver sees his own tasks');
select driver_task_step((select id from driver_tasks where kind = 'delivery' and contract_id = 'd9500000-0000-0000-0000-00000000000a'), 'start');
select driver_task_step((select id from driver_tasks where kind = 'delivery' and contract_id = 'd9500000-0000-0000-0000-00000000000a'), 'done', null, 'سُلّمت للعميل');
select pg_temp.logout();
select pg_temp.check((select status = 'done' and done_at is not null from driver_tasks
                       where kind = 'delivery' and contract_id = 'd9500000-0000-0000-0000-00000000000a'),
  'delivery time and status recorded');
select pg_temp.check((select count(*) >= 3 from contract_ops_events
                       where contract_id = 'd9500000-0000-0000-0000-00000000000a' and entity = 'driver_task'),
  'driver task steps are in the contract log');

select 'OK 99v_workers_drivers' as result;
