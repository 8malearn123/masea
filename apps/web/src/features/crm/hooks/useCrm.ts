import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  addActivity,
  convertLead,
  convertQuoteToContract,
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
  return useMutation<Quote, Error, QuoteInput>({
    mutationFn: (input) => createQuote(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm', 'quotes'] });
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      toast.success('تم إنشاء عرض السعر');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء العرض'),
  });
}

export function useSetQuoteStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; status: Quote['status'] }>({
    mutationFn: ({ id, status }) => setQuoteStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm', 'quotes'] });
      toast.success('تم تحديث حالة العرض');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}

export function useConvertQuoteToContract() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: (quoteId) => convertQuoteToContract(quoteId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm', 'quotes'] });
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      toast.success('تم تحويل العرض إلى عقد 🎉');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحويل'),
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
