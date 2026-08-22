import { useQuery } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { listTargets } from '@/features/targets/api/targets.api';

export function useTargets() {
  return useQuery({
    queryKey: ['targets', 'list'],
    queryFn: listTargets,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
