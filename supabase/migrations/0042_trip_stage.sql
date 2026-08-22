-- =============================================================
-- Masiat Alsharq ERP — 0042 Trip stage driven by the driver's barcode scans
-- A delivery trip has two legs, advanced by scanning the worker's barcode:
--   ذهاب (السكن → العميل):  warehouse_out (ركبت) → customer_arrived (سُلّمت)
--   إياب (العميل → السكن):  service_end (ركبت عائدة) → warehouse_in (رجعت)
-- Each scan advances service_requests.trip_stage and the order status, so the
-- driver's "رحلاتي" board reflects the worker boarding/handover automatically.
--   reuses service_requests + scan_type + drivers.user_id (0041). No new concept.
-- =============================================================

alter table service_requests
  add column if not exists trip_stage text not null default 'none'
    check (trip_stage in ('none','picked_up','delivered','return_picked','returned'));

-- Advance the trip from a scan event. Caller must be the assigned driver (or ops).
create or replace function advance_trip_stage(p_order_id uuid, p_scan_type text)
returns service_requests language plpgsql security definer set search_path = public
as $$
declare v_driver uuid; v_row service_requests; v_stage text; v_status text;
begin
  if not has_perm('gps','edit') and not has_perm('orders','edit') then
    raise exception 'لا تملك صلاحية تحديث الرحلة';
  end if;
  select driver_id into v_driver from service_requests where id = p_order_id;
  if not found then
    raise exception 'الطلب غير موجود';
  end if;
  -- the assigned driver (linked via drivers.user_id) or an ops/branch role
  if not (
    is_cross_branch() or has_perm('orders','edit')
    or exists (select 1 from drivers d where d.id = v_driver and d.user_id = auth.uid())
  ) then
    raise exception 'هذا الطلب غير مُسند لك';
  end if;

  v_stage := case p_scan_type
    when 'warehouse_out'    then 'picked_up'
    when 'customer_arrived' then 'delivered'
    when 'service_end'      then 'return_picked'
    when 'warehouse_in'     then 'returned'
    else null end;
  if v_stage is null then
    raise exception 'نوع مسح غير صحيح';
  end if;
  v_status := case when p_scan_type = 'warehouse_in' then 'completed' else 'in_progress' end;

  update service_requests
    set trip_stage = v_stage, status = v_status
    where id = p_order_id
    returning * into v_row;
  return v_row;
end $$;

grant execute on function advance_trip_stage(uuid, text) to authenticated;
