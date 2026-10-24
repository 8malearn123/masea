import type { BadgeTone } from '@/shared/ui/Badge';

export type RatingTarget = 'worker' | 'driver' | 'service' | 'branch';

/**
 * Moderation state (supabase `ratings.status`, 0053). Nothing is published
 * automatically: a new review is `pending` until management approves it.
 */
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** Moderation actions available from the admin queue. */
export type ModerationAction = 'approve' | 'reject' | 'pending' | 'delete' | 'restore';

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
  status: ReviewStatus;
  /** ملاحظة المراجِع (سبب الرفض مثلاً) — لا تظهر للزوار. */
  moderation_note?: string | null;
  moderated_at?: string | null;
  /** حذف = تعطيل (soft delete) — يختفي من الموقع ويبقى في السجل. */
  deleted_at?: string | null;
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

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'منشور',
  rejected: 'مرفوض',
};

export const REVIEW_STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  pending: 'gold',
  approved: 'success',
  rejected: 'danger',
};

/** Only approved, non-deleted reviews are ever shown to visitors. */
export function isPublished(r: Pick<Rating, 'status' | 'deleted_at'>): boolean {
  return r.status === 'approved' && !r.deleted_at;
}
