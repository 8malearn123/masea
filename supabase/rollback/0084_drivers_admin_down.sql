-- Rollback for 0084_drivers_admin.sql.
-- Restores the 0061 branch write policy on drivers and removes the guard, audit,
-- accounts reader and orders.manage. The is_active / updated_at columns are dropped.
drop function if exists list_driver_accounts();
drop trigger if exists trg_audit_row on drivers;
drop trigger if exists trg_guard_driver on drivers;
drop function if exists guard_driver();
drop function if exists driver_active_orders(uuid);
drop policy if exists drivers_ins on drivers;
drop policy if exists drivers_upd on drivers;
drop policy if exists drivers_b_write on drivers;
create policy drivers_b_write on drivers for all to authenticated
  using (in_my_branch(branch_id)) with check (in_my_branch(branch_id));
delete from role_permissions
 where module = 'orders' and action = 'manage'
   and role_code in ('admin', 'operations_manager', 'branch_manager');
drop index if exists uq_drivers_user;
alter table drivers drop constraint if exists drivers_name_chk;
alter table drivers drop constraint if exists drivers_phone_chk;
alter table drivers drop column if exists updated_at;
alter table drivers drop column if exists is_active;
