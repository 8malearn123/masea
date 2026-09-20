import { useState } from 'react';
import { MessageSquare, Send, Star } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useAddWorkerReview, useWorkerReviews } from '@/features/rating/hooks/useRatings';
import { ratingSummaryOf } from '@/features/rating/api/rating.api';

/**
 * تقييمات وتعليقات العملاء المرتبطة بالعاملة — تُقرأ من وحدة التقييم القائمة
 * (`features/rating`) عبر `worker_id`، ويقدر العميل على إضافة تقييمه من هنا.
 */
export function WorkerReviews({ workerId, workerName }: { workerId: string; workerName: string }) {
  const { data: reviews = [], isLoading, isError, refetch } = useWorkerReviews(workerId);
  const add = useAddWorkerReview(workerId);
  const summary = ratingSummaryOf(workerId);

  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(5);
  const [customerName, setCustomerName] = useState('');
  const [comment, setComment] = useState('');

  const submit = () => {
    if (!comment.trim()) return;
    add.mutate(
      { workerName, customerName, stars, comment },
      {
        onSuccess: () => {
          setComment('');
          setCustomerName('');
          setStars(5);
          setOpen(false);
        },
      },
    );
  };

  return (
    <div>
      {/* الملخّص */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl bg-navy-50 p-4">
        <div className="text-center">
          <p className="num text-2xl font-bold text-navy">
            {summary.count > 0 ? summary.average.toFixed(1) : '—'}
          </p>
          <Stars value={Math.round(summary.average)} />
          <p className="num mt-1 text-[11px] text-purple">{summary.count} تقييم</p>
        </div>
        <div className="min-w-[160px] flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((s) => {
            const n = summary.distribution[s] ?? 0;
            const pct = summary.count > 0 ? Math.round((n / summary.count) * 100) : 0;
            return (
              <div key={s} className="flex items-center gap-2">
                <span className="num w-3 text-[11px] text-purple">{s}</span>
                <Star size={10} className="fill-gold text-gold" />
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
                  <span
                    className="block h-full rounded-full bg-gold"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="num w-6 text-left text-[11px] text-purple">{n}</span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-xl bg-navy px-4 py-2 text-xs font-semibold text-white transition hover:bg-navy-700"
        >
          {open ? 'إلغاء' : 'أضف تقييمك'}
        </button>
      </div>

      {/* نموذج الإضافة */}
      {open && (
        <div className="mb-4 space-y-3 rounded-xl border border-navy-100 p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-navy-900">تقييمك:</span>
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStars(s)}
                aria-label={`${s} نجوم`}
                className="transition hover:scale-110"
              >
                <Star size={20} className={s <= stars ? 'fill-gold text-gold' : 'text-navy-200'} />
              </button>
            ))}
          </div>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="اسمك (اختياري)"
            className="w-full rounded-xl border border-navy-100 px-3.5 py-2.5 text-sm outline-none focus:border-navy"
          />
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="اكتب تجربتك مع العاملة…"
            className="w-full rounded-xl border border-navy-100 px-3.5 py-2.5 text-sm outline-none focus:border-navy"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!comment.trim() || add.isPending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gold px-4 py-2 text-xs font-bold text-white transition hover:bg-gold-600 disabled:opacity-50"
          >
            <Send size={14} /> {add.isPending ? 'جارٍ الإرسال…' : 'إرسال التقييم'}
          </button>
        </div>
      )}

      {/* القائمة */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState description="تعذّر تحميل التقييمات." onRetry={() => void refetch()} />
      ) : reviews.length === 0 ? (
        <EmptyState
          icon="💬"
          title="لا توجد تقييمات بعد"
          description="كن أول من يشارك تجربته مع هذه العاملة."
        />
      ) : (
        <ul className="space-y-2.5">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-xl border border-navy-100 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-navy-50 text-xs font-bold text-navy">
                    {r.customer_name.charAt(0)}
                  </span>
                  <span className="text-sm font-semibold text-navy">{r.customer_name}</span>
                </span>
                <Stars value={r.stars} />
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed text-navy-900">
                <MessageSquare size={13} className="mt-1 shrink-0 text-purple" />
                {r.comment}
              </p>
              <p className="num mt-1 text-[11px] text-purple">{dateAr(r.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={13} className={s <= value ? 'fill-gold text-gold' : 'text-navy-200'} />
      ))}
    </span>
  );
}
