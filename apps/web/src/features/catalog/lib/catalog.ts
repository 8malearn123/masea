import { fallbackPrice } from '@/shared/lib/pricing';
import type { ServiceCode, WorkerProfile } from '@/lib/funnel';

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

/** Deterministic pseudo-random in [0,1) from a string id (stable per worker). */
function hash01(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return h / 100000;
}

export function ratingOf(w: WorkerProfile): number {
  return Math.round((4.4 + hash01(w.id) * 0.5) * 10) / 10; // 4.4–4.9
}

export function reviewsOf(w: WorkerProfile): number {
  return 8 + Math.floor(hash01(w.id + 'r') * 40);
}

/** Demo availability: most available, a couple reserved/soon (stable per worker). */
export function availabilityOf(w: WorkerProfile): Availability {
  if (w.status && w.status !== 'available') return 'reserved';
  const r = hash01(w.id + 'a');
  if (r > 0.86) return 'soon';
  if (r > 0.72) return 'reserved';
  return 'available';
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

export interface PriorExperience {
  country: string;
  detail: string;
  years: number;
}

export function priorExperienceOf(w: WorkerProfile): PriorExperience[] {
  const total = w.experience_years || 4;
  const first = Math.max(2, Math.round(total * 0.6));
  return [
    { country: 'السعودية', detail: `${w.profession} · أسرة من 5 أفراد`, years: first },
    {
      country: 'الإمارات',
      detail: `${w.profession} · رعاية منزلية`,
      years: Math.max(1, total - first),
    },
  ];
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

/* ---- Personal attributes: real value if present, else stable demo derive ---- */
export const RELIGIONS = ['مسلمة', 'مسيحية', 'بوذية', 'هندوسية'];
export const MARITAL_STATUSES = ['عزباء', 'متزوجة', 'مطلّقة', 'أرملة'];
export const MOTHER_TONGUES = [
  'الإنجليزية',
  'الإندونيسية',
  'الفلبينية',
  'السواحيلية',
  'البنغالية',
  'السنهالية',
  'الأمهرية',
];
export const AGE_RANGES: { label: string; min: number; max: number }[] = [
  { label: '٢١–٢٥', min: 21, max: 25 },
  { label: '٢٦–٣٠', min: 26, max: 30 },
  { label: '٣١–٣٥', min: 31, max: 35 },
  { label: '٣٦–٤٥', min: 36, max: 45 },
];

const RELIGION_BY_NATIONALITY: Record<string, string> = {
  إندونيسيا: 'مسلمة',
  بنغلاديش: 'مسلمة',
  الفلبين: 'مسيحية',
  كينيا: 'مسيحية',
  أوغندا: 'مسيحية',
  إثيوبيا: 'مسيحية',
  سريلانكا: 'بوذية',
};
const MOTHER_TONGUE_BY_NATIONALITY: Record<string, string> = {
  إندونيسيا: 'الإندونيسية',
  بنغلاديش: 'البنغالية',
  الفلبين: 'الفلبينية',
  كينيا: 'السواحيلية',
  أوغندا: 'الإنجليزية',
  إثيوبيا: 'الأمهرية',
  سريلانكا: 'السنهالية',
};

export function religionOf(w: WorkerProfile): string {
  return w.religion ?? RELIGION_BY_NATIONALITY[w.nationality] ?? 'مسلمة';
}

export function motherTongueOf(w: WorkerProfile): string {
  return (
    w.mother_tongue ??
    MOTHER_TONGUE_BY_NATIONALITY[w.nationality] ??
    w.languages.find((l) => l !== 'العربية') ??
    w.languages[0] ??
    'الإنجليزية'
  );
}

export function maritalOf(w: WorkerProfile): string {
  if (w.marital_status) return w.marital_status;
  return MARITAL_STATUSES[Math.floor(hash01(w.id + 'm') * MARITAL_STATUSES.length)] ?? 'عزباء';
}

/** Union of spoken languages across all workers (for the filter list). */
export function spokenLanguages(workers: WorkerProfile[]): string[] {
  return [...new Set(workers.flatMap((w) => w.languages))].sort();
}
