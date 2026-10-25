import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { useToast } from '@/shared/ui';
import { applyModeration, listRatings, moderateRating } from '@/features/rating/api/rating.api';
import { getReviewService } from '@/features/rating/services/reviewService';
import type { ReviewSubmission } from '@/features/rating/schemas/review.schema';
import type { ModerationAction, Rating } from '@/features/rating/types';

const LIST_KEY = ['rating', 'list'] as const;

/** Admin moderation queue (all statuses). */
export function useRatings() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: listRatings,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

/** تقييمات وتعليقات عاملة بعينها — المنشورة فقط. */
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

/** إضافة تقييم مرتبط بطلب (يدخل قائمة المراجعة ولا يُنشر تلقائيًا) ثم إبطال كل ما يعرض التقييمات. */
export function useAddReview() {
  const qc = useQueryClient();
  return useMutation<Rating, Error, ReviewSubmission>({
    mutationFn: (input) => getReviewService().addReview(input),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rating'] }),
  });
}

const ACTION_DONE: Record<ModerationAction, string> = {
  approve: 'تمت الموافقة ونُشر التعليق',
  reject: 'تم رفض التعليق',
  pending: 'أُعيد التعليق إلى قيد المراجعة',
  delete: 'تم حذف التعليق',
  restore: 'تمت استعادة التعليق',
};

/** Moderate a review (optimistic) then refresh the queue and the public lists. */
export function useModerateRating() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { id: string; action: ModerationAction; note?: string },
    { prev: Rating[] | undefined }
  >({
    mutationFn: ({ id, action, note }) => moderateRating(id, action, note),
    onMutate: async ({ id, action, note }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Rating[]>(LIST_KEY);
      qc.setQueryData<Rating[]>(LIST_KEY, (old) =>
        old?.map((r) => (r.id === id ? applyModeration(r, action, note) : r)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
      toast.error(e.message || 'تعذّر تنفيذ الإجراء');
    },
    onSuccess: (_d, { action }) => toast.success(ACTION_DONE[action]),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['rating'] }),
  });
}
