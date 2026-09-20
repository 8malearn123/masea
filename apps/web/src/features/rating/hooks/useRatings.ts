import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { addWorkerReview, listRatings, listWorkerReviews } from '@/features/rating/api/rating.api';
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
    queryFn: () => listWorkerReviews(workerId),
    enabled: workerId.length > 0,
  });
}

/** إضافة تقييم/تعليق على عاملة ثم إبطال الكاش. */
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
      void qc.invalidateQueries({ queryKey: ['rating'] });
      toast.success('شكراً لك — نُشر تقييمك');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إرسال التقييم'),
  });
}
