import { z } from 'zod';

/** أقصى طول للتعليق. */
export const REVIEW_COMMENT_MAX = 500;

/**
 * نموذج تقييم العاملة كما يُدخله العميل: النجوم مطلوبة (عدد صحيح ١–٥)، والتعليق
 * اختياري؛ إن كُتب فلا يكون مسافات فقط ولا يتجاوز الحد، ويُحفظ بعد إزالة المسافات.
 */
export const reviewFormSchema = z.object({
  rating: z
    .unknown()
    .refine((v) => v !== null && v !== undefined && v !== 0 && v !== '', {
      message: 'اختر تقييمًا من ١ إلى ٥ نجوم.',
    })
    .refine((v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5, {
      message: 'التقييم عدد صحيح من ١ إلى ٥ نجوم.',
    })
    .transform((v) => v as number),
  comment: z
    .string()
    .refine((v) => v.length === 0 || v.trim().length > 0, {
      message: 'التعليق لا يكون مسافات فقط — اكتب تعليقًا أو اتركه فارغًا.',
    })
    .transform((v) => v.trim())
    .refine((v) => v.length <= REVIEW_COMMENT_MAX, {
      message: `التعليق لا يتجاوز ${REVIEW_COMMENT_MAX} حرف.`,
    }),
});

export type ReviewFormInput = z.input<typeof reviewFormSchema>;

/** التقييم كما يصل لخدمة التقييمات: مرتبط دائمًا بطلب وعاملة. */
export const reviewSubmissionSchema = reviewFormSchema.extend({
  requestNo: z.string().trim().min(1, { message: 'التقييم يجب أن يرتبط بطلب.' }),
  workerId: z.string().trim().min(1, { message: 'التقييم يجب أن يرتبط بعاملة.' }),
});

export type ReviewSubmission = z.input<typeof reviewSubmissionSchema>;
