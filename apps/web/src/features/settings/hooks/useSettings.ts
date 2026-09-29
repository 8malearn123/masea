import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  listBeneficiaryTypes,
  listConfig,
  listEventTypes,
  listSources,
  listStages,
  saveBeneficiaryType,
  saveEventType,
  saveSource,
  saveStage,
  updateConfig,
  type RefItem,
} from '@/features/settings/api/settings.api';

export function useSources() {
  return useQuery({
    queryKey: ['settings', 'sources'],
    queryFn: listSources,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function useStages() {
  return useQuery({
    queryKey: ['settings', 'stages'],
    queryFn: listStages,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function useBeneficiaryTypes() {
  return useQuery({
    queryKey: ['settings', 'beneficiary_types'],
    queryFn: listBeneficiaryTypes,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function useEventTypes() {
  return useQuery({
    queryKey: ['settings', 'event_types'],
    queryFn: listEventTypes,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function useConfig() {
  return useQuery({
    queryKey: ['settings', 'config'],
    queryFn: listConfig,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export type RefKind = 'sources' | 'stages' | 'beneficiary_types' | 'event_types';

const SAVE_REF: Record<RefKind, (item: RefItem, isNew: boolean) => Promise<void>> = {
  sources: saveSource,
  stages: saveStage,
  beneficiary_types: saveBeneficiaryType,
  event_types: saveEventType,
};

export function useSaveRef(kind: RefKind) {
  const qc = useQueryClient();
  const toast = useToast();
  const fn = SAVE_REF[kind];
  return useMutation<void, Error, { item: RefItem; isNew: boolean }>({
    mutationFn: ({ item, isNew }) => fn(item, isNew),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', kind] });
      toast.success('تم الحفظ');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { key: string; value: number }>({
    mutationFn: ({ key, value }) => updateConfig(key, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'config'] });
      toast.success('تم تحديث القيمة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}
