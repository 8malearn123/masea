-- =============================================================
-- Masiat Alsharq ERP — 0072 Attendance (المرحلة د)
-- يُبنى فوق attendance / shifts (0004) و housing_attendance / housing_scans /
-- log_housing_scan (0006/0039) و hr_in_scope (0068):
--   1) attendance_config: طرق التسجيل (باركود QR / موقع GPS / يدوي) — تفعيل كل طريقة
--      والأدوار المسموح لها، نصف قطر الموقع، أيام العمل، واشتراط الباركود لحضور العاملات.
--      كلها تُدار من الإعدادات — لا شيء ثابت في الكود.
--   2) موقع كل فرع + رمز QR خاص به (يُطبع عند المدخل ويمكن تجديده).
--   3) attendance_check(): الموظف يسجّل حضوره/انصرافه بنفسه — يتحقق الخادم من الطريقة
--      والدور والرمز أو المسافة، ويحسب التأخير من بداية الوردية + السماح.
--   4) manual_attendance(): تصحيح يدوي بملاحظة إلزامية ضمن النطاق (مُدقَّق).
--   5) close_attendance_day(): من لم يسجّل في يوم عمل = غائب، إلا من في إجازة أو عطلة.
--   6) public_holidays: العطل الرسمية تُدار من الإعدادات.
--   7) العاملات: مشرفة السكن تحضّرهن بمسح الباركود — المسح «دخول» يسجّل الحضور،
--      و«حاضرة» لا تُسجَّل يدوياً بدون مسح (إن كان الإعداد مفعّلاً).
-- =============================================================

-- ---------- 1) configuration ---------------------------------------------------
create table if not exists attendance_config (
  id                      integer primary key default 1 check (id = 1),
  qr_enabled              boolean not null default true,
  qr_roles                text[]  not null default array['admin','operations_manager','branch_manager','sales','call_center','hr','accountant'],
  gps_enabled             boolean not null default true,
  gps_roles               text[]  not null default array['admin','operations_manager','branch_manager','sales','call_center','hr','accountant'],
  gps_radius_m            integer not null default 200 check (gps_radius_m between 20 and 5000),
  manual_enabled          boolean not null default true,
  manual_roles            text[]  not null default array['admin','hr'],
  worker_barcode_required boolean not null default true,
  workdays                integer[] not null default array[0,1,2,3,4], -- الأحد..الخميس (0 = الأحد)
  updated_at              timestamptz not null default now()
);
insert into attendance_config (id) values (1) on conflict (id) do nothing;
alter table attendance_config enable row level security;
drop policy if exists attcfg_read on attendance_config;
create policy attcfg_read on attendance_config for select to authenticated using (true);
drop policy if exists attcfg_write on attendance_config;
create policy attcfg_write on attendance_config for update to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

-- ---------- 2) branch location + QR token -------------------------------------
alter table branches
  add column if not exists latitude         numeric(9,6),
  add column if not exists longitude        numeric(9,6),
  add column if not exists attendance_token text;
update branches set attendance_token = replace(gen_random_uuid()::text, '-', '')
 where attendance_token is null;
alter table branches alter column attendance_token set default replace(gen_random_uuid()::text, '-', '');
update branches set latitude = v.lat, longitude = v.lng
  from (values ('نجران', 17.565604, 44.228944), ('جازان', 16.889359, 42.570567),
               ('شرورة', 17.466944, 47.106667), ('حبونا', 17.851944, 44.026944)) as v(city, lat, lng)
 where branches.city = v.city and branches.latitude is null;

-- HR managers rotate a branch QR and set its location (nothing else on branches)
create or replace function set_branch_attendance(p_branch_id uuid, p_lat numeric, p_lng numeric, p_rotate boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not has_perm('hr','manage') then
    raise exception 'إعداد مواقع الفروع من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    raise exception 'إحداثيات غير صحيحة';
  end if;
  update branches set latitude = p_lat, longitude = p_lng,
         attendance_token = case when p_rotate then replace(gen_random_uuid()::text, '-', '') else attendance_token end
   where id = p_branch_id
   returning attendance_token into v_token;
  if not found then raise exception 'الفرع غير موجود'; end if;
  return v_token;
end $$;

-- the token is shown only to HR managers (it is printed at the branch door)
create or replace function branch_attendance_settings()
returns table (id uuid, city text, latitude numeric, longitude numeric, attendance_token text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('hr','manage') then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  return query select b.id, b.city, b.latitude, b.longitude, b.attendance_token
                 from branches b where b.is_active order by b.city;
end $$;

-- ---------- 3) official holidays ---------------------------------------------
create table if not exists public_holidays (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text not null,
  from_date  date not null,
  to_date    date not null,
  is_active  boolean not null default true,
  check (to_date >= from_date)
);
insert into public_holidays (name_ar, from_date, to_date)
select * from (values
  ('يوم التأسيس', date '2026-02-22', date '2026-02-22'),
  ('عيد الفطر (تقديري — يُعدَّل حسب الإعلان الرسمي)', date '2026-03-19', date '2026-03-22'),
  ('عيد الأضحى (تقديري — يُعدَّل حسب الإعلان الرسمي)', date '2026-05-26', date '2026-05-29'),
  ('اليوم الوطني', date '2026-09-23', date '2026-09-23'),
  ('يوم التأسيس', date '2027-02-22', date '2027-02-22'),
  ('اليوم الوطني', date '2027-09-23', date '2027-09-23')
) v(name_ar, from_date, to_date)
where not exists (select 1 from public_holidays);
alter table public_holidays enable row level security;
drop policy if exists hol_read on public_holidays;
create policy hol_read on public_holidays for select to authenticated using (true);
drop policy if exists hol_write on public_holidays;
create policy hol_write on public_holidays for all to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

create or replace function is_workday(p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select extract(dow from p_date)::int = any(c.workdays) from attendance_config c where c.id = 1), false)
     and not exists (select 1 from public_holidays h where h.is_active and p_date between h.from_date and h.to_date)
$$;

-- ---------- 4) attendance detail ------------------------------------------------
alter table attendance
  add column if not exists check_in_method  text check (check_in_method  in ('qr','gps','manual')),
  add column if not exists check_out_method text check (check_out_method in ('qr','gps','manual')),
  add column if not exists check_in_lat     numeric(9,6),
  add column if not exists check_in_lng     numeric(9,6),
  add column if not exists distance_m       integer,
  add column if not exists late_minutes     integer,
  add column if not exists recorded_by      uuid references auth.users(id) on delete set null,
  add column if not exists note             text;

create or replace function distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns integer language sql immutable as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1) / 2)), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lng2 - lng1) / 2)), 2))))::integer
$$;

-- minutes late vs the employee's shift that day (shifts row) or the default start + grace
create or replace function attendance_late_minutes(p_employee_id uuid, p_at timestamptz)
returns integer language plpgsql stable security definer set search_path = public as $$
declare c payroll_config%rowtype; v_start time; v_local timestamp := p_at at time zone 'Asia/Riyadh';
begin
  select * into c from payroll_config where id = 1;
  select shift_start into v_start from shifts
   where employee_id = p_employee_id and date = v_local::date limit 1;
  v_start := coalesce(v_start, make_time(floor(c.shift_start_hour)::int,
                      round((c.shift_start_hour - floor(c.shift_start_hour)) * 60)::int, 0));
  return greatest(floor(extract(epoch from (v_local::time - v_start)) / 60) - c.late_grace_minutes, 0)::integer;
end $$;

-- ---------- 5) self check-in / check-out ---------------------------------------
create or replace function attendance_check(
  p_method text, p_lat numeric default null, p_lng numeric default null, p_token text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg attendance_config%rowtype; e employees%rowtype; b branches%rowtype;
  v_role text := get_my_role(); v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_row attendance%rowtype; v_dist integer; v_late integer;
begin
  select * into cfg from attendance_config where id = 1;
  select * into e from employees where user_id = auth.uid() and is_active;
  if not found then raise exception 'حسابك غير مرتبط بملف موظف نشط — راجع الموارد البشرية'; end if;

  if p_method = 'qr' then
    if not cfg.qr_enabled then raise exception 'التسجيل بالباركود غير مفعّل'; end if;
    if not v_role = any(cfg.qr_roles) then raise exception 'دورك لا يسمح بالتسجيل بالباركود' using errcode = '42501'; end if;
    select * into b from branches where attendance_token = p_token;
    if not found then raise exception 'رمز الفرع غير صحيح أو منتهي — امسح الرمز المعلّق في الفرع'; end if;
    if e.branch_id is not null and b.id <> e.branch_id then
      raise exception 'هذا رمز فرع %، وفرعك مختلف', b.city;
    end if;
  elsif p_method = 'gps' then
    if not cfg.gps_enabled then raise exception 'التسجيل بالموقع غير مفعّل'; end if;
    if not v_role = any(cfg.gps_roles) then raise exception 'دورك لا يسمح بالتسجيل بالموقع' using errcode = '42501'; end if;
    if p_lat is null or p_lng is null then raise exception 'تعذّر تحديد موقعك — فعّل خدمة الموقع'; end if;
    select * into b from branches where id = e.branch_id;
    if b.latitude is null then raise exception 'موقع فرعك غير محدد — راجع الموارد البشرية'; end if;
    v_dist := distance_m(p_lat, p_lng, b.latitude, b.longitude);
    if v_dist > cfg.gps_radius_m then
      raise exception 'أنت على بُعد % متر من الفرع — المسموح % متر', v_dist, cfg.gps_radius_m;
    end if;
  else
    raise exception 'طريقة تسجيل غير معروفة';
  end if;

  select * into v_row from attendance where employee_id = e.id and date = v_today;
  if not found then
    v_late := attendance_late_minutes(e.id, v_now);
    insert into attendance (employee_id, date, check_in, status, check_in_method, check_in_lat, check_in_lng,
                            distance_m, late_minutes, recorded_by)
    values (e.id, v_today, v_now, (case when v_late > 0 then 'late' else 'present' end)::attendance_status, p_method, p_lat, p_lng,
            v_dist, v_late, auth.uid());
    return jsonb_build_object('action', 'in', 'late_minutes', v_late, 'at', v_now, 'distance_m', v_dist);
  end if;
  if v_row.check_out is not null then raise exception 'سجّلت حضورك وانصرافك اليوم'; end if;
  if v_row.check_in is null then raise exception 'سجلّ اليوم مُعدّ يدوياً — راجع الموارد البشرية'; end if;
  update attendance set check_out = v_now, check_out_method = p_method where id = v_row.id;
  return jsonb_build_object('action', 'out', 'at', v_now, 'distance_m', v_dist);
end $$;

-- ---------- 6) manual correction (roles from config + HR scope) ---------------
create or replace function manual_attendance(
  p_employee_id uuid, p_date date, p_status attendance_status,
  p_check_in time default null, p_check_out time default null, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare cfg attendance_config%rowtype; v_in timestamptz; v_out timestamptz; v_late integer;
begin
  select * into cfg from attendance_config where id = 1;
  if not cfg.manual_enabled or not get_my_role() = any(cfg.manual_roles) or not hr_in_scope(p_employee_id) then
    raise exception 'التحضير اليدوي غير مسموح لك' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'سبب التعديل اليدوي مطلوب'; end if;
  if p_date > (now() at time zone 'Asia/Riyadh')::date then raise exception 'لا يُسجَّل حضور لتاريخ قادم'; end if;
  if p_check_out is not null and p_check_in is not null and p_check_out <= p_check_in then
    raise exception 'وقت الانصراف قبل وقت الحضور';
  end if;
  v_in  := case when p_check_in  is not null then (p_date + p_check_in)  at time zone 'Asia/Riyadh' end;
  v_out := case when p_check_out is not null then (p_date + p_check_out) at time zone 'Asia/Riyadh' end;
  v_late := case when v_in is not null then attendance_late_minutes(p_employee_id, v_in) end;
  insert into attendance (employee_id, date, check_in, check_out, status, check_in_method, check_out_method,
                          late_minutes, recorded_by, note)
  values (p_employee_id, p_date, v_in, v_out,
          (case when p_status in ('present','late') and v_late > 0 then 'late'
                when p_status = 'late' then 'present' else p_status::text end)::attendance_status,
          case when v_in is not null then 'manual' end, case when v_out is not null then 'manual' end,
          v_late, auth.uid(), btrim(p_note))
  on conflict (employee_id, date) do update set
    check_in = excluded.check_in, check_out = excluded.check_out, status = excluded.status,
    check_in_method = coalesce(excluded.check_in_method, attendance.check_in_method),
    check_out_method = coalesce(excluded.check_out_method, attendance.check_out_method),
    late_minutes = excluded.late_minutes, recorded_by = excluded.recorded_by, note = excluded.note;
end $$;

-- ---------- 7) close a day: no record on a workday → absent (or leave) --------
create or replace function close_attendance_day(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_absent integer := 0; v_leave integer := 0;
begin
  if not has_perm('hr','manage') then
    raise exception 'إغلاق اليوم من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  if p_date >= (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'يُغلق اليوم بعد انتهائه';
  end if;
  if not is_workday(p_date) then
    return jsonb_build_object('absent', 0, 'leave', 0, 'workday', false);
  end if;
  with todo as (
    select e.id,
           exists (select 1 from leave_requests l where l.employee_id = e.id and l.status = 'approved'
                    and p_date between l.start_date and l.end_date) as on_leave
      from employees e
     where coalesce(e.hire_date, p_date) <= p_date
       and (e.is_active or e.termination_date >= p_date)
       and not exists (select 1 from attendance a where a.employee_id = e.id and a.date = p_date)
  ), ins as (
    insert into attendance (employee_id, date, status, recorded_by, note)
    select id, p_date, case when on_leave then 'leave' else 'absent' end::attendance_status, auth.uid(),
           'إغلاق اليوم: لا تسجيل حضور'
      from todo returning status
  )
  select count(*) filter (where status = 'absent'), count(*) filter (where status = 'leave')
    into v_absent, v_leave from ins;
  return jsonb_build_object('absent', v_absent, 'leave', v_leave, 'workday', true);
end $$;

grant execute on function attendance_check(text, numeric, numeric, text),
  manual_attendance(uuid, date, attendance_status, time, time, text), close_attendance_day(date),
  set_branch_attendance(uuid, numeric, numeric, boolean), branch_attendance_settings(),
  is_workday(date), attendance_late_minutes(uuid, timestamptz), distance_m(numeric, numeric, numeric, numeric)
  to authenticated;

-- ---------- 8) workers: presence only by barcode scan (housing supervisor) -----
create or replace function log_housing_scan(p_barcode text, p_direction text, p_note text default null)
returns workers language plpgsql security definer set search_path = public
as $$
declare v_worker workers; v_dorm uuid; v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if not has_perm('housing','view') then
    raise exception 'لا تملك صلاحية السكن';
  end if;
  if p_direction not in ('in','out') then
    raise exception 'اتجاه غير صحيح';
  end if;
  select * into v_worker from workers where barcode = p_barcode;
  if not found then
    raise exception 'لا توجد عاملة بهذا الباركود';
  end if;
  if not (is_cross_branch() or v_worker.branch_id = get_my_branch()) then
    raise exception 'هذه العاملة خارج نطاق فرعك';
  end if;
  select dorm_id into v_dorm from housing_attendance
    where worker_id = v_worker.id order by date desc limit 1;

  insert into housing_scans (worker_id, dorm_id, direction, note, scanned_by)
  values (v_worker.id, v_dorm, p_direction, nullif(btrim(coalesce(p_note,'')), ''), auth.uid());

  -- a dorm entry scan IS the worker's attendance for the day
  if p_direction = 'in' then
    insert into housing_attendance (worker_id, dorm_id, date, status)
    values (v_worker.id, v_dorm, v_today, 'present')
    on conflict (worker_id, date) do update set status = 'present';
  end if;
  return v_worker;
end $$;

create or replace function guard_housing_presence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.status <> 'present' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'present' then return new; end if;
  if (select worker_barcode_required from attendance_config where id = 1)
     and not exists (select 1 from housing_scans s
                      where s.worker_id = new.worker_id and s.direction = 'in'
                        and (s.scanned_at at time zone 'Asia/Riyadh')::date = new.date) then
    raise exception 'تحضير العاملة يكون بمسح باركودها' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_housing_presence on housing_attendance;
create trigger trg_guard_housing_presence before insert or update on housing_attendance
  for each row execute function guard_housing_presence();

-- ---------- 9) audit ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['attendance','attendance_config','public_holidays'] loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on %I
                    for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ---------- 10) payroll: late minutes recorded at check-in (shift-aware) --------
create or replace function calculate_payslip(p_employee_id uuid, p_period text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg   payroll_config%rowtype;
  v_gosi  gosi_config%rowtype;
  v_emp   employees%rowtype;
  v_sick  leave_types%rowtype;
  v_basic numeric := 0; v_transport numeric := 0; v_housing numeric := 0; v_other numeric := 0;
  v_saudi boolean; v_gosi_sys text;
  v_start date; v_end date; v_from date; v_to date;
  v_month_days integer; v_elig integer; v_factor numeric := 1;
  v_absent integer := 0; v_late_min numeric := 0; v_ot_hours numeric := 0; v_present integer := 0;
  v_daily_wage numeric; v_hourly numeric;
  v_ot_amt numeric; v_absence_ded numeric; v_late_ded numeric;
  v_additions numeric := 0; v_advances numeric := 0; v_penalties numeric := 0;
  v_gosi_base numeric; v_gosi_rate numeric; v_gosi_emp numeric; v_gosi_co numeric;
  v_unpaid_days integer := 0; v_sick_ded_days numeric := 0; v_leave_ded numeric := 0;
  v_gross numeric; v_ded numeric; v_net numeric;
begin
  if not hr_can_see(p_employee_id) then
    raise exception 'غير مصرّح بحساب راتب هذا الموظف' using errcode = '42501';
  end if;

  select * into v_cfg from payroll_config where id = 1;
  select * into v_gosi from gosi_config where id = 1;
  select * into v_emp from employees where id = p_employee_id;
  select * into v_sick from leave_types where code = 'sick';

  v_saudi := (v_emp.nationality = 'السعودية');
  select housing_allowance, other_allowance, gosi_system
    into v_housing, v_other, v_gosi_sys
    from employee_details where employee_id = p_employee_id;
  -- a missing details row must not turn the whole salary into NULL
  v_housing := coalesce(v_housing, 0);
  v_other := coalesce(v_other, 0);
  v_gosi_sys := coalesce(v_gosi_sys, 'new');

  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;

  -- partial month: hired / terminated inside the period → salary ÷ 30 × days
  v_month_days := (v_end - v_start) + 1;
  v_from := greatest(v_start, coalesce(v_emp.hire_date, v_start));
  v_to   := least(v_end, coalesce(v_emp.termination_date, v_end));
  v_elig := greatest((v_to - v_from) + 1, 0);
  if v_elig < v_month_days then
    v_factor := least(v_elig::numeric / nullif(v_cfg.standard_work_days, 0), 1);
  end if;

  v_daily_wage := round(coalesce(v_emp.basic_salary, 0) / nullif(v_cfg.standard_work_days,0), 2);
  v_hourly     := round(coalesce(v_emp.basic_salary, 0) / nullif(v_cfg.standard_work_days * v_cfg.daily_hours,0), 4);
  v_basic     := round(coalesce(v_emp.basic_salary, 0) * v_factor, 2);
  v_transport := round(coalesce(v_emp.transport_allowance, 0) * v_factor, 2);
  v_housing   := round(v_housing * v_factor, 2);
  v_other     := round(v_other * v_factor, 2);

  -- attendance-driven figures
  select
    count(*) filter (where status = 'present' or status = 'late'),
    count(*) filter (where status = 'absent'),
    coalesce(sum(case when check_in is not null and check_out is not null
                 then greatest(extract(epoch from (check_out - check_in))/3600.0 - v_cfg.daily_hours, 0) else 0 end), 0),
    coalesce(sum(case when status = 'late' then coalesce(late_minutes,
                   case when check_in is not null
                        then greatest(extract(epoch from (check_in at time zone 'Asia/Riyadh')::time)/60.0
                                      - v_cfg.shift_start_hour * 60 - v_cfg.late_grace_minutes, 0)
                        else 0 end)
                 else 0 end), 0)
    into v_present, v_absent, v_ot_hours, v_late_min
  from attendance where employee_id = p_employee_id and date between v_start and v_end;

  v_ot_amt      := round(v_ot_hours * v_hourly * v_cfg.overtime_multiplier, 2);
  v_absence_ded := round(v_daily_wage * v_absent, 2);
  v_late_ded    := round((v_late_min / 60.0) * v_hourly, 2);

  -- approved adjustments only; advances (recovered) and penalties (workers' fund) apart
  select coalesce(sum(amount) filter (where type in ('bonus','allowance','overtime')), 0),
         coalesce(sum(amount) filter (where type = 'advance'), 0),
         coalesce(sum(amount) filter (where type = 'penalty'), 0)
    into v_additions, v_advances, v_penalties
  from payroll_adjustments where employee_id = p_employee_id and period = p_period and status = 'approved';

  -- GOSI on the month's insurable wage (basic + housing), capped
  v_gosi_base := least(v_basic + v_housing, v_gosi.ceiling);
  v_gosi_rate := case when not v_saudi then 0
                      when v_gosi_sys = 'old' then v_gosi.saudi_old_employee
                      else v_gosi.saudi_new_employee end;
  v_gosi_emp := round(v_gosi_base * v_gosi_rate, 2);
  v_gosi_co  := round(v_gosi_base * case when not v_saudi then v_gosi.nonsaudi_company
                                         when v_gosi_sys = 'old' then v_gosi.saudi_old_company
                                         else v_gosi.saudi_new_company end, 2);

  -- approved leave: unpaid days, and sick days by their yearly tier (0070)
  select coalesce(sum(least(lr.end_date, v_end) - greatest(lr.start_date, v_start) + 1), 0)
    into v_unpaid_days
    from leave_requests lr join leave_types t on t.code = lr.type
   where lr.employee_id = p_employee_id and lr.status = 'approved' and not t.paid
     and lr.start_date <= v_end and lr.end_date >= v_start;
  with days as (
    select gs::date as d
      from leave_requests lr join leave_types t on t.code = lr.type and t.category = 'sick',
           generate_series(lr.start_date, lr.end_date, interval '1 day') gs
     where lr.employee_id = p_employee_id and lr.status = 'approved'
       and extract(year from gs) = extract(year from v_start)
  ), ranked as (select d, row_number() over (order by d) as n from days)
  select coalesce(sum(case
           when n <= coalesce(v_sick.entitlement_days, 0) then 0
           when n <= coalesce(v_sick.entitlement_days, 0) + coalesce(v_sick.sick_partial_days, 0)
             then 1 - coalesce(v_sick.sick_partial_pay_pct, 100) / 100.0
           else 1 end), 0)
    into v_sick_ded_days
    from ranked where d between v_start and v_end;
  v_leave_ded := round(v_daily_wage * (v_unpaid_days + v_sick_ded_days), 2);

  v_gross := round(v_basic + v_housing + v_transport + v_other + v_ot_amt + v_additions, 2);
  v_ded   := round(v_absence_ded + v_late_ded + v_gosi_emp + v_advances + v_penalties + v_leave_ded, 2);
  v_net   := round(v_gross - v_ded, 2);

  return jsonb_build_object(
    'basic', v_basic, 'housing_allowance', v_housing, 'transport_allowance', v_transport,
    'other_allowance', v_other, 'overtime_hours', round(v_ot_hours,2), 'overtime_amount', v_ot_amt,
    'additions', v_additions, 'present_days', v_present, 'absent_days', v_absent,
    'absence_deduction', v_absence_ded, 'late_minutes', round(v_late_min,1), 'late_deduction', v_late_ded,
    'gosi_system', v_gosi_sys, 'gosi_employee', v_gosi_emp, 'gosi_employer', v_gosi_co,
    'manual_deductions', round(v_advances + v_penalties, 2),
    'advance_deductions', v_advances, 'penalty_deductions', v_penalties,
    'unpaid_leave_days', v_unpaid_days, 'sick_deduction_days', round(v_sick_ded_days, 2),
    'leave_deduction', v_leave_ded,
    'eligible_days', v_elig, 'month_days', v_month_days,
    'gross', v_gross, 'total_deductions', v_ded, 'net', v_net
  );
end;
$$;

