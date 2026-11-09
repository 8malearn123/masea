/**
 * Worker payroll + WPS (0079). The same run cycle as staff, kind = 'workers':
 * approvable adjustments (incl. housing absence proposals) → calculate (frozen
 * worker_payslips) → approve by someone else → post (per branch) → pay.
 * Live: payroll_adjustments / payroll_runs / worker_payslips + the SQL functions.
 * Demo: in-memory stores applying the same rules (workerPayrollEngine).
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { scopeToViewerBranch } from '@/lib/branchScope';
import { recordAudit } from '@/shared/lib/auditTrail';
import { roleCan, type RoleCode } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import { listHouseWorkers, PAYROLL_CONFIG } from '@/features/hr/api/hr.api';
import {
  absenceAmount,
  computeWorkerSlip,
  workerRunTotals,
} from '@/features/hr/lib/workerPayrollEngine';
import type {
  HouseWorker,
  PayrollRun,
  WorkerAdjType,
  WorkerAdjustment,
  WorkerPayslip,
} from '@/features/hr/types';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
function one(v: unknown): Row | null {
  if (Array.isArray(v)) return (v[0] as Row | undefined) ?? null;
  return (v as Row | null) ?? null;
}
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ------------------------------- demo stores -------------------------------- */
const thisMonth = () => new Date().toISOString().slice(0, 7);
let seq = 0;
const ADJ: WorkerAdjustment[] = [
  {
    id: 'wadj1',
    worker_id: 'w1',
    worker_name: 'ماريا سانتوس',
    branch: 'نجران',
    type: 'advance',
    amount: 200,
    reason: 'سلفة شخصية — تُسترد من راتب الشهر',
    period: thisMonth(),
    status: 'approved',
    source: 'manual',
    days: null,
    submitted_by: 'خالد الدوسري',
  },
  {
    id: 'wadj2',
    worker_id: 'w3',
    worker_name: 'سيتي نورهاليزا',
    branch: 'جازان',
    type: 'bonus',
    amount: 150,
    reason: 'تقييم ممتاز من العميل',
    period: thisMonth(),
    status: 'pending',
    source: 'manual',
    days: null,
    submitted_by: 'سعد آل مريح',
  },
];
/** Demo housing attendance: absent days per worker (barcode scan records). */
const HOUSING_ABSENT: Record<string, string[]> = {
  w3: [`${thisMonth()}-03`, `${thisMonth()}-04`],
  w5: [`${thisMonth()}-02`],
};
const RUNS = new Map<string, { run: PayrollRun; slips: WorkerPayslip[] }>();

function role(): RoleCode | undefined {
  return useAuth.getState().profile?.role as RoleCode | undefined;
}
function me(): { id: string; name: string } {
  const p = useAuth.getState().profile;
  return { id: p?.id ?? 'system', name: p?.full_name ?? 'النظام' };
}
function need(module: 'hr' | 'accounting', action: 'view' | 'edit' | 'manage', msg: string): void {
  const r = role();
  if (useAuth.getState().profile && (!r || !roleCan(r, module, action))) throw new Error(msg);
}
async function scopedWorkers(): Promise<HouseWorker[]> {
  return scopeToViewerBranch(await listHouseWorkers(), (w) => w.branch);
}
function runApproved(period: string): boolean {
  const r = RUNS.get(period);
  return !!r && (r.run.status === 'approved' || r.run.status === 'paid');
}

/* ------------------------------- adjustments -------------------------------- */
function mapAdj(r: Row): WorkerAdjustment {
  const w = one(r.worker_profiles);
  return {
    id: str(r.id),
    worker_id: str(r.worker_id),
    worker_name: str(w?.full_name),
    branch: str(one(w?.branches)?.city),
    type: str(r.type) as WorkerAdjType,
    amount: num(r.amount),
    reason: str(r.reason),
    period: str(r.period),
    status: (str(r.status) || 'pending') as WorkerAdjustment['status'],
    source: r.source === 'housing_absence' ? 'housing_absence' : 'manual',
    days: r.days == null ? null : num(r.days),
    submitted_by: str(r.submitted_by),
  };
}

export async function listWorkerAdjustments(period: string): Promise<WorkerAdjustment[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('payroll_adjustments')
      .select(
        'id, worker_id, type, amount, reason, period, status, source, days, submitted_by, worker_profiles(full_name, branches(city))',
      )
      .not('worker_id', 'is', null)
      .eq('period', period)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`تعذّر تحميل تعديلات العاملات: ${error.message}`);
    return ((data ?? []) as Row[]).map(mapAdj);
  }
  const ids = new Set((await scopedWorkers()).map((w) => w.id));
  return ADJ.filter((a) => a.period === period && ids.has(a.worker_id)).map((a) => ({ ...a }));
}

export interface NewWorkerAdjustment {
  worker_id: string;
  type: WorkerAdjType;
  amount: number;
  reason: string;
  period: string;
}

export async function submitWorkerAdjustment(input: NewWorkerAdjustment): Promise<void> {
  if (!PERIOD_RE.test(input.period)) throw new Error('الشهر غير صحيح');
  if (!(input.amount > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  if (!input.reason.trim()) throw new Error('اذكر سبب التعديل');
  if (!isDemoMode()) {
    const { error } = await supabase.from('payroll_adjustments').insert({
      worker_id: input.worker_id,
      type: input.type,
      amount: input.amount,
      reason: input.reason.trim(),
      period: input.period,
      status: 'pending',
      source: 'manual',
    });
    if (error) throw new Error(error.message);
    return;
  }
  need('hr', 'edit', 'رفع التعديلات من صلاحية الموارد البشرية أو مدير الفرع');
  const w = (await scopedWorkers()).find((x) => x.id === input.worker_id);
  if (!w) throw new Error('العاملة خارج نطاقك');
  if (runApproved(input.period))
    throw new Error(`مسير ${input.period} معتمد — ارفع التعديل على الشهر التالي`);
  seq += 1;
  const row: WorkerAdjustment = {
    id: `wadj-${Date.now()}-${seq}`,
    worker_id: w.id,
    worker_name: w.full_name,
    branch: w.branch,
    type: input.type,
    amount: input.amount,
    reason: input.reason.trim(),
    period: input.period,
    status: 'pending',
    source: 'manual',
    days: null,
    submitted_by: me().name,
  };
  ADJ.unshift(row);
  recordAudit({
    action: 'insert',
    entity: 'payroll_adjustments',
    record_ref: `${w.full_name} — ${input.type}`,
    old_data: null,
    new_data: { type: row.type, amount: row.amount, period: row.period },
    branch: w.branch,
  });
}

/** Approve / reject — hr.manage (payadj_decide). Only approved items enter the run. */
export async function decideWorkerAdjustment(id: string, approve: boolean): Promise<void> {
  const status = approve ? 'approved' : 'rejected';
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('payroll_adjustments')
      .update({
        status,
        decided_at: new Date().toISOString(),
        approved_by: useAuth.getState().profile?.id ?? null,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || (data as unknown[]).length === 0)
      throw new Error('غير مصرّح أو التعديل ليس بانتظار الاعتماد — الاعتماد لمدير الموارد البشرية');
    return;
  }
  need('hr', 'manage', 'اعتماد التعديلات من صلاحية مدير الموارد البشرية');
  const a = ADJ.find((x) => x.id === id);
  if (!a) throw new Error('التعديل غير موجود');
  if (a.status !== 'pending') throw new Error('التعديل ليس بانتظار الاعتماد');
  if (runApproved(a.period)) throw new Error(`مسير ${a.period} معتمد`);
  a.status = status;
  recordAudit({
    action: 'update',
    entity: 'payroll_adjustments',
    record_ref: `${a.worker_name} — ${a.type}`,
    old_data: { status: 'pending' },
    new_data: { status },
    branch: a.branch,
  });
}

/** Housing absence → pending deduction proposals (propose_worker_absences). */
export async function proposeWorkerAbsences(period: string): Promise<number> {
  if (!PERIOD_RE.test(period)) throw new Error('الشهر غير صحيح');
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('propose_worker_absences', { p_period: period });
    if (error) throw new Error(error.message);
    return num(data);
  }
  need('hr', 'edit', 'اقتراح خصومات الغياب من صلاحية الموارد البشرية');
  if (runApproved(period)) throw new Error(`مسير العاملات ${period} معتمد`);
  let n = 0;
  for (const w of await scopedWorkers()) {
    const days = (HOUSING_ABSENT[w.id] ?? []).filter((d) => d.startsWith(period)).length;
    for (let i = ADJ.length - 1; i >= 0; i -= 1) {
      const a = ADJ[i]!;
      if (
        a.worker_id === w.id &&
        a.period === period &&
        a.source === 'housing_absence' &&
        a.status === 'pending'
      )
        ADJ.splice(i, 1);
    }
    const decided = ADJ.some(
      (a) =>
        a.worker_id === w.id &&
        a.period === period &&
        a.source === 'housing_absence' &&
        a.status !== 'pending',
    );
    if (days > 0 && !decided) {
      seq += 1;
      ADJ.unshift({
        id: `wadj-abs-${w.id}-${seq}`,
        worker_id: w.id,
        worker_name: w.full_name,
        branch: w.branch,
        type: 'absence',
        amount: absenceAmount(w.monthly_salary, days, PAYROLL_CONFIG.standardWorkDays),
        reason: `غياب ${days} يوم من السكن (التحضير بالباركود)`,
        period,
        status: 'pending',
        source: 'housing_absence',
        days,
        submitted_by: me().name,
      });
      n += 1;
    }
  }
  return n;
}

/* ---------------------------------- runs ------------------------------------ */
function mapSlip(r: Row): WorkerPayslip {
  return {
    worker_id: str(r.worker_id),
    worker_name: str(r.worker_name),
    nationality: str(r.nationality),
    iqama_no: str(r.iqama_no),
    passport_no: str(r.passport_no),
    branch: str(one(r.branches)?.city),
    payment_method: r.payment_method === 'cash' ? 'cash' : 'bank',
    bank_name: str(r.bank_name),
    iban: str(r.iban),
    monthly_salary: num(r.monthly_salary),
    eligible_days: num(r.eligible_days),
    base_pay: num(r.base_pay),
    additions: num(r.additions),
    absence_days: num(r.absence_days),
    absence_deduction: num(r.absence_deduction),
    penalty_deductions: num(r.penalty_deductions),
    advance_deductions: num(r.advance_deductions),
    gross: num(r.gross),
    total_deductions: num(r.total_deductions),
    net: num(r.net),
  };
}

export async function getWorkerRun(
  period: string,
): Promise<{ run: PayrollRun; slips: WorkerPayslip[] } | null> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('payroll_runs')
      .select('*')
      .eq('period', period)
      .eq('kind', 'workers')
      .is('branch_id', null)
      .maybeSingle();
    if (error) throw new Error(`تعذّر تحميل مسير العاملات: ${error.message}`);
    if (!data) return null;
    const r = data as Row;
    const ids = [str(r.run_by), str(r.approved_by)].filter(Boolean);
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: u } = await supabase.rpc('user_display_names', { p_ids: ids });
      ((u ?? []) as Row[]).forEach((x) => names.set(str(x.id), str(x.full_name)));
    }
    const run: PayrollRun = {
      id: str(r.id),
      period: str(r.period),
      status: r.status === 'paid' ? 'paid' : r.status === 'approved' ? 'approved' : 'calculated',
      run_by: (r.run_by as string | null) ?? null,
      run_by_name: names.get(str(r.run_by)) ?? '—',
      calculated_at: (r.calculated_at as string | null) ?? null,
      approved_by_name: names.get(str(r.approved_by)) ?? '',
      approved_at: (r.approved_at as string | null) ?? null,
      posted_at: (r.posted_at as string | null) ?? null,
      paid_at: (r.paid_at as string | null) ?? null,
      employee_count: num(r.employee_count),
      total_gross: num(r.total_gross),
      total_deductions: num(r.total_deductions),
      total_net: num(r.total_net),
      total_earnings: num(r.total_earnings),
      total_gosi_employee: 0,
      total_gosi_employer: 0,
      total_advances: num(r.total_advances),
      total_penalties: num(r.total_penalties),
    };
    const { data: ps, error: e2 } = await supabase
      .from('worker_payslips')
      .select('*, branches(city)')
      .eq('run_id', run.id)
      .order('worker_name');
    if (e2) throw new Error(e2.message);
    return { run, slips: ((ps ?? []) as Row[]).map(mapSlip) };
  }
  const r = RUNS.get(period);
  if (!r) return null;
  const rl = role();
  if (
    rl &&
    !roleCan(rl, 'hr', 'manage') &&
    !roleCan(rl, 'accounting', 'view') &&
    !roleCan(rl, 'hr', 'view')
  )
    return null;
  const visible = new Set((await scopedWorkers()).map((w) => w.id));
  const slips =
    rl && !roleCan(rl, 'hr', 'view') ? [] : r.slips.filter((s) => visible.has(s.worker_id));
  return { run: { ...r.run }, slips };
}

export async function calculateWorkerRun(period: string): Promise<void> {
  if (!PERIOD_RE.test(period)) throw new Error('الشهر غير صحيح');
  if (!isDemoMode()) {
    const { error } = await supabase.rpc('calculate_worker_payroll_run', { p_period: period });
    if (error) throw new Error(error.message);
    return;
  }
  need('hr', 'manage', 'إعداد المسير من صلاحية الموارد البشرية');
  if (runApproved(period))
    throw new Error(`مسير العاملات ${period} معتمد — التصحيح يكون بتعديل في الشهر التالي`);
  // every active worker company-wide, as the SQL function does
  const workers = await listHouseWorkers();
  const slips = workers
    .map((w) => computeWorkerSlip(w, period, ADJ, PAYROLL_CONFIG.standardWorkDays))
    .filter((s): s is WorkerPayslip => s !== null);
  const who = me();
  const prev = RUNS.get(period);
  RUNS.set(period, {
    slips,
    run: {
      id: prev?.run.id ?? `wrun-${period}`,
      period,
      status: 'calculated',
      run_by: who.id,
      run_by_name: who.name,
      calculated_at: new Date().toISOString(),
      approved_by_name: '',
      approved_at: null,
      posted_at: null,
      paid_at: null,
      ...workerRunTotals(slips),
    },
  });
}

export async function approveWorkerRun(period: string, runId: string): Promise<void> {
  if (!isDemoMode()) {
    const { error } = await supabase.rpc('approve_payroll_run', { p_run_id: runId });
    if (error) throw new Error(error.message);
    return;
  }
  need('hr', 'manage', 'اعتماد المسير من صلاحية الإدارة');
  const r = RUNS.get(period);
  if (!r) throw new Error('مسير العاملات غير موجود');
  if (r.run.status !== 'calculated') throw new Error('المسير ليس بانتظار الاعتماد');
  const who = me();
  if (r.run.run_by === who.id)
    throw new Error('لا يعتمد المسيرَ من أعدّه — يعتمده شخص آخر (مبدأ الأربع أعين)');
  r.run = {
    ...r.run,
    status: 'approved',
    approved_by_name: who.name,
    approved_at: new Date().toISOString(),
  };
}

/** Accounting: accrual entry split by branch (post_payroll_run → post_worker_payroll). */
export async function postWorkerRun(
  period: string,
  runId: string,
  postEntry: (slips: WorkerPayslip[], run: PayrollRun) => void,
): Promise<void> {
  if (!isDemoMode()) {
    const { error } = await supabase.rpc('post_payroll_run', { p_run_id: runId });
    if (error) throw new Error(error.message);
    return;
  }
  need('accounting', 'edit', 'ترحيل قيد الرواتب من صلاحية المحاسبة');
  const r = RUNS.get(period);
  if (!r) throw new Error('مسير العاملات غير موجود');
  if (r.run.status === 'calculated') throw new Error('لا يُرحَّل إلا مسير معتمد');
  if (r.run.posted_at) return;
  postEntry(r.slips, r.run);
  r.run = { ...r.run, posted_at: new Date().toISOString() };
}

export async function payWorkerRun(
  period: string,
  runId: string,
  paidOn: string,
  bankCode: string,
  postEntry: (slips: WorkerPayslip[], run: PayrollRun) => void,
): Promise<void> {
  if (!isDemoMode()) {
    const { error } = await supabase.rpc('pay_payroll_run', {
      p_run_id: runId,
      p_paid_on: paidOn,
      p_bank_code: bankCode,
    });
    if (error) throw new Error(error.message);
    return;
  }
  need('accounting', 'edit', 'تسجيل صرف الرواتب من صلاحية المحاسبة');
  const r = RUNS.get(period);
  if (!r) throw new Error('مسير العاملات غير موجود');
  if (!r.run.posted_at) throw new Error('رحّل قيد الاستحقاق أولاً');
  if (r.run.status === 'paid') return;
  if (!bankCode.startsWith('111')) throw new Error('اختر حساب بنك أو صندوق');
  postEntry(r.slips, r.run);
  r.run = { ...r.run, status: 'paid', paid_at: paidOn };
}
