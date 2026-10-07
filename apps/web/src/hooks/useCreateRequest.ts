import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRequestService } from '@/features/requests/services';
import type {
  RequestBackend,
  SubmitRequestInput,
  SubmittedRequest,
} from '@/features/requests/services/types';

export interface CreateResult {
  requestNo: string;
  /** mock = طلب تجريبي (يُعرض بوسم «تجريبي»). */
  backend: RequestBackend;
}

/**
 * مدخلات إنشاء الطلب. `clientToken` يثبّته المعالج لكل جلسة حتى لا يُنشأ طلبان عند
 * الضغط المزدوج أو إعادة المحاولة؛ إن لم يُمرَّر يُولَّد واحد لكل استدعاء.
 */
export type CreateRequestInput = Omit<SubmitRequestInput, 'clientToken'> & {
  clientToken?: string;
};

/** معرّف إرسال جديد (لكل جلسة معالج). */
export function newClientToken(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * إنشاء طلب عبر خدمة الطلبات (Mock افتراضيًا — انظر features/requests/services).
 * أي فشل (تحقق أو خادم) يصل للمستدعي كخطأ؛ لا رقم طلب محلي ولا نجاح وهمي.
 */
export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation<CreateResult, Error, CreateRequestInput>({
    mutationFn: async ({ clientToken, ...rest }) => {
      const res: SubmittedRequest = await getRequestService().submit({
        ...rest,
        clientToken: clientToken ?? newClientToken(),
      });
      return { requestNo: res.requestNo, backend: res.backend };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['request_files'] });
    },
  });
}
