import { GOSI } from '@masiat/shared';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { scopeToViewerBranch } from '@/lib/branchScope';
import { useAuth } from '@/store/auth';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import * as live from '@/features/hr/api/hr.live';
import { ADJ_IS_ADDITION } from '@/features/hr/types';
import type {
  AdjustmentStatus,
  AdjustmentType,
  AttendanceRecord,
  DocStatus,
  EmergencyContact,
  Employee,
  EmployeeDocument,
  HouseWorker,
  IqamaRecord,
  LeaveRequest,
  LeaveStatus,
  PayrollAdjustment,
  PayrollRow,
  Payslip,
  PerformanceReview,
} from '@/features/hr/types';

const EMPLOYEES: Employee[] = [
  {
    id: 'e1',
    full_name: 'فهد الشهري',
    job_title: 'مدير العمليات',
    department: 'العمليات',
    branch: 'نجران',
    nationality: 'السعودية',
    base_salary: 18000,
    allowances: 3000,
    status: 'active',
    role: 'operations_manager',
    join_date: '2023-03-01',
    phone: '0551000001',
    email: 'fahad@masiat.sa',
    absence_days: 0,
    late_count: 1,
    overtime_hours: 8,
  },
  {
    id: 'e2',
    full_name: 'سعد آل مريح',
    job_title: 'مدير الفرع',
    department: 'الإدارة',
    branch: 'جازان',
    nationality: 'السعودية',
    base_salary: 14000,
    allowances: 2500,
    status: 'active',
    role: 'branch_manager',
    join_date: '2023-06-15',
    phone: '0551000002',
    email: 'saad@masiat.sa',
    absence_days: 1,
    late_count: 3,
  },
  {
    id: 'e3',
    full_name: 'نورة العتيبي',
    job_title: 'موظفة مبيعات',
    department: 'المبيعات',
    branch: 'شرورة',
    nationality: 'السعودية',
    base_salary: 8000,
    allowances: 1500,
    status: 'active',
    role: 'sales',
    join_date: '2024-01-10',
    phone: '0551000003',
    email: 'noura@masiat.sa',
    absence_days: 0,
    late_count: 0,
  },
  {
    id: 'e4',
    full_name: 'ريم الزهراني',
    job_title: 'موظفة مركز اتصال',
    department: 'مركز الاتصال',
    branch: 'حبونا',
    nationality: 'السعودية',
    base_salary: 6500,
    allowances: 1000,
    status: 'on_leave',
    role: 'call_center',
    join_date: '2024-04-20',
    phone: '0551000004',
    email: 'reem@masiat.sa',
    absence_days: 0,
    late_count: 0,
  },
  {
    id: 'e5',
    full_name: 'بدر المالكي',
    job_title: 'محاسب',
    department: 'المالية',
    branch: 'نجران',
    nationality: 'السعودية',
    base_salary: 12000,
    allowances: 2000,
    status: 'active',
    role: 'accountant',
    join_date: '2023-09-05',
    phone: '0551000005',
    email: 'badr@masiat.sa',
    absence_days: 2,
    late_count: 1,
  },
  {
    id: 'e6',
    full_name: 'خالد الدوسري',
    job_title: 'أخصائي موارد بشرية',
    department: 'الموارد البشرية',
    branch: 'نجران',
    nationality: 'السعودية',
    base_salary: 11000,
    allowances: 1800,
    status: 'active',
    role: 'hr',
    join_date: '2023-11-12',
    phone: '0551000006',
    email: 'khaled@masiat.sa',
    absence_days: 0,
    late_count: 2,
  },
  {
    id: 'e7',
    full_name: 'راجيش كومار',
    job_title: 'مشرف سكن',
    department: 'السكن',
    branch: 'جازان',
    nationality: 'الهند',
    base_salary: 5000,
    allowances: 800,
    status: 'active',
    role: 'housing_supervisor',
    join_date: '2024-02-01',
    phone: '0551000007',
    email: 'rajesh@masiat.sa',
    absence_days: 0,
    late_count: 0,
    overtime_hours: 22,
  },
  {
    id: 'e8',
    full_name: 'منى الغامدي',
    job_title: 'مشرفة سكن',
    department: 'السكن',
    branch: 'شرورة',
    nationality: 'السعودية',
    base_salary: 7000,
    allowances: 1200,
    status: 'active',
    role: 'housing_supervisor',
    join_date: '2024-03-18',
    phone: '0551000008',
    email: 'mona@masiat.sa',
    absence_days: 1,
    late_count: 4,
  },
];

/** Daily-wage deduction per absent day + a flat fee per lateness incident. */
export const LATE_FEE = 50;
export function dailyWage(base: number): number {
  return Math.round(base / 30);
}

const ATTENDANCE: AttendanceRecord[] = [
  {
    id: 'a1',
    employee_name: 'فهد الشهري',
    department: 'العمليات',
    check_in: '07:55',
    check_out: '16:05',
    status: 'present',
  },
  {
    id: 'a2',
    employee_name: 'سعد آل مريح',
    department: 'الإدارة',
    check_in: '08:12',
    check_out: '16:00',
    status: 'late',
  },
  {
    id: 'a3',
    employee_name: 'نورة العتيبي',
    department: 'المبيعات',
    check_in: '07:58',
    check_out: '16:02',
    status: 'present',
  },
  {
    id: 'a4',
    employee_name: 'ريم الزهراني',
    department: 'مركز الاتصال',
    check_in: null,
    check_out: null,
    status: 'leave',
  },
  {
    id: 'a5',
    employee_name: 'بدر المالكي',
    department: 'المالية',
    check_in: null,
    check_out: null,
    status: 'absent',
  },
  {
    id: 'a6',
    employee_name: 'خالد الدوسري',
    department: 'الموارد البشرية',
    check_in: '07:50',
    check_out: '16:10',
    status: 'present',
  },
  {
    id: 'a7',
    employee_name: 'راجيش كومار',
    department: 'السكن',
    check_in: '07:45',
    check_out: '17:00',
    status: 'present',
  },
  {
    id: 'a8',
    employee_name: 'منى الغامدي',
    department: 'السكن',
    check_in: '08:20',
    check_out: '16:00',
    status: 'late',
  },
];

const LEAVE: LeaveRequest[] = [
  {
    id: 'l1',
    employee_name: 'ريم الزهراني',
    type: 'annual',
    from_date: '2026-06-12',
    to_date: '2026-06-18',
    days: 7,
    status: 'approved',
    reason: 'إجازة سنوية',
  },
  {
    id: 'l2',
    employee_name: 'نورة العتيبي',
    type: 'sick',
    from_date: '2026-06-14',
    to_date: '2026-06-15',
    days: 2,
    status: 'pending',
    reason: 'وعكة صحية',
  },
  {
    id: 'l3',
    employee_name: 'بدر المالكي',
    type: 'emergency',
    from_date: '2026-06-13',
    to_date: '2026-06-13',
    days: 1,
    status: 'pending',
    reason: 'ظرف عائلي طارئ',
  },
  {
    id: 'l4',
    employee_name: 'راجيش كومار',
    type: 'annual',
    from_date: '2026-07-01',
    to_date: '2026-07-10',
    days: 10,
    status: 'pending',
    reason: 'سفر',
  },
];

/** Demo: the viewer sees only their branch (cross-branch roles see all) — same rule as RLS. */
function demoEmployees(): Employee[] {
  return scopeToViewerBranch(EMPLOYEES, (e) => e.branch).map((e) => ({ ...e }));
}

/** Demo rows of child tables follow their employee's branch (like hr_can_see in 0068). */
function scopeByEmployee<T extends { employee_id?: string; employee_name: string }>(
  rows: T[],
): T[] {
  if (!useAuth.getState().profile) return rows;
  const visible = demoEmployees();
  const ids = new Set(visible.map((e) => e.id));
  const names = new Set(visible.map((e) => e.full_name));
  const known = new Set(EMPLOYEES.map((e) => e.full_name));
  return rows.filter((r) =>
    r.employee_id
      ? ids.has(r.employee_id)
      : names.has(r.employee_name) ||
        (!known.has(r.employee_name) && scopeToViewerBranch([r], () => null).length > 0),
  );
}

export async function listEmployees(): Promise<Employee[]> {
  if (!isDemoMode()) return live.liveListEmployees();
  return demoEmployees();
}

/** Upsert into the demo store so add/edit survive a cache refetch (staleTime/gc). */
export function saveEmployee(emp: Employee): Employee {
  const i = EMPLOYEES.findIndex((e) => e.id === emp.id);
  if (i >= 0) EMPLOYEES[i] = emp;
  else EMPLOYEES.unshift(emp);
  return emp;
}

/** Add or update an employee (backend in live mode, demo store otherwise). */
export async function persistEmployee(
  emp: Employee,
  isNew: boolean,
  canManagePay: boolean,
): Promise<Employee> {
  if (!isDemoMode()) return live.liveSaveEmployee(emp, isNew, canManagePay);
  return saveEmployee(emp);
}

/** Employees still on the payroll (active + on leave) — terminated are excluded. */
export function currentEmployees(employees: Employee[]): Employee[] {
  return employees.filter((e) => e.status !== 'terminated');
}

/** Form payload for add/edit. (Persisted locally for now; a richer employees
 *  table can be wired later — the 0004 schema lacks role/allowances columns.) */
export type EmployeeInput = Omit<Employee, 'id' | 'absence_days' | 'late_count'>;

export function buildEmployee(input: EmployeeInput): Employee {
  return { ...input, id: `e-${Date.now()}`, absence_days: 0, late_count: 0 };
}

export async function listAttendance(): Promise<AttendanceRecord[]> {
  if (!isDemoMode()) return live.liveListAttendance();
  return scopeByEmployee(ATTENDANCE).map((a) => ({ ...a }));
}

export async function listLeaveRequests(): Promise<LeaveRequest[]> {
  if (!isDemoMode()) return live.liveListLeave();
  return scopeByEmployee(LEAVE).map((l) => ({ ...l }));
}

export async function createLeaveRequest(l: LeaveRequest): Promise<LeaveRequest> {
  if (!isDemoMode()) return live.liveAddLeave(l);
  return addLeaveRequest(l);
}

/** Add a leave request to the demo store (persists across refetch). */
export function addLeaveRequest(l: LeaveRequest): LeaveRequest {
  LEAVE.unshift(l);
  return l;
}

export async function updateLeaveStatus(id: string, status: LeaveStatus): Promise<void> {
  const local = LEAVE.find((l) => l.id === id);
  if (local) local.status = status; // keep the demo store in sync with the optimistic update
  if (isDemoMode() || isDemoId(id)) return;
  const { error } = await supabase.from('leave_requests').update({ status }).eq('id', id);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

/** Total monthly cost to the company: base + allowances + employer GOSI share
 *  (same rates/base/ceiling as the payroll run and the accounting accrual). */
export function monthlyCost(e: Employee): number {
  const saudi = e.nationality === 'السعودية';
  const employerGosi = employerGosiFor(e.base_salary, e.allowances, saudi, e.gosi_system ?? 'new');
  return Math.round(e.base_salary + e.allowances + employerGosi);
}

/** Worked hours from "HH:MM" check-in/out (0 if absent). */
export function workedHours(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const [inH, inM] = checkIn.split(':').map(Number);
  const [outH, outM] = checkOut.split(':').map(Number);
  const mins = (outH ?? 0) * 60 + (outM ?? 0) - ((inH ?? 0) * 60 + (inM ?? 0));
  return Math.max(0, Math.round((mins / 60) * 10) / 10);
}

/**
 * Payroll with GOSI (Saudis ~9.75% employee share) + deductions:
 * absence (daily wage × absent days), lateness (flat fee × incidents),
 * and any manual deductions (warnings/penalties) passed in by id.
 */
export function computePayroll(
  employees: Employee[],
  manual: Record<string, number> = {},
): PayrollRow[] {
  return employees
    .filter((e) => e.status !== 'terminated')
    .map((e) => {
      const saudi = e.nationality === 'السعودية';
      const gosi = saudi ? Math.round(e.base_salary * GOSI.saudi.employee) : 0;
      const absence_ded = dailyWage(e.base_salary) * e.absence_days;
      const late_ded = LATE_FEE * e.late_count;
      const manual_ded = manual[e.id] ?? 0;
      const deductions = absence_ded + late_ded + manual_ded;
      const net = e.base_salary + e.allowances - gosi - deductions;
      return {
        id: e.id,
        employee_name: e.full_name,
        nationality: e.nationality,
        base: e.base_salary,
        allowances: e.allowances,
        gosi,
        absence_ded,
        late_ded,
        manual_ded,
        deductions,
        net,
      };
    });
}

/* ======================== Payroll engine (module 05) =====================
 * Salary is COMPUTED from sources — never typed in by hand:
 *   attendance (present/absent/late/overtime) + employee file (basic/allowances/
 *   nationality/GOSI system) + APPROVED adjustments + config.
 * This is the demo mirror of supabase/migrations/0022_payroll.sql calculate_payslip().
 * ========================================================================= */
/** Tunable payroll values — mirror of `payroll_config` (0022). Managed from
 *  «إعدادات الرواتب» (hr.manage); the engine always reads these live values. */
export interface PayrollConfig {
  standardWorkDays: number;
  dailyHours: number;
  overtimeMultiplier: number;
  shiftStartHour: number;
  lateGraceMinutes: number;
}

/** GOSI rates — mirror of `gosi_config` (0022). Rates are fractions (0.0975 = 9.75٪). */
export interface GosiConfig {
  ceiling: number;
  saudiOldEmployee: number;
  saudiOldCompany: number;
  saudiNewEmployee: number;
  saudiNewCompany: number;
  nonSaudiCompany: number;
}

/** Defaults = the DB column defaults (0022). Used to seed and to "restore defaults". */
export const PAYROLL_CONFIG_DEFAULTS: Readonly<PayrollConfig> = Object.freeze({
  standardWorkDays: 30,
  dailyHours: 8,
  overtimeMultiplier: 1.5, // نظام العمل السعودي
  shiftStartHour: 8,
  lateGraceMinutes: 15,
});
export const GOSI_CONFIG_DEFAULTS: Readonly<GosiConfig> = Object.freeze({
  ceiling: 45000,
  saudiOldEmployee: 0.0975, // نظام قديم (قبل 2024-07-03)
  saudiOldCompany: 0.1175,
  saudiNewEmployee: 0.1, // نظام جديد
  saudiNewCompany: 0.12,
  nonSaudiCompany: 0.02, // أخطار مهنية فقط
});

/** Live values — mutated in place by the settings screen (see payrollSettings.api). */
export const PAYROLL_CONFIG: PayrollConfig = { ...PAYROLL_CONFIG_DEFAULTS };
export const GOSI_CONFIG: GosiConfig = { ...GOSI_CONFIG_DEFAULTS };

/**
 * Demo-data only: the demo attendance stores a late COUNT, not check-in times,
 * so each incident is assumed to be this many minutes after shift start. The
 * configured grace is then subtracted exactly like calculate_payslip() does
 * with real check-ins (live mode never uses this value).
 */
export const DEMO_LATE_ARRIVAL_MINUTES = 45;

/** Minutes deducted per late incident = arrival delay beyond the grace period. */
export function lateMinutesPerIncident(cfg: PayrollConfig = PAYROLL_CONFIG): number {
  return Math.max(0, DEMO_LATE_ARRIVAL_MINUTES - cfg.lateGraceMinutes);
}

/** Employer GOSI share — same base (basic + housing, capped) as the payslip. */
export function employerGosiFor(
  basic: number,
  housing: number,
  saudi: boolean,
  system: 'old' | 'new',
): number {
  const base = Math.min(basic + housing, GOSI_CONFIG.ceiling);
  const rate = saudi
    ? system === 'old'
      ? GOSI_CONFIG.saudiOldCompany
      : GOSI_CONFIG.saudiNewCompany
    : GOSI_CONFIG.nonSaudiCompany;
  return Math.round(base * rate * 100) / 100;
}

/** Selectable payroll months: the last `count` months up to the current one ('YYYY-MM'). */
export function payrollPeriods(now: Date = new Date(), count = 12): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Compute one employee's payslip for a period from sources + approved adjustments.
 * Mirrors the SQL function field-for-field so live and demo agree.
 */
export function calculatePayslip(
  e: Employee,
  period: string,
  adjustments: PayrollAdjustment[],
): Payslip {
  const cfg = PAYROLL_CONFIG;
  const basic = e.base_salary;
  // demo mapping: combined "allowances" sits in housing (counts toward GOSI base).
  const housing = e.allowances;
  const transport = 0;
  const other = 0;

  const saudi = e.nationality === 'السعودية';
  const gosiSystem: 'old' | 'new' = e.gosi_system ?? 'new';

  const presentDays = Math.max(0, cfg.standardWorkDays - e.absence_days);
  const dailyWage = round2(basic / cfg.standardWorkDays);
  const hourly = round2(basic / (cfg.standardWorkDays * cfg.dailyHours));

  const overtimeHours = e.overtime_hours ?? 0;
  const overtimeAmount = round2(overtimeHours * hourly * cfg.overtimeMultiplier);

  const absenceDeduction = round2(dailyWage * e.absence_days);
  const lateMinutes = e.late_count * lateMinutesPerIncident(cfg);
  const lateDeduction = round2((lateMinutes / 60) * hourly);

  // approved adjustments only, for this period
  const mine = adjustments.filter(
    (a) => a.employee_id === e.id && a.period === period && a.status === 'approved',
  );
  const additions = mine.filter((a) => ADJ_IS_ADDITION[a.type]).reduce((s, a) => s + a.amount, 0);
  const manualDeductions = mine
    .filter((a) => !ADJ_IS_ADDITION[a.type])
    .reduce((s, a) => s + a.amount, 0);

  // GOSI: base = basic + housing, capped; employee rate by system; expat = 0
  const gosiBase = Math.min(basic + housing, GOSI_CONFIG.ceiling);
  const gosiRate = saudi
    ? gosiSystem === 'old'
      ? GOSI_CONFIG.saudiOldEmployee
      : GOSI_CONFIG.saudiNewEmployee
    : 0;
  const gosiEmployee = round2(gosiBase * gosiRate);

  const gross = round2(basic + housing + transport + other + overtimeAmount + additions);
  const totalDeductions = round2(
    absenceDeduction + lateDeduction + gosiEmployee + manualDeductions,
  );
  const net = round2(gross - totalDeductions);

  return {
    employee_id: e.id,
    employee_name: e.full_name,
    nationality: e.nationality,
    basic,
    housing_allowance: housing,
    transport_allowance: transport,
    other_allowance: other,
    present_days: presentDays,
    absent_days: e.absence_days,
    late_count: e.late_count,
    late_minutes: lateMinutes,
    overtime_hours: overtimeHours,
    overtime_amount: overtimeAmount,
    additions: round2(additions),
    absence_deduction: absenceDeduction,
    late_deduction: lateDeduction,
    gosi_system: gosiSystem,
    gosi_employee: gosiEmployee,
    manual_deductions: round2(manualDeductions),
    gross,
    total_deductions: totalDeductions,
    net,
  };
}

/** Run the full payroll for a period — one payslip per active employee. */
export function runPayroll(
  employees: Employee[],
  period: string,
  adjustments: PayrollAdjustment[],
): Payslip[] {
  return employees
    .filter((e) => e.status !== 'terminated')
    .map((e) => calculatePayslip(e, period, adjustments));
}

/** Payslips for a period: calculate_payslip() on the backend, the mirror engine in demo. */
export async function computePayslips(
  employees: Employee[],
  period: string,
  adjustments: PayrollAdjustment[],
): Promise<Payslip[]> {
  if (!isDemoMode()) return live.livePayslips(employees, period);
  return runPayroll(employees, period, adjustments);
}

/** WPS-style payroll file (CSV) — bank, IBAN, basic, allowances, deductions, net. */
export function buildWpsCsv(slips: Payslip[]): string {
  const header = ['الموظف', 'الجنسية', 'الأساسي', 'البدلات', 'الإضافي', 'الاستقطاعات', 'الصافي'];
  const lines = slips.map((s) =>
    [
      s.employee_name,
      s.nationality,
      s.basic,
      s.housing_allowance + s.transport_allowance + s.other_allowance + s.additions,
      s.overtime_amount,
      s.total_deductions,
      s.net,
    ].join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

/* --------------------- payroll adjustment requests ----------------------- */
const ADJUSTMENTS: PayrollAdjustment[] = [
  {
    id: 'adj1',
    employee_id: 'e1',
    employee_name: 'فهد الشهري',
    type: 'bonus',
    amount: 1500,
    reason: 'تجاوز مستهدف العمليات للربع',
    period: '2026-06',
    submitted_by: 'المدير العام',
    status: 'approved',
  },
  {
    id: 'adj2',
    employee_id: 'e2',
    employee_name: 'سعد آل مريح',
    type: 'advance',
    amount: 2000,
    reason: 'سلفة على الراتب',
    period: '2026-06',
    submitted_by: 'مدير الفرع',
    status: 'pending',
  },
  {
    id: 'adj3',
    employee_id: 'e8',
    employee_name: 'منى الغامدي',
    type: 'penalty',
    amount: 300,
    reason: 'تكرار التأخير',
    period: '2026-06',
    submitted_by: 'مشرف السكن',
    status: 'pending',
  },
];

export async function listAdjustments(): Promise<PayrollAdjustment[]> {
  if (!isDemoMode()) return live.liveListAdjustments();
  return scopeByEmployee(ADJUSTMENTS).map((a) => ({ ...a }));
}

export type NewAdjustmentInput = Omit<PayrollAdjustment, 'id' | 'status'>;
export function addAdjustment(input: NewAdjustmentInput): PayrollAdjustment {
  const a: PayrollAdjustment = { ...input, id: `adj-${Date.now()}`, status: 'pending' };
  ADJUSTMENTS.unshift(a);
  return a;
}
export async function createAdjustment(input: NewAdjustmentInput): Promise<PayrollAdjustment> {
  if (!isDemoMode()) return live.liveAddAdjustment(input);
  return addAdjustment(input);
}
export async function decideAdjustment(
  id: string,
  status: Exclude<AdjustmentStatus, 'pending'>,
): Promise<void> {
  const local = ADJUSTMENTS.find((a) => a.id === id);
  if (local) local.status = status; // keep the demo store in sync with the optimistic update
  if (isDemoMode() || isDemoId(id)) return;
  const { error } = await supabase
    .from('payroll_adjustments')
    .update({
      status,
      decided_at: new Date().toISOString(),
      approved_by: useAuth.getState().profile?.id ?? null,
    })
    .eq('id', id);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

export const ADJUSTMENT_TYPES: AdjustmentType[] = [
  'bonus',
  'allowance',
  'overtime',
  'penalty',
  'advance',
];

/* ===================== End of service / documents / iqamas ================ */

export function yearsOfService(joinDate: string): number {
  const start = new Date(joinDate).getTime();
  if (!joinDate || Number.isNaN(start)) return 0; // missing/invalid date → no service yet
  const ms = Date.now() - start;
  return Math.max(0, Math.round((ms / (365.25 * 86400000)) * 10) / 10);
}

/** Saudi labour-law gratuity: ½ month wage per year (first 5), full month after. */
export function computeEos(e: Employee): { years: number; wage: number; amount: number } {
  const wage = e.base_salary + e.allowances;
  const years = yearsOfService(e.join_date);
  const half = Math.min(years, 5) * 0.5;
  const full = Math.max(years - 5, 0);
  const amount = Math.round((half + full) * wage);
  return { years, wage, amount };
}

export function expiryStatus(expiry: string | null): DocStatus {
  if (!expiry) return 'valid';
  const diff = new Date(expiry).getTime() - Date.now();
  if (diff < 0) return 'expired';
  if (diff < 60 * 86400000) return 'expiring';
  return 'valid';
}

export function ratingLabel(score: number): string {
  if (score >= 90) return 'ممتاز';
  if (score >= 80) return 'جيد جدًا';
  if (score >= 70) return 'جيد';
  return 'يحتاج تحسين';
}

const DOCUMENTS: EmployeeDocument[] = [
  {
    id: 'doc1',
    employee_name: 'فهد الشهري',
    type: 'عقد عمل',
    number: 'CON-1001',
    issue_date: '2023-03-01',
    expiry_date: '2026-03-01',
  },
  {
    id: 'doc2',
    employee_name: 'راجيش كومار',
    type: 'إقامة',
    number: '2412345678',
    issue_date: '2024-02-01',
    expiry_date: '2026-07-15',
  },
  {
    id: 'doc3',
    employee_name: 'راجيش كومار',
    type: 'جواز سفر',
    number: 'P1234567',
    issue_date: '2021-05-10',
    expiry_date: '2031-05-10',
  },
  {
    id: 'doc4',
    employee_name: 'بدر المالكي',
    type: 'شهادة محاسبة (SOCPA)',
    number: 'SOC-7788',
    issue_date: '2022-01-01',
    expiry_date: '2027-01-01',
  },
  {
    id: 'doc5',
    employee_name: 'سعد آل مريح',
    type: 'رخصة قيادة',
    number: 'DL-99001',
    issue_date: '2020-08-01',
    expiry_date: '2026-06-25',
  },
  {
    id: 'doc6',
    employee_name: 'منى الغامدي',
    type: 'عقد عمل',
    number: 'CON-1008',
    issue_date: '2024-03-18',
    expiry_date: null,
  },
];

const IQAMAS: IqamaRecord[] = [
  {
    id: 'iq1',
    employee_name: 'راجيش كومار',
    iqama_no: '2412345678',
    profession: 'مشرف سكن',
    issue_date: '2024-02-01',
    expiry_date: '2026-07-15',
    work_permit: true,
  },
  {
    id: 'iq2',
    employee_name: 'سونيل راي (عامل)',
    iqama_no: '2498765432',
    profession: 'سائق',
    issue_date: '2024-04-10',
    expiry_date: '2026-06-30',
    work_permit: true,
  },
  {
    id: 'iq3',
    employee_name: 'براكاش كومار (عامل)',
    iqama_no: '2455667788',
    profession: 'عامل منزلي',
    issue_date: '2023-11-01',
    expiry_date: '2026-06-18',
    work_permit: false,
  },
  {
    id: 'iq4',
    employee_name: 'ماريا سانتوس (عاملة)',
    iqama_no: '2433445566',
    profession: 'عاملة نظافة',
    issue_date: '2024-01-15',
    expiry_date: '2027-01-15',
    work_permit: true,
  },
];

const PERFORMANCE: PerformanceReview[] = [
  {
    id: 'p1',
    employee_name: 'فهد الشهري',
    period: 'الربع الأول 2026',
    score: 94,
    reviewer: 'المدير العام',
    date: '2026-04-05',
  },
  {
    id: 'p2',
    employee_name: 'نورة العتيبي',
    period: 'الربع الأول 2026',
    score: 88,
    reviewer: 'مدير الفرع',
    date: '2026-04-06',
  },
  {
    id: 'p3',
    employee_name: 'بدر المالكي',
    period: 'الربع الأول 2026',
    score: 82,
    reviewer: 'المدير العام',
    date: '2026-04-06',
  },
  {
    id: 'p4',
    employee_name: 'ريم الزهراني',
    period: 'الربع الأول 2026',
    score: 68,
    reviewer: 'مدير الفرع',
    date: '2026-04-07',
  },
  {
    id: 'p5',
    employee_name: 'خالد الدوسري',
    period: 'الربع الأول 2026',
    score: 90,
    reviewer: 'المدير العام',
    date: '2026-04-07',
  },
];

export async function listDocuments(): Promise<EmployeeDocument[]> {
  if (!isDemoMode()) return live.liveListDocuments();
  return scopeByEmployee(DOCUMENTS).map((d) => ({ ...d }));
}
export async function listIqamas(): Promise<IqamaRecord[]> {
  if (!isDemoMode()) return live.liveListIqamas();
  return scopeByEmployee(IQAMAS).map((i) => ({ ...i }));
}
export async function listPerformance(): Promise<PerformanceReview[]> {
  if (!isDemoMode()) return live.liveListPerformance();
  return scopeByEmployee(PERFORMANCE).map((p) => ({ ...p }));
}
export function addPerformanceReview(r: PerformanceReview): PerformanceReview {
  PERFORMANCE.unshift(r);
  return r;
}
export async function createPerformanceReview(r: PerformanceReview): Promise<PerformanceReview> {
  if (!isDemoMode()) return live.liveAddPerformance(r);
  return addPerformanceReview(r);
}

/** Add an official document to an employee's file (demo store). */
export type NewDocInput = Omit<EmployeeDocument, 'id'>;
export function addEmployeeDocument(input: NewDocInput): EmployeeDocument {
  const doc: EmployeeDocument = { ...input, id: `doc-${Date.now()}` };
  DOCUMENTS.unshift(doc);
  return doc;
}
export async function createEmployeeDocument(input: NewDocInput): Promise<EmployeeDocument> {
  if (!isDemoMode()) return live.liveAddDocument(input);
  return addEmployeeDocument(input);
}

/* --------------------------- emergency contacts -------------------------- */
const EMERGENCY: EmergencyContact[] = [
  {
    id: 'ec1',
    employee_name: 'راجيش كومار',
    name: 'سونيل كومار',
    relation: 'أخ',
    phone: '0539990001',
  },
  {
    id: 'ec2',
    employee_name: 'فهد الشهري',
    name: 'أم فهد',
    relation: 'والدة',
    phone: '0539990002',
  },
];
export async function listEmergencyContacts(): Promise<EmergencyContact[]> {
  if (!isDemoMode()) return live.liveListEmergency();
  return scopeByEmployee(EMERGENCY).map((c) => ({ ...c }));
}
export function addEmergencyContact(input: Omit<EmergencyContact, 'id'>): EmergencyContact {
  const c: EmergencyContact = { ...input, id: `ec-${Date.now()}` };
  EMERGENCY.unshift(c);
  return c;
}
export async function createEmergencyContact(
  input: Omit<EmergencyContact, 'id'>,
): Promise<EmergencyContact> {
  if (!isDemoMode()) return live.liveAddEmergency(input);
  return addEmergencyContact(input);
}

/* ============================ House workers (عاملات) ======================
 * One worker record for the whole company: HR edits the SAME profile the
 * customer catalog, contracts and quotes read (`worker_profiles` live,
 * FALLBACK_WORKERS in demo). HR-only fields (passport/iqama/branch/skills)
 * are columns on worker_profiles (0068); in demo they sit in WORKER_HR below.
 * ========================================================================= */
type WorkerHr = Pick<HouseWorker, 'skills' | 'passport_no' | 'iqama_no' | 'branch'>;
const WORKER_HR: Record<string, WorkerHr> = {
  w1: {
    skills: ['محبة للأطفال', 'التنظيف', 'الكي'],
    passport_no: 'P1234567',
    iqama_no: '2433445566',
    branch: 'نجران',
  },
  w3: {
    skills: ['تجيد الطبخ', 'التنظيف'],
    passport_no: 'A7654321',
    iqama_no: '2477889900',
    branch: 'جازان',
  },
  w5: {
    skills: ['محبة للأطفال', 'رعاية ذوي الإعاقة'],
    passport_no: 'K1122334',
    iqama_no: '2411223344',
    branch: 'شرورة',
  },
  w9: {
    skills: ['التنظيف', 'الكي', 'العناية بكبار السن'],
    passport_no: 'B5544332',
    iqama_no: '2466778899',
    branch: 'حبونا',
  },
  w11: {
    skills: ['محبة للأطفال', 'العناية بكبار السن'],
    passport_no: 'S9988776',
    iqama_no: '2455667780',
    branch: 'نجران',
  },
};
const WORKER_STATUS_SET = new Set(['available', 'reserved', 'on_service', 'medical']);

function demoWorker(w: (typeof FALLBACK_WORKERS)[number]): HouseWorker {
  const hr = WORKER_HR[w.id];
  return {
    id: w.id,
    full_name: w.full_name,
    photo_url: w.photo_url,
    nationality: w.nationality,
    profession: w.profession,
    age: w.age ?? 0,
    experience_years: w.experience_years,
    monthly_salary: w.monthly_salary,
    languages: [...w.languages],
    skills: [...(hr?.skills ?? [])],
    passport_no: hr?.passport_no ?? '',
    iqama_no: hr?.iqama_no ?? '',
    status: (WORKER_STATUS_SET.has(w.status) ? w.status : 'available') as HouseWorker['status'],
    branch: hr?.branch ?? '',
    bio: w.bio_ar ?? '',
  };
}

export async function listHouseWorkers(): Promise<HouseWorker[]> {
  if (!isDemoMode()) return live.liveListWorkers();
  return FALLBACK_WORKERS.map(demoWorker);
}

/** Demo upsert — writes the shared catalog record + the HR-only fields. */
export function saveHouseWorker(w: HouseWorker): HouseWorker {
  const profile = {
    id: w.id,
    full_name: w.full_name,
    nationality: w.nationality,
    profession: w.profession,
    age: w.age,
    experience_years: w.experience_years,
    languages: [...w.languages],
    monthly_salary: w.monthly_salary,
    status: w.status,
    photo_url: w.photo_url,
    bio_ar: w.bio || null,
  };
  const i = FALLBACK_WORKERS.findIndex((x) => x.id === w.id);
  if (i >= 0) FALLBACK_WORKERS[i] = { ...FALLBACK_WORKERS[i], ...profile };
  else FALLBACK_WORKERS.unshift(profile);
  WORKER_HR[w.id] = {
    skills: [...w.skills],
    passport_no: w.passport_no,
    iqama_no: w.iqama_no,
    branch: w.branch,
  };
  return w;
}

export async function persistHouseWorker(w: HouseWorker, isNew: boolean): Promise<HouseWorker> {
  if (!isDemoMode()) return live.liveSaveWorker(w, isNew);
  return saveHouseWorker(w);
}

export type HouseWorkerInput = Omit<HouseWorker, 'id'>;

export function buildHouseWorker(input: HouseWorkerInput): HouseWorker {
  return { ...input, id: `w-${Date.now()}` };
}
