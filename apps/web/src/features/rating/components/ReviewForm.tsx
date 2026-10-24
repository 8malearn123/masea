import { useId, useState } from 'react';
import { CheckCircle2, Send, Star } from 'lucide-react';
import { useAddReview } from '@/features/rating/hooks/useRatings';
import { REVIEW_COMMENT_MAX, reviewFormSchema } from '@/features/rating/schemas/review.schema';
import { ReviewServiceError } from '@/features/rating/services/reviewService';

const STAR_LABEL = ['', 'سيئة', 'مقبولة', 'جيدة', 'جيدة جدًا', 'ممتازة'];

/**
 * نموذج تقييم العاملة من ملف الطلب: نجوم (أزرار راديو حقيقية — تعمل بالأسهم
 * ولوحة المفاتيح) + تعليق اختياري. التحقق بـ Zod، والحفظ عبر خدمة التقييمات
 * المرتبطة بالطلب والعاملة.
 */
export function ReviewForm({
  requestNo,
  workerId,
  workerName,
  onDone,
  onDuplicate,
}: {
  requestNo: string;
  workerId: string;
  workerName: string;
  onDone?: () => void;
  /** الطلب قُيّم مسبقًا (من تبويب آخر مثلًا) — يعرض المستدعي التقييم القائم مع الرسالة. */
  onDuplicate?: () => void;
}) {
  const id = useId();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useAddReview();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reviewFormSchema.safeParse({ rating, comment });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'بيانات التقييم غير صالحة');
      return;
    }
    setError(null);
    add.mutate(
      { requestNo, workerId, rating: parsed.data.rating, comment: parsed.data.comment },
      {
        onSuccess: () => onDone?.(),
        onError: (err) => {
          if (err instanceof ReviewServiceError && err.kind === 'duplicate') onDuplicate?.();
          setError(err.message || 'تعذّر إرسال التقييم');
        },
      },
    );
  };

  if (add.isSuccess) {
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 rounded-xl bg-teal-100 p-3 text-sm font-semibold text-teal"
      >
        <CheckCircle2 size={16} /> شكرًا لك — نُشر تقييمك.
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-navy-100 p-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-navy-900">تقييمك لـ {workerName}</legend>
        <div role="radiogroup" aria-label="عدد النجوم" className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <label
              key={s}
              className="cursor-pointer rounded-lg p-1.5 focus-within:ring-2 focus-within:ring-gold"
            >
              <input
                type="radio"
                name={`${id}-stars`}
                value={s}
                checked={rating === s}
                onChange={() => {
                  setRating(s);
                  setError(null);
                }}
                className="sr-only"
                aria-label={`${s} ${s === 1 ? 'نجمة' : 'نجوم'} — ${STAR_LABEL[s]}`}
              />
              <Star
                size={28}
                aria-hidden
                className={s <= rating ? 'fill-gold text-gold' : 'text-navy-200'}
              />
            </label>
          ))}
          {rating > 0 && <span className="ms-1 text-xs text-purple">{STAR_LABEL[rating]}</span>}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${id}-comment`} className="mb-1 block text-sm font-medium text-navy-900">
          تعليقك (اختياري)
        </label>
        <textarea
          id={`${id}-comment`}
          rows={3}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setError(null);
          }}
          maxLength={REVIEW_COMMENT_MAX + 50}
          aria-describedby={`${id}-count`}
          placeholder="اكتب تجربتك مع العاملة…"
          className="w-full rounded-xl border border-navy-100 px-3.5 py-2.5 text-sm outline-none focus:border-navy"
        />
        <span
          id={`${id}-count`}
          className={`num block text-left text-[11px] ${comment.trim().length > REVIEW_COMMENT_MAX ? 'text-red-600' : 'text-purple'}`}
        >
          {comment.trim().length}/{REVIEW_COMMENT_MAX}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-xs font-semibold text-red-600">
          {error}
        </p>
      )}

      <div data-fab-avoid>
        <button
          type="submit"
          disabled={add.isPending}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-gold px-5 py-2.5 text-sm font-bold text-white transition hover:bg-gold-600 disabled:opacity-50"
        >
          <Send size={15} /> {add.isPending ? 'جارٍ الإرسال…' : 'إرسال التقييم'}
        </button>
      </div>
    </form>
  );
}
