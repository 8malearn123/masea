/**
 * مصنع خدمة الطلبات — النقطة الوحيدة التي تقرّر مصدر الطلبات.
 *
 * الافتراضي: MockRequestService (عرض تجريبي في الذاكرة) حتى لو كانت Supabase مضبوطة.
 * التحويل للإنتاج لاحقًا: VITE_REQUEST_BACKEND=supabase (مع بيانات Supabase وبعد
 * إضافة دالتَي الخادم — انظر supabaseRequestService.ts). الحساب التجريبي يبقى
 * على Mock دائمًا. لا يلزم أي تعديل في StepWizard أو صفحات الطلب.
 */
import { isBackendConfigured } from '@/shared/lib/env';
import { isDemoActive } from '@/lib/demo';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import { createSupabaseRequestService } from '@/features/requests/services/supabaseRequestService';
import type { RequestBackend, RequestService } from '@/features/requests/services/types';

export type { RequestBackend, RequestService } from '@/features/requests/services/types';

export interface BackendFlags {
  /** قيمة VITE_REQUEST_BACKEND. */
  requested: string | undefined;
  backendConfigured: boolean;
  demoAccount: boolean;
}

/** قرار المصدر (دالة صرفة قابلة للاختبار). */
export function resolveRequestBackend(flags: BackendFlags): RequestBackend {
  if (flags.requested !== 'supabase') return 'mock';
  if (!flags.backendConfigured || flags.demoAccount) return 'mock';
  return 'supabase';
}

const instances: Partial<Record<RequestBackend, RequestService>> = {};

/** نسخة واحدة لكل مصدر (Mock يحتفظ ببياناته ومعرّفات الإرسال طوال الجلسة). */
export function requestServiceFor(backend: RequestBackend): RequestService {
  instances[backend] ??=
    backend === 'supabase' ? createSupabaseRequestService() : createMockRequestService();
  return instances[backend] as RequestService;
}

export function getRequestService(): RequestService {
  return requestServiceFor(
    resolveRequestBackend({
      requested: import.meta.env.VITE_REQUEST_BACKEND,
      backendConfigured: isBackendConfigured,
      demoAccount: isDemoActive(),
    }),
  );
}
