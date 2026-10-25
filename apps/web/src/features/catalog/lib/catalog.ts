import { fallbackPrice } from '@/shared/lib/pricing';
import { ratingSummaryOf } from '@/features/rating/api/rating.api';
import type { ServiceCode, WorkerProfile } from '@/lib/funnel';
import { dayState } from '@/features/catalog/lib/availability';
import { today } from '@/features/requests/lib/period';

/** Customer-facing catalog helpers — enrich the existing worker_profiles with
 *  presentational CV details (skills, rating, prior experience) and per-service
 *  pricing from the shared engine. No new data concept — derived from الموجود. */

export const SERVICE_ORDER: ServiceCode[] = [
  'recruitment',
  'monthly_rental',
  'daily_rental',
  'sponsorship_transfer',
];

export const SERVICE_LABEL: Record<ServiceCode, string> = {
  recruitment: 'استقدام',
  monthly_rental: 'تأجير شهري',
  daily_rental: 'تأجير يومي',
  sponsorship_transfer: 'نقل كفالة',
};

export const SERVICE_UNIT: Record<ServiceCode, string> = {
  recruitment: 'لمرة واحدة',
  monthly_rental: '/ شهر',
  daily_rental: '/ يوم',
  sponsorship_transfer: 'لمرة واحدة',
};

export type Availability = 'available' | 'reserved' | 'soon';

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'متاحة الآن',
  reserved: 'محجوزة',
  soon: 'قريباً',
};

/**
 * تقييم العاملة: متوسّط تقييمات عملائها الفعلية فقط — null إذا لم تُقيَّم بعد
 * (لا تقدير افتراضي يُعرض كأنه تقييم حقيقي).
 */
export function ratingOf(w: WorkerProfile): number | null {
  return ratingSummaryOf(w.id).average;
}

/** عدد التقييمات المنشورة على العاملة (٠ إذا لم تُقيَّم). */
export function reviewsOf(w: WorkerProfile): number {
  return ratingSummaryOf(w.id).count;
}

/**
 * حالة العاملة اليوم من جدول التوفّر نفسه (`availability.ts`) — نفس مصدر التقويم
 * وفحص الطلب، فلا تظهر «متاحة الآن» لعاملة محجوزة اليوم في جدولها.
 */
export function availabilityOf(w: WorkerProfile): Availability {
  if (w.status && w.status !== 'available') return 'reserved';
  return dayState(w.id, today()) === 'available' ? 'available' : 'reserved';
}

export interface Skill {
  label: string;
  level: string;
}

const SKILLS_BY_PROFESSION: Record<string, Skill[]> = {
  'عاملة منزلية': [
    { label: 'التنظيف', level: 'ممتاز' },
    { label: 'الطبخ', level: 'جيد جداً' },
    { label: 'تنظيم المنزل', level: 'ممتاز' },
    { label: 'الغسيل والكي', level: 'جيد جداً' },
  ],
  'مربية أطفال': [
    { label: 'رعاية الأطفال', level: 'ممتاز' },
    { label: 'حديثي الولادة', level: 'جيد جداً' },
    { label: 'المتابعة الدراسية', level: 'جيد' },
    { label: 'الطبخ للأطفال', level: 'جيد جداً' },
  ],
  طباخة: [
    { label: 'المأكولات العربية', level: 'ممتاز' },
    { label: 'المأكولات الآسيوية', level: 'ممتاز' },
    { label: 'الحلويات', level: 'جيد جداً' },
    { label: 'التنظيف', level: 'جيد' },
  ],
};

export function skillsOf(w: WorkerProfile): Skill[] {
  return (
    SKILLS_BY_PROFESSION[w.profession] ?? [
      { label: 'الأعمال المنزلية', level: 'ممتاز' },
      { label: 'التنظيم', level: 'جيد جداً' },
    ]
  );
}

export interface ServicePrice {
  code: ServiceCode;
  label: string;
  unit: string;
  total: number;
}

/** Per-service price for a worker from the shared engine. */
export function servicePrices(w: WorkerProfile): ServicePrice[] {
  return SERVICE_ORDER.map((code) => {
    const p = fallbackPrice(code, {
      nationality: w.nationality,
      profession: w.profession,
      quantity: 1,
    });
    return { code, label: SERVICE_LABEL[code], unit: SERVICE_UNIT[code], total: p.total };
  });
}

export const NATIONALITIES = [
  'الفلبين',
  'إندونيسيا',
  'كينيا',
  'إثيوبيا',
  'سريلانكا',
  'أوغندا',
  'بنغلاديش',
];
export const PROFESSIONS = ['عاملة منزلية', 'مربية أطفال', 'طباخة', 'سائق'];

/** «سنة واحدة» / «سنتان» / «٥ سنوات» / «١٢ سنة» — صيغة عربية سليمة للعدد. */
export function yearsLabel(n: number): string {
  if (n === 1) return 'سنة واحدة';
  if (n === 2) return 'سنتان';
  return `${n} ${n >= 3 && n <= 10 ? 'سنوات' : 'سنة'}`;
}

export const AGE_RANGES: { label: string; min: number; max: number }[] = [
  { label: '٢١–٢٥', min: 21, max: 25 },
  { label: '٢٦–٣٠', min: 26, max: 30 },
  { label: '٣١–٣٥', min: 31, max: 35 },
  { label: '٣٦–٤٥', min: 36, max: 45 },
];

/**
 * سمات شخصية من سجل العاملة فقط — لا تُستنتج الديانة أو اللغة الأم من الجنسية،
 * ولا الحالة الاجتماعية من المعرّف. null = غير متوفر في البيانات.
 */
export function religionOf(w: WorkerProfile): string | null {
  return w.religion?.trim() || null;
}

export function motherTongueOf(w: WorkerProfile): string | null {
  return w.mother_tongue?.trim() || null;
}

export function maritalOf(w: WorkerProfile): string | null {
  return w.marital_status?.trim() || null;
}

/** القيم الموجودة فعلًا في بيانات العاملات لسمة ما (لخيارات الفلتر). */
export function attributeOptions(
  workers: WorkerProfile[],
  read: (w: WorkerProfile) => string | null,
): string[] {
  return [...new Set(workers.map(read).filter((v): v is string => v !== null))].sort();
}

/** Union of spoken languages across all workers (for the filter list). */
export function spokenLanguages(workers: WorkerProfile[]): string[] {
  return [...new Set(workers.flatMap((w) => w.languages))].sort();
}
