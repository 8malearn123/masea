-- Rollback for 0083_housing_targets.sql.
-- Restores the 0039 admin-only write policy and removes the guard, audit and reader.
drop function if exists list_housing_targets(integer, integer);
drop function if exists supervisor_dorms(uuid, uuid);
drop trigger if exists trg_audit_row on housing_targets;
drop trigger if exists trg_guard_housing_target on housing_targets;
drop function if exists guard_housing_target();
alter table housing_targets drop column if exists updated_at;
drop policy if exists htarget_ins on housing_targets;
drop policy if exists htarget_upd on housing_targets;
drop policy if exists htarget_admin on housing_targets;
create policy htarget_admin on housing_targets for all to authenticated
  using (is_admin()) with check (is_admin());
