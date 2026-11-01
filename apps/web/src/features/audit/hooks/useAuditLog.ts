import { useQuery } from '@tanstack/react-query';
import { listAuditLog, type AuditFilters } from '@/features/audit/api/audit.api';

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ['audit-log', filters],
    queryFn: () => listAuditLog(filters),
    staleTime: 30_000, // a trail must look fresh — short cache
  });
}
