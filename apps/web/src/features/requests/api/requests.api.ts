/**
 * ملفات الطلبات (Prototype / Mock).
 *
 * مخزن في الذاكرة يحفظ «ملف الطلب» بعد تأكيده في نموذج الطلب، على نفس نمط
 * `addLocalOrder` في وحدة الطلبات: الطلب نفسه يبقى في `service_requests`،
 * وهذا الملف يحمل البيانات الموسّعة (نوع المستفيد، بيانات مكان الخدمة، المدة)
 * التي تُعرض للعميل في صفحة ملخّص الطلب حتى تُهيّأ الجداول في القاعدة.
 */
import { SERVICE_LABEL } from '@/features/catalog/lib/catalog';
import { buildPeriod } from '@/features/requests/lib/period';
import type { RequestFile } from '@/features/requests/types';
import { emptyPlaceDetails } from '@/features/requests/types';

/** ملفات تجريبية واقعية — تُعرض قبل إنشاء أي طلب جديد في الجلسة. */
const SEED: RequestFile[] = [
  {
    request_no: 'REQ-2A7F41C9',
    created_at: '2026-09-14T08:20:00Z',
    service_code: 'monthly_rental',
    service_name: SERVICE_LABEL.monthly_rental,
    status: 'مدفوع — قيد التجهيز',
    customer_name: 'نورة الشهري',
    phone: '0555102244',
    national_id: '1078451236',
    city: 'نجران',
    address: 'حي الفهد، شارع الأمير مشعل',
    branch: 'نجران',
    worker: {
      id: 'w3',
      full_name: 'سيتي نورهاليزا',
      nationality: 'إندونيسيا',
      profession: 'عاملة منزلية',
    },
    match_score: 86,
    place: {
      beneficiaryType: 'home',
      occasionType: null,
      floors: 2,
      rooms: 6,
      children: 3,
      elderly: 1,
      elderlyCareNeeded: true,
      careNeeds: ['children', 'elderly', 'cleaning'],
      guests: 0,
      notes: 'يفضّل من تجيد العربية للتواصل مع الوالدة.',
    },
    period: buildPeriod('2026-10-01', 'month', 3),
    amounts: { base: 6600, vat: 990, total: 7590 },
    payment_method: 'mada',
  },
  {
    request_no: 'REQ-93BD5E08',
    created_at: '2026-09-17T13:05:00Z',
    service_code: 'daily_rental',
    service_name: SERVICE_LABEL.daily_rental,
    status: 'مدفوع — بانتظار موعد المناسبة',
    customer_name: 'عبدالعزيز اليامي',
    phone: '0544887711',
    national_id: '1092233410',
    city: 'شرورة',
    address: 'قاعة الماسة للاحتفالات',
    branch: 'شرورة',
    worker: {
      id: 'w4',
      full_name: 'ديوي أنغرايني',
      nationality: 'إندونيسيا',
      profession: 'طباخة',
    },
    match_score: 92,
    place: {
      beneficiaryType: 'occasion',
      occasionType: 'wedding',
      floors: 1,
      rooms: 2,
      children: 0,
      elderly: 0,
      elderlyCareNeeded: false,
      careNeeds: ['cooking', 'serving'],
      guests: 120,
      notes: 'المناسبة مسائية وتبدأ بعد صلاة العشاء.',
    },
    period: buildPeriod('2026-10-09', 'day', 2),
    amounts: { base: 440, vat: 66, total: 506 },
    payment_method: 'stc_pay',
  },
];

const FILES: RequestFile[] = [...SEED];

/** حفظ ملف طلب جديد (أحدث الطلبات أولًا). */
export function saveRequestFile(file: RequestFile): void {
  const idx = FILES.findIndex((f) => f.request_no === file.request_no);
  if (idx === -1) FILES.unshift(file);
  else FILES[idx] = file;
}

export async function listRequestFiles(): Promise<RequestFile[]> {
  return [...FILES];
}

export async function getRequestFile(requestNo: string): Promise<RequestFile | null> {
  return FILES.find((f) => f.request_no === requestNo) ?? null;
}

/** ملف طلب فارغ — نقطة بناء واحدة تضمن اكتمال الحقول. */
export function blankRequestFile(requestNo: string): RequestFile {
  return {
    request_no: requestNo,
    created_at: new Date().toISOString(),
    service_code: 'recruitment',
    service_name: SERVICE_LABEL.recruitment,
    status: 'مدفوع — قيد المعالجة',
    customer_name: '',
    phone: '',
    national_id: '',
    city: '',
    address: '',
    branch: '',
    worker: null,
    match_score: null,
    place: emptyPlaceDetails(),
    period: null,
    amounts: { base: 0, vat: 0, total: 0 },
    payment_method: 'mada',
  };
}
