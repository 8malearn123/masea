import { Suspense, lazy } from 'react';
import PageHeader from '@/components/PageHeader';
import { Spinner } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';

// Each role's dashboard is a heavy, mutually-exclusive view — the admin overview
// pulls recharts (~100 kB gzip), which no driver/HR/sales user should ever
// download. Lazy-load them so each role fetches only its own cockpit, and the
// charting library stays out of every non-admin path.
const CompanyOverview = lazy(() =>
  import('@/features/dashboard/components/CompanyOverview').then((m) => ({
    default: m.CompanyOverview,
  })),
);
const SalesDashboard = lazy(() =>
  import('@/features/crm/components/SalesDashboard').then((m) => ({ default: m.SalesDashboard })),
);
const DriverTrips = lazy(() =>
  import('@/features/orders/components/DriverTrips').then((m) => ({ default: m.DriverTrips })),
);
const CallCenterDashboard = lazy(() =>
  import('@/features/call-center/components/CallCenterDashboard').then((m) => ({
    default: m.CallCenterDashboard,
  })),
);
const HrDashboard = lazy(() =>
  import('@/features/hr/components/HrDashboard').then((m) => ({ default: m.HrDashboard })),
);
const AccountantDashboard = lazy(() =>
  import('@/features/accounting/components/AccountantDashboard').then((m) => ({
    default: m.AccountantDashboard,
  })),
);
const ExternalOfficeDashboard = lazy(() =>
  import('@/features/contracts/components/ExternalOfficeDashboard').then((m) => ({
    default: m.ExternalOfficeDashboard,
  })),
);

function DashboardBody() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-navy">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export default function Dashboard() {
  const { role } = usePermissions();

  // The driver's home is his personal trips portal — not company KPIs.
  if (role === 'driver') {
    return (
      <Suspense fallback={<DashboardBody />}>
        <DriverTrips />
      </Suspense>
    );
  }

  // The sales rep gets a personal sales cockpit (لوحتي), not company KPIs.
  if (role === 'sales') {
    return (
      <div>
        <PageHeader title="لوحتي" subtitle="قمرة قيادة المبيعات — أهدافي وخط مبيعاتي ومتابعاتي" />
        <Suspense fallback={<DashboardBody />}>
          <SalesDashboard />
        </Suspense>
      </div>
    );
  }

  // The call-center agent gets a live queue cockpit, not company KPIs.
  if (role === 'call_center') {
    return (
      <div>
        <PageHeader title="لوحة مركز الاتصال" subtitle="قائمة المكالمات والتذاكر والمتابعات" />
        <Suspense fallback={<DashboardBody />}>
          <CallCenterDashboard />
        </Suspense>
      </div>
    );
  }

  // HR gets a workforce cockpit (headcount, leave, expiring docs, payroll).
  if (role === 'hr') {
    return (
      <div>
        <PageHeader
          title="لوحة الموارد البشرية"
          subtitle="القوى العاملة والإجازات والوثائق والرواتب"
        />
        <Suspense fallback={<DashboardBody />}>
          <HrDashboard />
        </Suspense>
      </div>
    );
  }

  // The accountant gets a tailored financial dashboard instead of the
  // operational KPIs (workers/contracts) which are irrelevant to their role.
  if (role === 'accountant') {
    return (
      <div>
        <PageHeader title="لوحة التحكم المالية" subtitle="نظرة مالية عامة — المحاسب" />
        <Suspense fallback={<DashboardBody />}>
          <AccountantDashboard />
        </Suspense>
      </div>
    );
  }

  // The external office only follows up recruitment requests assigned to it —
  // a focused dashboard of those requests by stage, not company-wide KPIs.
  if (role === 'external_office') {
    return (
      <div>
        <PageHeader
          title="لوحة المكتب الخارجي"
          subtitle="طلبات الاستقدام المُسندة لمكتبك ومتابعتها"
        />
        <Suspense fallback={<DashboardBody />}>
          <ExternalOfficeDashboard />
        </Suspense>
      </div>
    );
  }

  // Admin / operations / branch managers — full company overview.
  return (
    <div>
      <PageHeader title="لوحة التحكم" subtitle="نظرة عامة على أداء الشركة" />
      <Suspense fallback={<DashboardBody />}>
        <CompanyOverview />
      </Suspense>
    </div>
  );
}
