import { useQuery } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { listRatings } from '@/features/rating/api/rating.api';

export function useRatings() {
  return useQuery({
    queryKey: ['rating', 'list'],
    queryFn: listRatings,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
