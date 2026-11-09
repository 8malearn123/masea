import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPublicSiteInfo,
  saveCompanyProfile,
  submitWebLead,
  uploadSiteImage,
} from '@/features/site/api/site.api';
import type { CompanyProfile, WebLeadInput } from '@/features/site/types';

const SITE_KEY = ['site', 'info'] as const;

export function useSiteInfo() {
  return useQuery({ queryKey: SITE_KEY, queryFn: getPublicSiteInfo, staleTime: 5 * 60 * 1000 });
}

/** إرسال طلب الزائر — الحالة (إرسال/نجاح/فشل) تُعرض في النموذج نفسه. */
export function useSubmitWebLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WebLeadInput) => submitWebLead(input),
    // يظهر الطلب فورًا في خط المبيعات لمن يتصفّح النظام في نفس الجلسة
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crm'] }),
  });
}

export function useSaveCompanyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: CompanyProfile) => saveCompanyProfile(p),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['site'] }),
  });
}

export function useUploadSiteImage() {
  return useMutation({ mutationFn: (f: File) => uploadSiteImage(f) });
}
