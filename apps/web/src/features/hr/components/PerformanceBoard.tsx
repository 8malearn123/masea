import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Download,
  Eye,
  Gauge,
  Pencil,
  Plus,
  Save,
  Target,
  Trophy,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Skeleton,
  StatTile,
  Table,
  type Column,
} from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { exportCsv } from '@/shared/lib/exportTable';
import { usePermissions } from '@/hooks/usePermissions';
import { ROLE_META, type RoleCode } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import { currentEmployees } from '@/features/hr/api/hr.api';
import {
  usePerfAuto,
  usePerfBands,
  usePerfCriteria,
  usePerfTargets,
  usePerformanceReviews,
  useSaveReview,
  useSaveTarget,
  useSetReviewActive,
  useTargetBoard,
} from '@/features/hr/hooks/usePerformance';
import {
  applicableCriteria,
  bandFor,
  computeReview,
  firstError,
  reviewSchema,
  targetSchema,
} from '@/features/hr/lib/performanceEngine';
import {
  PERF_SOURCE_LABEL,
  type Employee,
  type PerfBand,
  type PerfCriterionScore,
  type PerformanceReview,
} from '@/features/hr/types';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;

function BandBadge({ score, bands }: { score: number; bands: PerfBand[] }) {
  const b = bandFor(score, bands);
  return b ? <Badge tone={b.tone}>{b.name_ar}</Badge> : null;
}

/** «12 من 15 عقد» / «حضور 18 · تأخير 2 · غياب 1» */
function autoDetail(source: PerfCriterionScore['source'], d: PerfCriterionScore['detail']): string {
  if (!d) return '';
  if (source === 'sales_count')
    return d.target ? `${d.achieved ?? 0} من ${d.target} عقد` : 'لا يوجد مستهدف للفترة';
  if (source === 'sales_amount')
    return d.target ? `${sar(d.achieved ?? 0)} من ${sar(d.target)} ر.س` : 'لا يوجد مستهدف للفترة';
  if (source === 'attendance')
    return (d.present ?? 0) + (d.late ?? 0) + (d.absent ?? 0)
      ? `حضور ${d.present} · تأخير ${d.late} · غياب ${d.absent}`
      : 'لا يوجد سجل حضور للفترة';
  return '';
}

/* -------------------------------- board ----------------------------------- */
export function PerformanceBoard({ employees }: { employees: Employee[] }) {
  const [tab, setTab] = useState<'reviews' | 'targets'>('reviews');
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-navy-100 bg-white p-1">
        {(
          [
            ['reviews', 'التقييمات', Gauge],
            ['targets', 'المستهدفات والإنجاز', Target],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === k ? 'bg-navy text-white' : 'text-purple hover:text-navy'}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === 'reviews' ? <Reviews employees={employees} /> : <Targets employees={employees} />}
    </div>
  );
}

/* ------------------------------- reviews ---------------------------------- */
type Dialog = { kind: 'new' } | { kind: 'edit' | 'view'; review: PerformanceReview } | null;

function Reviews({ employees }: { employees: Employee[] }) {
  const { can } = usePermissions();
  const canEdit = can('hr', 'edit');
  const bands = usePerfBands();
  const { data: all = [], isLoading, isError, refetch } = usePerformanceReviews();
  const setActive = useSetReviewActive();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const [band, setBand] = useState('all');
  const [dialog, setDialog] = useState<Dialog>(null);

  const active = all.filter((r) => r.is_active);
  const rows = all.filter(
    (r) =>
      r.is_active !== archived &&
      (!q.trim() || `${r.employee_name} ${r.period}`.includes(q.trim())) &&
      (band === 'all' || bandFor(r.score, bands)?.code === band),
  );
  const avg = active.length
    ? Math.round(active.reduce((s, r) => s + r.score, 0) / active.length)
    : 0;
  const top = [...active].sort((a, b) => b.score - a.score)[0];
  const weak = active.filter((r) => bandFor(r.score, bands)?.tone === 'danger').length;

  const columns: Column<PerformanceReview>[] = [
    {
      key: 'employee',
      header: 'الموظف',
      sortValue: (r) => r.employee_name,
      cell: (r) => <span className="font-semibold text-navy">{r.employee_name}</span>,
    },
    {
      key: 'period',
      header: 'الفترة',
      cell: (r) => (
        <div>
          {r.period}
          {r.period_from && (
            <div className="num text-[11px] text-purple">
              {dateAr(r.period_from)} → {dateAr(r.period_to)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'score',
      header: 'الدرجة',
      sortValue: (r) => r.score,
      cell: (r) => <span className="num font-bold text-navy">{r.score}٪</span>,
    },
    { key: 'band', header: 'التقدير', cell: (r) => <BandBadge score={r.score} bands={bands} /> },
    { key: 'reviewer', header: 'المُقيّم', cell: (r) => r.reviewer || '—' },
    {
      key: 'date',
      header: 'التاريخ',
      sortValue: (r) => r.date,
      cell: (r) => <span className="num text-xs">{dateAr(r.date)}</span>,
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="تفاصيل"
            title="تفاصيل"
            onClick={() => setDialog({ kind: 'view', review: r })}
          >
            <Eye size={15} />
          </Button>
          {canEdit && r.is_active && (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label="تعديل"
                title="تعديل"
                onClick={() => setDialog({ kind: 'edit', review: r })}
              >
                <Pencil size={15} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="أرشفة"
                title="أرشفة (لا حذف)"
                onClick={() => setActive.mutate({ id: r.id, active: false })}
              >
                <Archive size={15} />
              </Button>
            </>
          )}
          {canEdit && !r.is_active && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActive.mutate({ id: r.id, active: true })}
            >
              <ArchiveRestore size={14} /> استرجاع
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="متوسط الأداء" value={`${avg}٪`} icon={Gauge} />
        <StatTile label="التقييمات" value={active.length} icon={Gauge} />
        <StatTile
          label="الأعلى أداءً"
          value={top ? `${top.score}٪` : '—'}
          hint={top?.employee_name ?? ''}
          tone="success"
          icon={Trophy}
        />
        <StatTile label="يحتاجون خطة تحسين" value={weak} tone="danger" icon={Gauge} />
      </div>
      <Card className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <Input
            aria-label="بحث"
            placeholder="بحث بالاسم أو الفترة"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          aria-label="التقدير"
          value={band}
          onChange={(e) => setBand(e.target.value)}
          options={[
            { value: 'all', label: 'كل التقديرات' },
            ...bands.filter((b) => b.is_active).map((b) => ({ value: b.code, label: b.name_ar })),
          ]}
        />
        <Button variant={archived ? 'primary' : 'ghost'} onClick={() => setArchived(!archived)}>
          <Archive size={15} /> الأرشيف
        </Button>
        <Button
          variant="outline"
          aria-label="تصدير"
          disabled={rows.length === 0}
          onClick={() =>
            exportCsv({
              title: 'تقييمات الأداء',
              headers: [
                'الموظف',
                'الفترة',
                'من',
                'إلى',
                'الدرجة',
                'التقدير',
                'المُقيّم',
                'التاريخ',
              ],
              rows: rows.map((r) => [
                r.employee_name,
                r.period,
                r.period_from,
                r.period_to,
                r.score,
                bandFor(r.score, bands)?.name_ar ?? '',
                r.reviewer,
                r.date,
              ]),
            })
          }
        >
          <Download size={16} />
        </Button>
        {canEdit && (
          <Button onClick={() => setDialog({ kind: 'new' })}>
            <Plus size={16} /> تقييم جديد
          </Button>
        )}
      </Card>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle={archived ? 'لا توجد تقييمات مؤرشفة' : 'لا توجد تقييمات'}
      />
      {dialog?.kind === 'view' && (
        <ReviewDetails review={dialog.review} bands={bands} onClose={() => setDialog(null)} />
      )}
      {(dialog?.kind === 'new' || dialog?.kind === 'edit') && (
        <ReviewModal
          employees={employees}
          {...(dialog.kind === 'edit' ? { review: dialog.review } : {})}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ReviewDetails({
  review,
  bands,
  onClose,
}: {
  review: PerformanceReview;
  bands: PerfBand[];
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`تقييم ${review.employee_name} — ${review.period}`}
      size="lg"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="num text-3xl font-bold text-navy">{review.score}٪</span>
          <BandBadge score={review.score} bands={bands} />
          <span className="text-xs text-purple">
            المُقيّم: {review.reviewer || '—'} · <span className="num">{dateAr(review.date)}</span>
          </span>
        </div>
        <CriteriaTable criteria={review.criteria} />
        {review.notes && (
          <p className="rounded-xl bg-navy-50 px-3 py-2 text-sm text-navy">{review.notes}</p>
        )}
      </div>
    </Modal>
  );
}

function CriteriaTable({ criteria }: { criteria: PerfCriterionScore[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-50">
      <table className="w-full text-sm">
        <thead className="bg-navy-50 text-xs text-purple">
          <tr>
            <th className="px-3 py-2 text-right">المعيار</th>
            <th className="px-3 py-2 text-right">الوزن</th>
            <th className="px-3 py-2 text-right">الدرجة</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map((c) => (
            <tr key={c.code} className="border-t border-navy-50">
              <td className="px-3 py-2">
                <p className="font-medium text-navy">{c.name}</p>
                <p className="text-[11px] text-purple">
                  {PERF_SOURCE_LABEL[c.source]}
                  {c.source !== 'manual' && ` — ${autoDetail(c.source, c.detail)}`}
                </p>
              </td>
              <td className="num px-3 py-2">{c.weight}</td>
              <td className="num px-3 py-2 font-semibold">
                {c.score === null ? 'لا يُحتسب' : `${c.score}٪`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- add / edit -------------------------------- */
function ReviewModal({
  employees,
  review,
  onClose,
}: {
  employees: Employee[];
  review?: PerformanceReview;
  onClose: () => void;
}) {
  const me = useAuth((s) => s.profile?.full_name);
  const { data: criteria = [] } = usePerfCriteria();
  const bands = usePerfBands();
  const save = useSaveReview();
  const pool = currentEmployees(employees).filter((e) => e.full_name !== me);
  const [empId, setEmpId] = useState(review?.employee_id ?? '');
  const [period, setPeriod] = useState(review?.period ?? '');
  const [from, setFrom] = useState(review?.period_from || monthStart());
  const [to, setTo] = useState(review?.period_to || today());
  const [notes, setNotes] = useState(review?.notes ?? '');
  const [manual, setManual] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (review?.criteria ?? [])
        .filter((c) => c.source === 'manual')
        .map((c) => [c.code, String(c.score ?? '')]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const emp = employees.find((e) => e.id === empId);
  const auto = usePerfAuto(empId, from, to);

  const defs = useMemo(
    () =>
      review?.criteria.length
        ? review.criteria.map(({ code, name, source, weight }) => ({ code, name, source, weight }))
        : applicableCriteria(criteria, emp?.role).map((c) => ({
            code: c.code,
            name: c.name_ar,
            source: c.source,
            weight: c.weight,
          })),
    [review, criteria, emp?.role],
  );
  const manualNums = Object.fromEntries(
    Object.entries(manual)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => [k, Number(v)]),
  );
  let preview: { score: number } | null = null;
  if (auto.data && defs.length) {
    try {
      preview = computeReview(defs, manualNums, auto.data);
    } catch {
      preview = null; // incomplete — shown once every manual score is in
    }
  }

  function submit() {
    const base = { employee_id: empId, period, period_from: from, period_to: to, notes };
    const err = firstError(reviewSchema.safeParse(base));
    if (err) return setError(err);
    if (!auto.data) return setError('جارٍ احتساب الإنجاز…');
    try {
      computeReview(defs, manualNums, auto.data);
    } catch (e) {
      return setError((e as Error).message);
    }
    setError(null);
    save.mutate({ id: review?.id ?? null, ...base, manual: manualNums }, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={review ? `تعديل تقييم ${review.employee_name}` : 'تقييم أداء جديد'}
      size="lg"
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {review ? (
            <p className="rounded-xl bg-navy-50 px-3 py-2 text-sm text-navy">
              الموظف: <span className="font-semibold">{review.employee_name}</span>
            </p>
          ) : (
            <Select
              label="الموظف"
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              options={[
                { value: '', label: 'اختر…' },
                ...pool.map((e) => ({
                  value: e.id,
                  label: `${e.full_name} — ${e.job_title || e.branch}`,
                })),
              ]}
            />
          )}
          <Input
            label="اسم الفترة"
            placeholder="مثال: الربع الرابع 2026"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
          <Input label="من" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="إلى" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {!empId ? (
          <p className="rounded-xl bg-navy-50 px-3 py-6 text-center text-sm text-purple">
            اختر الموظف لعرض معايير دوره.
          </p>
        ) : auto.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : auto.isError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {(auto.error as Error).message}
          </p>
        ) : (
          <div className="space-y-2">
            {defs.map((d) => {
              const a = d.source === 'manual' ? null : auto.data?.[d.source];
              return (
                <div
                  key={d.code}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-navy">
                      {d.name}{' '}
                      <span className="num text-[11px] font-normal text-purple">
                        (الوزن {d.weight})
                      </span>
                    </p>
                    <p className="text-[11px] text-purple">
                      {PERF_SOURCE_LABEL[d.source]}
                      {a && ` — ${autoDetail(d.source, a as PerfCriterionScore['detail'])}`}
                    </p>
                  </div>
                  {d.source === 'manual' ? (
                    <div className="w-28">
                      <Input
                        aria-label={`درجة ${d.name}`}
                        type="number"
                        min={0}
                        max={100}
                        suffix="٪"
                        value={manual[d.code] ?? ''}
                        onChange={(e) => setManual({ ...manual, [d.code]: e.target.value })}
                      />
                    </div>
                  ) : (
                    <span className="num text-sm font-bold text-navy">
                      {a?.score == null ? 'لا يُحتسب' : `${a.score}٪`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Input
          label="ملاحظات وخطة التطوير"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex items-center justify-between rounded-xl bg-navy-50 px-3 py-2">
          <span className="text-sm text-navy">الدرجة الموزونة</span>
          <span className="flex items-center gap-2">
            <span className="num text-xl font-bold text-navy">
              {preview ? `${preview.score}٪` : '—'}
            </span>
            {preview && <BandBadge score={preview.score} bands={bands} />}
          </span>
        </div>
        <p className="text-[11px] text-purple">
          المعايير الآلية تُحسب من المبيعات الفعلية والمستهدفات وسجل الحضور، والمعيار بلا بيانات لا
          يدخل في الوزن. الحساب النهائي على الخادم.
        </p>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button className="w-full" loading={save.isPending} onClick={submit}>
          <Gauge size={16} /> حفظ التقييم
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------- targets ---------------------------------- */
function Targets({ employees }: { employees: Employee[] }) {
  const { can } = usePermissions();
  const canManage = can('hr', 'manage');
  const { data: criteria = [] } = usePerfCriteria();
  const { data: targets = [], isLoading, isError, refetch } = usePerfTargets();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [salesOnly, setSalesOnly] = useState(true);
  const board = useTargetBoard(period);

  // roles that carry a sales criterion = roles with sales targets
  const salesRoles = new Set(
    criteria
      .filter((c) => c.is_active && c.source !== 'manual' && c.source !== 'attendance')
      .flatMap((c) => c.roles),
  );
  const staff = currentEmployees(employees).filter(
    (e) => !salesOnly || (e.role && salesRoles.has(e.role)),
  );
  const tOf = (id: string) => targets.find((t) => t.employee_id === id && t.period === period);
  const achieved = new Map((board.data ?? []).map((r) => [r.employee_id, r]));

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Input
            label="الشهر"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={salesOnly}
            onChange={(e) => setSalesOnly(e.target.checked)}
          />
          أدوار المبيعات فقط
        </label>
        <p className="pb-2 text-xs text-purple">
          الإنجاز يُحسب آليًا من المبيعات المعتمدة (العقود الموقّعة) — لا إدخال يدوي للأرقام.
        </p>
      </Card>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <Card className="flex items-center justify-between text-sm text-red-700">
          تعذّر تحميل المستهدفات
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : staff.length === 0 ? (
        <Card className="py-8 text-center text-sm text-purple">لا يوجد موظفون بهذه الأدوار.</Card>
      ) : (
        <div className="space-y-2">
          {staff.map((e) => (
            <TargetRowEditor
              key={`${e.id}-${period}`}
              employee={e}
              period={period}
              target={tOf(e.id)}
              achieved={achieved.get(e.id)}
              editable={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TargetRowEditor({
  employee,
  period,
  target,
  achieved,
  editable,
}: {
  employee: Employee;
  period: string;
  target: { contracts_target: number; sales_amount_target: number; notes: string } | undefined;
  achieved: { contracts_achieved: number; sales_achieved: number } | undefined;
  editable: boolean;
}) {
  const save = useSaveTarget();
  const [c, setC] = useState(String(target?.contracts_target ?? ''));
  const [s, setS] = useState(String(target?.sales_amount_target ?? ''));
  const [error, setError] = useState<string | null>(null);
  const pct = (a: number, t: number | undefined) => (t ? Math.round((a / t) * 100) : null);
  const pc = pct(achieved?.contracts_achieved ?? 0, target?.contracts_target);
  const ps = pct(achieved?.sales_achieved ?? 0, target?.sales_amount_target);
  const dirty =
    c !== String(target?.contracts_target ?? '') || s !== String(target?.sales_amount_target ?? '');

  function submit() {
    const v = {
      employee_id: employee.id,
      period,
      contracts_target: Number(c || 0),
      sales_amount_target: Number(s || 0),
      notes: target?.notes ?? '',
    };
    const err = firstError(targetSchema.safeParse(v));
    if (err) return setError(err);
    setError(null);
    save.mutate(v);
  }

  return (
    <Card className="flex flex-wrap items-end gap-3 py-3">
      <div className="min-w-44 flex-1">
        <p className="font-semibold text-navy">{employee.full_name}</p>
        <p className="text-[11px] text-purple">
          {ROLE_META[employee.role as RoleCode]?.label ?? employee.job_title} · {employee.branch}
        </p>
      </div>
      <div className="w-28">
        <Input
          label="مستهدف العقود"
          type="number"
          min={0}
          value={c}
          disabled={!editable}
          onChange={(e) => setC(e.target.value)}
        />
      </div>
      <div className="w-36">
        <Input
          label="مستهدف المبيعات"
          type="number"
          min={0}
          suffix="ر.س"
          value={s}
          disabled={!editable}
          onChange={(e) => setS(e.target.value)}
        />
      </div>
      <div className="min-w-48 text-xs text-navy">
        <p>
          العقود: <span className="num font-semibold">{achieved?.contracts_achieved ?? 0}</span>
          {pc !== null && (
            <Badge tone={pc >= 100 ? 'success' : pc >= 75 ? 'navy' : 'danger'}>{pc}٪</Badge>
          )}
        </p>
        <p>
          المبيعات: <span className="num font-semibold">{sar(achieved?.sales_achieved ?? 0)}</span>
          {ps !== null && (
            <Badge tone={ps >= 100 ? 'success' : ps >= 75 ? 'navy' : 'danger'}>{ps}٪</Badge>
          )}
        </p>
      </div>
      {editable && (
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={submit}>
          <Save size={14} /> حفظ
        </Button>
      )}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </Card>
  );
}
