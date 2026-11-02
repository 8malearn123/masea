-- Rollback for 0064_customer_crm.sql.
-- Contacts logged on customers (lead_activities.customer_id) are removed with
-- the column only if no lead is attached; disabled customers become active.
drop view if exists customer_insights;
delete from app_config where key in ('crm_new_customer_days','crm_inactive_days','crm_followup_days','crm_return_window_days');

drop policy if exists lact_read on lead_activities;
drop policy if exists lact_write on lead_activities;
delete from lead_activities where lead_id is null;
alter table lead_activities drop constraint if exists lead_activities_parent_chk;
drop index if exists idx_lead_act_customer;
alter table lead_activities drop column if exists customer_id;
alter table lead_activities alter column lead_id set not null;
alter table lead_activities alter column created_by drop default;
-- 0044 policies
create policy lact_read on lead_activities for select to authenticated using (
  exists (select 1 from leads l where l.id = lead_activities.lead_id and (
    is_cross_branch()
    or (l.branch_id = get_my_branch() and (l.assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  ))
);
create policy lact_write on lead_activities for all to authenticated using (
  has_perm('leads','edit') and exists (select 1 from leads l where l.id = lead_activities.lead_id and (
    is_cross_branch() or (l.branch_id = get_my_branch() and (l.assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  ))
) with check (created_by = auth.uid());

alter table customers drop column if exists is_active;
