import { useQuery } from '@tanstack/react-query';
import { getRequestService } from '@/features/requests/services';
import type { TrackedRequest } from '@/features/requests/services/types';

export type { TrackedRequest } from '@/features/requests/services/types';

/**
 * تتبّع الطلب برقمه عبر خدمة الطلبات. null = لا يوجد طلب بهذا الرقم؛ أي فشل آخر
 * يظهر كحالة خطأ — لا سجلات مختلقة.
 */
export function useServiceRequest(requestNo: string, enabled: boolean) {
  return useQuery<TrackedRequest | null>({
    queryKey: ['service-request', requestNo.trim().toUpperCase()],
    enabled,
    retry: false,
    queryFn: () => getRequestService().track(requestNo),
  });
}
