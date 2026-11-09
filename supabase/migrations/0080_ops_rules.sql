-- =============================================================
-- 0080 — العمليات والميدان: قواعد الطلبات على الخادم (نتيجة الاختبار الشامل)
--   assign_order_driver (0018) كان يقبل: سائقًا من فرع آخر، سائقًا غير متاح،
--   وطلبًا مكتملًا أو ملغى. set_order_status (0018) كان يقبل أي حالة دون تسلسل.
--   القواعد نفسها التي تطبّقها الواجهة (features/orders/lib/orderStatus.ts) صارت
--   تُفرض هنا، ويعود السائق «متاحًا» عند انتهاء آخر طلب نشط له.
-- =============================================================

create or replace function order_transition_error(p_status text, p_next text, p_driver uuid, p_trip text)
returns text language sql immutable as $$
  select case
    when p_status = 'completed' then 'الطلب مكتمل ولا يمكن إعادة فتحه أو تغيير حالته.'
    when p_status = 'cancelled' then 'الطلب ملغى ولا يمكن تغيير حالته.'
    when not (p_next = any (case p_status
        when 'new' then array['assigned','cancelled']
        when 'paid' then array['assigned','cancelled']
        when 'assigned' then array['in_progress','cancelled']
        when 'in_progress' then array['completed','cancelled']
        else array[]::text[] end))
      then 'لا يمكن نقل الطلب من «' || p_status || '» إلى «' || p_next || '».'
    when p_next = 'assigned' and p_driver is null
      then 'لا يمكن جعل الطلب «مُسند» دون سائق: استخدم «إسناد» لاختيار السائق.'
    when p_next = 'completed' and coalesce(p_trip, 'none') not in ('none', 'returned')
      then 'لا يمكن إكمال الطلب والرحلة لم تنتهِ: يكتمل بمسح إرجاع العاملة للسكن.'
    else null end
$$;

-- the driver is free again once none of his orders is active
create or replace function release_driver_if_idle(p_driver uuid) returns void
language sql security definer set search_path = public as $$
  update drivers set status = 'available'
   where id = p_driver and status = 'on_route'
     and not exists (select 1 from service_requests
                      where driver_id = p_driver and status in ('assigned','in_progress'))
$$;

create or replace function assign_order_driver(p_order_id uuid, p_driver_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o service_requests%rowtype; d drivers%rowtype;
begin
  if not has_perm('orders', 'edit') then
    raise exception 'لا تملك صلاحية إدارة الطلبات' using errcode = '42501';
  end if;
  select * into o from service_requests where id = p_order_id for update;
  if not found then raise exception 'الطلب غير موجود.'; end if;
  if not (is_cross_branch() or o.branch_id = get_my_branch() or o.branch_id is null) then
    raise exception 'هذا الطلب خارج نطاق فرعك' using errcode = '42501';
  end if;
  if o.status in ('completed','cancelled') then
    raise exception '%', order_transition_error(o.status, 'assigned', p_driver_id, o.trip_stage);
  end if;
  select * into d from drivers where id = p_driver_id for update;
  if not found then raise exception 'السائق غير موجود: اختر سائقًا من القائمة.'; end if;
  if d.status <> 'available' then raise exception 'السائق «%» غير متاح حاليًا', d.full_name; end if;
  if o.branch_id is not null and d.branch_id is not null and d.branch_id <> o.branch_id then
    raise exception 'السائق «%» من فرع آخر — اختر سائقًا من فرع الطلب', d.full_name;
  end if;
  update service_requests set driver_id = p_driver_id, status = 'assigned', assigned_at = now()
   where id = p_order_id;
  update drivers set status = 'on_route' where id = p_driver_id;
  if o.driver_id is not null and o.driver_id <> p_driver_id then
    perform release_driver_if_idle(o.driver_id);
  end if;
end $$;

create or replace function set_order_status(p_order_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare o service_requests%rowtype; v_err text;
begin
  if not has_perm('orders', 'edit') then
    raise exception 'لا تملك صلاحية إدارة الطلبات' using errcode = '42501';
  end if;
  select * into o from service_requests where id = p_order_id for update;
  if not found then raise exception 'الطلب غير موجود.'; end if;
  if not (is_cross_branch() or o.branch_id = get_my_branch() or o.branch_id is null) then
    raise exception 'هذا الطلب خارج نطاق فرعك' using errcode = '42501';
  end if;
  v_err := order_transition_error(o.status, p_status, o.driver_id, o.trip_stage);
  if v_err is not null then raise exception '%', v_err; end if;
  update service_requests set status = p_status where id = p_order_id;
  if p_status in ('completed','cancelled') and o.driver_id is not null then
    perform release_driver_if_idle(o.driver_id);
  end if;
end $$;

grant execute on function order_transition_error(text, text, uuid, text) to authenticated;
revoke execute on function release_driver_if_idle(uuid) from public, anon, authenticated;

-- set_booking_status (0065) wrote 'processing' — a status the dispatch board and
-- the transition rules do not know; the request is simply «قيد التنفيذ».
create or replace function normalize_request_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'processing' then new.status := 'in_progress'; end if;
  return new;
end $$;
drop trigger if exists trg_normalize_request_status on service_requests;
create trigger trg_normalize_request_status before insert or update of status on service_requests
  for each row execute function normalize_request_status();
update service_requests set status = 'in_progress' where status = 'processing';

-- any path that ends an order (set_order_status, the return scan in advance_trip_stage,
-- hourly bookings) frees its driver once he has no other active order
create or replace function release_driver_on_order_end() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('completed','cancelled') and old.status is distinct from new.status
     and new.driver_id is not null then
    perform release_driver_if_idle(new.driver_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_release_driver_on_order_end on service_requests;
create trigger trg_release_driver_on_order_end after update of status on service_requests
  for each row execute function release_driver_on_order_end();
