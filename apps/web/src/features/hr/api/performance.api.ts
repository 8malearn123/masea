/**
 * Performance (0076) — criteria, bands, monthly targets and reviews.
 * Live: perf_criteria / perf_bands / targets / performance_reviews +
 * perf_auto_scores + save_performance_review (weighted on the server).
 * Demo: in-memory stores applying the same rules; achievement comes from the
 * demo sales (listSales) and attendance (listMonthAttendance).
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { recordAudit } from '@/shared/lib/auditTrail';
import { roleCan, type RoleCode } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import { configValue, listConfig } from '@/features/settings/api/settings.api';
import { listSales } from '@/features/sales/api/sales.api';
import { listEmployees, listMonthAttendance } from '@/features/hr/api/hr.api';
import {
  applicableCriteria,
  attendanceScore,
  bandSchema,
  computeReview,
  criterionSchema,
  DEFAULT_BANDS,
  DEFAULT_CRITERIA,
  DEFAULT_LATE_WEIGHT,
  firstError,
  monthsInRange,
  PERF_LATE_WEIGHT_KEY,
  ratioScore,
  reviewSchema,
  targetSchema,
} from '@/features/hr/lib/performanceEngine';
import type {
  Employee,
  PerfAuto,
  PerfBand,
  PerfCriterion,
  PerfCriterionScore,
  PerformanceReview,
  PerfReviewInput,
  PerfTarget,
} from '@/features/hr/types';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
function one(v: unknown): Row | null {
  if (Array.isArray(v)) return (v[0] as Row | undefined) ?? null;
  return (v as Row | null) ?? null;
}
function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`تعذّر ${what}: ${error.message}`);
}

/* ------------------------------ demo stores -------------------------------- */
const CRITERIA: PerfCriterion[] = DEFAULT_CRITERIA.map((c) => ({ ...c, roles: [...c.roles] }));
const BANDS: PerfBand[] = DEFAULT_BANDS.map((b) => ({ ...b }));

const thisMonth = () => new Date().toISOString().slice(0, 7);
const prevMonth = () => {
  const d = new Date(`${thisMonth()}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
type StoredTarget = Omit<PerfTarget, 'employee_name' | 'branch'>;
const TARGETS: StoredTarget[] = [
  {
    id: 't1',
    employee_id: 'e3',
    period: thisMonth(),
    contracts_target: 12,
    sales_amount_target: 60000,
    notes: '',
  },
  {
    id: 't2',
    employee_id: 'e3',
    period: prevMonth(),
    contracts_target: 10,
    sales_amount_target: 50000,
    notes: '',
  },
  {
    id: 't3',
    employee_id: 'e2',
    period: thisMonth(),
    contracts_target: 20,
    sales_amount_target: 110000,
    notes: 'مستهدف الفرع',
  },
  {
    id: 't4',
    employee_id: 'e4',
    period: thisMonth(),
    contracts_target: 8,
    sales_amount_target: 35000,
    notes: '',
  },
];

function seedReview(
  id: string,
  employee_id: string,
  employee_name: string,
  manual: [number, number, number],
  reviewer: string,
  date: string,
): PerformanceReview {
  const defs = DEFAULT_CRITERIA.filter((c) => c.roles.length === 0).map((c) => ({
    code: c.code,
    name: c.name_ar,
    source: c.source,
    weight: c.weight,
  }));
  const none: PerfAuto = {
    sales_count: { achieved: 0, target: 0, score: null },
    sales_amount: { achieved: 0, target: 0, score: null },
    attendance: { present: 0, late: 0, absent: 0, score: null },
  };
  const r = computeReview(
    defs,
    { quality: manual[0], teamwork: manual[1], customers: manual[2] },
    none,
  );
  return {
    id,
    employee_id,
    employee_name,
    period: 'الربع الثالث 2026',
    period_from: '2026-07-01',
    period_to: '2026-09-30',
    score: r.score,
    criteria: r.criteria,
    notes: '',
    reviewer,
    date,
    is_active: true,
  };
}
const REVIEWS: PerformanceReview[] = [
  seedReview('p1', 'e1', 'فهد الشهري', [95, 92, 94], 'المدير العام', '2026-10-05'),
  seedReview('p2', 'e3', 'نورة العتيبي', [88, 90, 86], 'مدير الفرع', '2026-10-06'),
  seedReview('p3', 'e5', 'بدر المالكي', [82, 80, 84], 'المدير العام', '2026-10-06'),
  seedReview('p4', 'e4', 'ريم الزهراني', [66, 72, 68], 'مدير الفرع', '2026-10-07'),
  seedReview('p5', 'e6', 'خالد الدوسري', [90, 92, 88], 'المدير العام', '2026-10-07'),
];

function role(): RoleCode | undefined {
  return useAuth.getState().profile?.role as RoleCode | undefined;
}
function need(action: 'edit' | 'manage', msg: string): void {
  const r = role();
  if (useAuth.getState().profile && (!r || !roleCan(r, 'hr', action))) throw new Error(msg);
}
async function lateWeight(): Promise<number> {
  return configValue(await listConfig(), PERF_LATE_WEIGHT_KEY, DEFAULT_LATE_WEIGHT);
}

/* ------------------------------- criteria ---------------------------------- */
export async function listCriteria(): Promise<PerfCriterion[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase.from('perf_criteria').select('*').order('sort_order');
    fail(error, 'تحميل معايير التقييم');
    return ((data ?? []) as Row[]).map((r) => ({
      code: str(r.code),
      name_ar: str(r.name_ar),
      source: str(r.source) as PerfCriterion['source'],
      weight: num(r.weight),
      roles: (r.roles as string[] | null) ?? [],
      is_active: r.is_active !== false,
      sort_order: num(r.sort_order),
    }));
  }
  return CRITERIA.map((c) => ({ ...c, roles: [...c.roles] })).sort(
    (a, b) => a.sort_order - b.sort_order,
  );
}

export async function saveCriterion(c: PerfCriterion, isNew: boolean): Promise<void> {
  const err = firstError(criterionSchema.safeParse(c));
  if (err) throw new Error(err);
  const next = { ...c, name_ar: c.name_ar.trim() };
  if (!isDemoMode()) {
    const cols = {
      name_ar: next.name_ar,
      source: next.source,
      weight: next.weight,
      roles: next.roles,
      is_active: next.is_active,
      sort_order: next.sort_order,
    };
    const { error } = isNew
      ? await supabase.from('perf_criteria').insert(cols)
      : await supabase.from('perf_criteria').update(cols).eq('code', next.code);
    if (error) throw new Error(error.message);
    return;
  }
  need('manage', 'معايير التقييم من صلاحية إدارة الموارد البشرية');
  if (CRITERIA.some((x) => x.code !== next.code && x.name_ar === next.name_ar))
    throw new Error(`«${next.name_ar}» موجود`);
  const i = CRITERIA.findIndex((x) => x.code === next.code);
  const before = i >= 0 ? { ...CRITERIA[i]! } : null;
  if (i >= 0) CRITERIA[i] = next;
  else CRITERIA.push(next);
  recordAudit({
    action: before ? 'update' : 'insert',
    entity: 'perf_criteria',
    record_ref: next.name_ar,
    old_data: before,
    new_data: { ...next },
    branch: null,
  });
}

/* -------------------------------- bands ------------------------------------ */
export async function listBands(): Promise<PerfBand[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('perf_bands')
      .select('*')
      .order('min_score', { ascending: false });
    fail(error, 'تحميل شرائح التقدير');
    return ((data ?? []) as Row[]).map((r) => ({
      code: str(r.code),
      name_ar: str(r.name_ar),
      min_score: num(r.min_score),
      tone: str(r.tone) as PerfBand['tone'],
      is_active: r.is_active !== false,
    }));
  }
  return BANDS.map((b) => ({ ...b })).sort((a, b) => b.min_score - a.min_score);
}

export async function saveBand(b: PerfBand, isNew: boolean): Promise<void> {
  const err = firstError(bandSchema.safeParse(b));
  if (err) throw new Error(err);
  const next = { ...b, name_ar: b.name_ar.trim() };
  if (!isDemoMode()) {
    const cols = {
      name_ar: next.name_ar,
      min_score: next.min_score,
      tone: next.tone,
      is_active: next.is_active,
    };
    const { error } = isNew
      ? await supabase.from('perf_bands').insert(cols)
      : await supabase.from('perf_bands').update(cols).eq('code', next.code);
    if (error) throw new Error(error.message);
    return;
  }
  need('manage', 'شرائح التقدير من صلاحية إدارة الموارد البشرية');
  const i = BANDS.findIndex((x) => x.code === next.code);
  if (i >= 0) BANDS[i] = next;
  else BANDS.push(next);
}

/* ------------------------------- targets ----------------------------------- */
async function staffWithAccounts(): Promise<Employee[]> {
  return listEmployees();
}

export async function listTargets(): Promise<PerfTarget[]> {
  if (!isDemoMode()) {
    const [{ data, error }, emps] = await Promise.all([
      supabase
        .from('targets')
        .select('id, user_id, month, year, contracts_target, sales_amount_target, notes')
        .order('year', { ascending: false })
        .order('month', { ascending: false }),
      staffWithAccounts(),
    ]);
    fail(error, 'تحميل المستهدفات');
    const byUser = new Map(emps.filter((e) => e.user_id).map((e) => [e.user_id!, e]));
    return ((data ?? []) as Row[]).flatMap((r) => {
      const e = byUser.get(str(r.user_id));
      if (!e) return [];
      return [
        {
          id: str(r.id),
          employee_id: e.id,
          employee_name: e.full_name,
          branch: e.branch,
          period: `${r.year}-${String(r.month).padStart(2, '0')}`,
          contracts_target: num(r.contracts_target),
          sales_amount_target: num(r.sales_amount_target),
          notes: str(r.notes),
        },
      ];
    });
  }
  const emps = new Map((await listEmployees()).map((e) => [e.id, e]));
  const r = role();
  const p = useAuth.getState().profile;
  return TARGETS.flatMap((t) => {
    const e = emps.get(t.employee_id);
    // hr.view in scope, or the employee's own target (targets_read)
    const own = !!p && e?.full_name === p.full_name;
    if (!e || (p && !own && (!r || !roleCan(r, 'hr', 'view')))) return [];
    return [{ ...t, employee_name: e.full_name, branch: e.branch }];
  }).sort(
    (a, b) =>
      b.period.localeCompare(a.period) || a.employee_name.localeCompare(b.employee_name, 'ar'),
  );
}

/** One target per employee-month (upsert, like unique(user_id, month, year)). */
export async function saveTarget(
  t: Omit<PerfTarget, 'id' | 'employee_name' | 'branch'>,
): Promise<void> {
  const err = firstError(targetSchema.safeParse(t));
  if (err) throw new Error(err);
  const emp = (await listEmployees()).find((e) => e.id === t.employee_id);
  if (!emp) throw new Error('الموظف خارج نطاقك');
  if (!isDemoMode()) {
    if (!emp.user_id) throw new Error('اربط الموظف بحساب دخول أولاً — المبيعات تُنسب للحساب');
    const [year, month] = t.period.split('-').map(Number);
    const { data: b } = await supabase
      .from('employees')
      .select('branch_id')
      .eq('id', emp.id)
      .single();
    const { error } = await supabase.from('targets').upsert(
      {
        user_id: emp.user_id,
        branch_id: (b as Row | null)?.branch_id ?? null,
        month,
        year,
        contracts_target: t.contracts_target,
        sales_amount_target: t.sales_amount_target,
        notes: t.notes || null,
      },
      { onConflict: 'user_id,month,year' },
    );
    if (error) throw new Error(error.message);
    return;
  }
  need('manage', 'تحديد المستهدفات من صلاحية إدارة الموارد البشرية');
  const i = TARGETS.findIndex((x) => x.employee_id === t.employee_id && x.period === t.period);
  const next: StoredTarget = { ...t, id: i >= 0 ? TARGETS[i]!.id : `t-${Date.now()}` };
  if (i >= 0) TARGETS[i] = next;
  else TARGETS.push(next);
  recordAudit({
    action: i >= 0 ? 'update' : 'insert',
    entity: 'targets',
    record_ref: `${emp.full_name} — ${t.period}`,
    old_data: null,
    new_data: { contracts_target: t.contracts_target, sales_amount_target: t.sales_amount_target },
    branch: emp.branch,
  });
}

/* --------------------------- automatic scores ------------------------------ */
function mapAuto(a: Row): PerfAuto {
  const s = (k: string) => (a[k] as Row | undefined) ?? {};
  return {
    sales_count: {
      achieved: num(s('sales_count').achieved),
      target: num(s('sales_count').target),
      score: numOrNull(s('sales_count').score),
    },
    sales_amount: {
      achieved: num(s('sales_amount').achieved),
      target: num(s('sales_amount').target),
      score: numOrNull(s('sales_amount').score),
    },
    attendance: {
      present: num(s('attendance').present),
      late: num(s('attendance').late),
      absent: num(s('attendance').absent),
      score: numOrNull(s('attendance').score),
    },
  };
}

/** Achievement for a period from real sales, targets and attendance. */
export async function autoScores(employeeId: string, from: string, to: string): Promise<PerfAuto> {
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('perf_auto_scores', {
      p_employee: employeeId,
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(error.message);
    return mapAuto((data ?? {}) as Row);
  }
  const emp = (await listEmployees()).find((e) => e.id === employeeId);
  if (!emp) throw new Error('غير مصرّح بأداء هذا الموظف');
  const months = monthsInRange(from, to);
  const sales = (await listSales()).filter(
    (s) =>
      s.sold_by_name === emp.full_name &&
      s.status !== 'cancelled' &&
      s.sold_at.slice(0, 10) >= from &&
      s.sold_at.slice(0, 10) <= to,
  );
  const tg = TARGETS.filter((t) => t.employee_id === employeeId && months.includes(t.period));
  const tc = tg.reduce((n, t) => n + t.contracts_target, 0);
  const ta = tg.reduce((n, t) => n + t.sales_amount_target, 0);
  const amount = Math.round(sales.reduce((n, s) => n + s.net_amount, 0) * 100) / 100;
  const att = (await Promise.all(months.map((m) => listMonthAttendance(employeeId, m))))
    .flat()
    .filter((a) => (a.date ?? '') >= from && (a.date ?? '') <= to);
  const present = att.filter((a) => a.status === 'present').length;
  const late = att.filter((a) => a.status === 'late').length;
  const absent = att.filter((a) => a.status === 'absent').length;
  return {
    sales_count: { achieved: sales.length, target: tc, score: ratioScore(sales.length, tc) },
    sales_amount: { achieved: amount, target: ta, score: ratioScore(amount, ta) },
    attendance: {
      present,
      late,
      absent,
      score: attendanceScore(present, late, absent, await lateWeight()),
    },
  };
}

/* -------------------------------- reviews ---------------------------------- */
export async function listReviews(): Promise<PerformanceReview[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('performance_reviews')
      .select(
        'id, employee_id, period, period_from, period_to, score, criteria, notes, reviewer_name, review_date, is_active, employees(full_name)',
      )
      .order('review_date', { ascending: false });
    fail(error, 'تحميل التقييمات');
    return ((data ?? []) as Row[]).map((r) => ({
      id: str(r.id),
      employee_id: str(r.employee_id),
      employee_name: str(one(r.employees)?.full_name),
      period: str(r.period),
      period_from: str(r.period_from),
      period_to: str(r.period_to),
      score: num(r.score),
      criteria: ((r.criteria as Row[] | null) ?? []).map((c) => ({
        code: str(c.code),
        name: str(c.name),
        source: str(c.source) as PerfCriterionScore['source'],
        weight: num(c.weight),
        score: numOrNull(c.score),
        detail: (c.detail as PerfCriterionScore['detail']) ?? null,
      })),
      notes: str(r.notes),
      reviewer: str(r.reviewer_name),
      date: str(r.review_date),
      is_active: r.is_active !== false,
    }));
  }
  const visible = new Set((await listEmployees()).map((e) => e.id));
  const r = role();
  const p = useAuth.getState().profile;
  return REVIEWS.filter(
    (x) =>
      visible.has(x.employee_id) &&
      (!p || (r && roleCan(r, 'hr', 'view')) || x.employee_name === p.full_name),
  ).map((x) => ({ ...x, criteria: x.criteria.map((c) => ({ ...c })) }));
}

/** Weighted on the server (save_performance_review); the demo mirrors it. */
export async function saveReview(input: PerfReviewInput): Promise<string> {
  const err = firstError(reviewSchema.safeParse(input));
  if (err) throw new Error(err);
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('save_performance_review', {
      p_id: input.id,
      p_employee: input.employee_id,
      p_period: input.period,
      p_from: input.period_from,
      p_to: input.period_to,
      p_manual: input.manual,
      p_notes: input.notes || null,
    });
    if (error) throw new Error(error.message);
    return str(data);
  }
  need('edit', 'تقييم الأداء من صلاحية الموارد البشرية أو مدير الفرع');
  const existing = input.id ? REVIEWS.find((x) => x.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('التقييم غير موجود');
  if (existing && !existing.is_active) throw new Error('التقييم مؤرشف — استرجعه أولاً');
  const empId = existing?.employee_id ?? input.employee_id;
  const emp = (await listEmployees()).find((e) => e.id === empId);
  if (!emp) throw new Error('تقييم الأداء من صلاحية الموارد البشرية أو مدير الفرع');
  const p = useAuth.getState().profile;
  if (p && emp.full_name === p.full_name) throw new Error('لا يقيّم الموظف نفسه');
  const auto = await autoScores(empId, input.period_from, input.period_to);
  const defs =
    existing && existing.criteria.length
      ? existing.criteria.map(({ code, name, source, weight }) => ({ code, name, source, weight }))
      : applicableCriteria(CRITERIA, emp.role).map((c) => ({
          code: c.code,
          name: c.name_ar,
          source: c.source,
          weight: c.weight,
        }));
  const { criteria, score } = computeReview(defs, input.manual, auto);
  const row: PerformanceReview = {
    id: existing?.id ?? `p-${Date.now()}`,
    employee_id: empId,
    employee_name: emp.full_name,
    period: input.period.trim(),
    period_from: input.period_from,
    period_to: input.period_to,
    score,
    criteria,
    notes: input.notes.trim(),
    reviewer: p?.full_name ?? 'الموارد البشرية',
    date: new Date().toISOString().slice(0, 10),
    is_active: true,
  };
  if (existing) Object.assign(existing, row);
  else REVIEWS.unshift(row);
  recordAudit({
    action: existing ? 'update' : 'insert',
    entity: 'performance_reviews',
    record_ref: `${emp.full_name} — ${row.period}`,
    old_data: existing ? { score: existing.score } : null,
    new_data: { score },
    branch: emp.branch,
  });
  return row.id;
}

/** Archive (never delete) / restore. */
export async function setReviewActive(id: string, active: boolean): Promise<void> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('performance_reviews')
      .update({ is_active: active })
      .eq('id', id)
      .select('id');
    fail(error, active ? 'استرجاع التقييم' : 'أرشفة التقييم');
    if (!data || (data as unknown[]).length === 0) throw new Error('غير مصرّح');
    return;
  }
  need('edit', 'تقييم الأداء من صلاحية الموارد البشرية أو مدير الفرع');
  const r = REVIEWS.find((x) => x.id === id);
  if (!r) throw new Error('التقييم غير موجود');
  r.is_active = active;
}

/* --------------------- leaderboard for «الأهداف» (/targets) ----------------- */
export interface TargetBoardRow {
  employee_id: string;
  employee_name: string;
  role: string;
  branch: string;
  contracts_target: number;
  contracts_achieved: number;
  sales_target: number;
  sales_achieved: number;
  /** latest active review score (0..100) — null when never reviewed */
  performance: number | null;
}

export async function targetBoard(period: string): Promise<TargetBoardRow[]> {
  const [targets, emps, reviews] = await Promise.all([
    listTargets(),
    listEmployees(),
    listReviews(),
  ]);
  const from = `${period}-01`;
  const end = new Date(`${period}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);
  const byId = new Map(emps.map((e) => [e.id, e]));
  const rows = await Promise.all(
    targets
      .filter((t) => t.period === period)
      .map(async (t): Promise<TargetBoardRow | null> => {
        const e = byId.get(t.employee_id);
        if (!e) return null;
        const a = await autoScores(e.id, from, to).catch(() => null);
        const last = reviews
          .filter((r) => r.employee_id === e.id && r.is_active)
          .sort((x, y) => y.date.localeCompare(x.date))[0];
        return {
          employee_id: e.id,
          employee_name: e.full_name,
          role: e.role ?? '',
          branch: e.branch,
          contracts_target: t.contracts_target,
          contracts_achieved: a?.sales_count.achieved ?? 0,
          sales_target: t.sales_amount_target,
          sales_achieved: a?.sales_amount.achieved ?? 0,
          performance: last?.score ?? null,
        };
      }),
  );
  return rows.filter((r): r is TargetBoardRow => r !== null);
}
