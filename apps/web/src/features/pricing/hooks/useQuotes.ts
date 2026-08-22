import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  createQuote,
  listQuotes,
  markQuoteSent,
  type CreateQuoteInput,
} from '@/features/pricing/api/quotes.api';
import type { PricingQuote } from '@/features/pricing/types';

const KEY = ['pricing', 'quotes'] as const;

export function useQuotes() {
  return useQuery({ queryKey: KEY, queryFn: listQuotes, staleTime: QUERY_DEFAULTS.staleTime });
}

export function useCreateQuote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<PricingQuote, Error, CreateQuoteInput>({
    mutationFn: createQuote,
    onSuccess: (quote) => {
      qc.setQueryData<PricingQuote[]>(KEY, (old = []) => [quote, ...old]);
      toast.success('تم إنشاء عرض السعر');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء عرض السعر'),
  });
}

export function useMarkQuoteSent() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: markQuoteSent,
    onSuccess: (_v, id) => {
      qc.setQueryData<PricingQuote[]>(KEY, (old = []) =>
        old.map((q) => (q.id === id ? { ...q, status: 'sent' } : q)),
      );
    },
    onError: (e) => toast.error(e.message || 'تعذّر تحديث حالة العرض'),
  });
}
