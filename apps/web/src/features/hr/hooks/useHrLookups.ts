import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { listHrLookups, lookupUsage, saveHrLookup } from '@/features/hr/api/lookups.api';
import {
  codeOptions,
  DEFAULT_LOOKUPS,
  lookupLabel,
  lookupNames,
  ofKind,
} from '@/features/hr/lib/lookups';
import type { HrLookup, HrLookupKind, LookupScope } from '@/features/hr/types';

export const HR_LOOKUPS_KEY = ['hr', 'lookups'] as const;

export function useHrLookupList() {
  return useQuery({
    queryKey: HR_LOOKUPS_KEY,
    queryFn: listHrLookups,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

/**
 * Pickers and labels from the managed lists. Until the lists load, the seeds
 * stand in so forms never render empty.
 */
export function useHrLookups() {
  const { data } = useHrLookupList();
  const items = data ?? DEFAULT_LOOKUPS;
  return useMemo(
    () => ({
      items,
      /** active names (+ the record's current value) as Select options */
      options: (
        kind: HrLookupKind,
        opts: { scope?: Exclude<LookupScope, 'both'>; keep?: string | null } = {},
      ) => lookupNames(items, kind, opts).map((n) => ({ value: n, label: n })),
      /** active names (+ current values) for chip pickers */
      names: (
        kind: HrLookupKind,
        opts: { scope?: Exclude<LookupScope, 'both'>; keep?: readonly string[] } = {},
      ) => lookupNames(items, kind, opts),
      /** doc types: {value: code, label} */
      docTypes: (keep?: string | null) => codeOptions(items, 'doc_type', keep),
      docTypeLabel: (code: string) => lookupLabel(items, 'doc_type', code),
      ofKind: (kind: HrLookupKind) => ofKind(items, kind),
    }),
    [items],
  );
}

export function useLookupUsage(kind: HrLookupKind) {
  return useQuery({
    queryKey: [...HR_LOOKUPS_KEY, 'usage', kind],
    queryFn: () => lookupUsage(kind),
    staleTime: 30_000,
  });
}

export function useSaveHrLookup() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { item: HrLookup; isNew: boolean; silent?: boolean }>({
    mutationFn: ({ item, isNew }) => saveHrLookup(item, isNew),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: HR_LOOKUPS_KEY });
      // a rename flows into employee files and worker profiles
      void qc.invalidateQueries({ queryKey: ['hr'] });
      if (!v.silent) toast.success('تم حفظ القائمة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}
