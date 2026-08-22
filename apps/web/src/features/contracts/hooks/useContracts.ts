import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { contractKeys } from '@/features/contracts/api/keys';
import {
  createDraft,
  getClauses,
  getContract,
  getHistory,
  getSignatures,
  getTemplates,
  listContracts,
  setMusanedNo,
  signContract,
  transitionContract,
  type SignPayload,
} from '@/features/contracts/api/contracts.api';
import type {
  ContractFilters,
  ContractListItem,
  ContractSignature,
  ContractStatus,
  ContractStatusHistory,
  CreateContractInput,
} from '@/features/contracts/types';

const LIST_KEY = ['contracts', 'list'] as const;

function historyEntry(id: string, from: string | null, to: string): ContractStatusHistory {
  return {
    id: `h-${Date.now()}`,
    contract_id: id,
    from_status: from,
    to_status: to,
    changed_by: null,
    created_at: new Date().toISOString(),
  };
}

export function useContracts(filters: ContractFilters) {
  return useQuery({
    queryKey: contractKeys.list(filters),
    queryFn: () => listContracts(filters),
    staleTime: QUERY_DEFAULTS.staleTime,
    gcTime: QUERY_DEFAULTS.gcTime,
  });
}

export function useContract(id: string) {
  return useQuery({ queryKey: contractKeys.detail(id), queryFn: () => getContract(id) });
}

export function useContractClauses(id: string) {
  return useQuery({ queryKey: contractKeys.clauses(id), queryFn: () => getClauses(id) });
}

export function useContractHistory(id: string) {
  return useQuery({ queryKey: contractKeys.history(id), queryFn: () => getHistory(id) });
}

export function useContractSignatures(id: string) {
  return useQuery({ queryKey: contractKeys.signatures(id), queryFn: () => getSignatures(id) });
}

export function useContractTemplates() {
  return useQuery({
    queryKey: contractKeys.templates(),
    queryFn: getTemplates,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useCreateContract() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<ContractListItem, Error, CreateContractInput>({
    mutationFn: async (input) => ({
      ...(await createDraft(input)),
      customer_name: null,
      worker_name: null,
    }),
    onSuccess: (created) => {
      qc.setQueriesData<ContractListItem[]>({ queryKey: LIST_KEY }, (old) =>
        old ? [created, ...old] : old,
      );
      toast.success('تم حفظ المسودة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء العقد'),
  });
}

export function useTransitionContract(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, ContractStatus>({
    mutationFn: (to) => transitionContract(id, to),
    onSuccess: (_data, to) => {
      qc.setQueryData<ContractListItem | null>(contractKeys.detail(id), (old) =>
        old
          ? {
              ...old,
              status: to,
              signed_at: to === 'signed' ? new Date().toISOString() : old.signed_at,
            }
          : old,
      );
      qc.setQueryData<ContractStatusHistory[]>(contractKeys.history(id), (old = []) => [
        ...old,
        historyEntry(id, null, to),
      ]);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('تم تحديث حالة العقد');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تغيير الحالة'),
  });
}

export function useUpdateMusanedNo(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: (no) => setMusanedNo(id, no),
    onSuccess: (_data, no) => {
      const clean = no.trim() || null;
      qc.setQueryData<ContractListItem | null>(contractKeys.detail(id), (old) =>
        old ? { ...old, musaned_contract_no: clean } : old,
      );
      qc.setQueriesData<ContractListItem[]>({ queryKey: LIST_KEY }, (old) =>
        old ? old.map((c) => (c.id === id ? { ...c, musaned_contract_no: clean } : c)) : old,
      );
      toast.success('تم حفظ رقم عقد مساند');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ رقم عقد مساند'),
  });
}

function signatureRecord(
  id: string,
  signer_type: 'customer' | 'company',
  signer_name: string,
  national_id: string | null,
  ip_address: string | null,
  at: string,
): ContractSignature {
  return {
    id: `sig-${id}-${signer_type}-${Date.now()}`,
    contract_id: id,
    signer_type,
    signer_name,
    national_id,
    ip_address,
    signature_image: null,
    signed_at: at,
  };
}

export function useSignContract(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, SignPayload>({
    mutationFn: (payload) => signContract(id, payload),
    onSuccess: (_data, payload) => {
      const at = new Date().toISOString();
      qc.setQueryData<ContractListItem | null>(contractKeys.detail(id), (old) =>
        old ? { ...old, status: 'signed', signed_at: at } : old,
      );
      qc.setQueryData<ContractStatusHistory[]>(contractKeys.history(id), (old = []) => [
        ...old,
        historyEntry(id, 'awaiting_signature', 'signed'),
      ]);
      qc.setQueryData<ContractSignature[]>(contractKeys.signatures(id), (old = []) => [
        ...old,
        signatureRecord(
          id,
          'customer',
          payload.customerName,
          payload.nationalId,
          payload.ipAddress,
          at,
        ),
        signatureRecord(id, 'company', 'ماسية الشرق للاستقدام', null, payload.ipAddress, at),
      ]);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('تم توقيع العقد');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ التوقيع'),
  });
}
