-- Rollback for 0080_ops_rules.sql.
-- Restores the 0018 versions of assign_order_driver / set_order_status and removes the
-- transition helpers and the 'processing' normalizer. Order statuses already written stay.
drop trigger if exists trg_release_driver_on_order_end on service_requests;
drop function if exists release_driver_on_order_end();
drop trigger if exists trg_normalize_request_status on service_requests;
drop function if exists normalize_request_status();

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


drop function if exists release_driver_if_idle(uuid);
drop function if exists order_transition_error(text, text, uuid, text);
