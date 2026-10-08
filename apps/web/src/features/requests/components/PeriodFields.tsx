import { CalendarCheck, CalendarClock, CalendarHeart, CalendarX2, CircleCheck } from 'lucide-react';
import { dateAr } from '@/shared/lib/format';
import { conflictFor, nextFreeDay } from '@/features/catalog/lib/availability';
import { buildPeriod, periodDays, periodLabel, today } from '@/features/requests/lib/period';
import type { PeriodUnit } from '@/features/requests/types';
import { PERIOD_UNIT_LABEL } from '@/features/requests/types';

const COUNT_LABEL: Record<PeriodUnit, string> = {
  day: 'عدد الأيام',
  week: 'عدد الأسابيع',
  month: 'عدد الأشهر',
};

const inputCls =
  'w-full rounded-xl border border-brand-100 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/**
 * مدة طلب العاملة: تاريخ البداية + وحدة المدة (من الوحدات المتاحة للخدمة) +
 * العدد، وتاريخ النهاية يُحسب تلقائيًا من `period.ts` (مصدر حساب واحد) ولا
 * يُدخل يدويًا. عند وجود عاملة مختارة تُفحص المدة مقابل جدول توفّرها فورًا.
 */
export function PeriodFields({
  startDate,
  unit,
  units = [unit],
  count,
  maxCount,
  onChange,
  workerId,
  workerName,
  eventDate,
}: {
  startDate: string;
  unit: PeriodUnit;
  /** الوحدات المتاحة للخدمة — يظهر الاختيار عند وجود أكثر من وحدة. */
  units?: PeriodUnit[];
  count: number;
  maxCount: number;
  onChange: (patch: { startDate?: string; count?: number; unit?: PeriodUnit }) => void;
  workerId?: string | null;
  workerName?: string | null;
  /** تاريخ المناسبة (إن وُجد) — يُعرض للتمييز عن تاريخ بداية الخدمة، لا يحل محله. */
  eventDate?: string | null;
}) {
  const minDate = today();
  const period = buildPeriod(startDate, unit, count);
  const validCount = Number.isInteger(count) && count >= 1 && count <= maxCount;
  const hasRange = Boolean(validCount && period.startDate && period.endDate);
  const conflict =
    workerId && hasRange ? conflictFor(workerId, period.startDate, period.endDate) : null;
  const nextFree = conflict && workerId ? nextFreeDay(workerId, periodDays(period)) : null;
  const eventOutside =
    hasRange && eventDate && (eventDate < period.startDate || eventDate > period.endDate);

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
            {COUNT_LABEL[unit]}
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={maxCount}
            step={1}
            value={Number.isFinite(count) && count !== 0 ? count : ''}
            onChange={(e) =>
              onChange({ count: e.target.value === '' ? 0 : Number(e.target.value) })
            }
            className={`num ${inputCls}`}
          />
        </label>
      </div>

      {units.length > 1 && (
        <div
          role="radiogroup"
          aria-label="وحدة المدة"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-sm font-medium text-brand-dark">وحدة المدة</span>
          {units.map((u) => {
            const active = u === unit;
            return (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ unit: u })}
                className={`min-w-16 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active ? 'bg-brand text-white' : 'bg-brand-50 text-brand-dark hover:bg-brand-100'
                }`}
              >
                {PERIOD_UNIT_LABEL[u]}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          icon={CalendarCheck}
          label="تاريخ بداية الخدمة"
          value={dateAr(period.startDate || null)}
        />
        <Stat
          icon={CalendarClock}
          label="مدة الخدمة"
          value={validCount ? periodLabel(period) : '—'}
        />
        <Stat
          icon={CalendarX2}
          label="تاريخ نهاية الخدمة"
          value={hasRange ? dateAr(period.endDate) : '—'}
        />
      </div>

      {eventDate && (
        <p
          className={`flex items-start gap-2 rounded-xl px-4 py-3 text-xs ${
            eventOutside ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-dark/70'
          }`}
        >
          <CalendarHeart size={15} className="mt-0.5 shrink-0" />
          <span>
            تاريخ المناسبة <span className="num font-bold">{dateAr(eventDate)}</span> — منفصل عن مدة
            الخدمة.
            {eventOutside && ' تنبيه: تاريخ المناسبة خارج مدة الخدمة المحددة.'}
          </span>
        </p>
      )}

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
                {workerName ?? 'العاملة'} غير متاحة خلال الفترة المحددة — مشغولة من{' '}
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
