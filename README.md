# ماسية الشرق للاستقدام — نظام ERP

**Masiat Alsharq Recruitment Co.** ERP — full-stack recruitment & operations platform.

| | |
|---|---|
| **العميل / Client** | ماسية الشرق للاستقدام · Masiat Alsharq Recruitment Co. |
| **المطوّر / Vendor** | قمة كود · Qimmah Code |
| **رقم العقد / Contract** | QUO-000105 |
| **الفروع / Branches** | نجران · جازان · شرورة · حبونا |

> الواجهة عربية بالكامل (RTL) — لا يوجد احتياطي LTR.

---

## 🎨 Brand

| Token | Value | Usage |
|---|---|---|
| Navy | `#1B1564` | Product primary |
| Gold | `#C8970A` | Product accent |
| Purple | `#564E85` | UI vendor primary |
| Teal | `#58B3B3` | UI vendor secondary |
| Font (text) | **Alexandria** (7 weights) | Arabic UI |
| Font (numbers) | **JetBrains Mono** | All numerals (`.num`) |

Centralised in [`packages/shared/src/brand.ts`](packages/shared/src/brand.ts) and the Tailwind theme.

---

## 🧱 Tech Stack

- **Web:** React 18 + TypeScript + Vite + Tailwind CSS
- **State:** Zustand + TanStack Query v5
- **Backend:** Supabase (PostgreSQL + RLS + Realtime + Auth)
- **Mobile:** Expo / React Native — Driver app + Housing Supervisor app
- **Payments:** Moyasar (Mada + Apple Pay) + Tamara + HyperPay
- **Notifications:** Twilio (WhatsApp + SMS)
- **Maps/GPS:** Google Maps + react-native-maps
- **Barcode:** expo-camera + expo-barcode-scanner
- **Reports:** jsPDF + xlsx + Recharts
- **CI/CD:** GitHub Actions → Vercel (web) + EAS Build (mobile)

---

## 📁 Monorepo Structure

```
.
├── apps/
│   ├── web/         # React + Vite admin/ops dashboard
│   ├── driver/      # Expo — driver barcode/GPS scanning app
│   └── housing/     # Expo — housing supervisor attendance app
├── packages/
│   └── shared/      # Brand, enums, domain types, Arabic labels
├── supabase/
│   ├── migrations/  # 0001…0010 schema, triggers, RLS
│   ├── seed.sql     # 4 branches + sample data
│   └── config.toml
└── .github/workflows/  # web.yml, mobile.yml
```

---

## 🗄️ Database

Full schema lives in [`supabase/migrations/`](supabase/migrations/), applied in order:

| File | Contents |
|---|---|
| `0001_extensions_and_enums.sql` | pgcrypto + all ENUM types |
| `0002_core_tables.sql` | branches, workers, customers, drivers |
| `0003_contracts_payments.sql` | contracts (generated VAT/total), payments, scans_log, absence_reports, penalties |
| `0004_hr.sql` | employees, attendance, payroll, leave_requests, shifts |
| `0005_loyalty_marketing.sql` | loyalty_transactions, campaigns, abandoned_carts, referrals |
| `0006_targets_housing.sql` | targets, target_progress, rewards, housing_dorms, housing_attendance |
| `0007_system.sql` | user_profiles, notifications, audit_log, faq_items + role helpers |
| `0008_triggers.sql` | **all 5 trigger groups** (see below) |
| `0009_rls.sql` | Row Level Security on every table |
| `0010_auth_profile.sql` | auto-provision `user_profiles` on signup |

### Triggers implemented

1. `scans_log` INSERT → auto-update `workers.status`
2. `contracts` completed → compute `late_return_days` → insert `penalties`
3. `contracts` INSERT → bump `target_progress` for the creating user
4. `loyalty_transactions` INSERT → update `customers.loyalty_points` + `wallet_balance`
5. `payroll` INSERT/UPDATE → validate & normalize GOSI rates by nationality

### Generated columns

`contracts.vat_amount = base_amount × 0.15`, `total_amount = base_amount × 1.15` (stored).

---

## 🚀 Getting Started

### Prerequisites
- Node ≥ 20
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### 1. Install
```bash
npm install
```

### 2. Database
```bash
supabase start          # local stack
supabase db reset       # applies migrations + seed.sql
```
Or push to a hosted project: `supabase db push`.

### 3. Web app
```bash
cp apps/web/.env.example apps/web/.env   # fill VITE_SUPABASE_*
npm run dev                               # http://localhost:5173
```

### 4. Mobile apps
```bash
cd apps/driver && npm install && npm start
cd apps/housing && npm install && npm start
```
Set `supabaseUrl` / `supabaseAnonKey` in each app's `app.json → expo.extra`.

---

## 👥 Roles (RBAC)

`admin`, `operations_manager`, `branch_manager`, `sales`, `call_center`, `driver`,
`housing_supervisor`, `hr`, `accountant`, `external_office`.

RLS scopes data by branch; `admin` / `operations_manager` see all branches.
Sidebar navigation is role-filtered ([`apps/web/src/nav.ts`](apps/web/src/nav.ts)).

---

## 🛠️ Engineering standards

Architecture, type safety, design system, and quality gates are described in
[`docs/adr/0001-foundation.md`](docs/adr/0001-foundation.md). Every module follows
[`docs/FEATURE_TEMPLATE.md`](docs/FEATURE_TEMPLATE.md). DB overview:
[`database/ER.md`](database/ER.md).

```
apps/web/src/
  app/        # app shell: ErrorBoundary, providers
  features/   # one folder per module (components / hooks / api / schemas / types)
  shared/
    ui/       # design system (Button, Input, Select, Card, Badge, Modal, Toast, Skeleton, EmptyState, ErrorState)
    lib/      # env (Zod), supabase client, queryKeys, formatters, pricing
    hooks/    # shared hooks
    types/    # shared + generated database types
  test/       # test setup
```

### Commands

| Command | What |
|---|---|
| `npm run dev` | dev server |
| `npm run lint` | ESLint (0 warnings allowed) |
| `npm run typecheck` | strict `tsc --noEmit` |
| `npm run test` | Vitest unit tests (critical logic) |
| `npm run build` | type-check + production build |
| `npm run format` | Prettier (+ Tailwind class ordering) |
| `npm run e2e` | Playwright E2E (needs `npx playwright install`) |

Pre-commit runs `lint-staged` (typecheck + format) via Husky. CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint + typecheck +
test + build on every PR.

### Environment

`apps/web/.env` (validated at boot by `src/shared/lib/env.ts`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## ✅ Build status

- `packages/shared` — brand, types, labels ✔
- `apps/web` — auth, layout, dashboard (KPIs + chart), Workers / Customers / Contracts modules ✔ (builds clean)
- Remaining web modules scaffolded as role-aware routes, built on the shared `DataTable` pattern.
- `apps/driver` — barcode scan + GPS scan logging ✔
- `apps/housing` — daily attendance marking ✔
- Supabase schema, triggers, RLS, seed ✔
- CI/CD workflows ✔

See [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) for payments & notifications wiring.

---

© Qimmah Code (قمة كود) — Contract QUO-000105.
