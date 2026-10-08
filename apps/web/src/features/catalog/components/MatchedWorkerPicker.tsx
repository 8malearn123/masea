import { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  Star,
  TriangleAlert,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { flagFor } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import type { WorkerProfile } from '@/lib/funnel';
import { ratingOf } from '@/features/catalog/lib/catalog';
import { AvailabilityCalendar } from '@/features/catalog/components/AvailabilityCalendar';
import { AvailabilitySummary } from '@/features/catalog/components/AvailabilitySummary';
import { isWorkerAvailable } from '@/features/catalog/lib/availability';
import {
  matchLabel,
  rankWorkers,
  MATCH_MIN_SCORE_FALLBACK,
  type MatchResult,
  type RequestNeed,
} from '@/features/catalog/lib/matching';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';

const TONE: Record<string, string> = {
  high: 'bg-teal-100 text-teal',
  good: 'bg-gold-100 text-gold-600',
  partial: 'bg-navy-50 text-purple',
};

function toneKey(score: number): keyof typeof TONE {
  if (score >= 80) return 'high';
  if (score >= 60) return 'good';
  return 'partial';
}

/**
 * ترشيح العاملات حسب احتياج الطلب: ترتيب بالمطابقة، مع سبب كل ترشيح وحالة
 * التوفّر في المدة المطلوبة وجدول العاملة عند الطلب.
 * حدّ الترشيح الأدنى قيمة إدارية من إعدادات النظام، لا رقم في الكود.
 */
export function MatchedWorkerPicker({
  workers,
  need,
  selectedId,
  onSelect,
  allowNone,
  isLoading,
}: {
  workers: WorkerProfile[];
  need: RequestNeed;
  selectedId: string | null;
  onSelect: (worker: WorkerProfile | null, match: MatchResult | null) => void;
  allowNone?: boolean;
  isLoading?: boolean;
}) {
  const { data: config = [] } = useConfig();
  const minScore = configValue(config, 'match_min_score', MATCH_MIN_SCORE_FALLBACK);
  const [showAll, setShowAll] = useState(false);
  const [openSchedule, setOpenSchedule] = useState<string | null>(null);

  const ranked = useMemo(
    () => rankWorkers(workers, need, showAll ? 0 : minScore),
    [workers, need, minScore, showAll],
  );
  const hidden = workers.length - ranked.length;
  const highlight =
    need.period && need.period.startDate && need.period.endDate
      ? { start: need.period.startDate, end: need.period.endDate }
      : undefined;
  // توفّر كل عاملة لفترة الطلب الحالية — يُعاد حسابه عند تغيّر الفترة
  const availability = useMemo(
    () =>
      new Map(
        ranked.map(({ worker }) => [
          worker.id,
          isWorkerAvailable(worker.id, highlight?.start ?? '', highlight?.end ?? ''),
        ]),
      ),
    [ranked, highlight?.start, highlight?.end],
  );

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-navy-50" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-purple">
          <Sparkles size={15} className="text-gold-600" />
          <span className="num font-bold text-navy">{ranked.length}</span> عاملة مرشّحة لاحتياج طلبك
        </p>
        {hidden > 0 && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
          >
            <UsersRound size={13} /> عرض الباقي ({hidden})
          </button>
        )}
      </div>

      {ranked.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-navy-200 bg-white p-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-navy-50 text-navy-200">
            <UserRound size={24} />
          </span>
          <p className="mt-2 text-sm font-bold text-navy">لا توجد عاملة مطابقة لهذا الاحتياج</p>
          <p className="mt-1 max-w-xs text-xs text-purple">
            جرّب تعديل بيانات مكان الخدمة أو المدة، أو اعرض كل العاملات واختر بنفسك.
          </p>
          {!showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 rounded-xl border border-navy-200 px-4 py-2 text-xs font-semibold text-navy hover:bg-navy-50"
            >
              عرض كل العاملات
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {allowNone && (
            <button
              type="button"
              onClick={() => onSelect(null, null)}
              className={`rounded-xl border p-4 text-center text-sm transition ${
                selectedId === null ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy'
              }`}
            >
              بدون تحديد — رشّحوا لي الأنسب
            </button>
          )}
          {ranked.map(({ worker, match }) => {
            const active = selectedId === worker.id;
            const scheduleOpen = openSchedule === worker.id;
            const avail = availability.get(worker.id);
            // غير متاحة للفترة (كليًا أو جزئيًا) → لا تُختار
            const blocked = avail?.status === 'partial' || avail?.status === 'unavailable';
            return (
              <div
                key={worker.id}
                className={`rounded-xl border transition ${
                  active ? 'border-navy bg-navy-50' : blocked ? 'border-red-100' : 'border-navy-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(worker, match)}
                  disabled={blocked}
                  aria-label={`${worker.full_name}${blocked ? ' — غير متاحة خلال الفترة المحددة' : ''}`}
                  className="flex w-full items-start gap-3 p-3.5 text-right disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white font-bold text-navy ring-1 ring-navy-100">
                    {worker.full_name.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-navy">
                        {worker.full_name}
                      </span>
                      <span
                        className={`num shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE[toneKey(match.score)]}`}
                      >
                        {match.score}٪ {matchLabel(match.score)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-purple">
                      <span className="text-sm leading-none">{flagFor(worker.nationality)}</span>
                      {worker.profession} · {worker.nationality}
                    </span>
                    <span className="num mt-0.5 flex items-center gap-2 text-[11px] text-gold-600">
                      <Star size={11} className="fill-current" /> {ratingOf(worker).toFixed(1)}
                      <span className="text-purple">{sar(worker.monthly_salary)} ر.س / شهر</span>
                    </span>

                    {match.reasons.length > 0 && (
                      <span className="mt-1.5 block space-y-0.5">
                        {match.reasons.slice(0, 2).map((r) => (
                          <span key={r} className="flex items-center gap-1 text-[11px] text-teal">
                            <CheckCircle2 size={11} /> {r}
                          </span>
                        ))}
                      </span>
                    )}
                    {match.gaps.length > 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-gold-600">
                        <TriangleAlert size={11} /> {match.gaps[0]}
                      </span>
                    )}
                  </span>
                </button>

                {avail && (
                  <div className="px-3.5 pb-3">
                    <AvailabilitySummary
                      result={avail}
                      nextFree={blocked ? match.nextFree : null}
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setOpenSchedule(scheduleOpen ? null : worker.id)}
                  className="flex w-full items-center justify-between border-t border-navy-50 px-3.5 py-2 text-[11px] font-semibold text-navy hover:bg-white/60"
                >
                  <span className="flex items-center gap-1.5">
                    <CalendarClock size={13} /> جدول التوفّر
                  </span>
                  <ChevronDown
                    size={13}
                    className={`transition-transform ${scheduleOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {scheduleOpen && (
                  <div className="border-t border-navy-50 bg-white p-3">
                    <AvailabilityCalendar workerId={worker.id} highlight={highlight} compact />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
