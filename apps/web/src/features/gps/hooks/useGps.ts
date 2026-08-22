import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { listDriverLocations, listRecentScans, logTripScan } from '@/features/gps/api/gps.api';

export function useDriverLocations() {
  return useQuery({
    queryKey: ['gps', 'locations'],
    queryFn: listDriverLocations,
    staleTime: 30_000,
  });
}

export function useRecentScans() {
  return useQuery({
    queryKey: ['gps', 'scans'],
    queryFn: listRecentScans,
    staleTime: 30_000,
  });
}

export function useLogTripScan() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    { worker_name: string; scan_label: string },
    Error,
    { barcode: string; scanType: string; lat?: number | null; lng?: number | null }
  >({
    mutationFn: ({ barcode, scanType, lat, lng }) => logTripScan(barcode, scanType, lat, lng),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['gps', 'trip-scans'] });
      toast.success(`تم: ${r.scan_label} — ${r.worker_name}`);
    },
    onError: (e) => toast.error(e.message || 'تعذّر تسجيل المسح'),
  });
}
