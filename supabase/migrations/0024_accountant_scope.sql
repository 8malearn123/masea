-- =============================================================
-- Masiat Alsharq ERP — 0024 Accountant scope + accounting module perms
-- Surgical correction to the RBAC matrix (0013) — forward-only & idempotent:
--   1. register the `accounting` module in the permissions catalog,
--   2. grant `accounting` to the roles that own it (parity with the frontend
--      mirror in apps/web/src/lib/permissions.ts),
--   3. RESTRICT the accountant to financial pages only — remove the over-broad
--      view grants (contracts/pricing/hr/loyalty/orders/targets) that were
--      leaking every module into their sidebar.
-- Because every table's RLS keys off has_perm(module,'view'), removing a grant
-- here makes the API return EMPTY for the accountant — not just hide the button.
-- =============================================================

-- 1) catalog: accounting × all actions
insert into permissions (module, action, label)
select 'accounting', a.code, a.name_ar || ' النظام المحاسبي'
from (values
  ('view','عرض'), ('create','إنشاء'), ('edit','تعديل'), ('delete','حذف'),
  ('approve','اعتماد'), ('export','تصدير'), ('manage','إدارة')
) as a(code, name_ar)
on conflict (module, action) do nothing;

-- 2) accounting grants (admin full · accountant full · ops/branch view)
insert into role_permissions (role_code, module, action)
select g.role_code, 'accounting', act
from (values
  ('admin','full'),
  ('accountant','full'),
  ('operations_manager','view'),
  ('branch_manager','view')
) as g(role_code, sym)
cross join lateral unnest(
  case g.sym
    when 'full' then array['view','create','edit','delete','approve','export']
    when 'view' then array['view']
    else array[]::text[]
  end
) as act
on conflict do nothing;

-- 3) restrict the accountant to financial pages only.
--    Clear every accountant grant, then re-seed the allowed set:
--    payments (full) · accounting (full) · reports (full). Dashboard is open to all.
delete from role_permissions where role_code = 'accountant';

insert into role_permissions (role_code, module, action)
select 'accountant', g.module, act
from (values
  ('payments','full'),
  ('accounting','full'),
  ('reports','full')
) as g(module, sym)
cross join lateral unnest(
  case g.sym
    when 'full' then array['view','create','edit','delete','approve','export']
    when 'view' then array['view']
    else array[]::text[]
  end
) as act
on conflict do nothing;
