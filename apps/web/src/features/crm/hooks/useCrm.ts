import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  addActivity,
  convertLead,
  convertQuote,
  createLeadQuote,
  getLead,
  listLeadQuotes,
  setLeadQuoteStatus,
  type LeadQuoteInput,
  createLead,
  createQuote,
  getMyTarget,
  listActivities,
  listLeads,
  listQuotes,
  listRenewals,
  setLeadStage,
  setQuoteStatus,
  toggleActivityDone,
  updateLead,
  type LeadInput,
  type QuoteInput,
} from '@/features/crm/api/crm.api';
import type { ActivityKind, Lead, LeadStageCode, Quote } from '@/features/crm/types';
import type { PricingConfig } from '@/shared/lib/pricing';
import type { PricingRule } from '@/features/pricing/types';
import type { QuoteApprovalPolicy, QuoteRecord } from '@/shared/lib/quotesLedger';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { usePermissions } from '@/hooks/usePermissions';

const LEADS_KEY = ['crm', 'leads'] as const;

export function useLeads() {
  return useQuery({ queryKey: LEADS_KEY, queryFn: listLeads, staleTime: QUERY_DEFAULTS.staleTime });
}

export function useActivities(leadId?: string) {
  return useQuery({
    queryKey: ['crm', 'activities', leadId ?? 'all'],
    queryFn: () => listActivities(leadId),
  });
}

export function useQuotes(leadId?: string) {
  return useQuery({
    queryKey: ['crm', 'quotes', leadId ?? 'all'],
    queryFn: () => listQuotes(leadId),
  });
}

export function useCreateQuote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    Quote,
    Error,
    { input: QuoteInput; rules: PricingRule[]; cfg: PricingConfig; actor: string }
  >({
    mutationFn: ({ input, ...ctx }) => createQuote(input, ctx),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm', 'quotes'] });
      void qc.invalidateQueries({ queryKey: ['pricing', 'quotes'] });
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      toast.success('تم إنشاء عرض السعر');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء العرض'),
  });
}

export function useSetQuoteStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; status: Quote['status']; actor: string }>({
    mutationFn: ({ id, status, actor }) => setQuoteStatus(id, status, actor),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm', 'quotes'] });
      void qc.invalidateQueries({ queryKey: ['pricing', 'quotes'] });
      toast.success('تم تحديث حالة العرض');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: (leadId) => convertLead(leadId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      toast.success('تم تحويله إلى عميل');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحويل'),
  });
}

export function useMyTarget() {
  return useQuery({
    queryKey: ['crm', 'target'],
    queryFn: getMyTarget,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useRenewals() {
  return useQuery({ queryKey: ['crm', 'renewals'], queryFn: listRenewals });
}

export function useCreateLead() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Lead, Error, LeadInput>({
    mutationFn: (input) => createLead(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      toast.success('تمت إضافة العميل المحتمل');
    },
    onError: (e) => toast.error(e.message || 'تعذّرت الإضافة'),
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; patch: Partial<LeadInput> }>({
    mutationFn: ({ id, patch }) => updateLead(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      toast.success('تم التحديث');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}

export function useSetLeadStage() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; stage: LeadStageCode }>({
    mutationFn: ({ id, stage }) => setLeadStage(id, stage),
    onMutate: ({ id, stage }) => {
      qc.setQueryData<Lead[]>(LEADS_KEY, (old) =>
        old?.map((l) => (l.id === id ? { ...l, stage_code: stage } : l)),
      );
    },
    onError: (e) => toast.error(e.message || 'تعذّر نقل المرحلة'),
  });
}

export function useAddActivity() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { lead_id: string; kind: ActivityKind; note: string | null; follow_up_at: string | null }
  >({
    mutationFn: (input) => addActivity(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm', 'activities'] });
      toast.success('تم تسجيل المتابعة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التسجيل'),
  });
}

export function useToggleActivity() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; done: boolean }>({
    mutationFn: ({ id, done }) => toggleActivityDone(id, done),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crm', 'activities'] }),
  });
}

/* ---------------------- lead file: quotes → contract (0062) ---------------------- */
export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: [...LEADS_KEY, 'one', id ?? ''],
    queryFn: () => (id ? getLead(id) : Promise.resolve(null)),
    enabled: Boolean(id),
  });
}

export function useLeadQuotes(leadId: string | undefined) {
  return useQuery({
    queryKey: ['crm', 'lead-quotes', leadId ?? ''],
    queryFn: () => (leadId ? listLeadQuotes(leadId) : Promise.resolve([])),
    enabled: Boolean(leadId),
  });
}

/** Managed approval policy for the current user (app_config + leads.approve). */
export function useQuoteApprovalPolicy(): QuoteApprovalPolicy {
  const { data: config = [] } = useConfig();
  const { can } = usePermissions();
  return {
    thresholdPct: configValue(config, 'quote_approval_discount_pct', 10),
    canApprove: can('leads', 'approve'),
  };
}

function invalidateQuotes(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['crm'] });
  void qc.invalidateQueries({ queryKey: ['pricing', 'quotes'] });
}

export function useCreateLeadQuote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    QuoteRecord,
    Error,
    { input: LeadQuoteInput; rules: PricingRule[]; cfg: PricingConfig; actor: string }
  >({
    mutationFn: ({ input, ...ctx }) => createLeadQuote(input, ctx),
    onSuccess: (q) => {
      invalidateQuotes(qc);
      toast.success(`تم إنشاء عرض السعر QT-${q.quote_no}`);
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء العرض'),
  });
}

const STATUS_DONE: Partial<Record<QuoteRecord['status'], string>> = {
  pending_approval: 'أُرسل العرض لاعتماد مدير الفرع',
  sent: 'تم تسجيل إرسال العرض',
  accepted: 'تم تسجيل قبول العميل',
  rejected: 'تم تسجيل الرفض',
};

export function useSetLeadQuoteStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    QuoteRecord,
    Error,
    { id: string; status: QuoteRecord['status']; actor: string; policy: QuoteApprovalPolicy }
  >({
    mutationFn: ({ id, status, actor, policy }) => setLeadQuoteStatus(id, status, actor, policy),
    onSuccess: (q) => {
      invalidateQuotes(qc);
      toast.success(STATUS_DONE[q.status] ?? 'تم تحديث حالة العرض');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}

export function useConvertQuote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    { contract_id: string; contract_no: string | null },
    Error,
    { quote: QuoteRecord; actor: string }
  >({
    mutationFn: ({ quote, actor }) => convertQuote(quote, actor),
    onSuccess: (r) => {
      invalidateQuotes(qc);
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success(`تم إنشاء العقد ${r.contract_no ?? ''}`.trim());
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء العقد'),
  });
}
