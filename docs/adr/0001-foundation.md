# ADR 0001 — Production Foundation

**Status:** Accepted · **Date:** 2026-06

## Context

The ERP must scale to 13 feature modules with strict quality. We need a
foundation that enforces type safety, a consistent design system, and
backend-first security.

## Decisions

1. **Feature-based architecture** under `src/features/*`; cross-cutting code in
   `src/shared` (`ui`, `lib`, `hooks`, `types`) and app shell in `src/app`.
2. **Strict TypeScript** — `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `noImplicitOverride`. `any` is forbidden.
3. **Zod** as the single validation source; boot-time env validation (`shared/lib/env.ts`).
4. **Data layer**: one typed Supabase client (`shared/lib/supabase.ts`), React
   Query for all server state with a central key factory (`shared/lib/queryKeys.ts`),
   Zustand for UI-only state.
5. **No Supabase calls in components** — only through `api` → `hooks`.
6. **Security is RLS-first** — the UI only hides; it never enforces. No
   `service_role` key ships to the client; sensitive ops go through Edge Functions.
7. **Design system** in `shared/ui` (Button, Input, Select, Card, Badge, Modal,
   Toast, Skeleton, EmptyState, ErrorState) on the Masiat identity + Alexandria,
   RTL-native, WCAG AA. Every data view handles loading / empty / error / success.

## Known follow-ups (need access/secrets unavailable in the sandbox)

- `database.types.ts` generation via `supabase gen types` (needs project access).
- Migrate ESLint to flat config (currently legacy `.eslintrc.cjs`, passing).
- Sentry wiring (needs DSN); Playwright browser install for E2E.
- GitHub Actions CI lives in `.github/workflows/ci.yml` — pushing it needs a
  token with the `workflow` scope.
