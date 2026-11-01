import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { addSaleNote, listSaleNotes, listSales } from '@/features/sales/api/sales.api';
import type { Sale } from '@/features/sales/types';

export function useSales() {
  return useQuery({ queryKey: ['sales', 'list'], queryFn: listSales, staleTime: 60_000 });
}

export function useSaleNotes(saleId: string | null) {
  return useQuery({
    queryKey: ['sales', 'notes', saleId ?? ''],
    queryFn: () => (saleId ? listSaleNotes(saleId) : Promise.resolve([])),
    enabled: Boolean(saleId),
  });
}

export function useAddSaleNote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { sale: Pick<Sale, 'id' | 'contract_no' | 'branch'>; note: string }
  >({
    mutationFn: ({ sale, note }) => addSaleNote(sale, note),
    onSuccess: (_, { sale }) => {
      void qc.invalidateQueries({ queryKey: ['sales', 'notes', sale.id] });
      toast.success('تمت إضافة الملاحظة');
    },
    onError: (e) => toast.error(e.message || 'تعذّرت إضافة الملاحظة'),
  });
}
