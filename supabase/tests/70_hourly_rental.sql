-- Phase 4: hourly rental — hours rules, branch pricing, conflict-free bookings,
-- check-in/out, quote → contract → booking, the public order RPCs.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

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
create or replace function pg_temp.fails(p_sql text, p_expect text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: %', p_msg;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if p_expect is not null and position(p_expect in sqlerrm) = 0 then
    raise exception 'FAIL: % (got: %)', p_msg, sqlerrm;
  end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

create temp table t_w as
  select (select id from worker_profiles where full_name = 'ماريا سانتوس') as w1,
         (select id from worker_profiles where full_name = 'غريس ريّس') as w2,
         (current_date + 2) as d;
grant select on t_w to authenticated;

create or replace function pg_temp.book(p_worker uuid, p_start text, p_end text, p_name text default 'جواهر آل منصور')
returns worker_bookings language sql as $$
  select book_hourly(jsonb_build_object(
    'worker_profile_id', p_worker, 'booking_date', (select d from t_w), 'start_time', p_start, 'end_time', p_end,
    'profession', 'تنظيف', 'customer_name', p_name, 'customer_phone', '0554000001', 'address', 'نجران — حي الفيصلية'))
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- Najran branch manager books ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select pg_temp.book((select w1 from t_w), '09:00', '13:00');
select pg_temp.check((
  select count(*) from worker_bookings b
    join contracts c on c.id = b.contract_id and c.service_code = 'hourly_rental' and c.status = 'draft'
    join service_requests r on r.id = b.request_id and r.contract_id = c.id
   where b.worker_profile_id = (select w1 from t_w) and b.hours = 4 and b.hourly_rate = 40
     and b.base_amount = 160 and c.base_amount = 160 and b.vat_amount = 24
     and b.branch_id = 'b0000000-0000-0000-0000-00000000000a') = 1,
  '4 hours × 40 = 160 + VAT; booking, draft contract and order linked');

select pg_temp.fails($$select pg_temp.book((select w1 from t_w), '12:00', '16:00')$$, 'محجوزة', 'overlapping booking accepted');
select pg_temp.fails($$select pg_temp.book((select w1 from t_w), '13:00', '17:00')$$, 'محجوزة', 'booking inside the 30-minute buffer accepted');
select pg_temp.book((select w1 from t_w), '13:30', '17:30', 'نوال اليامي');
select pg_temp.book((select w2 from t_w), '09:00', '13:00', 'عبير الحارثي');  -- another worker, same time
select pg_temp.fails($$select pg_temp.book((select w2 from t_w), '14:00', '17:00')$$, 'الحد الأدنى', '3 hours accepted');
select pg_temp.fails($$select pg_temp.book((select w2 from t_w), '08:00', '21:00')$$, 'الحد الأقصى', '13 hours accepted');
select pg_temp.fails($$select pg_temp.book((select w2 from t_w), '14:00', '18:15')$$, 'مضاعفات', '4h15 accepted with 30-minute slots');
select pg_temp.fails($$select pg_temp.book((select w2 from t_w), '18:00', '17:00')$$, 'بعد ساعة الوصول', 'end before start accepted');
select pg_temp.fails($$insert into worker_bookings (worker_profile_id, booking_date, start_at, end_at, hours, period)
                      values ((select w2 from t_w), current_date, now(), now() + interval '4 hours', 4, tstzrange(now(), now()))$$,
                     null, 'a booking was written directly, bypassing book_hourly');
select pg_temp.logout();

-- ---------- branch-specific price ----------
insert into pricing_rules (service_code, profession, base_price, min_price, duration_unit, branch_id, is_active)
values ('hourly_rental', 'تنظيف', 38, 34, 'hour', 'b0000000-0000-0000-0000-00000000000a', true);
select pg_temp.check((calc_price('hourly_rental', '{"profession":"تنظيف","quantity":4,"branch_id":"b0000000-0000-0000-0000-00000000000a"}'))->>'base' = '152.00',
  'Najran rate (38/h) preferred over the general rate');
select pg_temp.check((calc_price('hourly_rental', '{"profession":"تنظيف","quantity":4,"branch_id":"b0000000-0000-0000-0000-00000000000b"}'))->>'base' = '160.00',
  'other branches keep the general rate');
select pg_temp.check((calc_price('daily_rental', '{"profession":"تنظيف","quantity":1}'))->>'base'::text <> '0',
  'daily rental pricing untouched');

-- ---------- scope ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from worker_bookings) = 0, 'Jazan BM sees no Najran bookings');
select pg_temp.check((select count(*) from worker_busy_slots((select d from t_w))
                      where worker_profile_id = (select w1 from t_w)) = 2,
  'but the booking form knows the worker is busy (times only, no customer data)');
do $$
declare v uuid := (select id from worker_bookings order by created_at limit 1);
begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', false);
  set local role authenticated;
  begin
    perform set_booking_status(v, 'cancelled');
    raise exception 'FAIL: Jazan BM cancelled a Najran booking';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
reset role;

-- ---------- check-in / check-out / cancel frees the slot ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select set_booking_status((select id from worker_bookings where customer_name = 'جواهر آل منصور'), 'in_progress');
select set_booking_status((select id from worker_bookings where customer_name = 'جواهر آل منصور'), 'completed');
select pg_temp.check((select count(*) from worker_bookings b join service_requests r on r.id = b.request_id
                      where b.customer_name = 'جواهر آل منصور' and b.status = 'completed'
                        and b.actual_start_at is not null and b.actual_end_at is not null and r.status = 'completed') = 1,
  'start and end of service recorded; the order follows');
select pg_temp.fails($$select set_booking_status((select id from worker_bookings where customer_name = 'جواهر آل منصور'), 'in_progress')$$,
                     'لا يمكن نقل', 'a completed booking was restarted');
select set_booking_status((select id from worker_bookings where customer_name = 'عبير الحارثي'), 'cancelled');
select pg_temp.book((select w2 from t_w), '10:00', '14:00', 'سارة آل خليفة');   -- the cancelled slot is free again
select pg_temp.logout();

-- ---------- hourly quote → contract → booking ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
select create_quote_from_price('hourly_rental', '{"profession":"طبخ"}'::jsonb,
  'منى آل عباس', '0554000002', current_date + 5, null, null, null,
  jsonb_build_object('lead_id', 'e0000000-0000-0000-0000-000000000010',
                     'worker_profile_id', (select w1 from t_w), 'worker_name', 'ماريا سانتوس',
                     'start_date', (select d + 1 from t_w)::text, 'start_time', '16:00', 'end_time', '21:00'));
select pg_temp.check((select quantity = 1 and duration_count = 5 and duration_unit = 'hour' and base_amount = 250
                        and start_time = '16:00' and end_date = start_date from quotes where customer_name = 'منى آل عباس'),
  'hourly quote: 5 hours from the times, priced 5 × 50');
select set_quote_status((select id from quotes where customer_name = 'منى آل عباس'), 'sent');
select set_quote_status((select id from quotes where customer_name = 'منى آل عباس'), 'accepted');
select convert_quote_to_contract((select id from quotes where customer_name = 'منى آل عباس'));
select pg_temp.check((select count(*) from worker_bookings b join quotes q on q.id = b.quote_id and q.contract_id = b.contract_id
                      where q.customer_name = 'منى آل عباس' and b.hours = 5 and b.base_amount = q.base_amount) = 1,
  'converting the hourly quote booked the worker at the quoted price');
select pg_temp.logout();

-- ---------- public website order (anon) ----------
set role anon;
select pg_temp.check((select created from submit_service_request('tok-abcdef-1', jsonb_build_object(
  'service_code', 'hourly_rental', 'customer_name', 'لطيفة الشهراني', 'customer_phone', '0554000003',
  'customer_city', 'جازان', 'profession', 'رعاية',
  'details', jsonb_build_object('start_date', (current_date + 4)::text, 'start_time', '08:00', 'end_time', '14:00')))) = true,
  'website order created');
select pg_temp.check((select created from submit_service_request('tok-abcdef-1', '{}'::jsonb)) = false,
  'the same submission returns the same order (idempotent)');
select pg_temp.check((select status from track_service_request(
  (select request_no from submit_service_request('tok-abcdef-1', '{}'::jsonb)))) = 'new', 'order can be tracked');
reset role;
select pg_temp.check((select count(*) from service_requests where customer_phone = '0554000003'
                      and branch_id = 'b0000000-0000-0000-0000-00000000000b' and base_amount = 330) = 1,
  'website order priced by the server (6h × 55) and routed to Jazan');

select 'hourly rental: all checks passed' as result;
