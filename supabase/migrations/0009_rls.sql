-- =============================================================
-- Masiat Alsharq ERP — 0009 Row Level Security
-- Strategy:
--   * admin / operations_manager  -> full access (is_admin())
--   * branch-scoped tables         -> users see rows in their own branch
--   * authenticated users          -> may write operational tables
-- =============================================================

-- Enable RLS everywhere
alter table branches             enable row level security;
alter table workers              enable row level security;
alter table customers            enable row level security;
alter table drivers              enable row level security;
alter table contracts            enable row level security;
alter table payments             enable row level security;
alter table scans_log            enable row level security;
alter table absence_reports      enable row level security;
alter table penalties            enable row level security;
alter table employees            enable row level security;
alter table attendance           enable row level security;
alter table payroll              enable row level security;
alter table leave_requests       enable row level security;
alter table shifts               enable row level security;
alter table loyalty_transactions enable row level security;
alter table campaigns            enable row level security;
alter table abandoned_carts      enable row level security;
alter table referrals            enable row level security;
alter table targets              enable row level security;
alter table target_progress      enable row level security;
alter table rewards              enable row level security;
alter table housing_dorms        enable row level security;
alter table housing_attendance   enable row level security;
alter table user_profiles        enable row level security;
alter table notifications        enable row level security;
alter table audit_log            enable row level security;
alter table faq_items            enable row level security;

-- ---------- user_profiles ----------
create policy up_select_self_or_admin on user_profiles for select to authenticated
  using (id = auth.uid() or is_admin());
create policy up_update_self on user_profiles for update to authenticated
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());
create policy up_admin_all on user_profiles for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- branches (read for all auth, write admin) ----------
create policy branches_read on branches for select to authenticated using (true);
create policy branches_admin on branches for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- Branch-scoped operational tables ----------
-- Macro: select within branch OR admin; write within branch OR admin.
do $$
declare t text;
begin
  foreach t in array array[
    'workers','customers','drivers','contracts','employees','housing_dorms','targets'
  ]
  loop
    execute format($f$
      create policy %1$s_branch_read on %1$s for select to authenticated
        using (is_admin() or branch_id = current_branch_id() or branch_id is null);
      create policy %1$s_branch_write on %1$s for all to authenticated
        using (is_admin() or branch_id = current_branch_id())
        with check (is_admin() or branch_id = current_branch_id() or branch_id is null);
    $f$, t);
  end loop;
end $$;

-- ---------- Child tables (scope through parent / open to authenticated) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'payments','scans_log','absence_reports','penalties','attendance','payroll',
    'leave_requests','shifts','loyalty_transactions','campaigns','abandoned_carts',
    'referrals','target_progress','rewards','housing_attendance','faq_items'
  ]
  loop
    execute format($f$
      create policy %1$s_read on %1$s for select to authenticated using (true);
      create policy %1$s_write on %1$s for all to authenticated
        using (true) with check (true);
    $f$, t);
  end loop;
end $$;

-- ---------- notifications (own only) ----------
create policy notif_own on notifications for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy notif_update_own on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_insert on notifications for insert to authenticated with check (true);

-- ---------- audit_log (admin read, system insert) ----------
create policy audit_admin_read on audit_log for select to authenticated using (is_admin());
create policy audit_insert on audit_log for insert to authenticated with check (true);
