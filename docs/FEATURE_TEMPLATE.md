# Feature build template

Every one of the 13 modules is built in this fixed order, one module per task:

```
src/features/<feature>/
  schemas/      # Zod schemas — single source of truth for types (z.infer)
  api/          # Supabase calls ONLY here (no calls in components)
  hooks/        # React Query hooks (keys via shared/lib/queryKeys)
  components/   # UI with loading / empty / error / success states
  types.ts      # feature-local types derived from schemas
```

## Order of work

1. **Schema + DB** — Zod schema + migration + RLS + seed. Confirm it runs.
2. **Data** — `api` layer + React Query `hooks` (optimistic where it helps,
   precise invalidation after mutations).
3. **UI** — components built on `shared/ui`, handling all four states.
4. **Tests** — unit tests for critical logic (VAT, payroll, GOSI, rewards,
   permission helpers) + an RLS test (a role cannot read another branch).
5. **Verify** on the dev server before moving on.

## Definition of done

- `lint`, `typecheck`, `test`, `build` all green.
- No `any`, no silent `catch`, no white screens.
- Security verified in the backend (RLS), not just hidden in the UI.
