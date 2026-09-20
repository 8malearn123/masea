import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  listConfig,
  listRef,
  listSources,
  listStages,
  saveRef,
  updateConfig,
  type RefItem,
  type RefKind,
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
export function useConfig() {
  return useQuery({
    queryKey: ['settings', 'config'],
    queryFn: listConfig,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

/** أي قائمة مرجعية بكودها — مصدر واحد لكل الشاشات (الإعدادات ونماذج الطلب). */
export function useRefList(kind: RefKind) {
  return useQuery({
    queryKey: ['settings', kind],
    queryFn: () => listRef(kind),
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useSaveRef(kind: RefKind) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { item: RefItem; isNew: boolean }>({
    mutationFn: ({ item, isNew }) => saveRef(kind, item, isNew),
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
