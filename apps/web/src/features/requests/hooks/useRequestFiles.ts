import { useQuery } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { getRequestFile, listRequestFiles } from '@/features/requests/api/requests.api';

export function useRequestFiles() {
  return useQuery({
    queryKey: ['request_files', 'list'],
    queryFn: listRequestFiles,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useRequestFile(requestNo: string) {
  return useQuery({
    queryKey: ['request_files', requestNo],
    queryFn: () => getRequestFile(requestNo),
    enabled: requestNo.length > 0,
  });
}
