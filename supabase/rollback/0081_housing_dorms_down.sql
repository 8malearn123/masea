-- Rollback for 0081_housing_dorms.sql.
-- Restores the 0061 branch write policy and removes the dorm guards and readers.
-- Capacity / is_active / notes columns are dropped (their data is lost).
drop function if exists list_housing_supervisors();
drop function if exists list_housing_dorms();
drop trigger if exists trg_guard_worker_dorm on worker_details;
drop function if exists guard_worker_dorm();
drop trigger if exists trg_audit_row on housing_dorms;
drop trigger if exists trg_guard_housing_dorm on housing_dorms;
drop function if exists guard_housing_dorm();
drop function if exists dorm_occupied(uuid);

drop policy if exists housing_dorms_ins on housing_dorms;
drop policy if exists housing_dorms_upd on housing_dorms;
drop policy if exists housing_dorms_b_write on housing_dorms;
create policy housing_dorms_b_write on housing_dorms for all to authenticated
  using (in_my_branch(branch_id)) with check (in_my_branch(branch_id));
delete from role_permissions
 where module = 'housing' and action = 'manage'
   and role_code in ('admin', 'operations_manager', 'branch_manager');

drop index if exists uq_housing_dorms_name;
alter table housing_dorms drop constraint if exists housing_dorms_name_chk;
alter table housing_dorms drop constraint if exists housing_dorms_capacity_chk;
alter table housing_dorms drop column if exists updated_at;
alter table housing_dorms drop column if exists notes;
alter table housing_dorms drop column if exists is_active;
alter table housing_dorms drop column if exists capacity;
