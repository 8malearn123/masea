-- Tests for 0083: housing targets — assignment by housing.manage, computed achievement.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000003', 'bmj13@test'),
  ('ad000000-0000-0000-0000-000000000041', 'supj16@test'),
  ('ad000000-0000-0000-0000-000000000042', 'supn16@test'),
  ('ad000000-0000-0000-0000-000000000043', 'acc16@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('ad000000-0000-0000-0000-000000000041', 'نوال العسيري', 'housing_supervisor', 'b0000000-0000-0000-0000-00000000000b'),
  ('ad000000-0000-0000-0000-000000000042', 'هيفاء القحطاني', 'housing_supervisor', 'b0000000-0000-0000-0000-00000000000a'),
  ('ad000000-0000-0000-0000-000000000043', 'بدر المالكي', 'accountant', null)
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into housing_dorms (id, name, branch_id, capacity, supervisor_id) values
  ('d0000000-0000-0000-0000-0000000000c1', 'سكن اختبار 99l جازان', 'b0000000-0000-0000-0000-00000000000b', 4,
   'ad000000-0000-0000-0000-000000000041')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, monthly_salary, branch_id) values
  ('fb000000-0000-0000-0000-0000000000e1', 'سري واهيوني', 'إندونيسيا', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000b'),
  ('fb000000-0000-0000-0000-0000000000e2', 'جوسلين رييس', 'الفلبين', 'عاملة منزلية', 1500, 'b0000000-0000-0000-0000-00000000000b')
on conflict (id) do nothing;
update worker_details set dorm_id = 'd0000000-0000-0000-0000-0000000000c1'
 where worker_id in ('fb000000-0000-0000-0000-0000000000e1', 'fb000000-0000-0000-0000-0000000000e2');
-- this month: 3 records, 2 committed (present + on_service), 1 absent
insert into housing_attendance (worker_id, dorm_id, date, status)
select d.ops_worker_id, 'd0000000-0000-0000-0000-0000000000c1', x.dt, x.st::housing_status
  from (values ('fb000000-0000-0000-0000-0000000000e1', date_trunc('month', now())::date, 'present'),
               ('fb000000-0000-0000-0000-0000000000e1', date_trunc('month', now())::date + 1, 'absent'),
               ('fb000000-0000-0000-0000-0000000000e2', date_trunc('month', now())::date, 'on_service')) x(w, dt, st)
  join worker_details d on d.worker_id = x.w::uuid
on conflict (worker_id, date) do nothing;
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

create temp table _m as select extract(year from now())::int as y, extract(month from now())::int as m;
grant select on _m to authenticated;

-- ---- the Jazan BM assigns a target to his branch supervisor only
select pg_temp.login('ad000000-0000-0000-0000-000000000003');
insert into housing_targets (id, supervisor_id, month, year, occupancy_target_pct, attendance_target_pct, notes)
select 'aa000000-0000-0000-0000-0000000000c1', 'ad000000-0000-0000-0000-000000000041', m, y, 80, 90, 'تحسين حضور المساء' from _m;
select pg_temp.check((select branch_id = 'b0000000-0000-0000-0000-00000000000b' from housing_targets
                       where id = 'aa000000-0000-0000-0000-0000000000c1'), 'branch filled from the supervisor');
select pg_temp.rejects($$ insert into housing_targets (supervisor_id, month, year) select 'ad000000-0000-0000-0000-000000000042', m, y from _m $$,
  'row-level security', 'a Najran supervisor is outside the Jazan BM scope');
select pg_temp.rejects($$ insert into housing_targets (supervisor_id, month, year) select 'ad000000-0000-0000-0000-000000000003', m, y from _m $$,
  'مشرفة السكن', 'a target belongs to a housing supervisor');
select pg_temp.rejects($$ insert into housing_targets (supervisor_id, month, year) select 'ad000000-0000-0000-0000-000000000041', m, y from _m $$,
  'duplicate', 'one target per supervisor per month');
select pg_temp.rejects($$ update housing_targets set month = (month % 12) + 1 where id = 'aa000000-0000-0000-0000-0000000000c1' $$,
  'لا يُغيَّر', 'owner/month are fixed');
update housing_targets set attendance_target_pct = 95 where id = 'aa000000-0000-0000-0000-0000000000c1';
select pg_temp.logout();

-- ---- the accountant (is_admin before) can no longer write housing targets
select pg_temp.login('ad000000-0000-0000-0000-000000000043');
select pg_temp.rejects($$ insert into housing_targets (supervisor_id, month, year) select 'ad000000-0000-0000-0000-000000000042', m, y from _m $$,
  'row-level security', 'accountant cannot assign housing targets');
select pg_temp.logout();

-- ---- the supervisor reads her target with computed achievement, cannot edit it
select pg_temp.login('ad000000-0000-0000-0000-000000000041');
select pg_temp.check((select occupancy_actual_pct = 50 and attendance_actual_pct = 67 and attendance_target_pct = 95
                        from list_housing_targets((select y from _m), (select m from _m))
                       where id = 'aa000000-0000-0000-0000-0000000000c1'),
  'achievement computed: occupancy 2/4 = 50, attendance 2/3 = 67');
update housing_targets set occupancy_target_pct = 10 where id = 'aa000000-0000-0000-0000-0000000000c1';
select pg_temp.logout();
select pg_temp.check((select occupancy_target_pct = 80 from housing_targets where id = 'aa000000-0000-0000-0000-0000000000c1'),
  'supervisor update filtered by RLS');

-- ---- deactivate (soft delete) + audit
select pg_temp.login('ad000000-0000-0000-0000-000000000003');
update housing_targets set is_active = false where id = 'aa000000-0000-0000-0000-0000000000c1';
delete from housing_targets where id = 'aa000000-0000-0000-0000-0000000000c1';
select pg_temp.logout();
select pg_temp.check((select not is_active from housing_targets where id = 'aa000000-0000-0000-0000-0000000000c1'),
  'deactivated, not deleted');
select pg_temp.check((select count(*) >= 3 from audit_log where table_name = 'housing_targets'), 'target changes audited');
\echo 'OK 99l_housing_targets'
