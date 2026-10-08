/**
 * MockRequestService — تنفيذ العرض التجريبي (الافتراضي حاليًا). كل شيء في الذاكرة
 * بقصد: ملف الطلب، لوحة العمليات، حجز العاملة، والتقاط العميل المحتمل في CRM.
 * لا يتصل بـ Supabase إطلاقًا، فلا يختلط العرض ببيانات حقيقية ولا يتأثر بفشلها.
 */
import { addLocalOrder } from '@/features/orders/api/orders.api';
import { captureLead } from '@/features/crm/api/crm.api';
import { addBooking } from '@/features/catalog/lib/availability';
import {
  blankRequestFile,
  getRequestFile,
  listRequestFiles,
  saveRequestFile,
} from '@/features/requests/api/requests.api';
import { firstIssue, submitRequestSchema } from '@/features/requests/schemas/request.schema';
import {
  RequestServiceError,
  type RequestService,
  type SubmitRequestInput,
  type SubmittedRequest,
  type TrackedRequest,
} from '@/features/requests/services/types';
import { buildServiceDetails } from '@/features/requests/types';
import { draftPeriod } from '@/lib/orderTypes';
import type { ServiceCode } from '@/lib/funnel';

const REQUEST_NO_RE = /^REQ-[0-9A-F]{8}$/;

/** رقم طلب عشوائي غير قابل للتخمين بنفس صيغة القاعدة (REQ- + ٨ رموز ست عشرية). */
function randomRequestNo(): string {
  const bytes = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `REQ-${hex.toUpperCase()}`;
}

export function createMockRequestService(): RequestService {
  /** clientToken → الطلب الناتج (أو الإرسال الجاري): نفس المعرّف = نفس الطلب. */
  const byToken = new Map<string, Promise<SubmittedRequest>>();

  async function uniqueRequestNo(): Promise<string> {
    const taken = new Set((await listRequestFiles()).map((f) => f.request_no));
    for (let i = 0; i < 20; i += 1) {
      const no = randomRequestNo();
      if (!taken.has(no)) return no;
    }
    throw new RequestServiceError('تعذّر توليد رقم طلب فريد — حاول مرة أخرى', 'backend');
  }

  async function create(input: SubmitRequestInput): Promise<SubmittedRequest> {
    const { draft, price, serviceName, worker } = input;
    const requestNo = await uniqueRequestNo();
    const period = draftPeriod(draft);

    saveRequestFile({
      ...blankRequestFile(requestNo),
      service_code: draft.service,
      service_name: serviceName,
      customer_name: draft.customerName.trim(),
      phone: draft.phone,
      national_id: draft.nationalId.trim(),
      city: draft.city,
      address: draft.address,
      branch: draft.branch,
      worker: worker
        ? {
            id: worker.id,
            full_name: worker.full_name,
            nationality: worker.nationality,
            profession: worker.profession,
          }
        : null,
      match_score: draft.matchScore,
      details: buildServiceDetails(draft.place),
      period,
      amounts: { base: price.base, vat: price.vat, total: price.total },
      payment_method: draft.paymentMethod,
    });

    // لوحة العمليات التجريبية
    addLocalOrder({
      request_no: requestNo,
      customer_name: draft.customerName.trim() || null,
      service_code: draft.service as ServiceCode,
      branch: draft.branch || null,
      total_amount: price.total,
    });

    // حجز المدة على جدول العاملة حتى تظهر محجوزة للعملاء الآخرين
    if (worker && period) {
      addBooking(worker.id, {
        start: period.startDate,
        end: period.endDate,
        reason: `طلب ${serviceName}`,
        request_no: requestNo,
      });
    }

    // التقاط الصفقة في مسار المبيعات (مصدر: الموقع)
    captureLead({
      full_name: draft.customerName.trim() || 'عميل من الموقع',
      phone: draft.phone || null,
      source_code: 'website',
      service_code: draft.service as ServiceCode,
      est_value: price.total,
      stage_code: 'won',
    });

    return { requestNo, backend: 'mock', created: true };
  }

  return {
    backend: 'mock',
    supportsRequestFile: true,

    async submit(input) {
      const parsed = submitRequestSchema.safeParse(input);
      if (!parsed.success) throw new RequestServiceError(firstIssue(parsed.error), 'validation');

      const previous = byToken.get(input.clientToken);
      if (previous) return { ...(await previous), created: false };

      // نفس الجوال بصيغته الموحّدة (05XXXXXXXX) في ملف الطلب ولوحة العمليات
      const normalized: SubmitRequestInput = {
        ...input,
        draft: { ...input.draft, phone: parsed.data.draft.phone },
      };
      const pending = create(normalized);
      byToken.set(input.clientToken, pending);
      try {
        return await pending;
      } catch (e) {
        byToken.delete(input.clientToken); // فشل → يجوز إعادة المحاولة بنفس المعرّف
        throw e;
      }
    },

    async track(requestNo) {
      const no = requestNo.trim().toUpperCase();
      if (!REQUEST_NO_RE.test(no)) return null;
      const file = await getRequestFile(no);
      if (!file) return null; // لا سجلات مختلقة: رقم غير موجود = غير موجود
      const tracked: TrackedRequest = {
        request_no: file.request_no,
        service_code: file.service_code,
        status: 'paid', // الدفع في العرض التجريبي محاكاة ناجحة
        payment_status: 'paid',
        created_at: file.created_at,
        period: file.period,
        backend: 'mock',
      };
      return tracked;
    },

    getFile: (requestNo) => getRequestFile(requestNo),
    listFiles: () => listRequestFiles(),
  };
}
