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
  comment: string;
  created_at: string;
}

/** ملخّص تقييمات عاملة واحدة. */
export interface RatingSummary {
  count: number;
  /** المتوسّط من ٥ (٠ عند عدم وجود تقييمات). */
  average: number;
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
