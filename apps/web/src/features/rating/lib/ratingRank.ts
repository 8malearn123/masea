import type { RatingSummary } from '@/features/rating/types';

/**
 * ترتيب «الأعلى تقييمًا» — متوسط مرجّح (Bayesian average) يراعي المتوسط وعدد
 * التقييمات معًا، فلا يتقدّم تقييم واحد بـ ٥ نجوم على عاملة لها تقييمات كثيرة
 * بمتوسط ٤٫٨:
 *
 *   الدرجة = (C × المتوسط العام + مجموع النجوم) ÷ (C + عدد التقييمات)
 *
 * المتوسط العام = متوسط كل تقييمات العاملات في البيانات، و C = ثقة افتراضية
 * تعادل عدد تقييمات «وهمية» عند المتوسط العام. لا يغيّر أي تقييم معروض — يستخدم
 * للترتيب فقط. العاملة بلا تقييمات تأتي بعد كل المُقيَّمات. التعادل: الأكثر
 * تقييمات، ثم المعرّف (ترتيب ثابت).
 */
export const RATING_RANK_CONFIDENCE = 5;

export interface RankableRating {
  id: string;
  summary: RatingSummary;
}

/** المتوسط العام لكل التقييمات (مرجّحًا بعددها) — null إن لم توجد تقييمات. */
export function globalAverage(items: RankableRating[]): number | null {
  let sum = 0;
  let count = 0;
  for (const { summary } of items) {
    if (summary.average === null) continue;
    sum += summary.average * summary.count;
    count += summary.count;
  }
  return count === 0 ? null : sum / count;
}

/** الدرجة المرجّحة لعاملة — null إن لم تُقيَّم. */
export function weightedRating(
  summary: RatingSummary,
  prior: number,
  confidence = RATING_RANK_CONFIDENCE,
): number | null {
  if (summary.average === null || summary.count === 0) return null;
  return (confidence * prior + summary.average * summary.count) / (confidence + summary.count);
}

/** مقارِن ترتيب «الأعلى تقييمًا» (تنازلي) — حتمي. */
export function compareByRating(items: RankableRating[]) {
  const prior = globalAverage(items) ?? 0;
  return (a: RankableRating, b: RankableRating): number => {
    const wa = weightedRating(a.summary, prior);
    const wb = weightedRating(b.summary, prior);
    if (wa === null && wb !== null) return 1;
    if (wb === null && wa !== null) return -1;
    if (wa !== null && wb !== null && wa !== wb) return wb - wa;
    if (a.summary.count !== b.summary.count) return b.summary.count - a.summary.count;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}
