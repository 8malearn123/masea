/**
 * SupabaseRequestService — تنفيذ الإنتاج المستقبلي. **غير مفعّل حاليًا**: المصنع
 * (`services/index.ts`) يختار MockRequestService افتراضيًا.
 *
 * يعتمد على دالتين خادميتين تُضافان بـ migration مستقبلية (غير موجودة بعد):
 *   - submit_service_request(p_client_token uuid, p_payload jsonb)
 *       → { request_no text, created boolean }
 *     تُسعّر في الخادم (calc_price)، وتحدد الحالة والدفع، وتولّد رقم الطلب،
 *     وتُرجع نفس الطلب لنفس p_client_token (منع التكرار).
 *   - track_service_request(p_request_no text)
 *       → { request_no, service_code, status, payment_status, created_at } | null
 *     بلا أي بيانات شخصية.
 * عند الفشل يُرمى خطأ واضح — لا رجوع للبيانات التجريبية ولا رقم طلب محلي.
 */
import { supabase } from '@/shared/lib/supabase';
import { firstIssue, submitRequestSchema } from '@/features/requests/schemas/request.schema';
import {
  RequestServiceError,
  type RequestService,
  type SubmitRequestInput,
  type TrackedRequest,
} from '@/features/requests/services/types';
import { buildServiceDetails } from '@/features/requests/types';
import { draftPeriod } from '@/lib/orderTypes';

/**
 * الحمولة المرسلة للخادم: ما يعبّئه العميل فقط. المبالغ والحالة يحددها الخادم،
 * فلا تُرسل من المتصفح.
 */
export function toSubmitPayload(input: SubmitRequestInput, phone: string) {
  const { draft, worker } = input;
  const period = draftPeriod(draft);
  return {
    service_code: draft.service,
    customer_name: draft.customerName.trim(),
    customer_phone: phone,
    customer_national_id: draft.nationalId.trim() || null,
    customer_city: draft.city || null,
    customer_address: draft.address || null,
    branch: draft.branch || null,
    worker_profile_id: worker?.id ?? draft.workerProfileId ?? null,
    nationality: draft.nationality || null,
    profession: draft.profession || draft.taskType || null,
    start_date: period?.startDate ?? null,
    duration_unit: period?.unit ?? null,
    duration_count: period?.count ?? null,
    payment_method: draft.paymentMethod || null,
    details: {
      ...buildServiceDetails(draft.place),
      matchScore: draft.matchScore,
      monthlySalary: draft.monthlySalary,
      taskType: draft.taskType,
      sponsorship: {
        currentIqama: draft.currentIqama,
        currentNationality: draft.currentNationality,
        currentProfession: draft.currentProfession,
        currentSponsor: draft.currentSponsor,
        newSponsor: draft.newSponsor,
        documents: draft.documents,
      },
      agreeTerms: draft.agreeTerms,
    },
  };
}

function backendError(prefix: string, message: string): RequestServiceError {
  const permission = /permission denied|row-level security|not authorized|jwt/i.test(message);
  return new RequestServiceError(
    permission ? `${prefix}: لا تملك صلاحية تنفيذ هذا الإجراء` : `${prefix}: ${message}`,
    'backend',
  );
}

export function createSupabaseRequestService(): RequestService {
  return {
    backend: 'supabase',
    // ملف الطلب فيه بيانات شخصية — يحتاج قراءة آمنة بتحقق من هوية العميل (لاحقًا)
    supportsRequestFile: false,

    async submit(input) {
      const parsed = submitRequestSchema.safeParse(input);
      if (!parsed.success) throw new RequestServiceError(firstIssue(parsed.error), 'validation');
      const { data, error } = await supabase.rpc('submit_service_request', {
        p_client_token: input.clientToken,
        p_payload: toSubmitPayload(input, parsed.data.draft.phone),
      });
      if (error) throw backendError('تعذّر إرسال الطلب', error.message);
      const row = (Array.isArray(data) ? data[0] : data) as {
        request_no?: string;
        created?: boolean;
      } | null;
      if (!row?.request_no) {
        throw new RequestServiceError('تعذّر إرسال الطلب: لم يُرجِع الخادم رقم الطلب', 'backend');
      }
      return { requestNo: row.request_no, backend: 'supabase', created: row.created !== false };
    },

    async track(requestNo) {
      const { data, error } = await supabase.rpc('track_service_request', {
        p_request_no: requestNo.trim().toUpperCase(),
      });
      if (error) throw backendError('تعذّر جلب حالة الطلب', error.message);
      const row = (Array.isArray(data) ? data[0] : data) as Omit<TrackedRequest, 'backend'> | null;
      return row ? { ...row, backend: 'supabase' } : null;
    },

    async getFile() {
      throw new RequestServiceError('عرض ملف الطلب غير متاح بعد في الوضع الحقيقي', 'unavailable');
    },
    async listFiles() {
      throw new RequestServiceError(
        'قائمة ملفات الطلبات غير متاحة بعد في الوضع الحقيقي',
        'unavailable',
      );
    },
  };
}
