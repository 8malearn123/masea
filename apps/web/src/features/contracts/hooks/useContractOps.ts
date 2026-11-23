import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { contractKeys } from '@/features/contracts/api/keys';
import {
  listLookups,
  listOpsEvents,
  listPayouts,
  listRefunds,
  listReturns,
  listSettlements,
  listSettlementTerms,
  prepareSettlement,
  previewSettlement,
  recordPayout,
  refundStep,
  requestReturn,
  returnStep,
  saveLookup,
  setSettlementManualDue,
  settlementStep,
  settleSettlement,
  updateRefundDetails,
  updateSettlementTerm,
  type ContractLookup,
  type LookupKind,
  type PayoutInput,
  type PrepareSettlementInput,
  type Refund,
  type RefundAction,
  type RefundDetailsInput,
  type ReturnAction,
  type ReturnRequestInput,
  type ReturnStepInput,
  type Settlement,
  type SettlementAction,
  type WorkerReturn,
} from '@/features/contracts/api/contractOps.api';
import type { SettlementFee } from '@/features/contracts/lib/settlement';

export const opsKeys = {
  all: ['contract-ops'] as const,
  lookups: (kind?: LookupKind) => ['contract-ops', 'lookups', kind ?? 'all'] as const,
  terms: () => ['contract-ops', 'terms'] as const,
  settlements: (contractId?: string) =>
    ['contract-ops', 'settlements', contractId ?? 'all'] as const,
  returns: (contractId?: string) => ['contract-ops', 'returns', contractId ?? 'all'] as const,
  refunds: (contractId?: string) => ['contract-ops', 'refunds', contractId ?? 'all'] as const,
  payouts: (refundId: string) => ['contract-ops', 'payouts', refundId] as const,
  events: (contractId: string) => ['contract-ops', 'events', contractId] as const,
  preview: (contractId: string, date: string, fees: SettlementFee[]) =>
    ['contract-ops', 'preview', contractId, date, fees] as const,
};

export function useLookups(kind?: LookupKind) {
  return useQuery({ queryKey: opsKeys.lookups(kind), queryFn: () => listLookups(kind) });
}
export function useSettlementTerms() {
  return useQuery({ queryKey: opsKeys.terms(), queryFn: listSettlementTerms });
}
export function useSettlements(contractId?: string) {
  return useQuery({
    queryKey: opsKeys.settlements(contractId),
    queryFn: () => listSettlements(contractId),
  });
}
export function useReturns(contractId?: string) {
  return useQuery({
    queryKey: opsKeys.returns(contractId),
    queryFn: () => listReturns(contractId),
  });
}
export function useRefunds(contractId?: string) {
  return useQuery({
    queryKey: opsKeys.refunds(contractId),
    queryFn: () => listRefunds(contractId),
  });
}
export function usePayouts(refund: Pick<Refund, 'id' | 'contract_id'>) {
  return useQuery({
    queryKey: opsKeys.payouts(refund.id),
    queryFn: () => listPayouts(refund.id, refund.contract_id),
  });
}
export function useOpsEvents(contractId: string) {
  return useQuery({
    queryKey: opsKeys.events(contractId),
    queryFn: () => listOpsEvents(contractId),
  });
}
export function useSettlementPreview(
  contractId: string,
  date: string,
  fees: SettlementFee[],
  enabled: boolean,
) {
  return useQuery({
    queryKey: opsKeys.preview(contractId, date, fees),
    queryFn: () => previewSettlement(contractId, date, fees),
    enabled: enabled && Boolean(date),
    retry: false,
  });
}

/** Every operation touches the contract (status, worker) and the whole ops log. */
function useOpsMutation<TVars, TData = unknown>(
  fn: (v: TVars) => Promise<TData>,
  success: string | ((v: TVars) => string),
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: opsKeys.all });
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success(typeof success === 'function' ? success(v) : success);
    },
    onError: (e) => toast.error(e.message || 'تعذّر تنفيذ العملية'),
  });
}

export function useSaveLookup() {
  return useOpsMutation(
    ({ item, isNew }: { item: ContractLookup; isNew: boolean }) => saveLookup(item, isNew),
    'تم الحفظ',
  );
}
export function useUpdateSettlementTerm() {
  return useOpsMutation(updateSettlementTerm, 'تم حفظ شرط التسوية');
}

export function usePrepareSettlement() {
  return useOpsMutation(
    (v: PrepareSettlementInput) => prepareSettlement(v),
    'أُعدّت التسوية — راجعها ثم أرسلها',
  );
}
const SETTLEMENT_DONE: Record<SettlementAction, string> = {
  submit: 'أُرسلت التسوية للمراجعة',
  review: 'رُوجعت التسوية — بانتظار الاعتماد المالي',
  approve: 'اعتُمدت التسوية مالياً',
  reject: 'رُفضت التسوية',
  withdraw: 'سُحبت التسوية',
};
export function useSettlementStep() {
  return useOpsMutation(
    ({
      s,
      action,
      note,
    }: {
      s: Pick<Settlement, 'id' | 'contract_id'>;
      action: SettlementAction;
      note?: string;
    }) => settlementStep(s, action, note),
    (v) => SETTLEMENT_DONE[v.action],
  );
}
export function useSettlementManualDue() {
  return useOpsMutation(
    ({ s, due, ref }: { s: Pick<Settlement, 'id' | 'contract_id'>; due: number; ref: string }) =>
      setSettlementManualDue(s, due, ref),
    'حُدّدت القيمة المستحقة',
  );
}
export function useSettleSettlement() {
  return useOpsMutation(
    (s: Pick<Settlement, 'id' | 'contract_id'>) => settleSettlement(s),
    'نُفّذت التسوية: أُلغي العقد وأُنشئ طلب الاسترداد إن وُجد رصيد',
  );
}

export function useRequestReturn() {
  return useOpsMutation((v: ReturnRequestInput) => requestReturn(v), 'سُجّل طلب إرجاع العاملة');
}
const RETURN_DONE: Record<ReturnAction, string> = {
  schedule: 'جُدول استلام العاملة',
  receive: 'سُجّل الاستلام الفعلي',
  ready: 'العاملة جاهزة ومتاحة',
  cancel: 'أُلغي طلب الإرجاع',
};
export function useReturnStep() {
  return useOpsMutation(
    ({
      r,
      action,
      input,
    }: {
      r: Pick<WorkerReturn, 'id' | 'contract_id'>;
      action: ReturnAction;
      input?: ReturnStepInput;
    }) => returnStep(r, action, input),
    (v) => RETURN_DONE[v.action],
  );
}

export function useUpdateRefundDetails() {
  return useOpsMutation(
    ({ r, input }: { r: Pick<Refund, 'id' | 'contract_id'>; input: RefundDetailsInput }) =>
      updateRefundDetails(r, input),
    'حُفظت بيانات الاسترداد',
  );
}
const REFUND_DONE: Record<RefundAction, string> = {
  submit: 'أُرسل الاسترداد للمراجعة',
  review: 'رُوجع الاسترداد — بانتظار الاعتماد المالي',
  approve: 'اعتُمد الاسترداد مالياً',
  queue: 'أُرسل الاسترداد للصرف',
  reject: 'رُفض الاسترداد',
};
export function useRefundStep() {
  return useOpsMutation(
    ({
      r,
      action,
      note,
    }: {
      r: Pick<Refund, 'id' | 'contract_id'>;
      action: RefundAction;
      note?: string;
    }) => refundStep(r, action, note),
    (v) => REFUND_DONE[v.action],
  );
}
export function useRecordPayout() {
  return useOpsMutation(
    ({ r, input }: { r: Pick<Refund, 'id' | 'contract_id'>; input: PayoutInput }) =>
      recordPayout(r, input),
    'سُجّل الصرف وقيده المحاسبي',
  );
}
