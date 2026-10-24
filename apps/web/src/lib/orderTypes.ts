/** Order draft model + shared option lists for the customer wizard. */
import { CalendarClock, CreditCard, Smartphone, type LucideIcon } from 'lucide-react';
import type { ServiceCode } from '@/lib/funnel';
import { buildPeriod } from '@/features/requests/lib/period';
import { emptyPlaceDetails } from '@/features/requests/types';
import type { PeriodUnit, PlaceDetails, RequestPeriod } from '@/features/requests/types';

export interface OrderDraft {
  service: ServiceCode;
  /** نوع المستفيد وبيانات مكان الخدمة (منزل/منشأة/تجاري/مناسبة). */
  place: PlaceDetails;
  /** نسبة مطابقة العاملة المختارة لاحتياج الطلب (٪) — تُملأ عند الترشيح. */
  matchScore: number | null;
  // recruitment
  nationality: string;
  profession: string;
  monthlySalary: number;
  contractMonths: number;
  // rental
  months: number;
  /** عدد وحدات مدة التأجير اليومي (أيام أو أسابيع بحسب `durationUnit`). */
  days: number;
  /** وحدة مدة الطلب — من الوحدات المسموحة للخدمة في `DURATION_UNITS`. */
  durationUnit: PeriodUnit;
  startDate: string;
  taskType: string;
  workerProfileId: string | null;
  // sponsorship transfer
  currentIqama: string;
  currentNationality: string;
  currentProfession: string;
  currentSponsor: string;
  newSponsor: string;
  documents: string[];
  // customer / employer (shared)
  customerName: string;
  nationalId: string;
  phone: string;
  address: string;
  city: string;
  branch: string;
  // contract + payment
  agreeTerms: boolean;
  paymentMethod: string;
}

export const NATIONALITIES = [
  'الفلبين',
  'إندونيسيا',
  'كينيا',
  'أوغندا',
  'بنغلاديش',
  'سريلانكا',
] as const;
export const PROFESSIONS = ['عاملة منزلية', 'طباخة', 'مربية أطفال', 'سائق'] as const;
export const TASK_TYPES = ['تنظيف', 'طبخ', 'رعاية'] as const;

export interface PaymentMethodOpt {
  key: string;
  label: string;
  /** أيقونة lucide (لا إيموجي — CLAUDE.md). */
  icon: LucideIcon;
}
export const PAYMENT_METHODS: PaymentMethodOpt[] = [
  { key: 'mada', label: 'مدى / Moyasar', icon: CreditCard },
  { key: 'apple_pay', label: 'Apple Pay', icon: Smartphone },
  { key: 'stc_pay', label: 'STC Pay', icon: Smartphone },
  { key: 'tamara', label: 'تابي / تمارا (تقسيط)', icon: CalendarClock },
];

/** Post-order tracking stages, per service. */
export const TRACKING_STAGES: Record<ServiceCode, string[]> = {
  recruitment: ['إصدار التأشيرة', 'الإجراءات', 'السفر', 'الوصول'],
  monthly_rental: ['تأكيد الطلب', 'تجهيز العاملة', 'المباشرة'],
  daily_rental: ['تأكيد الطلب', 'في الطريق', 'الحضور'],
  sponsorship_transfer: ['تقديم الطلب', 'مراجعة الجهات', 'الموافقة', 'إصدار الإقامة'],
};

export function emptyDraft(service: ServiceCode): OrderDraft {
  return {
    service,
    place: emptyPlaceDetails(),
    matchScore: null,
    nationality: '',
    profession: '',
    monthlySalary: 1500,
    contractMonths: 24,
    months: 3,
    days: 1,
    durationUnit: DURATION_UNITS[service][0] ?? 'month',
    startDate: '',
    taskType: '',
    workerProfileId: null,
    currentIqama: '',
    currentNationality: '',
    currentProfession: '',
    currentSponsor: '',
    newSponsor: '',
    documents: [],
    customerName: '',
    nationalId: '',
    phone: '',
    address: '',
    city: '',
    branch: '',
    agreeTerms: false,
    paymentMethod: 'mada',
  };
}

/**
 * وحدات المدة المتاحة لكل خدمة (الأولى افتراضية). التأجير اليومي بالأيام أو
 * الأسابيع ويُسعَّر بعدد الأيام الفعلي؛ التأجير الشهري والاستقدام بالأشهر لأن
 * تسعيرهما شهري؛ نقل الكفالة بلا مدة.
 */
export const DURATION_UNITS: Record<ServiceCode, PeriodUnit[]> = {
  daily_rental: ['day', 'week'],
  monthly_rental: ['month'],
  recruitment: ['month'],
  sponsorship_transfer: [],
};

/** وحدة مدة المسودة — وحدة غير مسموحة للخدمة تعود لوحدتها الافتراضية. */
export function periodUnitOf(d: Pick<OrderDraft, 'service' | 'durationUnit'>): PeriodUnit {
  const allowed = DURATION_UNITS[d.service];
  return allowed.includes(d.durationUnit) ? d.durationUnit : (allowed[0] ?? 'month');
}

/** عدد الأيام الفعلي لمدة بالأيام/الأسابيع (أساس تسعير التأجير اليومي). */
export function durationDays(unit: PeriodUnit, count: number): number {
  const n = Math.max(Math.floor(count), 1);
  return unit === 'week' ? n * 7 : n;
}

/** عدد وحدات المدة في المسودة بحسب الخدمة. */
export function periodCountOf(d: OrderDraft): number {
  switch (d.service) {
    case 'daily_rental':
      return Math.max(d.days, 1);
    case 'monthly_rental':
      return Math.max(d.months, 1);
    case 'recruitment':
      return Math.max(d.contractMonths, 1);
    default:
      return 1;
  }
}

/**
 * مدة الطلب (بداية · نهاية · عدد) — تُحسب من مصدر واحد في `period.ts`.
 * تُرجع null قبل إدخال تاريخ البداية أو لخدمة لا تُقاس بمدة (نقل الكفالة).
 */
export function draftPeriod(d: OrderDraft): RequestPeriod | null {
  if (d.service === 'sponsorship_transfer' || !d.startDate) return null;
  return buildPeriod(d.startDate, periodUnitOf(d), periodCountOf(d));
}

/** Pricing params passed to calc_price / fallback. quantity scales by duration. */
export function priceParams(d: OrderDraft): {
  nationality?: string;
  profession?: string;
  quantity: number;
} {
  switch (d.service) {
    case 'recruitment':
      return { nationality: d.nationality, profession: d.profession, quantity: 1 };
    case 'monthly_rental':
      return { nationality: d.nationality, quantity: Math.max(d.months, 1) };
    case 'daily_rental':
      return { profession: d.taskType, quantity: durationDays(periodUnitOf(d), d.days) };
    case 'sponsorship_transfer':
      return { quantity: 1 };
    default:
      return { quantity: 1 };
  }
}
