import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import Layout from '@/components/Layout';
import { RequirePerm } from '@/components/RequirePerm';
import { Spinner } from '@/shared/ui';

// Route-level code splitting (lazy + Suspense).
const Login = lazy(() => import('@/pages/Login'));
const OrderLanding = lazy(() => import('@/pages/order/OrderLanding'));
const OrderWizard = lazy(() => import('@/pages/order/OrderWizard'));
const OrderTracking = lazy(() => import('@/pages/order/OrderTracking'));
const WorkerCatalog = lazy(() => import('@/features/catalog/components/WorkerCatalog'));
const WorkerProfile = lazy(() => import('@/features/catalog/components/WorkerProfile'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const ContractsList = lazy(() => import('@/features/contracts/components/ContractsList'));
const ContractWizard = lazy(() => import('@/features/contracts/components/ContractWizard'));
const ContractDetails = lazy(() => import('@/features/contracts/components/ContractDetails'));
const PipelineBoard = lazy(() => import('@/features/crm/components/PipelineBoard'));
const OrdersBoard = lazy(() => import('@/features/orders/components/OrdersBoard'));
const GpsTracking = lazy(() => import('@/features/gps/components/GpsTracking'));
const PricingBoard = lazy(() => import('@/features/pricing/components/PricingBoard'));
const PaymentsBoard = lazy(() => import('@/features/payments/components/PaymentsBoard'));
const PaymentCheckout = lazy(() => import('@/features/payments/components/PaymentCheckout'));
const PaymentSuccess = lazy(() => import('@/features/payments/components/PaymentSuccess'));
const CallCenterBoard = lazy(() => import('@/features/call-center/components/CallCenterBoard'));
const HrBoard = lazy(() => import('@/features/hr/components/HrBoard'));
const HousingBoard = lazy(() => import('@/features/housing/components/HousingBoard'));
const HousingScanPage = lazy(() => import('@/features/housing/components/ScanPage'));
const HousingReportPage = lazy(() => import('@/features/housing/components/ReportPage'));
const HousingAttendancePage = lazy(() => import('@/features/housing/components/AttendancePage'));
const HousingTargetsPage = lazy(() => import('@/features/housing/components/TargetsPage'));
const LoyaltyBoard = lazy(() => import('@/features/loyalty/components/LoyaltyBoard'));
const RatingBoard = lazy(() => import('@/features/rating/components/RatingBoard'));
const TargetsBoard = lazy(() => import('@/features/targets/components/TargetsBoard'));
const AccountingBoard = lazy(() => import('@/features/accounting/components/AccountingBoard'));
const ReportsBoard = lazy(() => import('@/features/reports/components/ReportsBoard'));
const RbacBoard = lazy(() => import('@/features/rbac/components/RbacBoard'));
const SettingsBoard = lazy(() => import('@/features/settings/components/SettingsBoard'));

function PageFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-navy">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export default function App() {
  const { session, loading, init } = useAuth();

  useEffect(() => {
    void init();
  }, [init]);

  if (loading) {
    return (
      <div className="grid h-screen place-items-center text-navy">
        <span className="animate-pulse text-sm">جارٍ التحميل…</span>
      </div>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      {!session ? (
        <Routes>
          {/* Public customer funnel is the home page */}
          <Route path="/" element={<OrderLanding />} />
          <Route path="/order" element={<Navigate to="/" replace />} />
          <Route path="/order/workers" element={<WorkerCatalog />} />
          <Route path="/order/workers/:id" element={<WorkerProfile />} />
          <Route path="/order/start" element={<OrderWizard />} />
          <Route path="/order/track" element={<OrderTracking />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          {/* Public customer funnel — also reachable while signed in */}
          <Route path="/order" element={<OrderLanding />} />
          <Route path="/order/workers" element={<WorkerCatalog />} />
          <Route path="/order/workers/:id" element={<WorkerProfile />} />
          <Route path="/order/start" element={<OrderWizard />} />
          <Route path="/order/track" element={<OrderTracking />} />
          <Route path="/login" element={<Navigate to="/" replace />} />

          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />

            <Route
              path="contracts"
              element={
                <RequirePerm module="contracts">
                  <ContractsList />
                </RequirePerm>
              }
            />
            <Route
              path="contracts/new"
              element={
                <RequirePerm module="contracts" action="create">
                  <ContractWizard />
                </RequirePerm>
              }
            />
            <Route
              path="contracts/:id"
              element={
                <RequirePerm module="contracts">
                  <ContractDetails />
                </RequirePerm>
              }
            />
            <Route
              path="leads"
              element={
                <RequirePerm module="leads">
                  <PipelineBoard />
                </RequirePerm>
              }
            />
            <Route
              path="orders"
              element={
                <RequirePerm module="orders">
                  <OrdersBoard />
                </RequirePerm>
              }
            />
            <Route
              path="gps"
              element={
                <RequirePerm module="gps">
                  <GpsTracking />
                </RequirePerm>
              }
            />
            <Route
              path="pricing"
              element={
                <RequirePerm module="pricing">
                  <PricingBoard />
                </RequirePerm>
              }
            />
            <Route
              path="payments"
              element={
                <RequirePerm module="payments">
                  <PaymentsBoard />
                </RequirePerm>
              }
            />
            <Route
              path="payments/pay/:id"
              element={
                <RequirePerm module="payments" action="edit">
                  <PaymentCheckout />
                </RequirePerm>
              }
            />
            <Route
              path="payments/success"
              element={
                <RequirePerm module="payments">
                  <PaymentSuccess />
                </RequirePerm>
              }
            />
            <Route
              path="call-center"
              element={
                <RequirePerm module="call_center">
                  <CallCenterBoard />
                </RequirePerm>
              }
            />
            <Route
              path="loyalty"
              element={
                <RequirePerm module="loyalty">
                  <LoyaltyBoard />
                </RequirePerm>
              }
            />
            <Route
              path="rating"
              element={
                <RequirePerm module="rating">
                  <RatingBoard />
                </RequirePerm>
              }
            />
            <Route
              path="hr"
              element={
                <RequirePerm module="hr">
                  <HrBoard />
                </RequirePerm>
              }
            />
            <Route
              path="hr/:section"
              element={
                <RequirePerm module="hr">
                  <HrBoard />
                </RequirePerm>
              }
            />
            <Route
              path="housing"
              element={
                <RequirePerm module="housing">
                  <HousingBoard />
                </RequirePerm>
              }
            />
            <Route
              path="housing/attendance"
              element={
                <RequirePerm module="housing" action="edit">
                  <HousingAttendancePage />
                </RequirePerm>
              }
            />
            <Route
              path="housing/targets"
              element={
                <RequirePerm module="housing">
                  <HousingTargetsPage />
                </RequirePerm>
              }
            />
            <Route
              path="housing/scan"
              element={
                <RequirePerm module="housing" action="edit">
                  <HousingScanPage />
                </RequirePerm>
              }
            />
            <Route
              path="housing/report"
              element={
                <RequirePerm module="housing">
                  <HousingReportPage />
                </RequirePerm>
              }
            />
            <Route
              path="targets"
              element={
                <RequirePerm module="targets">
                  <TargetsBoard />
                </RequirePerm>
              }
            />
            <Route
              path="accounting"
              element={
                <RequirePerm module="accounting">
                  <AccountingBoard />
                </RequirePerm>
              }
            />
            <Route
              path="reports"
              element={
                <RequirePerm module="reports">
                  <ReportsBoard />
                </RequirePerm>
              }
            />
            <Route
              path="rbac"
              element={
                <RequirePerm module="rbac" action="manage">
                  <RbacBoard />
                </RequirePerm>
              }
            />
            <Route
              path="settings"
              element={
                <RequirePerm module="settings" action="manage">
                  <SettingsBoard />
                </RequirePerm>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </Suspense>
  );
}
