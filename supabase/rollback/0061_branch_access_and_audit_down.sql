-- Rollback for 0061_branch_access_and_audit.sql.
-- Restores the pre-0061 policies (which let branch roles read rows without a
-- branch and write child rows of other branches). Audit rows already written
-- and branches filled in by the backfill are kept — they are real data.

-- ---------- audit trail ----------
do $$
declare t text;
begin
  foreach t in array array['contracts','quotes','promotions','campaigns','payments','customers',
                           'leads','role_permissions','roles','user_profiles','pricing_rules',
                           'app_config','service_requests']
  loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
  end loop;
end $$;
drop function if exists audit_row_change();
drop trigger if exists trg_audit_log_stamp on audit_log;
drop function if exists audit_log_stamp();
drop trigger if exists trg_audit_log_immutable on audit_log;
drop function if exists audit_log_immutable();
drop policy if exists audit_read on audit_log;
create policy audit_admin_read on audit_log for select to authenticated using (is_admin());
create policy audit_insert on audit_log for insert to authenticated with check (true);
drop index if exists idx_audit_log_created;
drop index if exists idx_audit_log_record;
alter table audit_log drop column if exists actor_name;
alter table audit_log drop column if exists branch_id;

-- ---------- permissions ----------
delete from role_permissions where module in ('customers','sales_ops','audit')
   or (module = 'leads' and action = 'approve');
delete from permissions where module in ('customers','sales_ops','audit')
   or (module = 'leads' and action = 'approve');
insert into role_permissions (role_code, module, action) values ('driver','targets','view')
on conflict do nothing;

-- ---------- default branch / routing ----------
do $$
declare t text;
begin
  foreach t in array array['customers','contracts','service_requests','leads','quotes',
                           'workers','drivers','targets','housing_dorms']
  loop
    execute format('drop trigger if exists trg_default_branch on %I', t);
  end loop;
end $$;
drop function if exists set_default_branch();
drop trigger if exists trg_route_request_branch on service_requests;
drop function if exists route_request_branch();

-- ---------- writable-by-anyone tables (as before) ----------
drop policy if exists campaigns_write on campaigns;
create policy campaigns_write on campaigns for all to authenticated using (true) with check (true);
drop policy if exists rewards_write on rewards;
create policy rewards_write on rewards for all to authenticated using (true) with check (true);
drop policy if exists faq_items_write on faq_items;
create policy faq_items_write on faq_items for all to authenticated using (true) with check (true);

-- ---------- branch policies (0036 / 0037 / 0016 / 0018 forms) ----------
do $$
declare t text;
begin
  foreach t in array array['workers','drivers','employees','targets','housing_dorms']
  loop
    execute format('drop policy if exists %1$s_b_read on %1$s', t);
    execute format('drop policy if exists %1$s_b_write on %1$s', t);
    execute format($f$
      create policy %1$s_b_read on %1$s for select to authenticated
        using (is_cross_branch() or branch_id = get_my_branch() or branch_id is null);
      create policy %1$s_b_write on %1$s for all to authenticated
        using (is_cross_branch() or branch_id = get_my_branch())
        with check (is_cross_branch() or branch_id = get_my_branch());
    $f$, t);
  end loop;
end $$;

drop policy if exists customers_read on customers;
drop policy if exists customers_insert on customers;
drop policy if exists customers_update on customers;
drop policy if exists customers_delete on customers;
create policy customers_b_read on customers for select to authenticated
  using (is_cross_branch() or branch_id = get_my_branch() or branch_id is null);
create policy customers_b_write on customers for all to authenticated
  using (is_cross_branch() or branch_id = get_my_branch())
  with check (is_cross_branch() or branch_id = get_my_branch());

drop policy if exists contracts_read on contracts;
create policy contracts_read on contracts for select to authenticated
  using (has_perm('contracts','view') and (
    is_cross_branch() or assigned_office_id = auth.uid()
    or (get_my_role() <> 'external_office' and (branch_id = get_my_branch() or branch_id is null))));
drop policy if exists contracts_insert on contracts;
create policy contracts_insert on contracts for insert to authenticated
  with check (has_perm('contracts', 'create') and (is_cross_branch() or branch_id = get_my_branch()));
drop policy if exists contracts_update_draft on contracts;
create policy contracts_update_draft on contracts for update to authenticated
  using (has_perm('contracts', 'edit') and status = 'draft'
         and (is_cross_branch() or branch_id = get_my_branch()))
  with check (status = 'draft');
drop policy if exists contracts_delete_draft on contracts;
create policy contracts_delete_draft on contracts for delete to authenticated
  using (has_perm('contracts', 'delete') and status = 'draft'
         and (is_cross_branch() or branch_id = get_my_branch()));

drop policy if exists rf_read on recruitment_followups;
create policy rf_read on recruitment_followups for select to authenticated using (
  exists (select 1 from contracts c where c.id = recruitment_followups.contract_id and (
    is_cross_branch() or c.assigned_office_id = auth.uid()
    or (get_my_role() <> 'external_office' and (c.branch_id = get_my_branch() or c.branch_id is null)))));
drop policy if exists rdoc_read on recruitment_documents;
create policy rdoc_read on recruitment_documents for select to authenticated using (
  exists (select 1 from contracts c where c.id = recruitment_documents.contract_id and (
    is_cross_branch() or c.assigned_office_id = auth.uid()
    or (get_my_role() <> 'external_office' and (c.branch_id = get_my_branch() or c.branch_id is null)))));

drop policy if exists sr_orders_read on service_requests;
create policy sr_orders_read on service_requests for select to authenticated
  using (has_perm('orders', 'view')
         and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null));
drop policy if exists sr_orders_update on service_requests;
create policy sr_orders_update on service_requests for update to authenticated
  using (has_perm('orders', 'edit')
         and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null))
  with check (true);
create policy drivers_orders_read on drivers for select to authenticated
  using (has_perm('orders', 'view')
         and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null));

drop policy if exists payments_b on payments;
create policy payments_b on payments for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from contracts c where c.id = payments.contract_id
    and (c.branch_id = get_my_branch() or c.branch_id is null)))
  with check (is_cross_branch() or exists (
    select 1 from contracts c where c.id = payments.contract_id and c.branch_id = get_my_branch()));

do $$
declare r record;
begin
  for r in select * from (values
    ('absence_reports',      'absence_b', 'contracts',     'contract_id'),
    ('penalties',            'penalties_b','contracts',    'contract_id'),
    ('loyalty_transactions', 'loyalty_b', 'customers',     'customer_id'),
    ('abandoned_carts',      'carts_b',   'customers',     'customer_id'),
    ('housing_attendance',   'hattend_b', 'housing_dorms', 'dorm_id'),
    ('target_progress',      'tprog_b',   'targets',       'target_id')
  ) as v(child, pol, parent, fk)
  loop
    execute format('drop policy if exists %I on %I', r.pol, r.child);
    execute format($f$
      create policy %1$I on %2$I for all to authenticated
        using (is_cross_branch() or exists (
          select 1 from %3$I p where p.id = %2$I.%4$I
          and (p.branch_id = get_my_branch() or p.branch_id is null)))
        with check (true);
    $f$, r.pol, r.child, r.parent, r.fk);
  end loop;
end $$;

drop policy if exists scans_b on scans_log;
create policy scans_b on scans_log for all to authenticated
  using (is_cross_branch()
    or exists (select 1 from contracts c where c.id = scans_log.contract_id and c.branch_id = get_my_branch())
    or exists (select 1 from workers w where w.id = scans_log.worker_id and w.branch_id = get_my_branch()))
  with check (true);

drop policy if exists payruns_read on payroll_runs;
create policy payruns_read on payroll_runs for select to authenticated
  using (has_perm('hr','view') and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null));
drop policy if exists htarget_read on housing_targets;
create policy htarget_read on housing_targets for select to authenticated
  using (supervisor_id = auth.uid() or (has_perm('housing','view')
         and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null)));

drop function if exists can_view_customers();
drop function if exists in_my_branch(uuid);
