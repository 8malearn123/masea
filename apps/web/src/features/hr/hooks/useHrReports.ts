import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { listNitaqat, reportRows, saveNitaqat } from '@/features/hr/api/hrReports.api';
import { DEFAULT_NITAQAT } from '@/features/hr/lib/hrReports';
import type { NitaqatBand } from '@/features/hr/types';

export const HR_REPORTS_KEY = ['hr', 'reports'] as const;

export function useHrReportRows(from: string, to: string) {
  return useQuery({
    queryKey: [...HR_REPORTS_KEY, from, to],
    queryFn: () => reportRows(from, to),
    enabled: !!from && !!to && from <= to,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useNitaqatBands(): NitaqatBand[] {
  const { data } = useQuery({
    queryKey: [...HR_REPORTS_KEY, 'nitaqat'],
    queryFn: listNitaqat,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
  return data ?? DEFAULT_NITAQAT;
}

export function useSaveNitaqat() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { item: NitaqatBand; isNew: boolean }>({
    mutationFn: ({ item, isNew }) => saveNitaqat(item, isNew),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...HR_REPORTS_KEY, 'nitaqat'] });
      toast.success('تم حفظ النطاق');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}
