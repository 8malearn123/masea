import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  createQuote,
  listEvents,
  listQuotes,
  setQuoteStatus,
  type CreateQuoteInput,
  type PricingQuote,
  type QuoteStatus,
} from '@/features/pricing/api/quotes.api';
import type { PricingConfig } from '@/shared/lib/pricing';
import type { PricingRule } from '@/features/pricing/types';

const KEY = ['pricing', 'quotes'] as const;

export function useQuotes() {
  return useQuery({ queryKey: KEY, queryFn: listQuotes, staleTime: QUERY_DEFAULTS.staleTime });
}
export function useQuoteEvents(id: string) {
  return useQuery({
    queryKey: ['pricing', 'quote-events', id],
    queryFn: () => listEvents(id),
    staleTime: 0,
  });
}

export function useCreateQuote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    PricingQuote,
    Error,
    { input: CreateQuoteInput; rules: PricingRule[]; cfg: PricingConfig; actor: string }
  >({
    mutationFn: ({ input, ...ctx }) => createQuote(input, ctx),
    onSuccess: (q) => {
      void qc.invalidateQueries({ queryKey: ['pricing'] });
      void qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success(`تم إنشاء عرض السعر QT-${q.quote_no}`);
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء عرض السعر'),
  });
}

export function useSetQuoteStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    PricingQuote,
    Error,
    { id: string; to: QuoteStatus; actor: string; note?: string }
  >({
    mutationFn: ({ id, to, actor, note }) => setQuoteStatus(id, to, actor, note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pricing'] });
      void qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('تم تحديث حالة العرض');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تحديث حالة العرض'),
  });
}
