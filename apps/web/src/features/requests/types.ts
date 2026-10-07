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

/**
 * بيانات مكان الخدمة أثناء تعبئة المعالج (مسودة العمل). الحقول تتبدّل بحسب نوع
 * المستفيد؛ ما يُحفظ في الطلب هو `ServiceDetails` المبني منها بـ
 * `buildServiceDetails` — حقول النوع المختار فقط.
 *
 * `children` و`elderly` و`elderlyCareNeeded` و`guests` و`careNeeds` هي مدخلات ترشيح
 * العاملة القائمة (matching.ts) وتبقى بنفس معناها.
 */
export interface PlaceDetails {
  /** كود نوع المستفيد من قائمة «أنواع المستفيد». */
  beneficiaryType: string;
  /** كود نوع المناسبة — فقط عندما يكون المستفيد «مناسبة / فعالية». */
  occasionType: string | null;
  /** نوع المناسبة مكتوبًا — فقط عند اختيار «أخرى». */
  customOccasionType: string;
  // ---- منزل
  floors: number;
  rooms: number;
  /** هل يوجد أطفال؟ null = لم يُجب بعد. */
  hasChildren: boolean | null;
  children: number;
  /** هل يوجد كبار سن؟ null = لم يُجب بعد. */
  hasElderly: boolean | null;
  /** ١ عند وجود كبار سن (لا يُسأل عن العدد) — مدخل الترشيح. */
  elderly: number;
  /** هل يحتاج كبار السن رعاية؟ null = لم يُجب بعد. */
  elderlyCareNeeded: boolean | null;
  // ---- منشأة
  facilityType: string;
  /** عدد الأقسام. */
  sections: number;
  // ---- مقهى / نشاط تجاري
  businessType: string;
  branchesCount: number;
  // ---- مناسبة / فعالية
  /** تاريخ المناسبة (اختياري) yyyy-mm-dd. */
  eventDate: string;
  /**
   * عدد الأشخاص المخدومين: الحضور (مناسبة)، المستفيدون/الموظفون (منشأة)، أو
   * المطلوب خدمتهم يوميًا (نشاط تجاري).
   */
  guests: number;
  // ---- عام
  /** أكواد احتياجات الرعاية/الخدمة من القائمة المرجعية. */
  careNeeds: string[];
  notes: string;
}

/** تفاصيل المكان المحفوظة في الطلب — حسب نوع المستفيد فقط. */
export type LocationDetails =
  | {
      kind: 'home';
      floors: number;
      rooms: number;
      hasChildren: boolean;
      childrenCount: number | null;
      hasElderly: boolean;
      elderlyNeedCare: boolean | null;
    }
  | { kind: 'facility'; facilityType: string; sectionsCount: number; beneficiariesCount: number }
  | { kind: 'commercial'; businessType: string; branchesCount: number; servedPeople: number }
  | { kind: 'occasion'; eventDate: string | null; attendees: number };

/** بيانات المستفيد والمكان كما تُحفظ داخل `details` في الطلب. */
export interface ServiceDetails {
  beneficiaryType: string;
  occasionType: string | null;
  customOccasionType: string | null;
  /** null لنوع مستفيد يضيفه الإداري بلا حقول خاصة. */
  locationDetails: LocationDetails | null;
  careNeeds: string[];
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
  /** نوع المستفيد وتفاصيل المكان — حقول النوع المختار فقط. */
  details: ServiceDetails;
  period: RequestPeriod | null;
  amounts: { base: number; vat: number; total: number };
  payment_method: string;
}

/** بيانات المستفيد الافتراضية لطلب جديد. */
export function emptyPlaceDetails(): PlaceDetails {
  return {
    beneficiaryType: '',
    occasionType: null,
    customOccasionType: '',
    floors: 1,
    rooms: 3,
    hasChildren: null,
    children: 0,
    hasElderly: null,
    elderly: 0,
    elderlyCareNeeded: null,
    facilityType: '',
    sections: 1,
    businessType: '',
    branchesCount: 1,
    eventDate: '',
    guests: 0,
    careNeeds: [],
    notes: '',
  };
}

/** أكواد أنواع المستفيد التي لها حقول خاصة (القائمة نفسها مرجعية في الإعدادات). */
export const HOME_CODE = 'home';
export const FACILITY_CODE = 'facility';
export const COMMERCIAL_CODE = 'commercial';
/** «مناسبة / فعالية» هي النوع الوحيد الذي يفتح قائمة أنواع المناسبات. */
export const OCCASION_BENEFICIARY_CODE = 'occasion';
/** نوع المناسبة «أخرى» يفتح حقلًا لكتابة النوع. */
export const OTHER_OCCASION_CODE = 'other';

export function isOccasion(beneficiaryType: string): boolean {
  return beneficiaryType === OCCASION_BENEFICIARY_CODE;
}

export function isOtherOccasion(place: Pick<PlaceDetails, 'beneficiaryType' | 'occasionType'>) {
  return isOccasion(place.beneficiaryType) && place.occasionType === OTHER_OCCASION_CODE;
}

/**
 * تغيير نوع المستفيد: تُمسح بيانات النوع السابق كلها (لا تبقى بيانات مخفية في
 * الطلب)، ويُحتفظ فقط بالعام: احتياجات الرعاية والملاحظات.
 */
export function placeForType(place: PlaceDetails, beneficiaryType: string): PlaceDetails {
  if (beneficiaryType === place.beneficiaryType) return place;
  return {
    ...emptyPlaceDetails(),
    beneficiaryType,
    careNeeds: place.careNeeds,
    notes: place.notes,
  };
}

/** ما يُحفظ في الطلب: حقول النوع المختار فقط، دون أي بيانات لنوع غير مختار. */
export function buildServiceDetails(place: PlaceDetails): ServiceDetails {
  const occasion = isOccasion(place.beneficiaryType);
  const other = occasion && place.occasionType === OTHER_OCCASION_CODE;
  let locationDetails: LocationDetails | null = null;
  switch (place.beneficiaryType) {
    case HOME_CODE:
      locationDetails = {
        kind: 'home',
        floors: place.floors,
        rooms: place.rooms,
        hasChildren: place.hasChildren === true,
        childrenCount: place.hasChildren ? place.children : null,
        hasElderly: place.hasElderly === true,
        elderlyNeedCare: place.hasElderly ? place.elderlyCareNeeded === true : null,
      };
      break;
    case FACILITY_CODE:
      locationDetails = {
        kind: 'facility',
        facilityType: place.facilityType.trim(),
        sectionsCount: place.sections,
        beneficiariesCount: place.guests,
      };
      break;
    case COMMERCIAL_CODE:
      locationDetails = {
        kind: 'commercial',
        businessType: place.businessType.trim(),
        branchesCount: place.branchesCount,
        servedPeople: place.guests,
      };
      break;
    case OCCASION_BENEFICIARY_CODE:
      locationDetails = {
        kind: 'occasion',
        eventDate: place.eventDate || null,
        attendees: place.guests,
      };
      break;
    default:
      locationDetails = null;
  }
  return {
    beneficiaryType: place.beneficiaryType,
    occasionType: occasion ? place.occasionType : null,
    customOccasionType: other ? place.customOccasionType.trim() : null,
    locationDetails,
    careNeeds: [...place.careNeeds],
    notes: place.notes.trim(),
  };
}
