import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { dateAr } from '@/shared/lib/format';
import {
  bookedRangesOf,
  dayState,
  freeDaysInHorizon,
  gridForDay,
  shiftMonth,
  WEEKDAYS_AR,
  type MonthGrid,
} from '@/features/catalog/lib/availability';
import { today } from '@/features/requests/lib/period';

/** المدة المطلوبة لتمييزها داخل التقويم. */
export interface HighlightRange {
  start: string;
  end: string;
}

const CELL_BASE = 'grid h-9 place-items-center rounded-lg text-xs font-medium transition num';

/**
 * جدول توفّر العاملة: تقويم شهري يفصل التواريخ المحجوزة عن المتاحة، مع قائمة
 * الحجوزات القادمة. البيانات من `availability.ts` (mock ثابت لكل عاملة).
 */
export function AvailabilityCalendar({
  workerId,
  highlight,
  compact,
}: {
  workerId: string;
  highlight?: HighlightRange | undefined;
  compact?: boolean;
}) {
  const from = useMemo(() => today(), []);
  const [grid, setGrid] = useState<MonthGrid>(() => gridForDay(highlight?.start || from));
  const ranges = useMemo(() => bookedRangesOf(workerId, from), [workerId, from]);
  const freeDays = useMemo(() => freeDaysInHorizon(workerId, from), [workerId, from]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setGrid((g) => shiftMonth(g, 1))}
          className="grid h-8 w-8 place-items-center rounded-lg border border-navy-100 text-navy hover:bg-navy-50"
          aria-label="الشهر التالي"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-sm font-bold text-navy">{grid.label}</p>
        <button
          type="button"
          onClick={() => setGrid((g) => shiftMonth(g, -1))}
          className="grid h-8 w-8 place-items-center rounded-lg border border-navy-100 text-navy hover:bg-navy-50"
          aria-label="الشهر السابق"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS_AR.map((d) => (
          <span key={d} className="pb-1 text-[10px] font-semibold text-purple">
            {d}
          </span>
        ))}
        {grid.cells.map((iso, i) => {
          if (!iso) return <span key={`e${i}`} />;
          const state = dayState(workerId, iso, from);
          const inRange = Boolean(highlight && iso >= highlight.start && iso <= highlight.end);
          const day = Number(iso.slice(8, 10));
          const cls =
            state === 'past'
              ? 'bg-navy-50/50 text-navy-200'
              : state === 'booked'
                ? 'bg-red-100 text-red-700'
                : 'bg-teal-100 text-teal';
          const ring = inRange ? ' ring-2 ring-gold ring-offset-1' : '';
          return (
            <span
              key={iso}
              className={`${CELL_BASE} ${cls}${ring}`}
              title={`${dateAr(iso)} · ${state === 'booked' ? 'محجوزة' : state === 'past' ? 'تاريخ سابق' : 'متاحة'}`}
            >
              {day}
            </span>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-purple">
        <Legend className="bg-teal-100 text-teal" label="متاحة" />
        <Legend className="bg-red-100 text-red-700" label="محجوزة" />
        {highlight && <Legend className="bg-white ring-2 ring-gold" label="المدة المطلوبة" />}
        <span className="num ms-auto">{freeDays} يوم متاح خلال الفترة القادمة</span>
      </div>

      {!compact && (
        <div className="mt-4 border-t border-navy-50 pt-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
            <CalendarDays size={14} /> الحجوزات القادمة
          </h3>
          {ranges.length === 0 ? (
            <p className="text-xs text-purple">لا توجد حجوزات — الجدول مفتوح بالكامل.</p>
          ) : (
            <ul className="space-y-1.5">
              {ranges.map((r) => (
                <li
                  key={`${r.start}-${r.end}`}
                  className="flex items-center justify-between rounded-lg bg-navy-50 px-3 py-2 text-xs"
                >
                  <span className="flex items-center gap-1.5 text-navy-900">
                    <Lock size={12} className="text-red-600" />
                    {r.reason}
                  </span>
                  <span className="num text-purple">
                    {dateAr(r.start)} — {dateAr(r.end)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded ${className}`} />
      {label}
    </span>
  );
}
