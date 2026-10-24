import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { contractKeys } from '@/features/contracts/api/keys';
import {
  createDraft,
  getClauses,
  getContract,
  getContractLineage,
  getHistory,
  getSignatures,
  getTemplates,
  listContracts,
  renewContract,
  setMusanedNo,
  signContract,
  transitionContract,
  updateContractTerm,
  type CreateDraftInput,
  type SignPayload,
} from '@/features/contracts/api/contracts.api';
import type {
  ContractFilters,
  ContractListItem,
  ContractSignature,
  ContractStatus,
  ContractStatusHistory,
} from '@/features/contracts/types';
import type { ContractTerm } from '@/features/contracts/schemas/contract.schema';

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

/** سلسلة إصدارات العقد (الأصول والتجديدات). */
export function useContractLineage(id: string) {
  return useQuery({
    queryKey: ['contracts', 'lineage', id],
    queryFn: () => getContractLineage(id),
  });
}

export function useContractTemplates() {
  return useQuery({
    queryKey: contractKeys.templates(),
    queryFn: getTemplates,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

/**
 * إنشاء مسودة عقد. رسالة النجاح والانتقال يتولّاهما المستدعي (المعالج) عبر
 * onSuccess الخاص بـ mutate — فلا تظهر رسالة نجاح إلا بعد حفظ فعلي.
 */
export function useCreateContract() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<ContractListItem, Error, CreateDraftInput>({
    mutationFn: createDraft,
    onSuccess: (created) => {
      qc.setQueryData(contractKeys.detail(created.id), created);
      void qc.invalidateQueries({ queryKey: contractKeys.clauses(created.id) });
      void qc.invalidateQueries({ queryKey: contractKeys.history(created.id) });
      qc.setQueriesData<ContractListItem[]>({ queryKey: LIST_KEY }, (old) =>
        old ? [created, ...old.filter((c) => c.id !== created.id)] : old,
      );
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء العقد'),
  });
}

/** تعديل مدة مسودة العقد (تاريخ البداية والنهاية). */
export function useUpdateContractTerm(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<ContractTerm, Error, ContractTerm>({
    mutationFn: ({ start_date, end_date }) => updateContractTerm(id, start_date, end_date),
    onSuccess: (term) => {
      qc.setQueryData<ContractListItem | null>(contractKeys.detail(id), (old) =>
        old ? { ...old, ...term } : old,
      );
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('تم حفظ مدة العقد');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ مدة العقد'),
  });
}

/**
 * تجديد العقد. رسالة النجاح والانتقال للنسخة الجديدة يتولّاهما المستدعي عبر
 * onSuccess الخاص بـ mutate — فلا تظهر رسالة نجاح إلا بعد حفظ فعلي.
 */
export function useRenewContract(parentId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<ContractListItem, Error, ContractTerm>({
    mutationFn: ({ start_date, end_date }) => {
      if (!end_date) throw new Error('حدّد تاريخ نهاية النسخة الجديدة');
      return renewContract(parentId, start_date, end_date);
    },
    onSuccess: (created) => {
      qc.setQueryData(contractKeys.detail(created.id), created);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      void qc.invalidateQueries({ queryKey: ['contracts', 'lineage'] });
    },
    onError: (e) => toast.error(e.message || 'تعذّر تجديد العقد'),
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
