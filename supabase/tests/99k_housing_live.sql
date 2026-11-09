-- Tests for 0082: live housing — residents list, scan by barcode or iqama, dorm from the worker file.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000003', 'bmj13@test'),
  ('ad000000-0000-0000-0000-000000000031', 'supj15@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('ad000000-0000-0000-0000-000000000031', 'منى الغامدي', 'housing_supervisor', 'b0000000-0000-0000-0000-00000000000b')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into housing_dorms (id, name, branch_id, capacity, supervisor_id) values
  ('d0000000-0000-0000-0000-0000000000b1', 'سكن اختبار 99k جازان', 'b0000000-0000-0000-0000-00000000000b', 5,
   'ad000000-0000-0000-0000-000000000031'),
  ('d0000000-0000-0000-0000-0000000000b2', 'سكن اختبار 99k نجران', 'b0000000-0000-0000-0000-00000000000a', 5, null)
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, monthly_salary, branch_id) values
  ('fb000000-0000-0000-0000-0000000000d1', 'ميرا سوسانتي', 'إندونيسيا', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000b'),
  ('fb000000-0000-0000-0000-0000000000d2', 'روزا ميندوزا', 'الفلبين', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000b'),
  ('fb000000-0000-0000-0000-0000000000d3', 'كمالا راجا', 'سريلانكا', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;
update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000b1', iqama_no = '2433990001'
 where worker_id = 'fb000000-0000-0000-0000-0000000000d1';
update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000b1', iqama_no = '2433990002'
 where worker_id = 'fb000000-0000-0000-0000-0000000000d2';
update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000b2', iqama_no = '2433990003'
 where worker_id = 'fb000000-0000-0000-0000-0000000000d3';
update worker_profiles set status = 'medical' where id = 'fb000000-0000-0000-0000-0000000000d2';
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

create temp table _ids as
  select d.worker_id, d.ops_worker_id as ops, d.barcode from worker_details d
   where d.worker_id in ('fb000000-0000-0000-0000-0000000000d1','fb000000-0000-0000-0000-0000000000d2','fb000000-0000-0000-0000-0000000000d3');
grant select on _ids to authenticated;
select pg_temp.check((select count(*) = 3 and bool_and(ops is not null) from _ids), 'workers synced to operations');

-- ---- the Jazan supervisor reads her residents only, with today's status
select pg_temp.login('ad000000-0000-0000-0000-000000000031');
select pg_temp.check((select count(*) from list_housing_residents() where dorm = 'سكن اختبار 99k جازان') = 2,
  'supervisor sees the two Jazan residents');
select pg_temp.check(not exists (select 1 from list_housing_residents() where dorm = 'سكن اختبار 99k نجران'),
  'no Najran resident in her list');
select pg_temp.check((select status from list_housing_residents() where full_name = 'روزا ميندوزا') = 'medical',
  'no attendance yet → status from the worker profile');
select pg_temp.check((select status from list_housing_residents() where full_name = 'ميرا سوسانتي') = 'absent',
  'no attendance yet and available → absent');

-- scan by iqama: dorm comes from the worker file
select log_housing_scan('2433990001', 'in', 'رجعت من العمل');
select pg_temp.check((select status from list_housing_residents() where full_name = 'ميرا سوسانتي') = 'present',
  'entry scan by iqama → present today');
select pg_temp.rejects($$ select log_housing_scan('2433990003', 'in') $$, 'خارج نطاق فرعك', 'Najran worker is out of her scope');
select pg_temp.rejects($$ select log_housing_scan('NOPE-0', 'in') $$, 'لا توجد عاملة', 'unknown code');
-- manual status: dorm filled from the worker file
insert into housing_attendance (worker_id, date, status)
select ops, (now() at time zone 'Asia/Riyadh')::date, 'medical' from _ids where worker_id = 'fb000000-0000-0000-0000-0000000000d2'
on conflict (worker_id, date) do update set status = excluded.status;
-- lookup for the scan station
select pg_temp.check((select dorm = 'سكن اختبار 99k جازان' and branch = 'جازان' from find_worker_by_code('2433990002')),
  'lookup by iqama returns the worker with her dorm');
select pg_temp.check((select full_name = 'ميرا سوسانتي' from find_worker_by_code((select barcode from _ids where worker_id = 'fb000000-0000-0000-0000-0000000000d1'))),
  'lookup by barcode');
select pg_temp.check(not exists (select 1 from find_worker_by_code('NOPE-0')), 'unknown code → no row');
select pg_temp.rejects($$ select * from find_worker_by_code('2433990003') $$, 'خارج نطاق فرعك', 'lookup out of scope is explicit');
select pg_temp.logout();

select pg_temp.check((select dorm_id = 'd0000000-0000-0000-0000-0000000000b1' from housing_scans s join _ids i on i.ops = s.worker_id
                       where i.worker_id = 'fb000000-0000-0000-0000-0000000000d1' order by scanned_at desc limit 1),
  'scan dorm = dorm in the worker file');
select pg_temp.check((select dorm_id = 'd0000000-0000-0000-0000-0000000000b1' from housing_attendance a join _ids i on i.ops = a.worker_id
                       where i.worker_id = 'fb000000-0000-0000-0000-0000000000d2'), 'manual attendance gets the dorm');

-- ---- the branch manager (housing view only) reads but cannot record scans
select pg_temp.login('ad000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from list_housing_residents() where dorm like 'سكن اختبار 99k%') = 2, 'BM reads his branch residents');
select pg_temp.rejects($$ select log_housing_scan('2433990002', 'in') $$, 'لا تملك صلاحية', 'view-only role cannot record a scan');
select pg_temp.logout();
\echo 'OK 99k_housing_live'
