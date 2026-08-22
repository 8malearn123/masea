import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { getInvoice, listInvoices, recordPayment } from '@/features/payments/api/payments.api';
import type { Invoice } from '@/features/payments/types';

const LIST_KEY = ['payments', 'invoices'] as const;

export function useInvoices() {
  return useQuery({ queryKey: LIST_KEY, queryFn: listInvoices, staleTime: QUERY_DEFAULTS.staleTime });
}

export function useInvoice(id: string) {
  return useQuery({ queryKey: ['payments', 'invoice', id], queryFn: () => getInvoice(id) });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<{ reference_no: string }, Error, { invoiceId: string; method: string; amount: number }>({
    mutationFn: ({ invoiceId, method, amount }) => recordPayment(invoiceId, method, amount),
    onSuccess: (res, { invoiceId, method }) => {
      qc.setQueryData<Invoice[]>(LIST_KEY, (old) =>
        old?.map((i) =>
          i.id === invoiceId ? { ...i, status: 'paid', method, reference_no: res.reference_no } : i,
        ),
      );
      toast.success('تمت عملية الدفع بنجاح');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إتمام الدفع'),
  });
}
