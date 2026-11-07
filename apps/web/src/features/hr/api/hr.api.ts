import { GOSI } from '@masiat/shared';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { scopeToViewerBranch } from '@/lib/branchScope';
import { recordAudit } from '@/shared/lib/auditTrail';
import { roleCan, type RoleCode } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import { DEMO_ACCOUNTS } from '@/lib/demo';
import * as live from '@/features/hr/api/hr.live';
import {
  DEFAULT_LEAVE_TYPES,
  daysInclusive,
  leaveBalance,
  leaveDeductionDays,
  validateLeave,
} from '@/features/hr/lib/leaveEngine';
import { leaveTypeSchema } from '@/features/hr/lib/leaveTypeSchema';
import {
  eosAward,
  eosCalculate,
  eosWages,
  provisionTarget,
  serviceYears,
} from '@/features/hr/lib/eosEngine';
import {
  assertMethodAllowed,
  DEFAULT_ATTENDANCE_CONFIG,
  distanceM,
  isWorkday,
  lateMinutes,
  nowRiyadh,
  tokenFromQr,
} from '@/features/hr/lib/attendanceEngine';
import { z } from 'zod';
import { ADJ_IS_ADDITION } from '@/features/hr/types';
import type {
  AccountOption,
  EosCalc,
  EosSettlement,
  EosWageBasis,
  AttendanceConfig,
  AttendanceMethod,
  BranchAttendance,
  PublicHoliday,
  AdjustmentStatus,
  AdjustmentType,
  AttendanceRecord,
  EmergencyContact,
  Employee,
  HouseWorker,
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveTypeConfig,
  PayrollAdjustment,
  PayrollRow,
  Payslip,
  PayrollRun,
  PerformanceReview,
  TerminationReason,
} from '@/features/hr/types';

const EMPLOYEES: Employee[] = [
  {
    id: 'e1',
    employee_no: 'EMP-1001',
    english_name: 'Fahad Alshehri',
    id_type: 'saudi',
    national_id: '1055238719',
    gender: 'male',
    contract_type: 'full_time',
    housing_allowance: 2000,
    transport_allowance: 1000,
    other_allowance: 0,
    iban: 'SA0380000000608010167519',
    bank_name: 'الراجحي',
    gosi_system: 'old',
    gosi_reg_date: '2023-03-01',
    counts_in_saudization: true,
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
    employee_no: 'EMP-1002',
    english_name: 'Saad Al Muraih',
    id_type: 'saudi',
    national_id: '1088345028',
    gender: 'male',
    contract_type: 'full_time',
    manager_id: 'e1',
    manager: 'فهد الشهري',
    housing_allowance: 1700,
    transport_allowance: 800,
    other_allowance: 0,
    iban: 'SA1810000013245678000101',
    bank_name: 'الأهلي السعودي',
    gosi_system: 'old',
    counts_in_saudization: true,
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
    employee_no: 'EMP-1003',
    id_type: 'saudi',
    national_id: '1102938477',
    gender: 'female',
    contract_type: 'full_time',
    manager_id: 'e2',
    manager: 'سعد آل مريح',
    housing_allowance: 1000,
    transport_allowance: 500,
    other_allowance: 0,
    iban: 'SA8320000002004563210001',
    bank_name: 'الرياض',
    gosi_system: 'old',
    counts_in_saudization: true,
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
    employee_no: 'EMP-1004',
    id_type: 'saudi',
    national_id: '1077652137',
    gender: 'female',
    contract_type: 'full_time',
    manager_id: 'e2',
    manager: 'سعد آل مريح',
    housing_allowance: 600,
    transport_allowance: 400,
    other_allowance: 0,
    iban: 'SA2305000068201234567000',
    bank_name: 'الإنماء',
    gosi_system: 'old',
    counts_in_saudization: true,
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
    employee_no: 'EMP-1005',
    id_type: 'saudi',
    national_id: '1044589214',
    gender: 'male',
    contract_type: 'full_time',
    manager_id: 'e1',
    manager: 'فهد الشهري',
    housing_allowance: 1400,
    transport_allowance: 600,
    other_allowance: 0,
    iban: 'SA7480000000608010245781',
    bank_name: 'الراجحي',
    gosi_system: 'old',
    counts_in_saudization: true,
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
    employee_no: 'EMP-1006',
    id_type: 'saudi',
    national_id: '1099123455',
    gender: 'male',
    contract_type: 'full_time',
    manager_id: 'e1',
    manager: 'فهد الشهري',
    housing_allowance: 1200,
    transport_allowance: 600,
    other_allowance: 0,
    iban: 'SA6315000000300112233001',
    bank_name: 'البلاد',
    gosi_system: 'old',
    counts_in_saudization: true,
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
    employee_no: 'EMP-1007',
    english_name: 'Rajesh Kumar',
    id_type: 'expat',
    iqama_no: '2443129875',
    passport_no: 'N4567890',
    gender: 'male',
    contract_type: 'full_time',
    manager_id: 'e2',
    manager: 'سعد آل مريح',
    housing_allowance: 500,
    transport_allowance: 300,
    other_allowance: 0,
    iban: 'SA1080000000608010998877',
    bank_name: 'الراجحي',
    counts_in_saudization: false,
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
    employee_no: 'EMP-1008',
    english_name: 'Mona Alghamdi',
    id_type: 'saudi',
    national_id: '1033488766',
    gender: 'female',
    contract_type: 'full_time',
    manager_id: 'e1',
    manager: 'فهد الشهري',
    housing_allowance: 800,
    transport_allowance: 400,
    other_allowance: 0,
    iban: 'SA5010000016677889900102',
    bank_name: 'الأهلي السعودي',
    gosi_system: 'old',
    counts_in_saudization: true,
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

/** Today's attendance (demo). Methods/late minutes as the server would record them. */
const ATT_TODAY = nowRiyadh().date;
const ATTENDANCE: AttendanceRecord[] = [
  att('a1', 'e1', 'فهد الشهري', 'العمليات', '07:55', '16:05', 'present', 'gps', { distance_m: 38 }),
  att('a2', 'e2', 'سعد آل مريح', 'الإدارة', '08:22', '16:00', 'late', 'qr', { late_minutes: 7 }),
  att('a3', 'e3', 'نورة العتيبي', 'المبيعات', '07:58', '16:02', 'present', 'qr'),
  att('a4', 'e4', 'ريم الزهراني', 'مركز الاتصال', '08:05', null, 'present', 'gps', {
    distance_m: 61,
  }),
  att('a5', 'e5', 'بدر المالكي', 'المالية', null, null, 'absent', 'manual', {
    note: 'غياب بدون عذر — أبلغ المدير المباشر',
  }),
  att('a6', 'e6', 'خالد الدوسري', 'الموارد البشرية', '07:50', '16:10', 'present', 'qr'),
  att('a7', 'e7', 'راجيش كومار', 'السكن', '07:45', '17:00', 'present', 'gps', { distance_m: 112 }),
  att('a8', 'e8', 'منى الغامدي', 'السكن', '08:20', '16:00', 'late', 'qr', { late_minutes: 5 }),
];

function att(
  id: string,
  employee_id: string,
  employee_name: string,
  department: string,
  check_in: string | null,
  check_out: string | null,
  status: AttendanceRecord['status'],
  method: AttendanceMethod,
  extra: Partial<AttendanceRecord> = {},
): AttendanceRecord {
  const r: AttendanceRecord = {
    id,
    employee_id,
    employee_name,
    department,
    date: ATT_TODAY,
    check_in,
    check_out,
    status,
    ...extra,
  };
  if (check_in || method === 'manual') r.check_in_method = method;
  if (check_out) r.check_out_method = method;
  return r;
}

const LEAVE: LeaveRequest[] = [
  {
    id: 'l1',
    employee_id: 'e4',
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
    employee_id: 'e3',
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
    employee_id: 'e5',
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
    employee_id: 'e7',
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
  const today = new Date().toISOString().slice(0, 10);
  // «في إجازة» is derived from an approved leave covering today (same as live)
  const away = new Set(
    LEAVE.filter((l) => l.status === 'approved' && l.from_date <= today && l.to_date >= today).map(
      (l) => l.employee_id,
    ),
  );
  return scopeToViewerBranch(EMPLOYEES, (e) => e.branch).map((e) => ({
    ...e,
    status: e.status === 'terminated' ? 'terminated' : away.has(e.id) ? 'on_leave' : 'active',
  }));
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
  if (!emp.employee_no) {
    // same as trg_set_employee_no (0069): EMP- + next number
    const max = Math.max(
      1000,
      ...EMPLOYEES.map((e) => Number(/^EMP-(\d+)$/.exec(e.employee_no ?? '')?.[1] ?? 0)),
    );
    emp = { ...emp, employee_no: `EMP-${max + 1}` };
  }
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

/* ----------------------- end of service / correction --------------------- */
export interface TerminationInput {
  date: string;
  reason: TerminationReason;
  note: string;
}

/** Same rules as terminate_employee() (0069) — demo store. */
export function terminateDemoEmployee(id: string, t: TerminationInput): Employee {
  const e = EMPLOYEES.find((x) => x.id === id);
  if (!e) throw new Error('الموظف غير موجود');
  if (e.status === 'terminated') throw new Error('الموظف منتهي الخدمة بالفعل');
  if (!t.date) throw new Error('تاريخ إنهاء الخدمة مطلوب');
  if (e.join_date && t.date < e.join_date) throw new Error('تاريخ إنهاء الخدمة قبل تاريخ التعيين');
  e.status = 'terminated';
  e.termination_date = t.date;
  e.termination_reason = t.reason;
  if (t.note) e.termination_note = t.note;
  return { ...e };
}

export function reactivateDemoEmployee(id: string): Employee {
  const e = EMPLOYEES.find((x) => x.id === id);
  if (!e) throw new Error('الموظف غير موجود');
  if (e.status !== 'terminated') throw new Error('الموظف على رأس العمل');
  e.status = 'active';
  delete e.termination_date;
  delete e.termination_reason;
  delete e.termination_note;
  return { ...e };
}

export async function terminateEmployee(id: string, t: TerminationInput): Promise<void> {
  if (!isDemoMode()) return live.liveTerminateEmployee(id, t);
  terminateDemoEmployee(id, t);
}
export async function reactivateEmployee(id: string): Promise<void> {
  if (!isDemoMode()) return live.liveReactivateEmployee(id);
  reactivateDemoEmployee(id);
}

/** Login accounts HR can link an employee to (demo: the demo accounts). */
export async function listAccountOptions(): Promise<AccountOption[]> {
  if (!isDemoMode()) return live.liveAccountOptions();
  return DEMO_ACCOUNTS.map((a) => ({
    id: `acc-${a.role}`,
    full_name: a.name,
    role: a.role,
    branch: a.branch,
    linked_employee: EMPLOYEES.find((e) => e.user_id === `acc-${a.role}`)?.id ?? null,
  }));
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

export async function listAttendance(date: string = nowRiyadh().date): Promise<AttendanceRecord[]> {
  if (!isDemoMode()) return live.liveListAttendance(date);
  return scopeByEmployee(ATTENDANCE.filter((a) => (a.date ?? ATT_TODAY) === date)).map((a) => ({
    ...a,
  }));
}

/* ============================ Attendance (0072) ==========================
 * Demo mirror of attendance_check / manual_attendance / close_attendance_day,
 * the config, holidays and branch locations + QR tokens.
 * ========================================================================= */
let ATT_CONFIG: AttendanceConfig = { ...DEFAULT_ATTENDANCE_CONFIG };
const HOLIDAYS: PublicHoliday[] = [
  {
    id: 'h1',
    name_ar: 'يوم التأسيس',
    from_date: '2026-02-22',
    to_date: '2026-02-22',
    is_active: true,
  },
  {
    id: 'h2',
    name_ar: 'عيد الفطر (تقديري — يُعدَّل حسب الإعلان الرسمي)',
    from_date: '2026-03-19',
    to_date: '2026-03-22',
    is_active: true,
  },
  {
    id: 'h3',
    name_ar: 'عيد الأضحى (تقديري — يُعدَّل حسب الإعلان الرسمي)',
    from_date: '2026-05-26',
    to_date: '2026-05-29',
    is_active: true,
  },
  {
    id: 'h4',
    name_ar: 'اليوم الوطني',
    from_date: '2026-09-23',
    to_date: '2026-09-23',
    is_active: true,
  },
  {
    id: 'h5',
    name_ar: 'يوم التأسيس',
    from_date: '2027-02-22',
    to_date: '2027-02-22',
    is_active: true,
  },
  {
    id: 'h6',
    name_ar: 'اليوم الوطني',
    from_date: '2027-09-23',
    to_date: '2027-09-23',
    is_active: true,
  },
];
const BRANCH_ATT: BranchAttendance[] = [
  {
    id: 'br-najran',
    city: 'نجران',
    latitude: 17.565604,
    longitude: 44.228944,
    attendance_token: 'najran7f3a91c2',
  },
  {
    id: 'br-jazan',
    city: 'جازان',
    latitude: 16.889359,
    longitude: 42.570567,
    attendance_token: 'jazan2b8e40d1',
  },
  {
    id: 'br-sharurah',
    city: 'شرورة',
    latitude: 17.466944,
    longitude: 47.106667,
    attendance_token: 'sharurah9c1d57',
  },
  {
    id: 'br-habuna',
    city: 'حبونا',
    latitude: 17.851944,
    longitude: 44.026944,
    attendance_token: 'habuna4e6f20a8',
  },
];

/** Read-only snapshot for other modules (housing presence rule). */
export function attendanceConfigSnapshot(): AttendanceConfig {
  return { ...ATT_CONFIG };
}

export const attendanceConfigSchema = z.object({
  qr_enabled: z.boolean(),
  qr_roles: z.array(z.string()),
  gps_enabled: z.boolean(),
  gps_roles: z.array(z.string()),
  gps_radius_m: z
    .number({ message: 'أدخل رقمًا' })
    .int()
    .min(20, { message: 'بين 20 و5000 متر' })
    .max(5000, { message: 'بين 20 و5000 متر' }),
  manual_enabled: z.boolean(),
  manual_roles: z.array(z.string()),
  worker_barcode_required: z.boolean(),
  workdays: z
    .array(z.number().int().min(0).max(6))
    .min(1, { message: 'اختر يوم عمل واحدًا على الأقل' }),
});

export async function getAttendanceConfig(): Promise<AttendanceConfig> {
  if (!isDemoMode()) return live.liveAttendanceConfig();
  return { ...ATT_CONFIG, workdays: [...ATT_CONFIG.workdays] };
}
export async function saveAttendanceConfig(cfg: AttendanceConfig): Promise<void> {
  const parsed = attendanceConfigSchema.parse(cfg);
  if (!isDemoMode()) return live.liveSaveAttendanceConfig(parsed);
  const before = ATT_CONFIG;
  ATT_CONFIG = parsed;
  const changed = (Object.keys(parsed) as (keyof AttendanceConfig)[]).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(parsed[k]),
  );
  if (changed.length)
    recordAudit({
      action: 'update',
      entity: 'attendance_config',
      record_ref: 'طرق تسجيل الحضور',
      old_data: Object.fromEntries(changed.map((k) => [k, before[k]])),
      new_data: Object.fromEntries(changed.map((k) => [k, parsed[k]])),
      branch: null,
    });
}

export async function listHolidays(): Promise<PublicHoliday[]> {
  if (!isDemoMode()) return live.liveListHolidays();
  return HOLIDAYS.map((h) => ({ ...h })).sort((a, b) => a.from_date.localeCompare(b.from_date));
}
export async function saveHoliday(h: PublicHoliday, isNew: boolean): Promise<void> {
  if (!h.name_ar.trim()) throw new Error('اسم العطلة مطلوب');
  if (!h.from_date || !h.to_date || h.to_date < h.from_date)
    throw new Error('تاريخ النهاية قبل البداية');
  if (!isDemoMode()) return live.liveSaveHoliday(h, isNew);
  const i = HOLIDAYS.findIndex((x) => x.id === h.id);
  if (i >= 0) HOLIDAYS[i] = { ...h };
  else HOLIDAYS.push({ ...h, id: `h-${Date.now()}` });
}

export async function listBranchAttendance(): Promise<BranchAttendance[]> {
  if (!isDemoMode()) return live.liveBranchAttendance();
  return BRANCH_ATT.map((b) => ({ ...b }));
}
export async function setBranchAttendance(
  id: string,
  lat: number | null,
  lng: number | null,
  rotate: boolean,
): Promise<void> {
  if (lat != null && (lat < -90 || lat > 90 || lng == null || lng < -180 || lng > 180))
    throw new Error('إحداثيات غير صحيحة');
  if (!isDemoMode()) return live.liveSetBranchAttendance(id, lat, lng, rotate);
  const b = BRANCH_ATT.find((x) => x.id === id);
  if (!b) throw new Error('الفرع غير موجود');
  b.latitude = lat;
  b.longitude = lng;
  if (rotate) b.attendance_token = `${b.id.slice(3)}${Math.random().toString(16).slice(2, 10)}`;
}

/** The signed-in user's employee file (demo: by name, live: employees.user_id). */
export async function getMyEmployee(): Promise<Employee | null> {
  if (!isDemoMode()) return live.liveMyEmployee();
  const name = useAuth.getState().profile?.full_name;
  const e = EMPLOYEES.find((x) => x.full_name === name && x.status !== 'terminated');
  return e ? { ...e } : null;
}

export interface CheckResult {
  action: 'in' | 'out';
  late_minutes?: number;
  distance_m?: number;
  at: string;
}

/** Self check-in / check-out (QR token or GPS) — mirror of attendance_check(). */
export async function attendanceCheck(
  method: 'qr' | 'gps',
  input: { lat?: number; lng?: number; token?: string },
): Promise<CheckResult> {
  if (!isDemoMode()) return live.liveAttendanceCheck(method, input);
  const me = await getMyEmployee();
  if (!me) throw new Error('حسابك غير مرتبط بملف موظف نشط — راجع الموارد البشرية');
  const role = useAuth.getState().profile?.role ?? '';
  assertMethodAllowed(method, role, ATT_CONFIG);
  const home = BRANCH_ATT.find((b) => b.city === me.branch);
  let dist: number | undefined;
  if (method === 'qr') {
    const b = BRANCH_ATT.find((x) => x.attendance_token === tokenFromQr(input.token ?? ''));
    if (!b) throw new Error('رمز الفرع غير صحيح أو منتهي — امسح الرمز المعلّق في الفرع');
    if (me.branch && b.city !== me.branch) throw new Error(`هذا رمز فرع ${b.city}، وفرعك مختلف`);
  } else {
    if (input.lat == null || input.lng == null)
      throw new Error('تعذّر تحديد موقعك — فعّل خدمة الموقع');
    if (!home || home.latitude == null || home.longitude == null)
      throw new Error('موقع فرعك غير محدد — راجع الموارد البشرية');
    dist = distanceM(input.lat, input.lng, home.latitude, home.longitude);
    if (dist > ATT_CONFIG.gps_radius_m)
      throw new Error(`أنت على بُعد ${dist} متر من الفرع — المسموح ${ATT_CONFIG.gps_radius_m} متر`);
  }
  const { date, time } = nowRiyadh();
  const row = ATTENDANCE.find((a) => a.employee_id === me.id && (a.date ?? ATT_TODAY) === date);
  if (!row) {
    const late = lateMinutes(time, PAYROLL_CONFIG.shiftStartHour, PAYROLL_CONFIG.lateGraceMinutes);
    const rec: AttendanceRecord = {
      id: `att-${Date.now()}`,
      employee_id: me.id,
      employee_name: me.full_name,
      department: me.department,
      date,
      check_in: time,
      check_out: null,
      status: late > 0 ? 'late' : 'present',
      check_in_method: method,
      late_minutes: late,
    };
    if (dist !== undefined) rec.distance_m = dist;
    ATTENDANCE.unshift(rec);
    return {
      action: 'in',
      late_minutes: late,
      at: time,
      ...(dist !== undefined ? { distance_m: dist } : {}),
    };
  }
  if (row.check_out) throw new Error('سجّلت حضورك وانصرافك اليوم');
  if (!row.check_in) throw new Error('سجلّ اليوم مُعدّ يدوياً — راجع الموارد البشرية');
  row.check_out = time;
  row.check_out_method = method;
  return { action: 'out', at: time, ...(dist !== undefined ? { distance_m: dist } : {}) };
}

export interface ManualAttendanceInput {
  employee_id: string;
  date: string;
  status: AttendanceRecord['status'];
  check_in: string | null;
  check_out: string | null;
  note: string;
}

/** Manual correction (roles from config, note required) — mirror of manual_attendance(). */
export async function manualAttendance(m: ManualAttendanceInput): Promise<void> {
  if (!isDemoMode()) return live.liveManualAttendance(m);
  const role = useAuth.getState().profile?.role ?? '';
  if (!ATT_CONFIG.manual_enabled || !ATT_CONFIG.manual_roles.includes(role))
    throw new Error('التحضير اليدوي غير مسموح لك');
  if (!m.note.trim()) throw new Error('سبب التعديل اليدوي مطلوب');
  if (m.date > nowRiyadh().date) throw new Error('لا يُسجَّل حضور لتاريخ قادم');
  if (m.check_in && m.check_out && m.check_out <= m.check_in)
    throw new Error('وقت الانصراف قبل وقت الحضور');
  const e = EMPLOYEES.find((x) => x.id === m.employee_id);
  if (!e) throw new Error('الموظف غير موجود');
  const late = m.check_in
    ? lateMinutes(m.check_in, PAYROLL_CONFIG.shiftStartHour, PAYROLL_CONFIG.lateGraceMinutes)
    : undefined;
  const status: AttendanceRecord['status'] =
    (m.status === 'present' || m.status === 'late') && late && late > 0
      ? 'late'
      : m.status === 'late'
        ? 'present'
        : m.status;
  const rec: AttendanceRecord = {
    id: `att-${Date.now()}`,
    employee_id: e.id,
    employee_name: e.full_name,
    department: e.department,
    date: m.date,
    check_in: m.check_in,
    check_out: m.check_out,
    status,
    check_in_method: 'manual',
    note: m.note.trim(),
  };
  if (m.check_out) rec.check_out_method = 'manual';
  if (late !== undefined) rec.late_minutes = late;
  const i = ATTENDANCE.findIndex((a) => a.employee_id === e.id && (a.date ?? ATT_TODAY) === m.date);
  if (i >= 0) ATTENDANCE[i] = { ...rec, id: ATTENDANCE[i]!.id };
  else ATTENDANCE.unshift(rec);
}

/** Close a past workday: no record → absent, or leave if on approved leave. */
export async function closeAttendanceDay(
  date: string,
): Promise<{ absent: number; leave: number; workday: boolean }> {
  if (!isDemoMode()) return live.liveCloseDay(date);
  if (date >= nowRiyadh().date) throw new Error('يُغلق اليوم بعد انتهائه');
  if (!isWorkday(date, ATT_CONFIG, HOLIDAYS)) return { absent: 0, leave: 0, workday: false };
  let absent = 0;
  let leave = 0;
  EMPLOYEES.filter(
    (e) =>
      (!e.join_date || e.join_date <= date) &&
      (e.status !== 'terminated' || (e.termination_date ?? '') >= date) &&
      !ATTENDANCE.some((a) => a.employee_id === e.id && (a.date ?? ATT_TODAY) === date),
  ).forEach((e) => {
    const onLeave = LEAVE.some(
      (l) =>
        l.employee_id === e.id &&
        l.status === 'approved' &&
        l.from_date <= date &&
        l.to_date >= date,
    );
    ATTENDANCE.push({
      id: `att-${e.id}-${date}`,
      employee_id: e.id,
      employee_name: e.full_name,
      department: e.department,
      date,
      check_in: null,
      check_out: null,
      status: onLeave ? 'leave' : 'absent',
      note: 'إغلاق اليوم: لا تسجيل حضور',
    });
    if (onLeave) leave++;
    else absent++;
  });
  return { absent, leave, workday: true };
}

/** One employee's month (records only; the calendar adds leave/holidays/weekends). */
export async function listMonthAttendance(
  employeeId: string,
  period: string,
): Promise<AttendanceRecord[]> {
  if (!isDemoMode()) return live.liveMonthAttendance(employeeId, period);
  return ATTENDANCE.filter(
    (a) => a.employee_id === employeeId && (a.date ?? ATT_TODAY).startsWith(period),
  ).map((a) => ({ ...a }));
}

export async function listLeaveRequests(): Promise<LeaveRequest[]> {
  if (!isDemoMode()) return live.liveListLeave();
  return scopeByEmployee(LEAVE).map((l) => ({ ...l }));
}

export async function createLeaveRequest(l: LeaveRequest): Promise<LeaveRequest> {
  if (!isDemoMode()) return live.liveAddLeave(l);
  return addLeaveRequest(l);
}

/** Demo request — validated with the same rules as validate_leave_request() (0070). */
export function addLeaveRequest(l: LeaveRequest): LeaveRequest {
  const e = EMPLOYEES.find((x) => x.id === l.employee_id || x.full_name === l.employee_name);
  const req = { ...l, days: daysInclusive(l.from_date, l.to_date) };
  if (e) validateLeave(req, e, LEAVE, LEAVE_TYPES);
  LEAVE.unshift(req);
  return req;
}

/** Approve / reject / cancel. Approval re-checks the rules (balance may have changed). */
export async function updateLeaveStatus(
  id: string,
  status: LeaveStatus,
  note?: string,
): Promise<void> {
  if (!isDemoMode() && !isDemoId(id)) return live.liveUpdateLeave(id, status, note);
  const local = LEAVE.find((l) => l.id === id);
  if (!local) return;
  if (status === 'approved') {
    const e = EMPLOYEES.find(
      (x) => x.id === local.employee_id || x.full_name === local.employee_name,
    );
    if (e) validateLeave({ ...local, status }, e, LEAVE, LEAVE_TYPES);
  }
  local.status = status;
  if (note) local.decision_note = note;
}

/* ------------------------------ leave types ------------------------------ */
/** Demo store of `leave_types` — starts from the labour-law defaults. */
const LEAVE_TYPES: LeaveTypeConfig[] = DEFAULT_LEAVE_TYPES.map((t) => ({ ...t }));

export async function listLeaveTypes(): Promise<LeaveTypeConfig[]> {
  if (!isDemoMode()) return live.liveListLeaveTypes();
  return LEAVE_TYPES.map((t) => ({ ...t })).sort((a, b) => a.sort_order - b.sort_order);
}

export async function saveLeaveType(t: LeaveTypeConfig, isNew: boolean): Promise<void> {
  const parsed = leaveTypeSchema.parse(t);
  if (!isDemoMode()) return live.liveSaveLeaveType(parsed, isNew);
  const i = LEAVE_TYPES.findIndex((x) => x.code === parsed.code);
  if (isNew && i >= 0) throw new Error('رمز النوع مستخدم');
  const before = i >= 0 ? LEAVE_TYPES[i]! : null;
  if (i >= 0) LEAVE_TYPES[i] = parsed;
  else LEAVE_TYPES.push(parsed);
  // same shape as audit_row_change (changed fields only)
  const changed = (Object.keys(parsed) as (keyof LeaveTypeConfig)[]).filter(
    (k) => !before || before[k] !== parsed[k],
  );
  recordAudit({
    action: before ? 'update' : 'insert',
    entity: 'leave_types',
    record_ref: parsed.name_ar,
    old_data: before ? Object.fromEntries(changed.map((k) => [k, before[k]])) : null,
    new_data: Object.fromEntries(changed.map((k) => [k, parsed[k]])),
    branch: null,
  });
}

/** Balance as of a date (annual accrued / used / pending, sick this year). */
export async function getLeaveBalance(e: Employee, asOf: string): Promise<LeaveBalance> {
  if (!isDemoMode()) return live.liveLeaveBalance(e.id, asOf);
  return leaveBalance(e, LEAVE, LEAVE_TYPES, asOf);
}

/** Demo leave rows for the payroll engine (live: the server reads its own). */
export function demoLeaveContext(): { leaves: LeaveRequest[]; types: LeaveTypeConfig[] } {
  return { leaves: LEAVE, types: LEAVE_TYPES };
}

/** Total monthly cost to the company: base + allowances + employer GOSI share
 *  (same rates/base/ceiling as the payroll run and the accounting accrual). */
export function monthlyCost(e: Employee): number {
  const saudi = e.nationality === 'السعودية';
  const housing = e.housing_allowance ?? e.allowances; // GOSI base = basic + housing
  const employerGosi = employerGosiFor(e.base_salary, housing, saudi, e.gosi_system ?? 'new');
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
  /** suggested allowances for a new hire, as % of basic (employee form). */
  defaultHousingPct: number;
  defaultTransportPct: number;
  /** wage the end-of-service award is computed on (0073) */
  eosWageBasis: EosWageBasis;
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
  defaultHousingPct: 25,
  defaultTransportPct: 10,
  eosWageBasis: 'full',
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
  leaves: LeaveRequest[] = [],
  leaveTypes: LeaveTypeConfig[] = DEFAULT_LEAVE_TYPES,
): Payslip {
  const cfg = PAYROLL_CONFIG;
  // partial month (0071): hired / terminated inside the period → pay × days ÷ 30
  const { eligible, factor } = employmentFactor(e, period, cfg.standardWorkDays);
  const basic = round2(e.base_salary * factor);
  // the employee file's split (0069); legacy records keep the total in housing
  const housing = round2((e.housing_allowance ?? e.allowances) * factor);
  const transport =
    e.housing_allowance !== undefined ? round2((e.transport_allowance ?? 0) * factor) : 0;
  const other = e.housing_allowance !== undefined ? round2((e.other_allowance ?? 0) * factor) : 0;

  const saudi = e.nationality === 'السعودية';
  const gosiSystem: 'old' | 'new' = e.gosi_system ?? 'new';

  const presentDays = Math.max(0, cfg.standardWorkDays - e.absence_days);
  const dailyWage = round2(e.base_salary / cfg.standardWorkDays);
  const hourly = round2(e.base_salary / (cfg.standardWorkDays * cfg.dailyHours));

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
  const advances = mine.filter((a) => a.type === 'advance').reduce((s, a) => s + a.amount, 0);
  const penalties = mine.filter((a) => a.type === 'penalty').reduce((s, a) => s + a.amount, 0);
  const manualDeductions = advances + penalties;

  // GOSI: base = basic + housing, capped; employee rate by system; expat = 0
  const gosiBase = Math.min(basic + housing, GOSI_CONFIG.ceiling);
  const gosiRate = saudi
    ? gosiSystem === 'old'
      ? GOSI_CONFIG.saudiOldEmployee
      : GOSI_CONFIG.saudiNewEmployee
    : 0;
  const gosiEmployee = round2(gosiBase * gosiRate);
  const gosiEmployer = employerGosiFor(basic, housing, saudi, gosiSystem);

  // approved leave: unpaid days + sick days in the reduced-pay tiers (0070)
  const leave = leaveDeductionDays(e, period, leaves, leaveTypes);
  const leaveDeduction = round2(dailyWage * (leave.unpaid_days + leave.sick_deduction_days));

  const gross = round2(basic + housing + transport + other + overtimeAmount + additions);
  const totalDeductions = round2(
    absenceDeduction + lateDeduction + gosiEmployee + manualDeductions + leaveDeduction,
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
    advance_deductions: round2(advances),
    penalty_deductions: round2(penalties),
    gosi_employer: gosiEmployer,
    eligible_days: eligible,
    unpaid_leave_days: leave.unpaid_days,
    sick_deduction_days: leave.sick_deduction_days,
    leave_deduction: leaveDeduction,
    gross,
    total_deductions: totalDeductions,
    net,
  };
}

/** Days employed in a period and the pay factor (1 = full month), as in 0071. */
export function employmentFactor(
  e: Employee,
  period: string,
  standardDays: number,
): { eligible: number; factor: number } {
  const start = `${period}-01`;
  const endD = new Date(`${start}T00:00:00Z`);
  endD.setUTCMonth(endD.getUTCMonth() + 1);
  endD.setUTCDate(0);
  const end = endD.toISOString().slice(0, 10);
  const monthDays = endD.getUTCDate();
  const from = e.join_date && e.join_date > start ? e.join_date : start;
  const to = e.termination_date && e.termination_date < end ? e.termination_date : end;
  const eligible = to < from ? 0 : daysInclusive(from, to);
  return { eligible, factor: eligible >= monthDays ? 1 : Math.min(eligible / standardDays, 1) };
}

/** Employees paid in a period: hired by its end, not terminated before its start. */
export function periodEmployees(employees: Employee[], period: string): Employee[] {
  const start = `${period}-01`;
  return employees.filter((e) => {
    const hiredBy = !e.join_date || e.join_date.slice(0, 7) <= period;
    const stillThere = e.status !== 'terminated' || (e.termination_date ?? '') >= start;
    return hiredBy && stillThere;
  });
}

/** Run the full payroll for a period — one payslip per active employee. */
export function runPayroll(
  employees: Employee[],
  period: string,
  adjustments: PayrollAdjustment[],
  leaves: LeaveRequest[] = [],
  leaveTypes: LeaveTypeConfig[] = DEFAULT_LEAVE_TYPES,
): Payslip[] {
  return periodEmployees(employees, period).map((e) =>
    calculatePayslip(e, period, adjustments, leaves, leaveTypes),
  );
}

/** Payslips for a period: calculate_payslip() on the backend, the mirror engine in demo. */
export async function computePayslips(
  employees: Employee[],
  period: string,
  adjustments: PayrollAdjustment[],
): Promise<Payslip[]> {
  if (!isDemoMode()) return live.livePayslips(employees, period);
  return runPayroll(employees, period, adjustments, LEAVE, LEAVE_TYPES);
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
  assertPeriodOpen(input.period);
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
  if (local && isDemoMode()) assertPeriodOpen(local.period);
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

/* ============================ End of service ============================== */

/** Years of service until today — same rule as eos_service_years (days ÷ 365). */
export function yearsOfService(joinDate: string): number {
  if (!joinDate || Number.isNaN(Date.parse(joinDate))) return 0; // missing/invalid → no service yet
  return serviceYears(joinDate, new Date().toISOString().slice(0, 10));
}

/** Award if the employee left today by employer termination (م84) — single engine (eosEngine). */
export function computeEos(e: Employee): { years: number; wage: number; amount: number } {
  const years = yearsOfService(e.join_date);
  const wage = eosWages(e, PAYROLL_CONFIG.eosWageBasis).eos;
  return { years, wage, amount: years ? eosAward(years, wage, 'employer_termination').award : 0 };
}

export function ratingLabel(score: number): string {
  if (score >= 90) return 'ممتاز';
  if (score >= 80) return 'جيد جدًا';
  if (score >= 70) return 'جيد';
  return 'يحتاج تحسين';
}

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

/* ------------------- reference lists in the demo stores (0075) ------------- */
type RenamableKind =
  | 'department'
  | 'job_title'
  | 'nationality'
  | 'profession'
  | 'skill'
  | 'language';

/** Demo mirror of cascade_hr_lookup_rename: records that store the name follow it. */
export function renameLookupValueDemo(kind: string, from: string, to: string): void {
  if (from === to) return;
  const swap = (arr: string[]) => arr.map((x) => (x === from ? to : x));
  EMPLOYEES.forEach((e) => {
    if (kind === 'department' && e.department === from) e.department = to;
    if (kind === 'job_title' && e.job_title === from) e.job_title = to;
    if (kind === 'nationality' && e.nationality === from) e.nationality = to;
  });
  FALLBACK_WORKERS.forEach((w, i) => {
    FALLBACK_WORKERS[i] = {
      ...w,
      nationality: kind === 'nationality' && w.nationality === from ? to : w.nationality,
      profession: kind === 'profession' && w.profession === from ? to : w.profession,
      languages: kind === 'language' ? swap([...w.languages]) : w.languages,
    };
  });
  if (kind === 'skill') Object.values(WORKER_HR).forEach((h) => (h.skills = swap(h.skills)));
}

/** Demo mirror of hr_lookup_usage: how many records hold each name. */
export function lookupUsageDemo(kind: RenamableKind): Map<string, number> {
  const out = new Map<string, number>();
  const add = (v: string | null | undefined) => {
    if (v) out.set(v, (out.get(v) ?? 0) + 1);
  };
  if (kind === 'department') EMPLOYEES.forEach((e) => add(e.department));
  if (kind === 'job_title') EMPLOYEES.forEach((e) => add(e.job_title));
  if (kind === 'nationality') {
    EMPLOYEES.forEach((e) => add(e.nationality));
    FALLBACK_WORKERS.forEach((w) => add(w.nationality));
  }
  if (kind === 'profession') FALLBACK_WORKERS.forEach((w) => add(w.profession));
  if (kind === 'language') FALLBACK_WORKERS.forEach((w) => w.languages.forEach(add));
  if (kind === 'skill') Object.values(WORKER_HR).forEach((h) => h.skills.forEach(add));
  return out;
}

export type HouseWorkerInput = Omit<HouseWorker, 'id'>;

export function buildHouseWorker(input: HouseWorkerInput): HouseWorker {
  return { ...input, id: `w-${Date.now()}` };
}

/* ============================ Payroll runs (0071) =========================
 * calculate (frozen snapshot) → approve by someone else (four eyes) → post to
 * the ledger → pay. Demo mirror of calculate_payroll_run / approve_payroll_run /
 * post_payroll_run / pay_payroll_run with the same rules and messages.
 * ========================================================================= */
interface DemoRun {
  run: PayrollRun;
  slips: Payslip[];
}
const RUNS = new Map<string, DemoRun>();

/** Same as guard_adjustment_period (0071): an approved month takes no new adjustments. */
export function assertPeriodOpen(period: string): void {
  const r = RUNS.get(period)?.run;
  if (r && r.status !== 'calculated')
    throw new Error(`مسير ${period} معتمد — ارفع التعديل على الشهر التالي`);
}

function actor(): { id: string; name: string } {
  const p = useAuth.getState().profile;
  return { id: p?.id ?? 'anon', name: p?.full_name ?? '—' };
}

/** Run totals — the figures accounting posts from (never the individual slips). */
export function runTotals(
  slips: Payslip[],
): Omit<
  PayrollRun,
  | 'id'
  | 'period'
  | 'status'
  | 'run_by'
  | 'run_by_name'
  | 'calculated_at'
  | 'approved_by_name'
  | 'approved_at'
  | 'posted_at'
  | 'paid_at'
> {
  const sum = (f: (p: Payslip) => number) => round2(slips.reduce((s, p) => s + f(p), 0));
  return {
    employee_count: slips.length,
    total_gross: sum((p) => p.gross),
    total_deductions: sum((p) => p.total_deductions),
    total_net: sum((p) => p.net),
    total_earnings: sum(
      (p) => p.gross - p.absence_deduction - p.late_deduction - p.leave_deduction,
    ),
    total_gosi_employee: sum((p) => p.gosi_employee),
    total_gosi_employer: sum((p) => p.gosi_employer),
    total_advances: sum((p) => p.advance_deductions),
    total_penalties: sum((p) => p.penalty_deductions),
  };
}

function snapshot(e: Employee, s: Payslip): Payslip {
  const out: Payslip = { ...s };
  if (e.employee_no) out.employee_no = e.employee_no;
  const idNo = e.national_id ?? e.iqama_no;
  if (idNo) out.id_number = idNo;
  if (e.iban) out.iban = e.iban;
  if (e.bank_name) out.bank_name = e.bank_name;
  return out;
}

export async function getPayrollRun(
  period: string,
): Promise<{ run: PayrollRun; slips: Payslip[] } | null> {
  if (!isDemoMode()) return live.liveGetPayrollRun(period);
  const r = RUNS.get(period);
  if (!r) return null;
  // company totals: hr.manage or accounting only (payruns_read, 0071)
  const role = useAuth.getState().profile?.role as RoleCode | undefined;
  if (role && !roleCan(role, 'hr', 'manage') && !roleCan(role, 'accounting', 'view')) return null;
  // a branch-scoped viewer sees only his branch's slips (payslips_read, 0071)
  const visible = new Set(demoEmployees().map((e) => e.id));
  // accounting posts from the totals and never opens individual slips
  const slips = role && !roleCan(role, 'hr', 'view') ? [] : r.slips;
  return { run: { ...r.run }, slips: slips.filter((p) => visible.has(p.employee_id)) };
}

export async function calculatePayrollRun(period: string): Promise<void> {
  if (!isDemoMode()) return live.liveCalculateRun(period);
  const existing = RUNS.get(period);
  if (existing && existing.run.status !== 'calculated')
    throw new Error(`مسير ${period} معتمد — التصحيح يكون بتعديل في الشهر التالي`);
  const me = actor();
  const slips = runPayroll(
    EMPLOYEES.map((e) => ({ ...e })),
    period,
    ADJUSTMENTS,
    LEAVE,
    LEAVE_TYPES,
  ).map((s) => snapshot(EMPLOYEES.find((e) => e.id === s.employee_id)!, s));
  RUNS.set(period, {
    slips,
    run: {
      id: existing?.run.id ?? `run-${period}`,
      period,
      status: 'calculated',
      run_by: me.id,
      run_by_name: me.name,
      calculated_at: new Date().toISOString(),
      approved_by_name: '',
      approved_at: null,
      posted_at: null,
      paid_at: null,
      ...runTotals(slips),
    },
  });
}

export async function approvePayrollRun(period: string, runId: string): Promise<void> {
  if (!isDemoMode()) return live.liveApproveRun(runId);
  const r = RUNS.get(period);
  if (!r) throw new Error('مسير الرواتب غير موجود');
  if (r.run.status !== 'calculated') throw new Error('المسير ليس بانتظار الاعتماد');
  const me = actor();
  if (r.run.run_by === me.id)
    throw new Error('لا يعتمد المسيرَ من أعدّه — يعتمده شخص آخر (مبدأ الأربع أعين)');
  r.run = {
    ...r.run,
    status: 'approved',
    approved_by_name: me.name,
    approved_at: new Date().toISOString(),
  };
}

/** Accounting: accrual entry from the frozen run (live: post_payroll_run). */
export async function postPayrollRun(
  period: string,
  runId: string,
  postEntry: (slips: Payslip[], run: PayrollRun) => void,
): Promise<void> {
  if (!isDemoMode()) return live.livePostRun(runId);
  const r = RUNS.get(period);
  if (!r) throw new Error('مسير الرواتب غير موجود');
  if (r.run.status === 'calculated') throw new Error('لا يُرحَّل إلا مسير معتمد');
  if (r.run.posted_at) return;
  postEntry(r.slips, r.run);
  r.run = { ...r.run, posted_at: new Date().toISOString() };
}

/** Accounting: salaries transferred (WPS) — settles 2130 from a bank account. */
export async function payPayrollRun(
  period: string,
  runId: string,
  paidOn: string,
  bankCode: string,
  postEntry: (run: PayrollRun) => void,
): Promise<void> {
  if (!isDemoMode()) return live.livePayRun(runId, paidOn, bankCode);
  const r = RUNS.get(period);
  if (!r) throw new Error('مسير الرواتب غير موجود');
  if (!r.run.posted_at) throw new Error('رحّل قيد الاستحقاق أولاً');
  if (r.run.status === 'paid') return;
  if (!bankCode.startsWith('111')) throw new Error('اختر حساب بنك أو صندوق');
  postEntry(r.run);
  r.run = { ...r.run, status: 'paid', paid_at: paidOn };
}

/* =========================== End of service (0073) =======================
 * Demo mirror of eos_calculate / prepare / approve (four eyes) / post / pay and
 * the monthly provision true-up. Same rules and messages as the server.
 * ========================================================================= */
const EOS: EosSettlement[] = [];
/** demo balance of 2210 «مخصص مكافأة نهاية الخدمة» (provision true-ups − settlements) */
let EOS_PROVISION_BALANCE = 0;
const EOS_PROVISION_POSTED = new Set<string>();

export interface EosPrepareInput {
  employee_id: string;
  art77: boolean;
  other_additions: number;
  other_deductions: number;
  note: string;
}

/** Entitlement preview for an employee leaving on `end` for `reason`. */
export async function calculateEos(
  e: Employee,
  end: string,
  reason: TerminationReason,
  art77 = false,
): Promise<EosCalc> {
  if (!isDemoMode()) return live.liveEosCalculate(e.id, end, reason, art77);
  return eosCalculate(e, end, reason, art77, PAYROLL_CONFIG.eosWageBasis, LEAVE, LEAVE_TYPES);
}

export async function listEosSettlements(): Promise<EosSettlement[]> {
  if (!isDemoMode()) return live.liveListEos();
  return scopeByEmployee(EOS.filter((x) => x.status !== 'cancelled')).map((x) => ({ ...x }));
}

export async function prepareEosSettlement(input: EosPrepareInput): Promise<void> {
  if (!isDemoMode()) return live.livePrepareEos(input);
  const e = EMPLOYEES.find((x) => x.id === input.employee_id);
  if (!e || e.status !== 'terminated' || !e.termination_date || !e.termination_reason)
    throw new Error('سجّل إنهاء خدمة الموظف أولاً');
  if (input.art77 && e.termination_reason !== 'employer_termination')
    throw new Error('تعويض المادة 77 للإنهاء من صاحب العمل فقط');
  if (input.other_additions < 0 || input.other_deductions < 0)
    throw new Error('المبالغ لا تكون سالبة');
  if ((input.other_additions > 0 || input.other_deductions > 0) && !input.note.trim())
    throw new Error('اذكر سبب الإضافات أو الخصومات');
  if (EOS.some((x) => x.employee_id === e.id && (x.status === 'approved' || x.status === 'paid')))
    throw new Error('تسوية هذا الموظف معتمدة — لا تُعاد');
  const c = eosCalculate(
    e,
    e.termination_date,
    e.termination_reason,
    input.art77,
    PAYROLL_CONFIG.eosWageBasis,
    LEAVE,
    LEAVE_TYPES,
  );
  for (let i = EOS.length - 1; i >= 0; i--)
    if (EOS[i]!.employee_id === e.id && EOS[i]!.status === 'draft') EOS.splice(i, 1);
  const me = actor();
  EOS.unshift({
    ...c,
    id: `eos-${e.id}-${Date.now()}`,
    employee_id: e.id,
    employee_name: e.full_name,
    end_date: e.termination_date,
    reason: e.termination_reason,
    art77: input.art77,
    other_additions: input.other_additions,
    other_deductions: input.other_deductions,
    note: input.note.trim(),
    net: round2(c.total + input.other_additions - input.other_deductions),
    status: 'draft',
    prepared_by: me.id,
    prepared_by_name: me.name,
    approved_by_name: '',
    posted_at: null,
    paid_at: null,
  });
}

export async function approveEosSettlement(id: string): Promise<void> {
  if (!isDemoMode()) return live.liveEosAction('approve_eos_settlement', { p_id: id });
  const s = EOS.find((x) => x.id === id);
  if (!s) throw new Error('التسوية غير موجودة');
  if (s.status !== 'draft') throw new Error('التسوية ليست بانتظار الاعتماد');
  const me = actor();
  if (s.prepared_by === me.id)
    throw new Error('لا يعتمد التسويةَ من أعدّها — يعتمدها شخص آخر (مبدأ الأربع أعين)');
  if (s.net < 0) throw new Error('صافي التسوية سالب — راجع الخصومات');
  s.status = 'approved';
  s.approved_by_name = me.name;
}

export async function cancelEosSettlement(id: string): Promise<void> {
  if (!isDemoMode()) return live.liveEosAction('cancel_eos_settlement', { p_id: id });
  const s = EOS.find((x) => x.id === id);
  if (!s || s.status !== 'draft') throw new Error('لا تُلغى إلا التسوية غير المعتمدة');
  s.status = 'cancelled';
}

/** Accounting: settlement entry (award drawn from the provision 2210). */
export async function postEosSettlement(
  id: string,
  postEntry: (s: EosSettlement) => void,
): Promise<void> {
  if (!isDemoMode()) return live.liveEosAction('post_eos_settlement', { p_id: id });
  const s = EOS.find((x) => x.id === id);
  if (!s) throw new Error('التسوية غير موجودة');
  if (s.status !== 'approved' && s.status !== 'paid')
    throw new Error('لا تُرحَّل إلا تسوية معتمدة');
  if (s.posted_at) return;
  postEntry(s);
  EOS_PROVISION_BALANCE = round2(EOS_PROVISION_BALANCE - s.award);
  s.posted_at = new Date().toISOString();
}

export async function payEosSettlement(
  id: string,
  paidOn: string,
  bankCode: string,
  postEntry: (s: EosSettlement) => void,
): Promise<void> {
  if (!isDemoMode())
    return live.liveEosAction('pay_eos_settlement', {
      p_id: id,
      p_paid_on: paidOn,
      p_bank_code: bankCode,
    });
  const s = EOS.find((x) => x.id === id);
  if (!s) throw new Error('التسوية غير موجودة');
  if (!s.posted_at) throw new Error('رحّل قيد التسوية أولاً');
  if (s.status === 'paid') return;
  if (!bankCode.startsWith('111')) throw new Error('اختر حساب بنك أو صندوق');
  postEntry(s);
  s.status = 'paid';
  s.paid_at = paidOn;
}

export interface ProvisionStatus {
  target: number;
  balance: number;
  delta: number;
  posted: boolean;
}

/** Provision for a month: the liability vs the current balance of 2210. */
export async function getEosProvision(period: string): Promise<ProvisionStatus> {
  if (!isDemoMode()) return live.liveEosProvision(period);
  const end = monthEndOf(period);
  const target = provisionTarget(EMPLOYEES, end, PAYROLL_CONFIG.eosWageBasis);
  return {
    target,
    balance: EOS_PROVISION_BALANCE,
    delta: round2(target - EOS_PROVISION_BALANCE),
    posted: EOS_PROVISION_POSTED.has(period),
  };
}

export async function postEosProvision(
  period: string,
  postEntry: (delta: number) => void,
): Promise<void> {
  if (!isDemoMode()) return live.liveEosAction('post_eos_provision', { p_period: period });
  if (EOS_PROVISION_POSTED.has(period)) throw new Error(`مخصص ${period} مُرحَّل بالفعل`);
  const st = await getEosProvision(period);
  if (st.delta !== 0) postEntry(st.delta);
  EOS_PROVISION_BALANCE = st.target;
  EOS_PROVISION_POSTED.add(period);
}

function monthEndOf(period: string): string {
  const d = new Date(`${period}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
