import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { configValue } from '@/features/settings/api/settings.api';
import { useConfig } from '@/features/settings/hooks/useSettings';
import {
  createHrDocument,
  getDocFileUrl,
  listHrDocuments,
  renewHrDocument,
  setHrDocumentActive,
  updateHrDocument,
} from '@/features/hr/api/documents.api';
import {
  DEFAULT_DOC_ALERT_DAYS,
  DOC_ALERT_DAYS_KEY,
  type RenewInput,
} from '@/features/hr/lib/documentsEngine';
import type { DocFile, DocumentDraft } from '@/features/hr/types';

export const HR_DOCS_KEY = ['hr', 'documents'] as const;
export const DOC_COSTS_KEY = ['accounting', 'doc-costs'] as const;

export function useHrDocuments() {
  return useQuery({
    queryKey: HR_DOCS_KEY,
    queryFn: listHrDocuments,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

/** The managed alert window (app_config.doc_expiry_alert_days). */
export function useDocAlertDays(): number {
  const { data = [] } = useConfig();
  return configValue(data, DOC_ALERT_DAYS_KEY, DEFAULT_DOC_ALERT_DAYS);
}

function useDocMutation<V>(fn: (v: V) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, Error, V>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: HR_DOCS_KEY });
      void qc.invalidateQueries({ queryKey: DOC_COSTS_KEY });
      toast.success(ok);
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ الوثيقة'),
  });
}

export function useSaveHrDocument() {
  return useDocMutation(
    (v: { id: string | null; draft: DocumentDraft; file: DocFile | null }) =>
      v.id ? updateHrDocument(v.id, v.draft, v.file) : createHrDocument(v.draft, v.file),
    'تم حفظ الوثيقة',
  );
}

export function useSetDocumentActive() {
  return useDocMutation(
    (v: { id: string; active: boolean }) => setHrDocumentActive(v.id, v.active),
    'تم تحديث حالة الوثيقة',
  );
}

export function useRenewHrDocument() {
  return useDocMutation(
    (v: { id: string; input: RenewInput; file: DocFile | null }) =>
      renewHrDocument(v.id, v.input, v.file),
    'تم تجديد الوثيقة',
  );
}

/** Open the stored file in a new tab (signed URL live, object URL in demo). */
export function useOpenDocFile() {
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (path) => {
      const url = await getDocFileUrl(path);
      window.open(url, '_blank', 'noopener');
    },
    onError: (e) => toast.error(e.message || 'تعذّر فتح الملف'),
  });
}
