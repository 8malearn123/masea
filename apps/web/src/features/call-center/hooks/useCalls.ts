import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { addCall, listCalls, updateCallStatus } from '@/features/call-center/api/calls.api';
import type { CallLog, CallStatus, NewCallInput } from '@/features/call-center/types';

const KEY = ['call-center', 'calls'] as const;

export function useCalls() {
  return useQuery({ queryKey: KEY, queryFn: listCalls, staleTime: QUERY_DEFAULTS.staleTime });
}

export function useUpdateCallStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { id: string; status: CallStatus },
    { prev: CallLog[] | undefined }
  >({
    mutationFn: ({ id, status }) => updateCallStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<CallLog[]>(KEY);
      qc.setQueryData<CallLog[]>(KEY, (old) =>
        old?.map((c) => (c.id === id ? { ...c, status } : c)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error(e.message || 'تعذّر تحديث الحالة');
    },
    onSuccess: () => toast.success('تم تحديث حالة المكالمة'),
  });
}

export function useAddCall() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<CallLog, Error, NewCallInput>({
    mutationFn: (input) => addCall(input),
    onSuccess: (call) => {
      qc.setQueryData<CallLog[]>(KEY, (old) => [call, ...(old ?? [])]);
      toast.success('تم تسجيل المكالمة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تسجيل المكالمة'),
  });
}
