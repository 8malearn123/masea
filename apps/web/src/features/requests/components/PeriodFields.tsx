import { CalendarCheck, CalendarClock, CalendarX2, CircleCheck } from 'lucide-react';
import { dateAr } from '@/shared/lib/format';
import { conflictFor, nextFreeDay } from '@/features/catalog/lib/availability';
import { buildPeriod, periodDays, periodLabel, today } from '@/features/requests/lib/period';
import type { PeriodUnit } from '@/features/requests/types';

const inputCls =
  'w-full rounded-xl border border-brand-100 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * مدة طلب العاملة: تاريخ البداية + عدد الأيام/الأشهر، وتاريخ النهاية يُحسب
 * تلقائيًا من `period.ts` (مصدر حساب واحد). عند وجود عاملة مختارة تُفحص المدة
 * مقابل جدول توفّرها فورًا.
 */
export function PeriodFields({
  startDate,
  unit,
  count,
  onChange,
  workerId,
  workerName,
  maxCount = unit === 'day' ? 30 : 24,
}: {
  startDate: string;
  unit: PeriodUnit;
  count: number;
  onChange: (patch: { startDate?: string; count?: number }) => void;
  workerId?: string | null;
  workerName?: string | null;
  maxCount?: number;
}) {
  const minDate = today();
  const period = buildPeriod(startDate, unit, count);
  const hasRange = Boolean(period.startDate && period.endDate);
  const conflict =
    workerId && hasRange ? conflictFor(workerId, period.startDate, period.endDate) : null;
  const nextFree = conflict && workerId ? nextFreeDay(workerId, periodDays(period)) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-brand-dark">تاريخ بداية الخدمة</span>
          <input
            type="date"
            min={minDate}
            value={startDate}
            onChange={(e) => onChange({ startDate: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-brand-dark">
            {unit === 'day' ? 'عدد الأيام' : 'عدد الأشهر'}
          </span>
          <input
            type="number"
            min={1}
            max={maxCount}
            value={count}
            onChange={(e) => onChange({ count: Number(e.target.value) })}
            className={inputCls}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={CalendarCheck} label="تاريخ البداية" value={dateAr(period.startDate || null)} />
        <Stat icon={CalendarX2} label="تاريخ النهاية" value={dateAr(period.endDate || null)} />
        <Stat icon={CalendarClock} label="المدة" value={hasRange ? periodLabel(period) : '—'} />
      </div>

      {workerId && hasRange && (
        <div
          className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
            conflict ? 'bg-red-50 text-red-700' : 'bg-teal-100 text-teal'
          }`}
        >
          {conflict ? (
            <CalendarClock size={16} className="mt-0.5 shrink-0" />
          ) : (
            <CircleCheck size={16} className="mt-0.5 shrink-0" />
          )}
          <span>
            {conflict ? (
              <>
                جدول {workerName ?? 'العاملة'} محجوز ({conflict.reason}) من{' '}
                <span className="num">{dateAr(conflict.start)}</span> إلى{' '}
                <span className="num">{dateAr(conflict.end)}</span>.
                {nextFree && (
                  <>
                    {' '}
                    أقرب تاريخ متاح <span className="num font-bold">{dateAr(nextFree)}</span>.
                  </>
                )}
              </>
            ) : (
              <>{workerName ?? 'العاملة'} متاحة طوال المدة المطلوبة.</>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarCheck;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-brand-50 p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-brand-dark/60">
        <Icon size={13} /> {label}
      </p>
      <p className="num mt-1 text-sm font-bold text-brand">{value}</p>
    </div>
  );
}
