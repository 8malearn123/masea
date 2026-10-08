import { CalendarCheck, CalendarClock, CalendarX2 } from 'lucide-react';
import { dateAr } from '@/shared/lib/format';
import type { AvailabilityResult } from '@/features/catalog/lib/availability';

const TONE = {
  available: 'border-teal-100 bg-teal-100/40 text-teal',
  busy: 'border-red-100 bg-red-50 text-red-700',
  unknown: 'border-navy-100 bg-navy-50 text-purple',
} as const;

/**
 * ملخّص توفّر العاملة لفترة الطلب: الحالة، الفترة المطلوبة، والتعارض. لا يعرض
 * إلا تواريخ الانشغال وسببها العام — لا أرقام طلبات ولا بيانات عملاء.
 */
export function AvailabilitySummary({
  result,
  nextFree,
}: {
  result: AvailabilityResult;
  nextFree?: string | null;
}) {
  if (result.status === 'unknown') {
    return (
      <p
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] ${TONE.unknown}`}
      >
        <CalendarClock size={13} className="shrink-0" /> {result.message}
      </p>
    );
  }
  const free = result.available;
  const Icon = free ? CalendarCheck : CalendarX2;
  return (
    <dl
      aria-label="ملخص التوفر"
      className={`space-y-1 rounded-lg border px-3 py-2 text-[11px] ${free ? TONE.available : TONE.busy}`}
    >
      <div className="flex items-center justify-between gap-2">
        <dt className="flex items-center gap-1.5">
          <Icon size={13} /> الحالة
        </dt>
        <dd className="font-bold">{free ? 'متاحة' : 'غير متاحة'}</dd>
      </div>
      <div className="flex items-center justify-between gap-2">
        <dt>الفترة المطلوبة</dt>
        <dd className="num">
          {dateAr(result.startDate)} – {dateAr(result.endDate)}
        </dd>
      </div>
      <div className="flex items-start justify-between gap-2">
        <dt>التعارض</dt>
        <dd className="num text-left">
          {free
            ? 'لا يوجد'
            : result.conflicts.map((c) => (
                <span key={`${c.start}-${c.end}`} className="block">
                  {dateAr(c.start)} – {dateAr(c.end)}
                </span>
              ))}
        </dd>
      </div>
      {!free && (
        <p className="pt-0.5 font-semibold">
          {result.message}
          {result.status === 'partial' && (
            <span className="num font-normal">
              {' '}
              ({result.busyDays} من {result.totalDays} يوم مشغولة)
            </span>
          )}
          {nextFree && (
            <span className="num block font-normal">أقرب توفّر للمدة نفسها {dateAr(nextFree)}</span>
          )}
        </p>
      )}
    </dl>
  );
}
