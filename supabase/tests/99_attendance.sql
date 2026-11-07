-- Tests for 0072 (attendance): method toggles + roles from config, QR token and
-- GPS radius checks, manual correction, closing a day, holidays, worker barcode presence.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-000000000002', 'hr5@test'),
  ('a5000000-0000-0000-0000-000000000004', 'sales5@test'),
  ('a5000000-0000-0000-0000-000000000007', 'housing5@test'),
  ('a5000000-0000-0000-0000-000000000008', 'nolink5@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a5000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a5000000-0000-0000-0000-000000000004', 'نورة العتيبي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('a5000000-0000-0000-0000-000000000007', 'منى الغامدي', 'housing_supervisor', 'b0000000-0000-0000-0000-00000000000a'),
  ('a5000000-0000-0000-0000-000000000008', 'زائر', 'sales', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into employees (id, full_name, branch_id, basic_salary, nationality, hire_date, user_id) values
  ('e5000000-0000-0000-0000-00000000000a', 'نورة العتيبي', 'b0000000-0000-0000-0000-00000000000a', 9000,
   'السعودية', '2024-01-10', 'a5000000-0000-0000-0000-000000000004'),
  ('e5000000-0000-0000-0000-00000000000b', 'ريم الزهراني', 'b0000000-0000-0000-0000-00000000000a', 6500,
   'السعودية', '2024-04-20', null)
on conflict (id) do nothing;
insert into leave_requests (employee_id, type, start_date, end_date, status)
values ('e5000000-0000-0000-0000-00000000000b', 'annual', '2026-11-03', '2026-11-04', 'approved');
insert into workers (id, full_name, branch_id, barcode, status) values
  ('c5000000-0000-0000-0000-00000000000a', 'ماريا سانتوس', 'b0000000-0000-0000-0000-00000000000a', 'W-5001', 'available'),
  ('c5000000-0000-0000-0000-00000000000b', 'سيتي نورهاليزا', 'b0000000-0000-0000-0000-00000000000a', 'W-5002', 'available')
on conflict (id) do nothing;
insert into housing_dorms (id, name, branch_id) values
  ('d5000000-0000-0000-0000-00000000000a', 'سكن نجران - أ', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;
-- the worker's last known dorm (log_housing_scan attaches it)
insert into housing_attendance (worker_id, dorm_id, date, status) values
  ('c5000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-00000000000a', '2026-11-01', 'absent');

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

-- ---------- branch location + QR: HR managers only ----------
select pg_temp.login('a5000000-0000-0000-0000-000000000004');
select pg_temp.rejects($$select set_branch_attendance('b0000000-0000-0000-0000-00000000000a', 17.5656, 44.2289)$$,
  'صلاحية', 'sales set a branch location');
select pg_temp.rejects($$select * from branch_attendance_settings()$$, 'غير مصرّح', 'sales read the branch QR tokens');
select pg_temp.logout();
select pg_temp.login('a5000000-0000-0000-0000-000000000002');
select set_branch_attendance('b0000000-0000-0000-0000-00000000000a', 17.565600, 44.228900);
select set_branch_attendance('b0000000-0000-0000-0000-00000000000b', 16.889359, 42.570567);
select pg_temp.logout();
create temp table tok as select city, attendance_token from branches
 where id in ('b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000b');
grant select on tok to authenticated;

-- ---------- self check-in ----------
select pg_temp.login('a5000000-0000-0000-0000-000000000008');
select pg_temp.rejects($$select attendance_check('gps', 17.5656, 44.2289)$$, 'غير مرتبط', 'an unlinked account checked in');
select pg_temp.logout();

select pg_temp.login('a5000000-0000-0000-0000-000000000004');
select pg_temp.rejects($$select attendance_check('gps', 17.6156, 44.2289)$$, 'على بُعد', 'check-in 5 km away accepted');
select pg_temp.rejects($$select attendance_check('qr', null, null, 'wrong-token')$$, 'غير صحيح', 'a wrong QR token accepted');
select pg_temp.rejects($$select attendance_check('qr', null, null, (select attendance_token from tok where city = 'جازان'))$$,
  'فرعك مختلف', 'another branch QR accepted');
select pg_temp.check((attendance_check('gps', 17.566000, 44.228900)->>'action') = 'in', 'GPS check-in within ~45 m');
select pg_temp.check((attendance_check('qr', null, null, (select attendance_token from tok where city = 'نجران'))->>'action') = 'out',
  'second scan = check-out (QR)');
select pg_temp.rejects($$select attendance_check('gps', 17.566000, 44.228900)$$, 'وانصرافك', 'a third check accepted');
select pg_temp.logout();
select pg_temp.check((select check_in_method = 'gps' and check_out_method = 'qr' and distance_m < 200
                        from attendance where employee_id = 'e5000000-0000-0000-0000-00000000000a'
                         and date = (now() at time zone 'Asia/Riyadh')::date), 'methods and distance recorded');

-- config switches are enforced by the server
update attendance_config set gps_enabled = false, qr_roles = array['admin','hr'] where id = 1;
delete from attendance where employee_id = 'e5000000-0000-0000-0000-00000000000a';
select pg_temp.login('a5000000-0000-0000-0000-000000000004');
select pg_temp.rejects($$select attendance_check('gps', 17.566, 44.2289)$$, 'غير مفعّل', 'GPS used while disabled');
select pg_temp.rejects($$select attendance_check('qr', null, null, (select attendance_token from tok where city = 'نجران'))$$,
  'دورك لا يسمح', 'a role outside qr_roles used QR');
select pg_temp.logout();
update attendance_config set gps_enabled = true,
  qr_roles = array['admin','operations_manager','branch_manager','sales','call_center','hr','accountant'] where id = 1;

-- ---------- manual correction ----------
select pg_temp.login('a5000000-0000-0000-0000-000000000004');
select pg_temp.rejects($$select manual_attendance('e5000000-0000-0000-0000-00000000000a', '2026-11-02', 'present', '08:00', '16:00', 'x')$$,
  'غير مسموح', 'sales edited attendance manually');
select pg_temp.logout();
select pg_temp.login('a5000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$select manual_attendance('e5000000-0000-0000-0000-00000000000a', '2026-11-02', 'present', '08:40', '16:00', '')$$,
  'سبب التعديل', 'manual edit without a note');
select pg_temp.rejects($$select manual_attendance('e5000000-0000-0000-0000-00000000000a', '2026-11-02', 'present', '16:00', '08:00', 'خطأ')$$,
  'قبل وقت الحضور', 'check-out before check-in');
select manual_attendance('e5000000-0000-0000-0000-00000000000a', '2026-11-02', 'present', '08:40', '16:00', 'نسيت التسجيل — تأكيد المدير');
select pg_temp.check((select status = 'late' and late_minutes = 25 from attendance
                       where employee_id = 'e5000000-0000-0000-0000-00000000000a' and date = '2026-11-02'),
  '08:40 vs 08:00 + 15 grace = 25 minutes late');

-- ---------- close a day / holidays / weekends ----------
select pg_temp.check(not is_workday('2026-11-06'), 'Friday is not a workday');
select pg_temp.check(not is_workday('2026-09-23'), 'National Day is a holiday');
select pg_temp.check(is_workday('2026-11-03'), 'a Tuesday is a workday');
select pg_temp.check((close_attendance_day('2026-11-06')->>'workday')::boolean = false, 'closing a Friday changes nothing');
select close_attendance_day('2026-11-03');
select pg_temp.rejects($$select close_attendance_day((now() at time zone 'Asia/Riyadh')::date)$$, 'بعد انتهائه', 'closed today early');
select pg_temp.check((select status from attendance where employee_id = 'e5000000-0000-0000-0000-00000000000a' and date = '2026-11-03') = 'absent',
  'no record on a workday → absent');
select pg_temp.check((select status from attendance where employee_id = 'e5000000-0000-0000-0000-00000000000b' and date = '2026-11-03') = 'leave',
  'on approved leave → leave, not absent');
select pg_temp.check((calculate_payslip('e5000000-0000-0000-0000-00000000000a', '2026-11')->>'absent_days')::int >= 1
                     and (calculate_payslip('e5000000-0000-0000-0000-00000000000a', '2026-11')->>'late_minutes')::numeric >= 25,
  'payroll sees the absence and the recorded late minutes');
select pg_temp.logout();

-- ---------- workers: presence by barcode (housing supervisor) ----------
select pg_temp.login('a5000000-0000-0000-0000-000000000007');
select pg_temp.rejects($$insert into housing_attendance (worker_id, dorm_id, date, status)
  values ('c5000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-00000000000a', (now() at time zone 'Asia/Riyadh')::date, 'present')$$,
  'بمسح باركودها', 'worker marked present without a scan');
insert into housing_attendance (worker_id, dorm_id, date, status)
values ('c5000000-0000-0000-0000-00000000000b', 'd5000000-0000-0000-0000-00000000000a', (now() at time zone 'Asia/Riyadh')::date, 'medical');
select log_housing_scan('W-5001', 'in');
select pg_temp.logout();
select pg_temp.check((select status from housing_attendance where worker_id = 'c5000000-0000-0000-0000-00000000000a'
                       and date = (now() at time zone 'Asia/Riyadh')::date) = 'present', 'barcode entry scan = present');
select pg_temp.check((select status from housing_attendance where worker_id = 'c5000000-0000-0000-0000-00000000000b'
                       and date = (now() at time zone 'Asia/Riyadh')::date) = 'medical', 'other statuses stay manual');
update attendance_config set worker_barcode_required = false where id = 1;
select pg_temp.login('a5000000-0000-0000-0000-000000000007');
update housing_attendance set status = 'present' where worker_id = 'c5000000-0000-0000-0000-00000000000b';
select pg_temp.logout();
select pg_temp.check((select status from housing_attendance where worker_id = 'c5000000-0000-0000-0000-00000000000b'
                       and date = (now() at time zone 'Asia/Riyadh')::date) = 'present', 'switch off → manual presence allowed');
update attendance_config set worker_barcode_required = true where id = 1;
select pg_temp.check(exists (select 1 from audit_log where table_name = 'attendance_config'), 'config changes audited');
