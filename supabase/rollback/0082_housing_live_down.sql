-- Rollback for 0082_housing_live.sql.
-- Restores the 0072 log_housing_scan (barcode only, dorm from the last attendance row,
-- housing.view) and removes the residents reader and the attendance dorm filler.
drop trigger if exists trg_fill_attendance_dorm on housing_attendance;
drop function if exists fill_attendance_dorm();
drop function if exists find_worker_by_code(text);
drop function if exists list_housing_residents();
drop index if exists uq_worker_details_iqama;
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
drop function if exists worker_dorm_of(uuid);
