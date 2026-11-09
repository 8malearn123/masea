import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  approveWorkerRun,
  calculateWorkerRun,
  decideWorkerAdjustment,
  getWorkerRun,
  listWorkerAdjustments,
  proposeWorkerAbsences,
  submitWorkerAdjustment,
  type NewWorkerAdjustment,
} from '@/features/hr/api/workerPayroll.api';

export const WORKER_PAYROLL_KEY = ['hr', 'worker-payroll'] as const;

export function useWorkerRun(period: string) {
  return useQuery({
    queryKey: [...WORKER_PAYROLL_KEY, 'run', period],
    queryFn: () => getWorkerRun(period),
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function useWorkerAdjustments(period: string) {
  return useQuery({
    queryKey: [...WORKER_PAYROLL_KEY, 'adjustments', period],
    queryFn: () => listWorkerAdjustments(period),
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

function useWp<V, R = unknown>(fn: (v: V) => Promise<R>, ok: (r: R) => string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<R, Error, V>({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: WORKER_PAYROLL_KEY });
      toast.success(ok(r));
    },
    onError: (e) => toast.error(e.message || 'تعذّر تنفيذ العملية'),
  });
}

export const useSubmitWorkerAdjustment = () =>
  useWp(
    (v: NewWorkerAdjustment) => submitWorkerAdjustment(v),
    () => 'رُفع التعديل بانتظار الاعتماد',
  );
export const useDecideWorkerAdjustment = () =>
  useWp(
    (v: { id: string; approve: boolean }) =>
      decideWorkerAdjustment(v.id, v.approve).then(() => v.approve),
    (approved) => (approved ? 'تم اعتماد التعديل' : 'تم رفض التعديل'),
  );
export const useProposeWorkerAbsences = () =>
  useWp(
    (period: string) => proposeWorkerAbsences(period),
    (n) =>
      n
        ? `اقتُرح خصم غياب لـ ${n} عاملة — بانتظار الاعتماد`
        : 'لا يوجد غياب مسجّل في السكن لهذا الشهر',
  );
export const useCalculateWorkerRun = () =>
  useWp(
    (period: string) => calculateWorkerRun(period),
    () => 'تم احتساب مسير العاملات',
  );
export const useApproveWorkerRun = () =>
  useWp(
    (v: { period: string; runId: string }) => approveWorkerRun(v.period, v.runId),
    () => 'تم اعتماد مسير العاملات',
  );
