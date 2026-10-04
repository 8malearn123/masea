/**
 * نموذج طلب العاملة الموسّع (Prototype) — يبني فوق `OrderDraft` القائم ولا يكرّره:
 * هنا فقط المفاهيم الجديدة التي طلبها العميل — نوع المستفيد/مكان الخدمة وبياناته،
 * ومدة الطلب بتاريخ بداية ونهاية، وملف الطلب الذي يجمع كل ذلك للعرض.
 *
 * أكواد أنواع المستفيد والمناسبات واحتياجات الرعاية ليست enums جامدة — تُقرأ من
 * القوائم المرجعية في الإعدادات (`features/settings`), فيضيفها الإداري بلا برمجة.
 */
import type { ServiceCode } from '@/lib/funnel';

/** وحدة قياس مدة الطلب. */
export type PeriodUnit = 'day' | 'month';

export const PERIOD_UNIT_LABEL: Record<PeriodUnit, string> = {
  day: 'يوم',
  month: 'شهر',
};

/** مدة الطلب: تاريخ بداية + عدد + وحدة، وتاريخ النهاية محسوب منها. */
export interface RequestPeriod {
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd (محسوب)
  unit: PeriodUnit;
  count: number;
}

/** بيانات المنزل / مكان الخدمة. */
export interface PlaceDetails {
  /** كود نوع المستفيد من قائمة «أنواع المستفيد». */
  beneficiaryType: string;
  /** كود نوع المناسبة — يُستخدم فقط عندما يكون المستفيد «مناسبة». */
  occasionType: string | null;
  floors: number;
  rooms: number;
  children: number;
  elderly: number;
  /** كبار السن يحتاجون رعاية مباشرة (لا مجرد وجودهم). */
  elderlyCareNeeded: boolean;
  /** أكواد احتياجات الرعاية من القائمة المرجعية. */
  careNeeds: string[];
  /** عدد الحضور المتوقّع — للمناسبات والمقاهي. */
  guests: number;
  notes: string;
}

/** بيانات العاملة المختارة كما تُحفظ في ملف الطلب. */
export interface RequestWorkerRef {
  id: string;
  full_name: string;
  nationality: string;
  profession: string;
}

/** ملف/ملخص الطلب — البيانات الأساسية التي يراها العميل بعد التأكيد. */
export interface RequestFile {
  request_no: string;
  created_at: string;
  service_code: ServiceCode;
  service_name: string;
  status: string;
  customer_name: string;
  phone: string;
  national_id: string;
  city: string;
  address: string;
  branch: string;
  worker: RequestWorkerRef | null;
  /** نسبة مطابقة العاملة لاحتياج الطلب عند الاختيار (٪) — null إن لم تُختر عاملة. */
  match_score: number | null;
  place: PlaceDetails;
  period: RequestPeriod | null;
  amounts: { base: number; vat: number; total: number };
  payment_method: string;
}

/** بيانات المستفيد الافتراضية لطلب جديد. */
export function emptyPlaceDetails(): PlaceDetails {
  return {
    beneficiaryType: '',
    occasionType: null,
    floors: 1,
    rooms: 3,
    children: 0,
    elderly: 0,
    elderlyCareNeeded: false,
    careNeeds: [],
    guests: 0,
    notes: '',
  };
}

/** «مناسبة» هي النوع الوحيد الذي يفتح قائمة أنواع المناسبات. */
export const OCCASION_BENEFICIARY_CODE = 'occasion';

/** الأنواع التي يُسأل فيها عن عدد الحضور بدل الأطفال وكبار السن. */
export const GUEST_BENEFICIARY_CODES = ['occasion', 'commercial'];

export function isOccasion(beneficiaryType: string): boolean {
  return beneficiaryType === OCCASION_BENEFICIARY_CODE;
}

export function asksForGuests(beneficiaryType: string): boolean {
  return GUEST_BENEFICIARY_CODES.includes(beneficiaryType);
}

export function asksForHouseholdCare(beneficiaryType: string): boolean {
  return beneficiaryType === 'home' || beneficiaryType === 'facility';
}
