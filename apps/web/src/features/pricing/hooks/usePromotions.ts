import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import type { Promotion } from '@/shared/lib/pricing';
import {
  createPromotion,
  listPromotions,
  updatePromotion,
} from '@/features/pricing/api/promotions.api';

export const PROMOTIONS_KEY = ['pricing', 'promotions'] as const;

export function usePromotions() {
  return useQuery({
    queryKey: PROMOTIONS_KEY,
    queryFn: listPromotions,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

type Row = Omit<Promotion, 'id' | 'usage_count'>;

/** Create (no id) or edit (with id) a predefined discount. */
export function useSavePromotion() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Promotion | null, Error, { id?: string; row: Row }>({
    mutationFn: async ({ id, row }) => {
      if (id) {
        await updatePromotion(id, row);
        return null;
      }
      return createPromotion(row);
    },
    onSuccess: (created, { id, row }) => {
      qc.setQueryData<Promotion[]>(PROMOTIONS_KEY, (old = []) =>
        created ? [created, ...old] : old.map((p) => (p.id === id ? { ...p, ...row } : p)),
      );
      void qc.invalidateQueries({ queryKey: PROMOTIONS_KEY });
      toast.success(id ? 'تم تحديث الخصم' : 'تمت إضافة الخصم');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ الخصم'),
  });
}

/** Enable / disable (soft delete) a discount. */
export function useTogglePromotion() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; is_active: boolean }>({
    mutationFn: ({ id, is_active }) => updatePromotion(id, { is_active }),
    onSuccess: (_v, { id, is_active }) => {
      qc.setQueryData<Promotion[]>(PROMOTIONS_KEY, (old = []) =>
        old.map((p) => (p.id === id ? { ...p, is_active } : p)),
      );
      toast.success(is_active ? 'تم تفعيل الخصم' : 'تم تعطيل الخصم');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تحديث الخصم'),
  });
}
