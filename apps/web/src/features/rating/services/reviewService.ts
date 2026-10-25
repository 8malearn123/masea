/**
 * خدمة تقييمات العاملات — عقد واحد للواجهة والمطابقة. التنفيذ الحالي تجريبي في
 * الذاكرة (نفس مخزن `rating.api.ts`) ولا يتصل بـ Supabase؛ تنفيذ Supabase
 * مستقبلًا يطبّق نفس الواجهة (`ReviewService`) دون تغيير في الصفحات.
 *
 * القواعد:
 *   - التقييم مرتبط دائمًا بطلب موجود وبالعاملة المختارة في ذلك الطلب.
 *   - تقييم واحد فقط لكل (طلب + عاملة).
 *   - تقييم جديد فقط إذا كانت حالة طلب التشغيل المرتبط «مكتملة» (`completed`)
 *     صراحةً في مخزن الطلبات المشترك — لا تُستنتج من التواريخ أو الدفع أو النص.
 *   - الملخّص (متوسط/عدد/توزيع) يُحسب من سجلات التقييم نفسها.
 */
import {
  findRequestReview,
  insertWorkerReview,
  listWorkerReviews,
  ratingSummaryOf,
} from '@/features/rating/api/rating.api';
import { getRequestFile } from '@/features/requests/api/requests.api';
import { demoOrderStatusOf } from '@/features/orders/api/orders.api';
import type { OrderStatus } from '@/features/orders/types';
import {
  reviewSubmissionSchema,
  type ReviewSubmission,
} from '@/features/rating/schemas/review.schema';
import type { Rating, RatingSummary } from '@/features/rating/types';

export type ReviewErrorKind =
  | 'validation'
  | 'duplicate'
  | 'not_found'
  | 'no_worker'
  | 'not_completed';

export class ReviewServiceError extends Error {
  constructor(
    message: string,
    readonly kind: ReviewErrorKind,
  ) {
    super(message);
    this.name = 'ReviewServiceError';
  }
}

export const DUPLICATE_REVIEW_MESSAGE = 'تم تقييم هذه العاملة لهذا الطلب مسبقًا.';
export const REVIEW_NOT_READY_MESSAGE = 'يتاح التقييم بعد اكتمال الخدمة';

/**
 * أهلية تقييم (طلب + عاملة). `serviceStatus: null` = لا يوجد طلب تشغيل مرتبط
 * (حالة غير معروفة) فلا يُسمح بتقييم جديد.
 */
export type ReviewEligibility =
  | { status: 'eligible' }
  | { status: 'reviewed'; review: Rating }
  | { status: 'not_completed'; serviceStatus: OrderStatus | null }
  | { status: 'not_found' }
  | { status: 'no_worker' }
  | { status: 'worker_mismatch' };

export interface ReviewService {
  getWorkerReviews(workerId: string): Promise<Rating[]>;
  /** متزامن عن قصد: المطابقة تقرأه أثناء الحساب دون تحويلها لـ async. */
  getWorkerRatingSummary(workerId: string): RatingSummary;
  /** التقييم السابق لنفس (الطلب + العاملة) إن وُجد. */
  getRequestReview(requestNo: string, workerId: string): Rating | null;
  /** هل يمكن إضافة تقييم الآن؟ التقييم القائم يبقى مقروءًا مهما كانت الحالة. */
  getReviewEligibility(requestNo: string, workerId: string): Promise<ReviewEligibility>;
  addReview(input: ReviewSubmission): Promise<Rating>;
}

export function createMockReviewService(): ReviewService {
  return {
    getWorkerReviews: (workerId) => listWorkerReviews(workerId),
    getWorkerRatingSummary: (workerId) => ratingSummaryOf(workerId),
    getRequestReview: (requestNo, workerId) => findRequestReview(requestNo, workerId),

    async getReviewEligibility(requestNo, workerId) {
      const file = await getRequestFile(requestNo);
      if (!file) return { status: 'not_found' };
      if (!file.worker) return { status: 'no_worker' };
      if (file.worker.id !== workerId) return { status: 'worker_mismatch' };
      const review = findRequestReview(requestNo, workerId);
      if (review) return { status: 'reviewed', review };
      const serviceStatus = demoOrderStatusOf(requestNo);
      if (serviceStatus !== 'completed') return { status: 'not_completed', serviceStatus };
      return { status: 'eligible' };
    },

    async addReview(input) {
      const parsed = reviewSubmissionSchema.safeParse(input);
      if (!parsed.success) {
        throw new ReviewServiceError(
          parsed.error.issues[0]?.message ?? 'بيانات التقييم غير صالحة',
          'validation',
        );
      }
      const { requestNo, workerId, rating, comment } = parsed.data;
      const file = await getRequestFile(requestNo);
      if (!file) throw new ReviewServiceError('لم نعثر على هذا الطلب.', 'not_found');
      if (!file.worker) {
        throw new ReviewServiceError('لا يمكن التقييم: الطلب غير مرتبط بعاملة.', 'no_worker');
      }
      if (file.worker.id !== workerId) {
        throw new ReviewServiceError('هذه العاملة ليست مرتبطة بهذا الطلب.', 'validation');
      }
      // الفحوص والحفظ متتالية بلا await بينها — لا يمر تقييمان متزامنان لنفس الطلب
      if (findRequestReview(requestNo, workerId)) {
        throw new ReviewServiceError(DUPLICATE_REVIEW_MESSAGE, 'duplicate');
      }
      if (demoOrderStatusOf(requestNo) !== 'completed') {
        throw new ReviewServiceError(REVIEW_NOT_READY_MESSAGE, 'not_completed');
      }
      return insertWorkerReview({
        workerId,
        workerName: file.worker.full_name,
        customerName: file.customer_name || 'عميل',
        stars: rating,
        comment,
        requestNo,
      });
    },
  };
}

let instance: ReviewService | null = null;

/** خدمة التقييمات الحالية — تجريبية دائمًا في هذه المرحلة. */
export function getReviewService(): ReviewService {
  instance ??= createMockReviewService();
  return instance;
}
