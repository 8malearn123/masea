import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { listRatings } from '@/features/rating/api/rating.api';
import { getReviewService } from '@/features/rating/services/reviewService';
import type { ReviewSubmission } from '@/features/rating/schemas/review.schema';
import type { Rating } from '@/features/rating/types';

export function useRatings() {
  return useQuery({
    queryKey: ['rating', 'list'],
    queryFn: listRatings,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

/** تقييمات وتعليقات عاملة بعينها. */
export function useWorkerReviews(workerId: string) {
  return useQuery({
    queryKey: ['rating', 'worker', workerId],
    queryFn: () => getReviewService().getWorkerReviews(workerId),
    enabled: workerId.length > 0,
  });
}

/** ملخّص تقييمات العاملة (متوسط/عدد/توزيع) — يتحدث بعد إضافة تقييم. */
export function useWorkerRatingSummary(workerId: string) {
  return useQuery({
    queryKey: ['rating', 'summary', workerId],
    queryFn: () => getReviewService().getWorkerRatingSummary(workerId),
    enabled: workerId.length > 0,
  });
}

/** تقييم هذا الطلب للعاملة إن سبق. */
export function useRequestReview(requestNo: string, workerId: string) {
  return useQuery({
    queryKey: ['rating', 'request', requestNo, workerId],
    queryFn: () => getReviewService().getRequestReview(requestNo, workerId),
    enabled: requestNo.length > 0 && workerId.length > 0,
  });
}

/**
 * أهلية تقييم الطلب — تُقرأ من جديد عند كل عرض (staleTime: 0) لأن الموظفين
 * قد يغيّرون حالة الخدمة من لوحة الطلبات.
 */
export function useReviewEligibility(requestNo: string, workerId: string) {
  return useQuery({
    queryKey: ['rating', 'eligibility', requestNo, workerId],
    queryFn: () => getReviewService().getReviewEligibility(requestNo, workerId),
    enabled: requestNo.length > 0 && workerId.length > 0,
    staleTime: 0,
  });
}

/** إضافة تقييم مرتبط بطلب ثم إبطال كل ما يعرض التقييمات. */
export function useAddReview() {
  const qc = useQueryClient();
  return useMutation<Rating, Error, ReviewSubmission>({
    mutationFn: (input) => getReviewService().addReview(input),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rating'] }),
  });
}
