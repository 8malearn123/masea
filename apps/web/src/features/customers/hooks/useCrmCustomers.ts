import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import {
  addInteraction,
  customerContracts,
  getCustomer,
  listCustomerInsights,
  listInteractions,
  saveCustomer,
  setCustomerActive,
} from '@/features/customers/api/customers.api';
import {
  DEFAULT_CRM_THRESHOLDS,
  type CrmThresholds,
  type CustomerInput,
  type CustomerRecord,
  type InteractionKind,
} from '@/features/customers/types';

const KEY = ['crm-customers'] as const;

export function useCustomerInsights() {
  return useQuery({
    queryKey: [...KEY, 'insights'],
    queryFn: listCustomerInsights,
    staleTime: 60_000,
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'one', id ?? ''],
    queryFn: () => (id ? getCustomer(id) : Promise.resolve(null)),
    enabled: Boolean(id),
  });
}

export function useCustomerContracts(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'contracts', id ?? ''],
    queryFn: () => (id ? customerContracts(id) : Promise.resolve([])),
    enabled: Boolean(id),
  });
}

export function useInteractions(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'interactions', id ?? ''],
    queryFn: () => (id ? listInteractions(id) : Promise.resolve([])),
    enabled: Boolean(id),
  });
}

/** CRM thresholds from app_config (crm_*), editable in الإعدادات. */
export function useCrmThresholds(): CrmThresholds {
  const { data: config = [] } = useConfig();
  const d = DEFAULT_CRM_THRESHOLDS;
  return {
    newDays: configValue(config, 'crm_new_customer_days', d.newDays),
    inactiveDays: configValue(config, 'crm_inactive_days', d.inactiveDays),
    followupDays: configValue(config, 'crm_followup_days', d.followupDays),
    returnWindowDays: configValue(config, 'crm_return_window_days', d.returnWindowDays),
  };
}

export function useSaveCustomer() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<CustomerRecord, Error, { input: CustomerInput; id?: string }>({
    mutationFn: ({ input, id }) => saveCustomer(input, id),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(id ? 'تم تحديث بيانات العميل' : 'تمت إضافة العميل');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}

export function useSetCustomerActive() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; active: boolean }>({
    mutationFn: ({ id, active }) => setCustomerActive(id, active),
    onSuccess: (_, { active }) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(active ? 'تم تفعيل العميل' : 'تم تعطيل العميل');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}

export function useAddInteraction() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { customer_id: string; kind: InteractionKind; note: string | null; follow_up_at: string | null }
  >({
    mutationFn: (input) => addInteraction(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success('تم تسجيل التواصل');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التسجيل'),
  });
}
