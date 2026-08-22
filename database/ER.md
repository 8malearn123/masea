# Database schema (ER overview)

Source of truth: `supabase/migrations/*.sql`. Regenerate types with
`supabase gen types typescript`.

## Core

- **branches** (نجران، جازان، شرورة، حبونا) ← referenced by most tables via `branch_id`.
- **user_profiles** `1:1 auth.users` — `role` (app_role), `branch_id`, `is_active`,
  `phone`, `national_id`, `created_by`.

## RBAC (module 11) — 0013

- **roles** (code, name_ar, is_cross_branch)
- **permissions** (module, action, label) — unique(module, action)
- **role_permissions** (role_code → roles, module, action) — the matrix
- helpers: `get_my_role()`, `get_my_branch()`, `is_cross_branch()`,
  `has_perm(module, action)`, `my_permissions()` — all SECURITY DEFINER, used by RLS.

## Operations

- **workers**, **customers**, **drivers**, **contracts**, **payments**, …
  (branch-scoped, RLS via `get_my_branch()` / `is_cross_branch()`).

## Customer funnel (B2C) — 0011/0012

- **services** (catalog), **worker_profiles** (public showcase),
  **pricing_rules**, **service_requests** (order pipeline).
- `calc_price(service_code, params) → {base, vat, total}` (VAT 15%, SECURITY DEFINER).

## RLS principles

- Cross-branch roles (admin, operations_manager, hr, accountant) see all branches.
- Other roles are restricted to `branch_id = get_my_branch()`.
- Public (anon): read `services` + available `worker_profiles`; insert
  `service_requests` + `customers`. No public read of internal data.
