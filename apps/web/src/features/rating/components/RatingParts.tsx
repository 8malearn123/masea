import { MessageSquare, MessageSquareDashed, Star } from 'lucide-react';
import { ErrorState, Skeleton } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useWorkerRatingSummary, useWorkerReviews } from '@/features/rating/hooks/useRatings';
import { reviewerDisplayName, reviewsLabel } from '@/features/rating/types';

/** صف نجوم للعرض فقط. */
export function StarRow({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} من 5 نجوم`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={size}
          aria-hidden
          className={s <= Math.round(value) ? 'fill-gold text-gold' : 'text-navy-200'}
        />
      ))}
    </span>
  );
}

/**
 * ملخّص مختصر: «4.8 (23 تقييمًا)» من تقييمات العملاء الفعلية، أو «لا توجد تقييمات
 * بعد» — لا يُعرض ٠ كأنه تقييم.
 */
export function RatingBadge({
  workerId,
  className = '',
}: {
  workerId: string;
  className?: string;
}) {
  const { data, isLoading, isError } = useWorkerRatingSummary(workerId);
  // span لا div: الشارة تُعرض داخل فقرات (<p>)
  if (isLoading) {
    return (
      <span
        aria-hidden
        className={`inline-block h-3.5 w-20 animate-pulse rounded bg-navy-50 ${className}`}
      />
    );
  }
  if (isError || !data) return null;
  if (data.average === null) {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] text-purple ${className}`}>
        <Star size={11} aria-hidden className="text-navy-200" /> لا توجد تقييمات بعد
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold text-gold-600 ${className}`}
      aria-label={`التقييم ${data.average.toFixed(1)} من 5 — ${reviewsLabel(data.count)}`}
    >
      <Star size={11} aria-hidden className="fill-current" />
      <span className="num">{data.average.toFixed(1)}</span>
      <span className="font-normal text-purple">({reviewsLabel(data.count)})</span>
    </span>
  );
}

/** المتوسط والعدد وتوزيع النجوم. */
export function RatingSummaryPanel({ workerId }: { workerId: string }) {
  const { data, isLoading, isError, refetch } = useWorkerRatingSummary(workerId);
  if (isLoading) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (isError || !data) {
    return <ErrorState description="تعذّر تحميل ملخّص التقييمات." onRetry={() => void refetch()} />;
  }
  if (data.average === null) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-navy-50 p-4 text-sm text-purple">
        <Star size={16} aria-hidden className="text-navy-200" /> لا توجد تقييمات بعد
      </div>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-xl bg-navy-50 p-4"
      aria-label="ملخص التقييمات"
    >
      <div className="text-center">
        <p className="num text-2xl font-bold text-navy">{data.average.toFixed(1)}</p>
        <StarRow value={data.average} />
        <p className="mt-1 text-[11px] text-purple">{reviewsLabel(data.count)}</p>
      </div>
      <ul className="min-w-[160px] flex-1 space-y-1" aria-label="توزيع النجوم">
        {[5, 4, 3, 2, 1].map((s) => {
          const n = data.distribution[s] ?? 0;
          const pct = Math.round((n / data.count) * 100);
          return (
            <li key={s} className="flex items-center gap-2" aria-label={`${s} نجوم: ${n}`}>
              <span className="num w-3 text-[11px] text-purple">{s}</span>
              <Star size={10} aria-hidden className="fill-gold text-gold" />
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
                <span className="block h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
              </span>
              <span className="num w-6 text-left text-[11px] text-purple">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** قائمة التقييمات (الأحدث أولًا) باسم عرض غير حساس. */
export function ReviewList({ workerId }: { workerId: string }) {
  const { data: reviews = [], isLoading, isError, refetch } = useWorkerReviews(workerId);
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError)
    return <ErrorState description="تعذّر تحميل التقييمات." onRetry={() => void refetch()} />;
  if (reviews.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-navy-100 p-8 text-center">
        <MessageSquareDashed size={28} aria-hidden className="text-navy-200" />
        <p className="mt-2 text-sm font-bold text-navy">لا توجد تقييمات بعد</p>
        <p className="mt-1 text-xs text-purple">يظهر هنا تقييم العملاء بعد تجربتهم مع العاملة.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2.5" aria-label="قائمة التقييمات">
      {reviews.map((r) => {
        const name = reviewerDisplayName(r.customer_name);
        return (
          <li key={r.id} className="rounded-xl border border-navy-100 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-navy-50 text-xs font-bold text-navy">
                  {name.charAt(0)}
                </span>
                <span className="text-sm font-semibold text-navy">{name}</span>
              </span>
              <StarRow value={r.stars} />
            </div>
            {r.comment && (
              <p className="mt-2 flex items-start gap-1.5 break-words text-sm leading-relaxed text-navy-900 [overflow-wrap:anywhere]">
                <MessageSquare size={13} aria-hidden className="mt-1 shrink-0 text-purple" />
                {r.comment}
              </p>
            )}
            <p className="num mt-1 text-[11px] text-purple">{dateAr(r.created_at)}</p>
          </li>
        );
      })}
    </ul>
  );
}
