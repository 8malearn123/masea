import { useMemo, useState } from 'react';
import {
  CalendarClock,
  CalendarX2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
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
import {
  matchLabel,
  rankWorkers,
  MATCH_MIN_SCORE_FALLBACK,
  type MatchResult,
  type RankedWorker,
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
 * ترشيح العاملات حسب احتياج الطلب: لكل عاملة نسبة المطابقة وأسبابها وما ينقصها
 * وما لا توجد عنه بيانات، وتوفّرها للفترة كشرط مستقل. المتاحات (أو الكل إن لم
 * تُحدَّد فترة) هن الخيارات الأساسية؛ غير المتاحات للفترة في قسم منفصل ولا
 * تُختار. حدّ الترشيح الأدنى قيمة إدارية من إعدادات النظام، لا رقم في الكود.
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
  const [showBlocked, setShowBlocked] = useState(false);
  const [openSchedule, setOpenSchedule] = useState<string | null>(null);

  const ranked = useMemo(
    () => rankWorkers(workers, need, showAll ? 0 : minScore),
    [workers, need, minScore, showAll],
  );
  const eligible = ranked.filter((r) => r.match.eligible);
  const blocked = ranked.filter((r) => !r.match.eligible);
  const hidden = workers.length - ranked.length;
  const highlight =
    need.period && need.period.startDate && need.period.endDate
      ? { start: need.period.startDate, end: need.period.endDate }
      : undefined;

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-navy-50" />
        ))}
      </div>
    );
  }

  const renderCard = ({ worker, match }: RankedWorker) => (
    <WorkerMatchCard
      key={worker.id}
      worker={worker}
      match={match}
      active={selectedId === worker.id}
      scheduleOpen={openSchedule === worker.id}
      onToggleSchedule={() => setOpenSchedule(openSchedule === worker.id ? null : worker.id)}
      onSelect={() => onSelect(worker, match)}
      highlight={highlight}
    />
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-purple">
          <Sparkles size={15} className="text-gold-600" />
          <span className="num font-bold text-navy">{eligible.length}</span> عاملة مرشّحة لاحتياج
          طلبك
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

      {eligible.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-navy-200 bg-white p-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-navy-50 text-navy-200">
            <UserRound size={24} />
          </span>
          <p className="mt-2 text-sm font-bold text-navy">
            {blocked.length > 0
              ? 'لا توجد عاملة مطابقة متاحة خلال الفترة المحددة'
              : 'لا توجد عاملة مطابقة لهذا الاحتياج'}
          </p>
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
          {allowNone && (
            <button
              type="button"
              onClick={() => onSelect(null, null)}
              className="mt-2 text-xs font-semibold text-navy hover:underline"
            >
              بدون تحديد — رشّحوا لي الأنسب
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {allowNone && (
            <button
              type="button"
              onClick={() => onSelect(null, null)}
              className={`self-start rounded-xl border p-4 text-center text-sm transition ${
                selectedId === null ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy'
              }`}
            >
              بدون تحديد — رشّحوا لي الأنسب
            </button>
          )}
          {eligible.map(renderCard)}
        </div>
      )}

      {blocked.length > 0 && (
        <section className="mt-4">
          <button
            type="button"
            onClick={() => setShowBlocked((v) => !v)}
            aria-expanded={showBlocked}
            className="flex w-full items-center justify-between rounded-xl border border-red-100 bg-red-50/60 px-3.5 py-2.5 text-xs font-semibold text-red-700"
          >
            <span className="flex items-center gap-1.5">
              <CalendarX2 size={14} /> غير متاحة خلال الفترة المحددة (
              <span className="num">{blocked.length}</span>)
            </span>
            <ChevronDown
              size={14}
              className={`transition-transform ${showBlocked ? 'rotate-180' : ''}`}
            />
          </button>
          {showBlocked && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">{blocked.map(renderCard)}</div>
          )}
        </section>
      )}
    </div>
  );
}

/** بطاقة عاملة واحدة: النسبة، التوفّر، أسباب المطابقة، النواقص، والاختيار. */
function WorkerMatchCard({
  worker,
  match,
  active,
  scheduleOpen,
  onToggleSchedule,
  onSelect,
  highlight,
}: {
  worker: WorkerProfile;
  match: MatchResult;
  active: boolean;
  scheduleOpen: boolean;
  onToggleSchedule: () => void;
  onSelect: () => void;
  highlight: { start: string; end: string } | undefined;
}) {
  const blocked = !match.eligible;
  // أسباب المطابقة (بدون سطر التوفّر — يظهر في ملخّص التوفّر تحتها)
  const reasons = match.criteria.filter((c) => c.status === 'matched').slice(0, 4);
  const gaps = match.criteria
    .filter((c) => c.status === 'missing' || c.status === 'partial')
    .slice(0, 2);
  const unknowns = match.criteria.filter((c) => c.status === 'unknown').slice(0, 2);

  return (
    <article
      aria-label={worker.full_name}
      className={`flex flex-col rounded-xl border transition ${
        active ? 'border-navy bg-navy-50' : blocked ? 'border-red-100' : 'border-navy-100'
      }`}
    >
      <div className="flex items-start gap-3 p-3.5">
        {worker.photo_url ? (
          <img
            src={worker.photo_url}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-navy-100"
          />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white font-bold text-navy ring-1 ring-navy-100">
            {worker.full_name.charAt(0)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p className="text-sm font-bold text-navy">{worker.full_name}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-bold ${TONE[toneKey(match.score)]}`}
            >
              <span className="num">{match.score}٪</span> {matchLabel(match.score)}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-purple">
            <span className="text-sm leading-none">{flagFor(worker.nationality)}</span>
            {worker.profession} · {worker.nationality}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px]">
            <span className="flex items-center gap-1 text-gold-600">
              <Star size={11} className="fill-current" />
              <span className="num">{ratingOf(worker).toFixed(1)}</span>
            </span>
            <span className="text-purple">
              <span className="num">{sar(worker.monthly_salary)}</span> ر.س / شهر
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-2 px-3.5 pb-3">
        <AvailabilitySummary
          result={match.availability}
          nextFree={blocked ? match.nextFree : null}
        />

        {reasons.length > 0 && (
          <ul aria-label="أسباب المطابقة" className="space-y-0.5">
            {reasons.map((c) => (
              <li key={c.key} className="flex items-start gap-1 text-[11px] text-teal">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0" /> {c.detail}
              </li>
            ))}
          </ul>
        )}
        {(gaps.length > 0 || unknowns.length > 0) && (
          <div>
            <p className="text-[11px] font-semibold text-navy">ينقصها:</p>
            <ul aria-label="المتطلبات غير المتوفرة" className="space-y-0.5">
              {gaps.map((c) => (
                <li key={c.key} className="flex items-start gap-1 text-[11px] text-gold-600">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {c.detail}
                </li>
              ))}
              {unknowns.map((c) => (
                <li key={c.key} className="flex items-start gap-1 text-[11px] text-purple">
                  <CircleHelp size={12} className="mt-0.5 shrink-0" /> {c.detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={onSelect}
          disabled={blocked}
          aria-pressed={active}
          aria-label={`اختيار ${worker.full_name}${blocked ? ' — غير متاحة خلال الفترة المحددة' : ''}`}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:bg-navy-50 disabled:text-navy-200 ${
            active ? 'bg-navy text-white' : 'border border-navy-200 text-navy hover:bg-navy-50'
          }`}
        >
          {active ? <Check size={14} /> : null}
          {blocked ? 'غير متاحة للاختيار' : active ? 'تم الاختيار' : 'اختيار العاملة'}
        </button>
      </div>

      <button
        type="button"
        onClick={onToggleSchedule}
        aria-expanded={scheduleOpen}
        className="mt-auto flex w-full items-center justify-between border-t border-navy-50 px-3.5 py-2 text-[11px] font-semibold text-navy hover:bg-white/60"
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
    </article>
  );
}
