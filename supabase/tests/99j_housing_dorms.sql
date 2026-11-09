-- Tests for 0081: housing units — manage permission, supervisor, capacity, occupancy.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000001', 'ops13@test'),
  ('ad000000-0000-0000-0000-000000000003', 'bmj13@test'),
  ('ad000000-0000-0000-0000-000000000021', 'supj14@test'),
  ('ad000000-0000-0000-0000-000000000022', 'supn14@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000001', 'فهد الشهري', 'operations_manager', null),
  ('ad000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('ad000000-0000-0000-0000-000000000021', 'منى الغامدي', 'housing_supervisor', 'b0000000-0000-0000-0000-00000000000b'),
  ('ad000000-0000-0000-0000-000000000022', 'هيفاء القحطاني', 'housing_supervisor', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
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

-- ---- the Jazan branch manager creates a dorm in his branch only
select pg_temp.login('ad000000-0000-0000-0000-000000000003');
insert into housing_dorms (id, name, branch_id, capacity, supervisor_id) values
  ('d0000000-0000-0000-0000-0000000000a1', 'سكن اختبار جازان', 'b0000000-0000-0000-0000-00000000000b', 2,
   'ad000000-0000-0000-0000-000000000021');
select pg_temp.rejects($$ insert into housing_dorms (name, branch_id) values ('سكن اختبار خارج النطاق', 'b0000000-0000-0000-0000-00000000000a') $$,
  'row-level security', 'BM cannot create a dorm in another branch');
select pg_temp.rejects($$ update housing_dorms set supervisor_id = 'ad000000-0000-0000-0000-000000000022' where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'مشرفة السكن', 'a supervisor from another branch is refused');
select pg_temp.rejects($$ update housing_dorms set supervisor_id = 'ad000000-0000-0000-0000-000000000003' where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'مشرفة السكن', 'a non-supervisor user is refused');
select pg_temp.rejects($$ insert into housing_dorms (name, branch_id) values (' سكن اختبار جازان ', 'b0000000-0000-0000-0000-00000000000b') $$,
  'duplicate', 'dorm names are unique');
select pg_temp.check((select count(*) = 1 from list_housing_supervisors()), 'BM sees only his branch supervisors');
select pg_temp.logout();

-- ---- the supervisor sees her dorm but cannot manage it
select pg_temp.login('ad000000-0000-0000-0000-000000000021');
select pg_temp.check((select supervisor = 'منى الغامدي' and occupied = 0 from list_housing_dorms()
                        where id = 'd0000000-0000-0000-0000-0000000000a1'), 'supervisor reads her dorm with occupancy');
update housing_dorms set capacity = 50 where id = 'd0000000-0000-0000-0000-0000000000a1';
select pg_temp.logout();
select pg_temp.check((select capacity = 2 from housing_dorms where id = 'd0000000-0000-0000-0000-0000000000a1'),
  'supervisor update is silently filtered by RLS (no manage)');

-- ---- capacity + branch guard on housing a worker
insert into worker_profiles (id, full_name, nationality, profession, monthly_salary, branch_id) values
  ('fb000000-0000-0000-0000-0000000000c1', 'ديوي أنغرايني', 'إندونيسيا', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000b'),
  ('fb000000-0000-0000-0000-0000000000c2', 'سيتي نورهاليزا', 'إندونيسيا', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000b'),
  ('fb000000-0000-0000-0000-0000000000c3', 'نيلوكا فرناندو', 'سريلانكا', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000b'),
  ('fb000000-0000-0000-0000-0000000000c4', 'ماريا سانتوس', 'الفلبين', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;
update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000a1'
 where worker_id in ('fb000000-0000-0000-0000-0000000000c1', 'fb000000-0000-0000-0000-0000000000c2');
select pg_temp.check(dorm_occupied('d0000000-0000-0000-0000-0000000000a1') = 2, 'occupancy computed from residents');
select pg_temp.rejects($$ update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000a1' where worker_id = 'fb000000-0000-0000-0000-0000000000c3' $$,
  'ممتلئ', 'a full dorm takes no more workers');
select pg_temp.rejects($$ update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000a1' where worker_id = 'fb000000-0000-0000-0000-0000000000c4' $$,
  'من فرع آخر', 'a worker from another branch is refused');

-- ---- the operations manager manages every branch; deactivation and capacity rules
select pg_temp.login('ad000000-0000-0000-0000-000000000001');
select pg_temp.rejects($$ update housing_dorms set capacity = 1 where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'أقل من عدد المقيمات', 'capacity below residents refused');
select pg_temp.rejects($$ update housing_dorms set is_active = false where id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'انقل العاملات', 'a dorm with residents cannot be deactivated');
update housing_dorms set capacity = 3, notes = 'توسعة' where id = 'd0000000-0000-0000-0000-0000000000a1';
insert into housing_dorms (id, name, branch_id, capacity) values
  ('d0000000-0000-0000-0000-0000000000a2', 'سكن اختبار نجران', 'b0000000-0000-0000-0000-00000000000a', 4);
update housing_dorms set is_active = false where id = 'd0000000-0000-0000-0000-0000000000a2';
select pg_temp.check((select count(*) >= 2 from list_housing_dorms()), 'ops manager sees all branches');
delete from housing_dorms where id = 'd0000000-0000-0000-0000-0000000000a2';  -- no delete policy: filtered
select pg_temp.logout();
select pg_temp.check(exists (select 1 from housing_dorms where id = 'd0000000-0000-0000-0000-0000000000a2'), 'dorm still exists after delete attempt');
select pg_temp.rejects($$ update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000a2' where worker_id = 'fb000000-0000-0000-0000-0000000000c4' $$,
  'معطّل', 'an inactive dorm takes no workers');
update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000a1' where worker_id = 'fb000000-0000-0000-0000-0000000000c3';
select pg_temp.check(dorm_occupied('d0000000-0000-0000-0000-0000000000a1') = 3, 'after expansion a third worker fits');
select pg_temp.check((select count(*) >= 3 from audit_log where table_name = 'housing_dorms'), 'dorm changes are audited');
\echo 'OK 99j_housing_dorms'
