import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { contractKeys } from '@/features/contracts/api/keys';
import { opsKeys } from '@/features/contracts/hooks/useContractOps';
import {
  approveTrialTerms,
  createTrial,
  getAcceptance,
  getTrialByContract,
  issueTrialLink,
  listTrials,
  listTrialTerms,
  saveTrialTermsDraft,
  setTrialRequirement,
  trialStep,
  viewTrialByToken,
  type CreateTrialInput,
  type Trial,
  type TrialAction,
} from '@/features/contracts/api/trials.api';

export const trialKeys = {
  all: ['trials'] as const,
  list: () => ['trials', 'list'] as const,
  byContract: (id: string) => ['trials', 'contract', id] as const,
  acceptance: (id: string) => ['trials', 'acceptance', id] as const,
  terms: () => ['trials', 'terms'] as const,
  public: (token: string) => ['trials', 'public', token] as const,
};

export function useTrials() {
  return useQuery({ queryKey: trialKeys.list(), queryFn: listTrials });
}
export function useTrialByContract(contractId: string, enabled = true) {
  return useQuery({
    queryKey: trialKeys.byContract(contractId),
    queryFn: () => getTrialByContract(contractId),
    enabled,
  });
}
export function useTrialAcceptance(trialId: string | undefined) {
  return useQuery({
    queryKey: trialKeys.acceptance(trialId ?? ''),
    queryFn: () => getAcceptance(trialId ?? ''),
    enabled: Boolean(trialId),
  });
}
export function useTrialTerms() {
  return useQuery({ queryKey: trialKeys.terms(), queryFn: listTrialTerms });
}
export function usePublicTrial(token: string) {
  return useQuery({
    queryKey: trialKeys.public(token),
    queryFn: () => viewTrialByToken(token),
    retry: false,
  });
}

function useTrialMutation<TVars, TData = unknown>(
  fn: (v: TVars) => Promise<TData>,
  success: string | ((v: TVars) => string),
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: trialKeys.all });
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      void qc.invalidateQueries({ queryKey: opsKeys.all });
      toast.success(typeof success === 'function' ? success(v) : success);
    },
    onError: (e) => toast.error(e.message || 'تعذّر تنفيذ العملية'),
  });
}

export function useSaveTrialTerms() {
  return useTrialMutation(saveTrialTermsDraft, 'حُفظت نسخة الشروط — بانتظار الاعتماد');
}
export function useApproveTrialTerms() {
  return useTrialMutation(approveTrialTerms, 'اعتُمدت شروط التجربة وقُفلت');
}
export function useCreateTrial() {
  return useTrialMutation(
    (v: CreateTrialInput) => createTrial(v),
    'أُنشئت التجربة — أرسل رابط القبول للعميل',
  );
}
export function useIssueTrialLink() {
  return useTrialMutation((t: Pick<Trial, 'id'>) => issueTrialLink(t), 'أُنشئ رابط القبول');
}
export function useSetTrialRequirement() {
  return useTrialMutation(
    ({
      t,
      code,
      done,
      note,
    }: {
      t: Pick<Trial, 'id'>;
      code: string;
      done: boolean;
      note?: string;
    }) => setTrialRequirement(t, code, done, note),
    'حُدّث المتطلب',
  );
}
const STEP_DONE: Record<TrialAction, string> = {
  start: 'سُلّمت العاملة — بدأت التجربة',
  complete: 'اكتملت التجربة',
  transfer: 'سُجّلت رغبة النقل وأُنشئت مسودة عقد نقل الكفالة (مساند)',
  decline: 'سُجّل عدم الرغبة — أكمل الإرجاع والتسوية',
  cancel: 'أُلغيت التجربة',
};
export function useTrialStep() {
  return useTrialMutation(
    ({
      t,
      action,
      note,
    }: {
      t: Pick<Trial, 'id'>;
      action: TrialAction;
      note?: string | undefined;
    }) => trialStep(t, action, note),
    (v) => STEP_DONE[v.action],
  );
}
