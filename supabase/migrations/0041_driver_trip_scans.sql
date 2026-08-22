-- =============================================================
-- Masiat Alsharq ERP — 0041 Driver trip scans (barcode of the worker)
-- The driver scans the worker's barcode at each leg of the trip:
--   • warehouse_out     → استلمها (من السكن/المستودع)
--   • customer_arrived  → وصّلها للعميل
--   • service_end       → استلمها من العميل
--   • warehouse_in      → رجّعها للسكن ونزلت من السيارة
--   reuses scans_log + scan_type enum (0003) + workers.barcode + RBAC. No new
--   "scan" concept — these are the four existing scan types.
-- =============================================================

-- ---------- 1) link a driver row to its auth account ---------------------------
-- needed so a logged-in driver resolves to his drivers row when scanning.
alter table drivers
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_drivers_user on drivers(user_id);

-- ---------- 2) log_trip_scan() — driver scans a worker barcode -----------------
-- Caller needs gps edit (the driver has it); the worker must be in his branch.
create or replace function log_trip_scan(
  p_barcode text,
  p_scan_type text,
  p_lat numeric default null,
  p_lng numeric default null)
returns scans_log language plpgsql security definer set search_path = public
as $$
declare v_worker workers; v_driver uuid; v_row scans_log;
begin
  if not has_perm('gps','edit') then
    raise exception 'لا تملك صلاحية تسجيل المسح';
  end if;
  if p_scan_type not in ('warehouse_out','customer_arrived','service_end','warehouse_in') then
    raise exception 'نوع مسح غير صحيح';
  end if;
  select * into v_worker from workers where barcode = p_barcode;
  if not found then
    raise exception 'لا توجد عاملة بهذا الباركود';
  end if;
  if not (is_cross_branch() or v_worker.branch_id = get_my_branch()) then
    raise exception 'هذه العاملة خارج نطاق فرعك';
  end if;
  -- resolve the driver row linked to this account (may be null if not linked)
  select id into v_driver from drivers where user_id = auth.uid();

  insert into scans_log (worker_id, driver_id, scan_type, latitude, longitude)
  values (v_worker.id, v_driver, p_scan_type::scan_type, p_lat, p_lng)
  returning * into v_row;
  return v_row;
end $$;

grant execute on function log_trip_scan(text, text, numeric, numeric) to authenticated;
