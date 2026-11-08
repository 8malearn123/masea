import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  autoScores,
  listBands,
  listCriteria,
  listReviews,
  listTargets,
  saveBand,
  saveCriterion,
  saveReview,
  saveTarget,
  setReviewActive,
  targetBoard,
} from '@/features/hr/api/performance.api';
import { DEFAULT_BANDS } from '@/features/hr/lib/performanceEngine';
import type { PerfBand, PerfCriterion, PerfReviewInput, PerfTarget } from '@/features/hr/types';

export const PERF_KEY = ['hr', 'performance'] as const;

export function usePerformanceReviews() {
  return useQuery({
    queryKey: [...PERF_KEY, 'reviews'],
    queryFn: listReviews,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function usePerfCriteria() {
  return useQuery({
    queryKey: [...PERF_KEY, 'criteria'],
    queryFn: listCriteria,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
/** Rating bands (seeds stand in until loaded). */
export function usePerfBands(): PerfBand[] {
  const { data } = useQuery({
    queryKey: [...PERF_KEY, 'bands'],
    queryFn: listBands,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
  return data ?? DEFAULT_BANDS;
}
export function usePerfTargets() {
  return useQuery({
    queryKey: [...PERF_KEY, 'targets'],
    queryFn: listTargets,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function usePerfAuto(employeeId: string, from: string, to: string) {
  return useQuery({
    queryKey: [...PERF_KEY, 'auto', employeeId, from, to],
    queryFn: () => autoScores(employeeId, from, to),
    enabled: !!employeeId && !!from && !!to && from <= to,
    staleTime: 30_000,
  });
}
export function useTargetBoard(period: string) {
  return useQuery({
    queryKey: [...PERF_KEY, 'board', period],
    queryFn: () => targetBoard(period),
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

function usePerfMutation<V>(fn: (v: V) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, Error, V>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PERF_KEY });
      toast.success(ok);
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}

export const useSaveReview = () =>
  usePerfMutation((v: PerfReviewInput) => saveReview(v), 'تم حفظ التقييم');
export const useSetReviewActive = () =>
  usePerfMutation(
    (v: { id: string; active: boolean }) => setReviewActive(v.id, v.active),
    'تم تحديث التقييم',
  );
export const useSaveCriterion = () =>
  usePerfMutation(
    (v: { item: PerfCriterion; isNew: boolean }) => saveCriterion(v.item, v.isNew),
    'تم حفظ المعيار',
  );
export const useSaveBand = () =>
  usePerfMutation(
    (v: { item: PerfBand; isNew: boolean }) => saveBand(v.item, v.isNew),
    'تم حفظ التقدير',
  );
export const useSaveTarget = () =>
  usePerfMutation(
    (v: Omit<PerfTarget, 'id' | 'employee_name' | 'branch'>) => saveTarget(v),
    'تم حفظ المستهدف',
  );
