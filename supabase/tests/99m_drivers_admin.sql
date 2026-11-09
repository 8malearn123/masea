-- Tests for 0084: drivers administration — orders.manage, status rules, account link.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000003', 'bmj13@test'),
  ('ad000000-0000-0000-0000-000000000051', 'drvj17@test'),
  ('ad000000-0000-0000-0000-000000000052', 'drvn17@test'),
  ('ad000000-0000-0000-0000-000000000053', 'sales17@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('ad000000-0000-0000-0000-000000000051', 'ياسر الحازمي', 'driver', 'b0000000-0000-0000-0000-00000000000b'),
  ('ad000000-0000-0000-0000-000000000052', 'ماجد الحربي', 'driver', 'b0000000-0000-0000-0000-00000000000a'),
  ('ad000000-0000-0000-0000-000000000053', 'نورة العتيبي', 'sales', 'b0000000-0000-0000-0000-00000000000b')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into service_requests (id, request_no, service_code, branch_id, customer_name, status)
values ('5e000000-0000-0000-0000-000000000041', 'REQ-T17-01', (select code from services limit 1),
        'b0000000-0000-0000-0000-00000000000b', 'عميل اختبار', 'paid')
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

-- ---- the Jazan BM adds a driver in his branch and links the driver account
select pg_temp.login('ad000000-0000-0000-0000-000000000003');
insert into drivers (id, full_name, phone, branch_id, vehicle_no, user_id) values
  ('dd000000-0000-0000-0000-0000000000d1', ' ياسر الحازمي ', '0551234567', 'b0000000-0000-0000-0000-00000000000b', ' jzn-4521 ',
   'ad000000-0000-0000-0000-000000000051');
select pg_temp.check((select full_name = 'ياسر الحازمي' and vehicle_no = 'JZN-4521' and status = 'available'
                        from drivers where id = 'dd000000-0000-0000-0000-0000000000d1'), 'driver saved, fields normalised');
select pg_temp.rejects($$ insert into drivers (full_name, branch_id) values ('سائق خارج النطاق', 'b0000000-0000-0000-0000-00000000000a') $$,
  'row-level security', 'BM cannot add a driver to another branch');
select pg_temp.rejects($$ insert into drivers (full_name, branch_id, phone) values ('سائق', 'b0000000-0000-0000-0000-00000000000b', '12345') $$,
  'drivers_phone_chk', 'phone format');
select pg_temp.rejects($$ insert into drivers (full_name, branch_id, status) values ('سائق', 'b0000000-0000-0000-0000-00000000000b', 'on_route') $$,
  'آليًا', 'on_route is automatic');
select pg_temp.rejects($$ insert into drivers (full_name, branch_id, user_id) values ('سائق', 'b0000000-0000-0000-0000-00000000000b', 'ad000000-0000-0000-0000-000000000053') $$,
  'بدور «سائق»', 'only a driver account can be linked');
select pg_temp.rejects($$ insert into drivers (full_name, branch_id, user_id) values ('سائق', 'b0000000-0000-0000-0000-00000000000b', 'ad000000-0000-0000-0000-000000000051') $$,
  'duplicate', 'an account links to one driver only');
select pg_temp.check((select driver_id = 'dd000000-0000-0000-0000-0000000000d1' from list_driver_accounts()
                       where id = 'ad000000-0000-0000-0000-000000000051'), 'accounts list shows the link');
select pg_temp.check(not exists (select 1 from list_driver_accounts() where id = 'ad000000-0000-0000-0000-000000000052'),
  'Najran driver account outside the BM scope');

-- busy driver: status / branch / deactivation follow the orders
select assign_order_driver('5e000000-0000-0000-0000-000000000041', 'dd000000-0000-0000-0000-0000000000d1');
select pg_temp.rejects($$ update drivers set status = 'off_duty' where id = 'dd000000-0000-0000-0000-0000000000d1' $$,
  'في مهمة', 'no manual status change while on a trip');
select pg_temp.rejects($$ update drivers set is_active = false where id = 'dd000000-0000-0000-0000-0000000000d1' $$,
  'في مهمة', 'no deactivation while on a trip');
select set_order_status('5e000000-0000-0000-0000-000000000041', 'cancelled');
select pg_temp.check((select status = 'available' from drivers where id = 'dd000000-0000-0000-0000-0000000000d1'), 'released after the order');
update drivers set status = 'off_duty' where id = 'dd000000-0000-0000-0000-0000000000d1';
select pg_temp.rejects($$ update drivers set status = 'on_route' where id = 'dd000000-0000-0000-0000-0000000000d1' $$,
  'آليًا', 'on_route cannot be set by hand');
update drivers set is_active = false, status = 'available' where id = 'dd000000-0000-0000-0000-0000000000d1';
select pg_temp.check((select status = 'off_duty' and not is_active from drivers where id = 'dd000000-0000-0000-0000-0000000000d1'),
  'a deactivated driver is off duty');
delete from drivers where id = 'dd000000-0000-0000-0000-0000000000d1';
select pg_temp.logout();
select pg_temp.check(exists (select 1 from drivers where id = 'dd000000-0000-0000-0000-0000000000d1'), 'no hard delete');

-- ---- sales (orders.edit) cannot manage drivers
select pg_temp.login('ad000000-0000-0000-0000-000000000053');
select pg_temp.rejects($$ insert into drivers (full_name, branch_id) values ('سائق', 'b0000000-0000-0000-0000-00000000000b') $$,
  'row-level security', 'sales cannot add drivers');
update drivers set vehicle_no = 'HACK' where id = 'dd000000-0000-0000-0000-0000000000d1';
select pg_temp.logout();
select pg_temp.check((select vehicle_no = 'JZN-4521' from drivers where id = 'dd000000-0000-0000-0000-0000000000d1'), 'sales update filtered');
select pg_temp.check((select count(*) >= 3 from audit_log where table_name = 'drivers'), 'driver changes audited');
\echo 'OK 99m_drivers_admin'
