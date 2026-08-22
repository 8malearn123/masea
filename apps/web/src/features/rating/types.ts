import type { BadgeTone } from '@/shared/ui/Badge';

export type RatingTarget = 'worker' | 'driver' | 'service' | 'branch';

export interface Rating {
  id: string;
  customer_name: string;
  target_type: RatingTarget;
  target_name: string;
  stars: number; // 1..5
  comment: string;
  created_at: string;
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
