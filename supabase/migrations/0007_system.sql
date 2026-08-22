-- =============================================================
-- Masiat Alsharq ERP — 0007 System Tables
-- =============================================================

create table user_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       app_role not null default 'sales',
  branch_id  uuid references branches(id) on delete set null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_user_profiles_branch on user_profiles(branch_id);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  title      text not null,
  body       text,
  type       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on notifications(user_id, is_read);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  action     text,
  table_name text,
  record_id  uuid,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);

create table faq_items (
  id        uuid primary key default gen_random_uuid(),
  question  text not null,
  answer    text,
  category  text,
  is_active boolean not null default true,
  views     integer not null default 0
);

-- Helper: current user's role / branch (used by RLS, SECURITY DEFINER to avoid recursion)
create or replace function current_role_name()
returns app_role
language sql stable security definer set search_path = public
as $$ select role from user_profiles where id = auth.uid() $$;

create or replace function current_branch_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select branch_id from user_profiles where id = auth.uid() $$;

create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(current_role_name() in ('admin','operations_manager'), false) $$;
