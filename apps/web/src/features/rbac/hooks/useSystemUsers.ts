import { useQuery } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { listSystemUsers } from '@/features/rbac/api/rbac.api';

export function useSystemUsers() {
  return useQuery({
    queryKey: ['rbac', 'users'],
    queryFn: listSystemUsers,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
