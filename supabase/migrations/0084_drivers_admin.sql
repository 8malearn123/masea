-- =============================================================
-- 0084 — إدارة السائقين (خطة العمليات والميدان، المرحلة 4)
--   سياسة الكتابة (0061) كانت تسمح لأي مستخدم في الفرع بتعديل السائقين، ولا توجد
--   شاشة لإضافتهم. هنا:
--   • صلاحية orders.manage (الإدارة، مدير العمليات، مدير الفرع لفرعه) — المبيعات
--     ومركز الاتصال يملكون orders.edit للطلبات فقط.
--   • التفعيل (الحذف = تعطيل)، الجوال بصيغة 05xxxxxxxx.
--   • الحالة: «في مهمة» آلية من الطلبات (0080)؛ يدويًا «متاح» / «خارج الدوام» فقط،
--     ولا تغيير للحالة أو الفرع أو التعطيل وللسائق طلب نشط.
--   • ربط حساب الدخول: مستخدم نشط بدور «سائق» من فرع السائق، ولسائق واحد فقط.
--   • تدقيق على كل تعديل.
-- التراجع: supabase/rollback/0084_drivers_admin_down.sql
-- =============================================================

alter table drivers add column if not exists is_active  boolean not null default true;
alter table drivers add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drivers_phone_chk') then
    alter table drivers add constraint drivers_phone_chk check (phone is null or phone ~ '^05[0-9]{8}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drivers_name_chk') then
    alter table drivers add constraint drivers_name_chk check (length(btrim(full_name)) > 0) not valid;
  end if;
end $$;
-- حساب الدخول لسائق واحد
create unique index if not exists uq_drivers_user on drivers (user_id) where user_id is not null;

-- ---------- 1) الصلاحية: orders.manage -----------------------------------------
insert into role_permissions (role_code, module, action) values
  ('admin', 'orders', 'manage'),
  ('operations_manager', 'orders', 'manage'),
  ('branch_manager', 'orders', 'manage')
on conflict do nothing;

drop policy if exists drivers_b_write on drivers;
drop policy if exists drivers_ins on drivers;
drop policy if exists drivers_upd on drivers;
create policy drivers_ins on drivers for insert to authenticated
  with check (has_perm('orders', 'manage') and in_my_branch(branch_id));
create policy drivers_upd on drivers for update to authenticated
  using (has_perm('orders', 'manage') and in_my_branch(branch_id))
  with check (has_perm('orders', 'manage') and in_my_branch(branch_id));
-- لا سياسة حذف: السائق يُعطَّل

-- ---------- 2) حارس السائق -------------------------------------------------------
create or replace function driver_active_orders(p_driver uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from service_requests
   where driver_id = p_driver and status in ('assigned', 'in_progress')
$$;
revoke execute on function driver_active_orders(uuid) from public, anon, authenticated;

create or replace function guard_driver() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_busy integer := 0;
begin
  new.full_name := btrim(new.full_name);
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.vehicle_no := nullif(upper(btrim(coalesce(new.vehicle_no, ''))), '');
  new.updated_at := now();
  if not new.is_active then new.status := 'off_duty'; end if;

  if new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id
                                  or new.branch_id is distinct from old.branch_id) then
    if not exists (select 1 from user_profiles u
                    where u.id = new.user_id and u.role = 'driver' and u.is_active
                      and (new.branch_id is null or u.branch_id is null or u.branch_id = new.branch_id)) then
      raise exception 'الحساب المربوط يجب أن يكون مستخدمًا نشطًا بدور «سائق» من فرع السائق';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'on_route' then
      raise exception 'حالة «في مهمة» تُضبط آليًا عند إسناد طلب';
    end if;
    return new;
  end if;

  v_busy := driver_active_orders(new.id);
  if new.status = 'on_route' and old.status <> 'on_route' and v_busy = 0 then
    raise exception 'حالة «في مهمة» تُضبط آليًا عند إسناد طلب';
  end if;
  if v_busy > 0 then
    if new.status <> 'on_route' and old.status = 'on_route' then
      raise exception 'السائق في مهمة (% طلب نشط): تتغيّر حالته عند انتهاء طلباته', v_busy;
    end if;
    if new.branch_id is distinct from old.branch_id then
      raise exception 'لا يُنقل السائق لفرع آخر وله طلبات نشطة';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_driver on drivers;
create trigger trg_guard_driver before insert or update on drivers
  for each row execute function guard_driver();

drop trigger if exists trg_audit_row on drivers;
create trigger trg_audit_row after insert or update or delete on drivers
  for each row execute function audit_row_change();

-- ---------- 3) حسابات السائقين المتاحة للربط ---------------------------------------
create or replace function list_driver_accounts()
returns table (id uuid, full_name text, branch text, driver_id uuid)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, b.city, d.id
    from user_profiles u
    left join branches b on b.id = u.branch_id
    left join drivers d on d.user_id = u.id
   where u.role = 'driver' and u.is_active
     and has_perm('orders', 'manage') and in_my_branch(u.branch_id)
   order by u.full_name
$$;
revoke execute on function list_driver_accounts() from public, anon;
grant execute on function list_driver_accounts() to authenticated;
