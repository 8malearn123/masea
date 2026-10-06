import { Card, ErrorState, Skeleton } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { useContracts } from '@/features/contracts/hooks/useContracts';
import { ExpiryAlerts } from '@/features/contracts/components/ExpiryAlerts';
import type { ContractFilters } from '@/features/contracts/types';

const ALL: ContractFilters = { status: 'all', service: 'all', branch: 'all', search: '' };

/**
 * ملخّص تنبيهات انتهاء العقود في لوحة التحكم. يظهر فقط لمن يملك صلاحية عرض
 * العقود، وبياناته نفس قائمة العقود (RLS ونطاق الفرع مطبّقان في الجلب)، فلا
 * يرى المستخدم إلا العقود المسموح له بها. عند فشل الجلب يظهر خطأ — لا «لا تنبيهات».
 */
export function ContractExpiryWidget() {
  const { can } = usePermissions();
  if (!can('contracts', 'view')) return null;
  return <ContractExpiryWidgetBody />;
}

function ContractExpiryWidgetBody() {
  const { data, isLoading, isError, refetch } = useContracts(ALL);

  if (isLoading) {
    return (
      <Card data-testid="expiry-alerts-loading">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState
        title="تعذّر تحميل تنبيهات العقود"
        description="لم نتمكن من جلب العقود — لا يمكن عرض حالة الانتهاء الآن."
        onRetry={() => void refetch()}
      />
    );
  }
  return <ExpiryAlerts contracts={data} variant="dashboard" />;
}
