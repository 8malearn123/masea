-- Rollback for 0076_performance.sql.
-- Data stays: reviews (with their snapshots), targets and their new column.
-- Functions, guards, settings tables and policies go; the branch policies of
-- targets come back as they were.
drop trigger if exists trg_guard_performance_review on performance_reviews;
drop function if exists guard_performance_review();
drop function if exists save_performance_review(uuid, uuid, text, date, date, jsonb, text);
drop function if exists perf_auto_scores(uuid, date, date);
drop function if exists perf_rating(numeric);
alter table performance_reviews drop constraint if exists perf_period_chk;
drop policy if exists targets_read on targets;
drop policy if exists targets_insert on targets;
drop policy if exists targets_update on targets;
create policy targets_b_read on targets for select to authenticated using (in_my_branch(branch_id));
create policy targets_b_write on targets for all to authenticated
  using (in_my_branch(branch_id)) with check (in_my_branch(branch_id));
drop trigger if exists trg_audit_row on targets;
alter table targets drop constraint if exists targets_values_chk;
alter table app_config drop constraint if exists app_config_perf_late_chk;
drop table if exists perf_bands;
drop table if exists perf_criteria;
