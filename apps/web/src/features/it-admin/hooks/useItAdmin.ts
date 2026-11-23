import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import {
  cancelRequest,
  decideRequest,
  executeRequest,
  getOwnership,
  listAccounts,
  listRequests,
  submitRequest,
  updateOwnership,
  type AccountRequest,
  type OwnershipInput,
  type RequestInput,
} from '@/features/it-admin/api/itAdmin.api';

export const itKeys = {
  all: ['it-admin'] as const,
  ownership: () => ['it-admin', 'ownership'] as const,
  accounts: () => ['it-admin', 'accounts'] as const,
  requests: () => ['it-admin', 'requests'] as const,
};

export function useOwnership() {
  return useQuery({ queryKey: itKeys.ownership(), queryFn: getOwnership });
}
export function useMailAccounts() {
  return useQuery({ queryKey: itKeys.accounts(), queryFn: listAccounts });
}
export function useAccountRequests() {
  return useQuery({ queryKey: itKeys.requests(), queryFn: listRequests });
}

function useItMutation<TVars>(fn: (v: TVars) => Promise<void>, success: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itKeys.all });
      toast.success(success);
    },
    onError: (e) => toast.error(e.message || 'تعذّر تنفيذ العملية'),
  });
}

export function useUpdateOwnership() {
  return useItMutation((v: OwnershipInput) => updateOwnership(v), 'حُفظت بيانات الملكية');
}
export function useSubmitRequest() {
  return useItMutation(
    (v: RequestInput) => submitRequest(v),
    'سُجّل الطلب — بانتظار اعتماد مستخدم آخر',
  );
}
export function useDecideRequest() {
  return useItMutation(
    ({
      r,
      approve,
      note,
    }: {
      r: Pick<AccountRequest, 'id'>;
      approve: boolean;
      note?: string | undefined;
    }) => decideRequest(r, approve, note),
    'سُجّل القرار',
  );
}
export function useExecuteRequest() {
  return useItMutation(
    ({ r, note }: { r: Pick<AccountRequest, 'id'>; note?: string | undefined }) =>
      executeRequest(r, note),
    'سُجّل التنفيذ',
  );
}
export function useCancelRequest() {
  return useItMutation((r: Pick<AccountRequest, 'id'>) => cancelRequest(r), 'أُلغي الطلب');
}
