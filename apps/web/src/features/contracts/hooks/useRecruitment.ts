import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { contractKeys } from '@/features/contracts/api/keys';
import {
  addDocument,
  advanceStage,
  assignOffice,
  getDocuments,
  getFollowups,
  listExternalOffices,
  listRecruitmentStages,
  setTravel,
  type TravelInput,
} from '@/features/contracts/api/recruitment.api';
import type { ContractListItem } from '@/features/contracts/types';

const LIST_KEY = ['contracts', 'list'] as const;

export function useRecruitmentStages() {
  return useQuery({
    queryKey: contractKeys.stages(),
    queryFn: listRecruitmentStages,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useFollowups(id: string) {
  return useQuery({ queryKey: contractKeys.followups(id), queryFn: () => getFollowups(id) });
}

export function useExternalOffices() {
  return useQuery({
    queryKey: contractKeys.offices(),
    queryFn: listExternalOffices,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useAssignOffice(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: (officeId) => assignOffice(id, officeId),
    onSuccess: (_d, officeId) => {
      qc.setQueryData<ContractListItem | null>(contractKeys.detail(id), (old) =>
        old ? { ...old, assigned_office_id: officeId, assigned_at: new Date().toISOString() } : old,
      );
      void qc.invalidateQueries({ queryKey: contractKeys.followups(id) });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('تم إسناد العقد للمكتب الخارجي');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الإسناد'),
  });
}

export function useAdvanceStage(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { stage: string; note: string | null }>({
    mutationFn: ({ stage, note }) => advanceStage(id, stage, note),
    onSuccess: (_d, { stage }) => {
      qc.setQueryData<ContractListItem | null>(contractKeys.detail(id), (old) =>
        old ? { ...old, recruitment_stage: stage } : old,
      );
      void qc.invalidateQueries({ queryKey: contractKeys.followups(id) });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('تم تحديث مرحلة الاستقدام');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تحديث المرحلة'),
  });
}

export function useRecruitmentDocuments(id: string) {
  return useQuery({ queryKey: contractKeys.documents(id), queryFn: () => getDocuments(id) });
}

export function useAddDocument(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { doc_type: string; file_name: string; storage_path: string | null; stage: string | null }
  >({
    mutationFn: (input) => addDocument(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.documents(id) });
      toast.success('تم إرفاق المستند');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إرفاق المستند'),
  });
}

export function useSetTravel(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, TravelInput>({
    mutationFn: (input) => setTravel(id, input),
    onSuccess: (_d, input) => {
      qc.setQueryData<ContractListItem | null>(contractKeys.detail(id), (old) =>
        old ? { ...old, ...input } : old,
      );
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('تم حفظ بيانات التأشيرة والسفر');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ البيانات'),
  });
}
