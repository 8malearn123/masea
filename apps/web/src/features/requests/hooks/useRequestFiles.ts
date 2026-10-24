import { useQuery } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { getRequestService } from '@/features/requests/services';

export function useRequestFiles() {
  return useQuery({
    queryKey: ['request_files', 'list'],
    queryFn: () => getRequestService().listFiles(),
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useRequestFile(requestNo: string) {
  return useQuery({
    queryKey: ['request_files', requestNo],
    queryFn: () => getRequestService().getFile(requestNo),
    enabled: requestNo.length > 0,
  });
}

/** مصدر الطلبات الحالي — لعرض وسم «تجريبي» وإخفاء ما لا يدعمه التنفيذ. */
export function useRequestBackend() {
  const service = getRequestService();
  return { backend: service.backend, supportsRequestFile: service.supportsRequestFile };
}
