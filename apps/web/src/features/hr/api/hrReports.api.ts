/**
 * HR reports (0077). Live: hr_report_rows (scope + salary visibility on the
 * server) and nitaqat_bands. Demo: the same rows built from the demo stores —
 * actual cost from approved payroll runs, estimated by the payroll engine for
 * other months; attendance and approved leave in the range.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { recordAudit } from '@/shared/lib/auditTrail';
import { roleCan, type RoleCode } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import {
  computePayslips,
  getPayrollRun,
  listAdjustments,
  listEmployees,
  listLeaveRequests,
  listMonthAttendance,
  periodEmployees,
} from '@/features/hr/api/hr.api';
import { monthsInRange } from '@/features/hr/lib/performanceEngine';
import { DEFAULT_NITAQAT } from '@/features/hr/lib/hrReports';
import { SAUDI_NATIONALITY } from '@/features/hr/lib/lookups';
import type { HrReportRow, NitaqatBand } from '@/features/hr/types';

type Row = Record<string, unknown>;
const NITAQAT: NitaqatBand[] = DEFAULT_NITAQAT.map((b) => ({ ...b }));

function role(): RoleCode | undefined {
  return useAuth.getState().profile?.role as RoleCode | undefined;
}
const signedIn = () => !!useAuth.getState().profile;

function validRange(from: string, to: string): void {
  if (!from || !to || from > to) throw new Error('الفترة غير صحيحة');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 731)
    throw new Error('الفترة حتى سنتين كحد أقصى');
}

export async function reportRows(from: string, to: string): Promise<HrReportRow[]> {
  validRange(from, to);
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('hr_report_rows', { p_from: from, p_to: to });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      employee_id: String(r.employee_id),
      full_name: String(r.full_name ?? ''),
      branch: String(r.branch ?? ''),
      department: String(r.department ?? ''),
      job_title: String(r.job_title ?? ''),
      nationality: String(r.nationality ?? ''),
      is_saudi: r.is_saudi === true,
      counts_saudization: r.counts_saudization === true,
      nitaqat_wage: Number(r.nitaqat_wage ?? 0),
      status: r.status === 'terminated' ? 'terminated' : 'active',
      hire_date: (r.hire_date as string | null) ?? null,
      termination_date: (r.termination_date as string | null) ?? null,
      termination_reason: (r.termination_reason as string | null) ?? null,
      cost: r.cost == null ? null : Number(r.cost),
      cost_estimated: r.cost_estimated === true,
      present_days: Number(r.present_days ?? 0),
      late_days: Number(r.late_days ?? 0),
      absent_days: Number(r.absent_days ?? 0),
      late_minutes: Number(r.late_minutes ?? 0),
      leave_days: Number(r.leave_days ?? 0),
    }));
  }
  const r = role();
  if (signedIn() && (!r || !roleCan(r, 'hr', 'view')))
    throw new Error('تقارير الموارد البشرية لمن يملك صلاحية عرض الموارد البشرية');
  const money =
    !signedIn() || (!!r && (roleCan(r, 'hr', 'manage') || roleCan(r, 'accounting', 'view')));
  const months = monthsInRange(from, to);
  const emps = (await listEmployees()).filter(
    (e) =>
      (!e.join_date || e.join_date <= to) && (!e.termination_date || e.termination_date >= from),
  );

  // cost per employee: approved run if any, else the payroll engine's estimate
  const cost = new Map<string, number>();
  const estimated = new Set<string>();
  if (money) {
    const adjustments = await listAdjustments();
    for (const period of months) {
      const run = await getPayrollRun(period).catch(() => null);
      const actual = run && ['approved', 'paid'].includes(run.run.status) ? run.slips : null;
      const est = await computePayslips(periodEmployees(emps, period), period, adjustments);
      emps.forEach((e) => {
        const slip = actual?.find((s) => s.employee_id === e.id) ?? null;
        const pick = slip ?? est.find((s) => s.employee_id === e.id) ?? null;
        if (!pick) return;
        if (!slip) estimated.add(e.id);
        cost.set(e.id, (cost.get(e.id) ?? 0) + pick.gross + pick.gosi_employer);
      });
    }
  }
  const leaves = (await listLeaveRequests()).filter((l) => l.status === 'approved');
  const rows: HrReportRow[] = [];
  for (const e of emps) {
    const att = (await Promise.all(months.map((m) => listMonthAttendance(e.id, m))))
      .flat()
      .filter((a) => (a.date ?? '') >= from && (a.date ?? '') <= to);
    const leaveDays = leaves
      .filter((l) => l.employee_id === e.id && l.from_date <= to && l.to_date >= from)
      .reduce((s, l) => {
        const a = l.from_date > from ? l.from_date : from;
        const b = l.to_date < to ? l.to_date : to;
        return s + Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
      }, 0);
    const saudi = e.nationality === SAUDI_NATIONALITY;
    rows.push({
      employee_id: e.id,
      full_name: e.full_name,
      branch: e.branch,
      department: e.department,
      job_title: e.job_title ?? '',
      nationality: e.nationality,
      is_saudi: saudi,
      counts_saudization: e.counts_in_saudization ?? saudi,
      nitaqat_wage: e.base_salary + (e.housing_allowance ?? 0),
      status: e.termination_date && e.termination_date <= to ? 'terminated' : 'active',
      hire_date: e.join_date || null,
      termination_date: e.termination_date ?? null,
      termination_reason: e.termination_reason ?? null,
      cost: money ? Math.round((cost.get(e.id) ?? 0) * 100) / 100 : null,
      cost_estimated: estimated.has(e.id),
      present_days: att.filter((a) => a.status === 'present').length,
      late_days: att.filter((a) => a.status === 'late').length,
      absent_days: att.filter((a) => a.status === 'absent').length,
      late_minutes: att.reduce((s, a) => s + (a.late_minutes ?? 0), 0),
      leave_days: leaveDays,
    });
  }
  return rows;
}

/* ----------------------------- nitaqat bands -------------------------------- */
export async function listNitaqat(): Promise<NitaqatBand[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('nitaqat_bands')
      .select('*')
      .order('min_pct', { ascending: false });
    if (error) throw new Error(`تعذّر تحميل نطاقات السعودة: ${error.message}`);
    return ((data ?? []) as Row[]).map((b) => ({
      code: String(b.code),
      name_ar: String(b.name_ar),
      min_pct: Number(b.min_pct),
      tone: String(b.tone) as NitaqatBand['tone'],
      is_active: b.is_active !== false,
    }));
  }
  return NITAQAT.map((b) => ({ ...b })).sort((a, b) => b.min_pct - a.min_pct);
}

export async function saveNitaqat(b: NitaqatBand, isNew: boolean): Promise<void> {
  const name = b.name_ar.trim();
  if (!name || name.length > 40) throw new Error('أدخل اسم النطاق');
  if (!(b.min_pct >= 0 && b.min_pct <= 100)) throw new Error('الحد بين 0 و100');
  const next = { ...b, name_ar: name };
  if (!isDemoMode()) {
    const cols = {
      name_ar: next.name_ar,
      min_pct: next.min_pct,
      tone: next.tone,
      is_active: next.is_active,
    };
    const { error } = isNew
      ? await supabase.from('nitaqat_bands').insert(cols)
      : await supabase.from('nitaqat_bands').update(cols).eq('code', next.code);
    if (error) throw new Error(error.message);
    return;
  }
  const r = role();
  if (signedIn() && (!r || !roleCan(r, 'hr', 'manage')))
    throw new Error('نطاقات السعودة من صلاحية إدارة الموارد البشرية');
  const i = NITAQAT.findIndex((x) => x.code === next.code);
  const before = i >= 0 ? { ...NITAQAT[i]! } : null;
  if (i >= 0) NITAQAT[i] = next;
  else NITAQAT.push(next);
  recordAudit({
    action: before ? 'update' : 'insert',
    entity: 'nitaqat_bands',
    record_ref: next.name_ar,
    old_data: before,
    new_data: { ...next },
    branch: null,
  });
}
