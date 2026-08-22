-- =============================================================
-- Masiat Alsharq ERP — 0013 RBAC (Module 11)
-- Roles + permission matrix + helper functions, layered on the
-- existing user_profiles (app_role) / branches / audit_log.
-- `admin` == المدير العام (general_manager) — sole rbac.manage holder.
-- =============================================================

-- ---------- roles (metadata over the existing app_role enum) ----------
create table roles (
  code            text primary key,        -- matches app_role values
  name_ar         text not null,
  is_cross_branch boolean not null default false,
  sort_order      integer not null default 0
);

insert into roles (code, name_ar, is_cross_branch, sort_order) values
  ('admin',              'المدير العام',        true,  1),
  ('operations_manager', 'مدير العمليات',       true,  2),
  ('branch_manager',     'مدير الفرع',          false, 3),
  ('sales',              'موظف المبيعات',       false, 4),
  ('call_center',        'موظف مركز الاتصال',   false, 5),
  ('driver',             'السائق',              false, 6),
  ('housing_supervisor', 'مشرفة السكن',         false, 7),
  ('hr',                 'الموارد البشرية',     true,  8),
  ('accountant',         'المحاسب',             true,  9),
  ('external_office',    'المكتب الخارجي',      false, 10)
on conflict (code) do nothing;

-- ---------- permissions catalog (module × action) ----------
create table permissions (
  id      uuid primary key default gen_random_uuid(),
  module  text not null,
  action  text not null,
  label   text not null,
  unique (module, action)
);

insert into permissions (module, action, label)
select m.code, a.code, a.name_ar || ' ' || m.name_ar
from (values
  ('contracts','العقود'), ('gps','التتبع'), ('pricing','التسعير'), ('payments','المدفوعات'),
  ('hr','الموارد البشرية'), ('call_center','مركز الاتصال'), ('loyalty','الولاء والتسويق'),
  ('housing','السكن'), ('orders','الطلبات'), ('rating','التقييم'), ('rbac','الصلاحيات'),
  ('reports','التقارير'), ('targets','الأهداف')
) as m(code, name_ar)
cross join (values
  ('view','عرض'), ('create','إنشاء'), ('edit','تعديل'), ('delete','حذف'),
  ('approve','اعتماد'), ('export','تصدير'), ('manage','إدارة')
) as a(code, name_ar)
on conflict (module, action) do nothing;

-- ---------- role_permissions (seed of the matrix in section 2) ----------
create table role_permissions (
  role_code text not null references roles(code) on delete cascade,
  module    text not null,
  action    text not null,
  primary key (role_code, module, action)
);

-- symbols:  full = view+create+edit+delete+approve+export · edit = view+create+edit
--           view = view · manage = view+manage
insert into role_permissions (role_code, module, action)
select g.role_code, g.module, act
from (values
  -- المدير العام (admin) — full everywhere + rbac.manage
  ('admin','contracts','full'),('admin','gps','full'),('admin','pricing','full'),('admin','payments','full'),
  ('admin','hr','full'),('admin','call_center','full'),('admin','loyalty','full'),('admin','housing','full'),
  ('admin','orders','full'),('admin','rating','full'),('admin','rbac','manage'),('admin','reports','full'),('admin','targets','full'),
  -- مدير العمليات
  ('operations_manager','contracts','full'),('operations_manager','gps','full'),('operations_manager','pricing','full'),
  ('operations_manager','payments','view'),('operations_manager','hr','view'),('operations_manager','call_center','full'),
  ('operations_manager','loyalty','full'),('operations_manager','housing','full'),('operations_manager','orders','full'),
  ('operations_manager','rating','full'),('operations_manager','reports','full'),('operations_manager','targets','full'),
  -- مدير الفرع
  ('branch_manager','contracts','full'),('branch_manager','gps','view'),('branch_manager','pricing','edit'),
  ('branch_manager','payments','view'),('branch_manager','hr','view'),('branch_manager','call_center','edit'),
  ('branch_manager','loyalty','edit'),('branch_manager','housing','view'),('branch_manager','orders','full'),
  ('branch_manager','rating','view'),('branch_manager','reports','view'),('branch_manager','targets','full'),
  -- المبيعات
  ('sales','contracts','edit'),('sales','pricing','edit'),('sales','call_center','view'),('sales','loyalty','edit'),
  ('sales','orders','edit'),('sales','rating','view'),('sales','reports','view'),('sales','targets','view'),
  -- مركز الاتصال
  ('call_center','contracts','view'),('call_center','gps','view'),('call_center','pricing','view'),
  ('call_center','call_center','full'),('call_center','loyalty','edit'),('call_center','orders','edit'),
  ('call_center','rating','edit'),('call_center','targets','view'),
  -- السائق (تطبيق الجوال)
  ('driver','gps','edit'),('driver','orders','edit'),('driver','targets','view'),
  -- مشرفة السكن (تطبيق الجوال)
  ('housing_supervisor','housing','full'),
  -- الموارد البشرية
  ('hr','hr','full'),('hr','housing','view'),('hr','reports','view'),
  -- المحاسب
  ('accountant','contracts','view'),('accountant','pricing','view'),('accountant','payments','full'),
  ('accountant','hr','view'),('accountant','loyalty','view'),('accountant','orders','view'),
  ('accountant','reports','full'),('accountant','targets','view'),
  -- المكتب الخارجي (تعديل محدود)
  ('external_office','contracts','edit')
) as g(role_code, module, sym)
cross join lateral unnest(
  case g.sym
    when 'full'   then array['view','create','edit','delete','approve','export']
    when 'edit'   then array['view','create','edit']
    when 'view'   then array['view']
    when 'manage' then array['view','manage']
    else array[]::text[]
  end
) as act
on conflict do nothing;

-- ---------- extend existing user_profiles / audit_log ----------
alter table user_profiles add column if not exists phone       text;
alter table user_profiles add column if not exists national_id text;
alter table user_profiles add column if not exists created_by  uuid references auth.users(id) on delete set null;

alter table audit_log add column if not exists entity  text;
alter table audit_log add column if not exists details jsonb;

-- ---------- helper functions (SECURITY DEFINER — used by every RLS policy) ----------
create or replace function get_my_role()
returns text language sql stable security definer set search_path = public
as $$ select role::text from user_profiles where id = auth.uid() $$;

create or replace function get_my_branch()
returns uuid language sql stable security definer set search_path = public
as $$ select branch_id from user_profiles where id = auth.uid() $$;

create or replace function is_cross_branch()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(get_my_role() in ('admin','operations_manager','hr','accountant'), false) $$;

create or replace function has_perm(p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from role_permissions rp
    where rp.role_code = get_my_role() and rp.module = p_module and rp.action = p_action
  )
$$;

-- The current user's full permission set — lets the UI build a dynamic
-- sidebar without granting read on role_permissions itself.
create or replace function my_permissions()
returns table(module text, action text)
language sql stable security definer set search_path = public
as $$ select module, action from role_permissions where role_code = get_my_role() $$;

grant execute on function get_my_role(), get_my_branch(), is_cross_branch(),
  has_perm(text, text), my_permissions() to anon, authenticated;

-- ---------- RLS: RBAC tables are general-manager only ----------
alter table roles            enable row level security;
alter table permissions      enable row level security;
alter table role_permissions enable row level security;

create policy roles_gm on roles for all to authenticated
  using (has_perm('rbac','manage')) with check (has_perm('rbac','manage'));
create policy perms_gm on permissions for all to authenticated
  using (has_perm('rbac','manage')) with check (has_perm('rbac','manage'));
create policy rp_gm on role_permissions for all to authenticated
  using (has_perm('rbac','manage')) with check (has_perm('rbac','manage'));

-- general manager may manage all user_profiles (additive to existing policies)
create policy up_rbac_manage on user_profiles for all to authenticated
  using (has_perm('rbac','manage')) with check (has_perm('rbac','manage'));
