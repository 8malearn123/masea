-- Tests for 0080: order assignment and status rules enforced on the server.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000001', 'ops13@test'),
  ('ad000000-0000-0000-0000-000000000003', 'bmj13@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000001', 'فهد الشهري', 'operations_manager', null),
  ('ad000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into drivers (id, full_name, branch_id, status) values
  ('dd000000-0000-0000-0000-00000000000a', 'عبدالرحمن الفيفي', 'b0000000-0000-0000-0000-00000000000a', 'available'),
  ('dd000000-0000-0000-0000-00000000000b', 'سلطان آل سعيد', 'b0000000-0000-0000-0000-00000000000b', 'available'),
  ('dd000000-0000-0000-0000-00000000000c', 'ناصر القرني', 'b0000000-0000-0000-0000-00000000000a', 'off_duty')
on conflict (id) do nothing;
insert into service_requests (id, request_no, service_code, branch_id, customer_name, status)
select x.id::uuid, x.no, (select code from services limit 1), x.b::uuid, 'عميل اختبار', x.st
  from (values ('5e000000-0000-0000-0000-000000000001', 'REQ-T13-01', 'b0000000-0000-0000-0000-00000000000a', 'paid'),
               ('5e000000-0000-0000-0000-000000000002', 'REQ-T13-02', 'b0000000-0000-0000-0000-00000000000a', 'new'),
               ('5e000000-0000-0000-0000-000000000003', 'REQ-T13-03', 'b0000000-0000-0000-0000-00000000000a', 'completed'),
               ('5e000000-0000-0000-0000-000000000004', 'REQ-T13-04', 'b0000000-0000-0000-0000-00000000000b', 'paid')) x(id, no, b, st)
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

select pg_temp.login('ad000000-0000-0000-0000-000000000001');
-- assignment rules
select pg_temp.rejects($$ select assign_order_driver('5e000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000b') $$,
  'فرع آخر', 'a Jazan driver cannot take a Najran order');
select pg_temp.rejects($$ select assign_order_driver('5e000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000c') $$,
  'غير متاح', 'an off-duty driver cannot be assigned');
select pg_temp.rejects($$ select assign_order_driver('5e000000-0000-0000-0000-000000000003', 'dd000000-0000-0000-0000-00000000000a') $$,
  'مكتمل', 'a completed order cannot be assigned');
select assign_order_driver('5e000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-00000000000a');
select pg_temp.check((select status = 'assigned' from service_requests where id = '5e000000-0000-0000-0000-000000000001'), 'assigned');
select pg_temp.check((select status = 'on_route' from drivers where id = 'dd000000-0000-0000-0000-00000000000a'), 'driver on route');
select pg_temp.rejects($$ select assign_order_driver('5e000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-00000000000a') $$,
  'غير متاح', 'a busy driver cannot take a second order');

-- status rules
select pg_temp.rejects($$ select set_order_status('5e000000-0000-0000-0000-000000000002', 'completed') $$,
  'لا يمكن نقل', 'new → completed is not a valid step');
select pg_temp.rejects($$ select set_order_status('5e000000-0000-0000-0000-000000000002', 'assigned') $$,
  'دون سائق', 'assigned needs a driver');
select pg_temp.rejects($$ select set_order_status('5e000000-0000-0000-0000-000000000003', 'cancelled') $$,
  'مكتمل', 'completed is final');
select set_order_status('5e000000-0000-0000-0000-000000000001', 'in_progress');
update service_requests set trip_stage = 'delivered' where id = '5e000000-0000-0000-0000-000000000001';
select pg_temp.rejects($$ select set_order_status('5e000000-0000-0000-0000-000000000001', 'completed') $$,
  'الرحلة لم تنتهِ', 'cannot complete mid-trip');
select set_order_status('5e000000-0000-0000-0000-000000000001', 'cancelled');
select pg_temp.check((select status = 'available' from drivers where id = 'dd000000-0000-0000-0000-00000000000a'),
  'driver released when his last active order ends');
select pg_temp.logout();

-- branch scope
select pg_temp.login('ad000000-0000-0000-0000-000000000003');
select pg_temp.rejects($$ select set_order_status('5e000000-0000-0000-0000-000000000002', 'cancelled') $$,
  'خارج نطاق فرعك', 'Jazan BM cannot touch a Najran order');
select assign_order_driver('5e000000-0000-0000-0000-000000000004', 'dd000000-0000-0000-0000-00000000000b');
select pg_temp.logout();

-- legacy 'processing' from hourly bookings is normalised
update service_requests set status = 'processing' where id = '5e000000-0000-0000-0000-000000000004';
select pg_temp.check((select status from service_requests where id = '5e000000-0000-0000-0000-000000000004') = 'in_progress',
  'processing → in_progress');
-- the return scan (advance_trip_stage) completes the order directly: the trigger frees the driver
update service_requests set trip_stage = 'returned', status = 'completed'
 where id = '5e000000-0000-0000-0000-000000000004';
select pg_temp.check((select status = 'available' from drivers where id = 'dd000000-0000-0000-0000-00000000000b'),
  'driver released when the trip completes by scan');
\echo 'OK 99i_ops_rules'
