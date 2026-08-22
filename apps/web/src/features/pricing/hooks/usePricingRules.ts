import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  getPricingConfig,
  listPricingLog,
  listPricingRules,
  updatePricingConfig,
  updatePricingRule,
} from '@/features/pricing/api/pricing.api';
import type { PricingConfig } from '@/shared/lib/pricing';
import type { PricingRule } from '@/features/pricing/types';

const KEY = ['pricing', 'rules'] as const;
const CONFIG_KEY = ['pricing', 'config'] as const;
const LOG_KEY = ['pricing', 'log'] as const;

export function usePricingRules() {
  return useQuery({
    queryKey: KEY,
    queryFn: listPricingRules,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useUpdatePricingRule() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { id: string; base_price: number; min_price: number },
    { prev: PricingRule[] | undefined }
  >({
    mutationFn: ({ id, base_price, min_price }) => updatePricingRule(id, { base_price, min_price }),
    onMutate: async ({ id, base_price, min_price }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<PricingRule[]>(KEY);
      qc.setQueryData<PricingRule[]>(KEY, (old) =>
        old?.map((r) => (r.id === id ? { ...r, base_price, min_price } : r)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error(e.message || 'تعذّر تحديث السعر');
    },
    onSuccess: () => toast.success('تم تحديث السعر'),
  });
}

export function usePricingConfig() {
  return useQuery({
    queryKey: CONFIG_KEY,
    queryFn: getPricingConfig,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useUpdatePricingConfig() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, PricingConfig>({
    mutationFn: (cfg) => updatePricingConfig(cfg),
    onSuccess: (_v, cfg) => {
      qc.setQueryData<PricingConfig>(CONFIG_KEY, cfg);
      toast.success('تم حفظ إعدادات التسعير');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ الإعدادات'),
  });
}

export function usePricingLog() {
  return useQuery({
    queryKey: LOG_KEY,
    queryFn: listPricingLog,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
