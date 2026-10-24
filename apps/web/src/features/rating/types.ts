import type { BadgeTone } from '@/shared/ui/Badge';

export type RatingTarget = 'worker' | 'driver' | 'service' | 'branch';

export interface Rating {
  id: string;
  customer_name: string;
  target_type: RatingTarget;
  target_name: string;
  /** مُعرّف العاملة في `worker_profiles` — يربط التقييم بملفها (تقييمات العاملة). */
  worker_id?: string | null;
  stars: number; // 1..5
  /** التعليق (اختياري — قد يكون فارغًا إذا اكتفى العميل بالنجوم). */
  comment: string;
  created_at: string;
  /** رقم الطلب الذي نتج عنه التقييم — تقييم واحد لكل (طلب + عاملة). */
  request_no?: string | null;
}

/** ملخّص تقييمات عاملة واحدة. */
export interface RatingSummary {
  count: number;
  /** المتوسّط من ٥ — null عند عدم وجود تقييمات (لا يُعرض ٠ كتقييم حقيقي). */
  average: number | null;
  /** توزيع النجوم: العدد لكل درجة من ١ إلى ٥. */
  distribution: Record<number, number>;
}

export const RATING_TARGET_LABEL: Record<RatingTarget, string> = {
  worker: 'العاملة',
  driver: 'السائق',
  service: 'الخدمة',
  branch: 'الفرع',
};

export const RATING_TARGET_TONE: Record<RatingTarget, BadgeTone> = {
  worker: 'navy',
  driver: 'teal',
  service: 'gold',
  branch: 'success',
};

export function starTone(stars: number): BadgeTone {
  if (stars >= 4) return 'success';
  if (stars >= 3) return 'gold';
  return 'danger';
}

/** «تقييم واحد» / «تقييمان» / «٥ تقييمات» / «٢٣ تقييمًا». */
export function reviewsLabel(n: number): string {
  if (n === 1) return 'تقييم واحد';
  if (n === 2) return 'تقييمان';
  return `${n} ${n >= 3 && n <= 10 ? 'تقييمات' : 'تقييمًا'}`;
}

/**
 * اسم عرض غير حساس للعميل: الاسم الأول + أول حرف من اسم العائلة
 * («محمد الأحمدي» ← «محمد أ.»). لا يُعرض الاسم الكامل في التقييمات العامة.
 */
export function reviewerDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'عميل';
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  const initial = last.replace(/^(آل|ال)/, '').charAt(0) || last.charAt(0);
  return initial ? `${first} ${initial}.` : first;
}
