import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  createPricingRule,
  getPricingConfig,
  getPricingConfigMeta,
  listAllPricingRules,
  listPricingLog,
  listPricingRules,
  listRuleChanges,
  setPricingRuleActive,
  updatePricingConfig,
  updatePricingRule,
  type NewRuleInput,
  type RuleChangeInput,
} from '@/features/pricing/api/pricing.api';
import type { PricingConfig } from '@/shared/lib/pricing';
import type { PricingRule } from '@/features/pricing/types';

const KEY = ['pricing', 'rules'] as const;
const ALL_KEY = ['pricing', 'rules', 'all'] as const;
const CONFIG_KEY = ['pricing', 'config'] as const;
const LOG_KEY = ['pricing', 'log'] as const;
const q = { staleTime: QUERY_DEFAULTS.staleTime };

/** Active rules — the price source (calculator, contracts, orders). */
export function usePricingRules() {
  return useQuery({ queryKey: KEY, queryFn: listPricingRules, ...q });
}
/** All rules incl. disabled — price-list management. */
export function useAllPricingRules() {
  return useQuery({ queryKey: ALL_KEY, queryFn: listAllPricingRules, ...q });
}
export function useRuleChanges(ruleId?: string) {
  return useQuery({
    queryKey: ['pricing', 'rule-changes', ruleId ?? 'all'],
    queryFn: () => listRuleChanges(ruleId),
    ...q,
  });
}

function useRuleMutation<T>(fn: (v: T) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, Error, T>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pricing'] });
      toast.success(ok);
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}

export function useUpdatePricingRule() {
  return useRuleMutation(
    (v: { id: string; actor: string } & RuleChangeInput) => updatePricingRule(v.id, v, v.actor),
    'تم تحديث السعر — العروض والعقود السابقة لم تتغيّر',
  );
}
export function useCreatePricingRule() {
  return useRuleMutation(
    (v: { input: NewRuleInput; actor: string }) => createPricingRule(v.input, v.actor),
    'أُضيفت قاعدة السعر',
  );
}
export function useTogglePricingRule() {
  return useRuleMutation(
    (v: { rule: PricingRule; actor: string }) =>
      setPricingRuleActive(v.rule.id, !v.rule.is_active, v.actor),
    'تم تحديث حالة القاعدة',
  );
}

export function usePricingConfig() {
  return useQuery({ queryKey: CONFIG_KEY, queryFn: getPricingConfig, ...q });
}
export function usePricingConfigMeta() {
  return useQuery({ queryKey: ['pricing', 'config-meta'], queryFn: getPricingConfigMeta, ...q });
}

export function useUpdatePricingConfig() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { cfg: PricingConfig; actor: string }>({
    mutationFn: ({ cfg, actor }) => updatePricingConfig(cfg, actor),
    onSuccess: (_v, { cfg }) => {
      qc.setQueryData<PricingConfig>(CONFIG_KEY, cfg);
      void qc.invalidateQueries({ queryKey: ['pricing', 'config-meta'] });
      toast.success('تم حفظ إعدادات التسعير');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ الإعدادات'),
  });
}

export function usePricingLog() {
  return useQuery({ queryKey: LOG_KEY, queryFn: listPricingLog, ...q });
}
