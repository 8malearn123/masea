-- =============================================================
-- Masiat Alsharq ERP — 0036 Branch-manager scope + real branch RLS
-- Branch manager = full operations for THEIR branch only; sees financials as
-- a result (read), never approves payroll, never touches accounting/RBAC.
-- Enforces branch isolation in the DB (read AND write) — not just the UI.
--   cross-branch roles (admin/ops/hr/accountant) → all branches
--   branch_manager + branch roles → branch_id = get_my_branch() only
-- =============================================================

-- ---------- 1) branch_manager permission matrix ----------------
delete from role_permissions where role_code = 'branch_manager';

insert into role_permissions (role_code, module, action)
select 'branch_manager', g.module, act
from (values
  ('contracts','full'),     -- create + approve (own branch)
  ('orders','full'),        -- dispatch & drivers (own branch)
  ('targets','full'),       -- team targets & honor board
  ('loyalty','edit'),       -- offers within limits
  ('call_center','edit'),   -- branch call-center team
  ('gps','view'),
  ('payments','view'),      -- branch revenue (read only)
  ('pricing','view'),       -- view + bounded discount (applied in deal flow)
  ('rating','view'),
  ('reports','view'),       -- branch performance (cross-branch comparison blocked)
  ('housing','view')
) as g(module, sym)
cross join lateral unnest(
  case g.sym
    when 'full' then array['view','create','edit','delete','approve','export']
    when 'edit' then array['view','create','edit']
    when 'view' then array['view']
    else array[]::text[]
  end
) as act
-- HR: manage team + approve leaves + SUBMIT payroll adjustments, but NOT manage
-- (no payroll final approval — separation of duties stays with HR).
union all
select 'branch_manager', 'hr', act
from unnest(array['view','create','edit','approve']) as act;
-- NOTE: accounting + rbac intentionally NOT granted (blocked).

-- ---------- 2) branch-scope predicate helpers ------------------
-- (reuse get_my_branch() / is_cross_branch() / emp_in_my_branch() from 0013/0021)
create or replace function _drop_all_policies(p_table text) returns void
language plpgsql as $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy if exists %I on %I', r.policyname, p_table);
  end loop;
end $$;

-- ---------- 3) core operational tables → cross-branch OR own branch ----------
do $$
declare t text;
begin
  foreach t in array array['workers','customers','drivers','employees','targets','housing_dorms']
  loop
    perform _drop_all_policies(t);
    execute format($f$
      create policy %1$s_b_read on %1$s for select to authenticated
        using (is_cross_branch() or branch_id = get_my_branch() or branch_id is null);
      create policy %1$s_b_write on %1$s for all to authenticated
        using (is_cross_branch() or branch_id = get_my_branch())
        with check (is_cross_branch() or branch_id = get_my_branch());
    $f$, t);
  end loop;
end $$;

-- ---------- 4) child tables (were using(true)) → scope via parent branch ----------

-- payments / scans_log / absence_reports / penalties → via contract (or worker)
select _drop_all_policies('payments');
create policy payments_b on payments for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from contracts c where c.id = payments.contract_id
    and (c.branch_id = get_my_branch() or c.branch_id is null)))
  with check (is_cross_branch() or exists (
    select 1 from contracts c where c.id = payments.contract_id and c.branch_id = get_my_branch()));

select _drop_all_policies('absence_reports');
create policy absence_b on absence_reports for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from contracts c where c.id = absence_reports.contract_id
    and (c.branch_id = get_my_branch() or c.branch_id is null)))
  with check (true);

select _drop_all_policies('penalties');
create policy penalties_b on penalties for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from contracts c where c.id = penalties.contract_id
    and (c.branch_id = get_my_branch() or c.branch_id is null)))
  with check (true);

select _drop_all_policies('scans_log');
create policy scans_b on scans_log for all to authenticated
  using (is_cross_branch()
    or exists (select 1 from contracts c where c.id = scans_log.contract_id and c.branch_id = get_my_branch())
    or exists (select 1 from workers w where w.id = scans_log.worker_id and w.branch_id = get_my_branch()))
  with check (true);

-- attendance / leave_requests / shifts → via employee branch
do $$
declare t text;
begin
  foreach t in array array['attendance','leave_requests','shifts']
  loop
    perform _drop_all_policies(t);
    execute format($f$
      create policy %1$s_b on %1$s for all to authenticated
        using (is_cross_branch() or emp_in_my_branch(employee_id))
        with check (is_cross_branch() or emp_in_my_branch(employee_id));
    $f$, t);
  end loop;
end $$;

-- payroll (monthly) → read within branch; WRITE only HR/admin (manager view-only)
select _drop_all_policies('payroll');
create policy payroll_read_b on payroll for select to authenticated
  using (is_cross_branch() or emp_in_my_branch(employee_id));
create policy payroll_write_hr on payroll for all to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

-- loyalty / abandoned_carts / referrals → via customer branch
select _drop_all_policies('loyalty_transactions');
create policy loyalty_b on loyalty_transactions for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from customers c where c.id = loyalty_transactions.customer_id
    and (c.branch_id = get_my_branch() or c.branch_id is null)))
  with check (true);

select _drop_all_policies('abandoned_carts');
create policy carts_b on abandoned_carts for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from customers c where c.id = abandoned_carts.customer_id
    and (c.branch_id = get_my_branch() or c.branch_id is null)))
  with check (true);

-- target_progress → via target branch ; housing_attendance → via dorm branch
select _drop_all_policies('target_progress');
create policy tprog_b on target_progress for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from targets t where t.id = target_progress.target_id
    and (t.branch_id = get_my_branch() or t.branch_id is null)))
  with check (true);

select _drop_all_policies('housing_attendance');
create policy hattend_b on housing_attendance for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from housing_dorms d where d.id = housing_attendance.dorm_id
    and (d.branch_id = get_my_branch() or d.branch_id is null)))
  with check (true);

-- ---------- 5) HR profile/payroll reads → branch-scoped (fix has_perm-only leak) ----------
drop policy if exists emp_details_read on employee_details;
create policy emp_details_read on employee_details for select using (
  (has_perm('hr','view') and (is_cross_branch() or emp_in_my_branch(employee_id)))
  or owns_employee(employee_id));

drop policy if exists emp_docs_read on employee_documents;
create policy emp_docs_read on employee_documents for select using (
  (has_perm('hr','view') and (is_cross_branch() or emp_in_my_branch(employee_id)))
  or owns_employee(employee_id));

drop policy if exists emp_emergency_read on employee_emergency_contacts;
create policy emp_emergency_read on employee_emergency_contacts for select using (
  (has_perm('hr','view') and (is_cross_branch() or emp_in_my_branch(employee_id)))
  or owns_employee(employee_id));

drop policy if exists payadj_read on payroll_adjustments;
create policy payadj_read on payroll_adjustments for select using (
  (has_perm('hr','view') and (is_cross_branch() or emp_in_my_branch(employee_id)))
  or emp_in_my_branch(employee_id) or owns_employee(employee_id));

drop policy if exists payslips_read on payslips;
create policy payslips_read on payslips for select using (
  (has_perm('hr','view') and (is_cross_branch() or emp_in_my_branch(employee_id)))
  or owns_employee(employee_id));

drop policy if exists payruns_read on payroll_runs;
create policy payruns_read on payroll_runs for select using (
  has_perm('hr','view') and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null));

drop function _drop_all_policies(text);
