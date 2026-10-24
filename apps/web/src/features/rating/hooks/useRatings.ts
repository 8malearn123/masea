import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  addWorkerReview,
  applyModeration,
  listRatings,
  listWorkerReviews,
  moderateRating,
} from '@/features/rating/api/rating.api';
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
    queryFn: () => listWorkerReviews(workerId),
    enabled: workerId.length > 0,
  });
}

/** إرسال تقييم/تعليق على عاملة — يدخل قائمة المراجعة ولا يُنشر تلقائياً. */
export function useAddWorkerReview(workerId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    Rating,
    Error,
    { workerName: string; customerName: string; stars: number; comment: string }
  >({
    mutationFn: (input) => addWorkerReview({ workerId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('شكراً لك — استلمنا تقييمك وسيظهر بعد مراجعة الإدارة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إرسال التقييم'),
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
