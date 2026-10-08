/**
 * طبقة خدمة الطلبات — عقد واحد تستخدمه الواجهة (StepWizard، التتبّع، ملخّص الطلب،
 * مركز الاتصال) مهما كان مصدر البيانات. تبديل التنفيذ (Mock ↔ Supabase) يتم من
 * المصنع في `services/index.ts` دون أي تعديل على الصفحات.
 */
import type { PriceBreakdown, ServiceCode, WorkerProfile } from '@/lib/funnel';
import type { OrderDraft } from '@/lib/orderTypes';
import type { RequestFile, RequestPeriod } from '@/features/requests/types';

/** مصدر الطلبات: عرض تجريبي في الذاكرة، أو Supabase (للمستقبل). */
export type RequestBackend = 'mock' | 'supabase';

export interface SubmitRequestInput {
  /**
   * معرّف إرسال ثابت لكل جلسة معالج: إعادة الإرسال بنفس المعرّف (ضغط مزدوج أو
   * إعادة محاولة) تُرجع نفس الطلب ولا تنشئ طلبًا ثانيًا.
   */
  clientToken: string;
  draft: OrderDraft;
  price: PriceBreakdown;
  serviceName: string;
  worker?: WorkerProfile | null;
}

export interface SubmittedRequest {
  requestNo: string;
  /** مصدر الطلب — الواجهة تعرض وسم «تجريبي» عند mock. */
  backend: RequestBackend;
  /** false إذا أُعيد طلب سابق بنفس clientToken (لا طلب جديد). */
  created: boolean;
}

/** ما تعرضه صفحة التتبّع — بلا بيانات شخصية. */
export interface TrackedRequest {
  request_no: string;
  service_code: ServiceCode;
  status: string;
  payment_status: string;
  created_at: string;
  /** مدة الخدمة وتواريخها (ليست بيانات شخصية) — null لخدمة بلا مدة. */
  period: RequestPeriod | null;
  backend: RequestBackend;
}

export interface RequestService {
  readonly backend: RequestBackend;
  /** هل يمكن عرض ملف الطلب الكامل (بياناته الشخصية) في هذا التنفيذ؟ */
  readonly supportsRequestFile: boolean;
  submit(input: SubmitRequestInput): Promise<SubmittedRequest>;
  /** null = لا يوجد طلب بهذا الرقم. أي فشل آخر يُرمى كخطأ. */
  track(requestNo: string): Promise<TrackedRequest | null>;
  getFile(requestNo: string): Promise<RequestFile | null>;
  listFiles(): Promise<RequestFile[]>;
}

/** خطأ قابل للعرض للمستخدم كما هو (رسالة عربية واضحة). */
export class RequestServiceError extends Error {
  constructor(
    message: string,
    readonly kind: 'validation' | 'unavailable' | 'backend',
  ) {
    super(message);
    this.name = 'RequestServiceError';
  }
}
