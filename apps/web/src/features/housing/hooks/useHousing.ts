import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  listDorms,
  listHousingScans,
  listMyHousingTargets,
  listResidents,
  logHousingScan,
  markAttendance,
} from '@/features/housing/api/housing.api';
import type { Resident, ResidentStatus, ScanDirection } from '@/features/housing/types';

export function useDorms() {
  return useQuery({
    queryKey: ['housing', 'dorms'],
    queryFn: listDorms,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useResidents() {
  return useQuery({
    queryKey: ['housing', 'residents'],
    queryFn: listResidents,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useHousingScans(workerId?: string) {
  return useQuery({
    queryKey: ['housing', 'scans', workerId ?? 'all'],
    queryFn: () => listHousingScans(workerId),
  });
}

export function useMyHousingTargets() {
  return useQuery({
    queryKey: ['housing', 'targets'],
    queryFn: listMyHousingTargets,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useMarkAttendance() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; status: ResidentStatus }>({
    mutationFn: ({ id, status }) => markAttendance(id, status),
    onMutate: ({ id, status }) => {
      qc.setQueryData<Resident[]>(['housing', 'residents'], (old) =>
        old?.map((r) => (r.id === id ? { ...r, status } : r)),
      );
    },
    onSuccess: () => toast.success('تم تسجيل الحضور'),
    onError: (e) => toast.error(e.message || 'تعذّر تسجيل الحضور'),
  });
}

export function useLogHousingScan() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    Resident,
    Error,
    { code: string; direction: ScanDirection; note: string | null }
  >({
    mutationFn: ({ code, direction, note }) => logHousingScan(code, direction, note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['housing', 'scans'] });
      toast.success('تم تسجيل الحركة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تسجيل المسح'),
  });
}
