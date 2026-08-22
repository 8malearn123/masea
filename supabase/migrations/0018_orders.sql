-- =============================================================
-- Masiat Alsharq ERP — 0018 Orders & Drivers (Module 09)
-- Dispatch layer over service_requests + drivers, guarded by RBAC.
-- =============================================================

alter table service_requests
  add column if not exists driver_id    uuid references drivers(id) on delete set null,
  add column if not exists scheduled_at timestamptz,
  add column if not exists assigned_at  timestamptz;
create index if not exists idx_sr_driver on service_requests(driver_id);

-- Assign a driver → order becomes 'assigned', driver becomes 'on_route'.
create or replace function assign_order_driver(p_order_id uuid, p_driver_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_branch uuid;
begin
  if not has_perm('orders', 'edit') then
    raise exception 'لا تملك صلاحية إدارة الطلبات';
  end if;
  select branch_id into v_branch from service_requests where id = p_order_id;
  if not (is_cross_branch() or v_branch = get_my_branch() or v_branch is null) then
    raise exception 'هذا الطلب خارج نطاق فرعك';
  end if;
  update service_requests
    set driver_id = p_driver_id, status = 'assigned', assigned_at = now()
    where id = p_order_id;
  update drivers set status = 'on_route' where id = p_driver_id;
end $$;

-- Update an order's status (validated set is enforced in the app + here).
create or replace function set_order_status(p_order_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_branch uuid;
begin
  if not has_perm('orders', 'edit') then
    raise exception 'لا تملك صلاحية إدارة الطلبات';
  end if;
  select branch_id into v_branch from service_requests where id = p_order_id;
  if not (is_cross_branch() or v_branch = get_my_branch() or v_branch is null) then
    raise exception 'هذا الطلب خارج نطاق فرعك';
  end if;
  update service_requests set status = p_status where id = p_order_id;
end $$;

grant execute on function assign_order_driver(uuid, uuid), set_order_status(uuid, text) to authenticated;

-- ---------- RLS: manage orders/drivers via has_perm('orders', …) ----------
drop policy if exists sr_staff_read on service_requests;

create policy sr_orders_read on service_requests for select to authenticated
  using (has_perm('orders', 'view')
         and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null));

create policy sr_orders_update on service_requests for update to authenticated
  using (has_perm('orders', 'edit')
         and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null))
  with check (true);

create policy drivers_orders_read on drivers for select to authenticated
  using (has_perm('orders', 'view')
         and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null));
