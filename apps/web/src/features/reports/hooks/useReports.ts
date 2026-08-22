import { useQuery } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { getReports } from '@/features/reports/api/reports.api';

export function useReports() {
  return useQuery({
    queryKey: ['reports', 'overview'],
    queryFn: getReports,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
