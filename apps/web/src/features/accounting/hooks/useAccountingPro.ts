import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { usePermissions } from '@/hooks/usePermissions';
import { loadDemo } from '@/lib/demo';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import * as pro from '@/features/accounting/api/accountingPro.api';
import { dutyCan, type AccAction, type AccArea } from '@/features/accounting/data/access';

/**
 * Hooks for the professional accounting layer. Every mutation invalidates the
 * whole ['accounting'] cache so the dashboard, ledger and statements refresh
 * right after anything is posted.
 */
const K = (...k: string[]): QueryKey => ['accounting', 'pro', ...k];
const q = <T>(key: QueryKey, fn: () => Promise<T>) => ({
  queryKey: key,
  queryFn: fn,
  staleTime: QUERY_DEFAULTS.staleTime,
});

export const useWorkflow = () => useQuery(q(K('workflow'), pro.listWorkflow));
export const useRecurring = () => useQuery(q(K('recurring'), pro.listRecurring));
export const useCostCenters = () => useQuery(q(K('cost-centers'), pro.listCostCenters));
export const useAllocationRules = () => useQuery(q(K('allocation'), pro.listAllocationRules));
export const useBudgets = () => useQuery(q(K('budgets'), pro.listBudgets));
export const useStatement = (code: string) =>
  useQuery(q(K('statement', code), () => pro.getStatement(code)));
export const useMatches = (code: string) =>
  useQuery(q(K('matches', code), () => pro.listMatches(code)));
export const useBankRules = () => useQuery(q(K('bank-rules'), pro.listBankRules));
export const useCreditLimits = () => useQuery(q(K('credit-limits'), pro.getCreditLimits));
export const useReminders = () => useQuery(q(K('reminders'), pro.listReminders));
export const useApSchedule = () => useQuery(q(K('ap-schedule'), pro.getApSchedule));
export const useCreditNotes = () => useQuery(q(K('credit-notes'), pro.listCreditNotes));
export const useSeller = () => useQuery(q(K('seller'), pro.getSeller));
export const useEInvoices = () => useQuery(q(K('einvoices'), pro.listEInvoices));
export const useAlertState = () => useQuery(q(K('alert-state'), pro.getAlertState));
export const useDuties = () => useQuery(q(K('duties'), pro.listDuties));
export const useAssignments = () => useQuery(q(K('assignments'), pro.listAssignments));
export const useAiConfig = () => useQuery(q(K('ai'), pro.getAiConfig));
export const useAssistantLog = () => useQuery(q(K('assistant-log'), pro.listAssistantLog));
export const useAuditTrail = () => useQuery(q(K('audit'), pro.listAuditTrail));

/** Generic accounting mutation: toast + full accounting cache refresh. */
export function useAccMutation<TIn, TOut = unknown>(
  fn: (input: TIn) => Promise<TOut> | TOut,
  success: string | ((out: TOut) => string),
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TOut, Error, TIn>({
    mutationFn: async (input) => fn(input),
    onSuccess: (out) => {
      void qc.invalidateQueries({ queryKey: ['accounting'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
      toast.success(typeof success === 'function' ? success(out) : success);
    },
    onError: (e) => toast.error(e.message || 'تعذّر تنفيذ العملية'),
  });
}

/** Managed accounting thresholds (app_config — editable in الإعدادات). */
export function useAccConfig() {
  const { data = [] } = useConfig();
  return useMemo(
    () => ({
      lowCash: configValue(data, 'acc_low_cash_threshold', 50000),
      billDueDays: configValue(data, 'acc_bill_due_alert_days', 7),
      budgetAlertPct: configValue(data, 'acc_budget_alert_pct', 90),
      anomalyMultiplier: configValue(data, 'acc_anomaly_multiplier', 3),
      requireSod: configValue(data, 'acc_require_sod', 1) === 1,
      bankMatchDays: configValue(data, 'acc_bank_match_days', 3),
      reminderAfterDays: configValue(data, 'acc_reminder_after_days', 7),
      vatRate: configValue(data, 'vat_rate', 15) / 100,
    }),
    [data],
  );
}

/** Current user's accounting duty + capability check (UI mirror of has_acc_perm). */
export function useAccAccess() {
  const { role, fullName, can } = usePermissions();
  const email = loadDemo()?.email;
  const { data: duties = [] } = useDuties();
  const { data: dutyCode = null } = useQuery(
    q(K('my-duty', email ?? '-', role ?? '-'), () => pro.dutyFor(email, role)),
  );
  const duty = duties.find((d) => d.code === dutyCode);
  const allowed = (area: AccArea, action: AccAction) =>
    can('accounting', 'view') && dutyCan(role, duty, area, action);
  return { role, actor: fullName, email, duty, allowed };
}
