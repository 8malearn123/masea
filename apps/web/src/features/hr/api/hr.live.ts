/**
 * HR ↔ Supabase (live mode). Reads/writes the existing tables only:
 * employees + employee_details (0004/0021), attendance, leave_requests,
 * employee_documents, employee_emergency_contacts, payroll_adjustments (0022),
 * performance_reviews (0068) and worker_profiles (0011 — the same worker record
 * the catalog, contracts and quotes use). RLS (0068) scopes every query to the
 * viewer: HR sees all branches, a branch manager his branch, an employee himself.
 *
 * hr.api.ts calls these only when NOT in demo mode; errors are thrown so the
 * screen shows its error state instead of silently faking data.
 */
import { supabase } from '@/shared/lib/supabase';
import { useAuth } from '@/store/auth';
import { ROLE_META, type RoleCode } from '@/lib/permissions';
import { tokenFromQr } from '@/features/hr/lib/attendanceEngine';
import {
  DOC_TYPE_LABEL,
  TERMINATION_REASON_LABEL,
  docTypeCode,
  type AccountOption,
  type AttendanceConfig,
  type BranchAttendance,
  type PublicHoliday,
  type TerminationReason,
  type AdjustmentStatus,
  type AttendanceRecord,
  type AttendanceStatus,
  type EmergencyContact,
  type Employee,
  type EmployeeDocument,
  type HouseWorker,
  type IqamaRecord,
  type LeaveRequest,
  type LeaveBalance,
  type LeaveStatus,
  type LeaveTypeConfig,
  type PayrollAdjustment,
  type AdjustmentType,
  type Payslip,
  type PayrollRun,
  type EosCalc,
  type EosSettlement,
  type PerformanceReview,
  type WorkerStatus,
} from '@/features/hr/types';

/* --------------------------------- utils --------------------------------- */
type Row = Record<string, unknown>;

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`تعذّر ${what}: ${error.message}`);
}

/** PostgREST returns a to-one embed as an object (or a 1-item array). */
function one(v: unknown): Row | null {
  if (Array.isArray(v)) return (v[0] as Row | undefined) ?? null;
  return (v as Row | null) ?? null;
}
const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const today = (): string => new Date().toISOString().slice(0, 10);

function empName(r: Row): string {
  return str(one(r.employees)?.full_name);
}

async function branchIdOf(name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const { data } = await supabase.from('branches').select('id').eq('city', name).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** "HH:MM" in Riyadh time from a timestamptz. */
function hhmm(ts: unknown): string | null {
  if (!ts) return null;
  return new Date(String(ts)).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysInclusive(from: string, to: string): number {
  if (!from || !to) return 0;
  const d = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
  return d > 0 ? d : 0;
}

/* ------------------------------- employees -------------------------------- */
const EMP_SELECT =
  'id, full_name, role, job_title, branch_id, basic_salary, transport_allowance, phone, ' +
  'national_id, nationality, hire_date, is_active, employee_no, user_id, termination_date, ' +
  'termination_reason, termination_note, branches(city), ' +
  'employee_details(english_name, dob, gender, marital_status, email, id_type, iqama_no, ' +
  'passport_no, border_no, department, contract_type, manager_id, employment_status, iban, ' +
  'bank_name, housing_allowance, other_allowance, gosi_system, gosi_reg_date, ' +
  'gosi_subscription_no, counts_in_saudization)';

function asRole(v: unknown): RoleCode {
  const r = str(v) as RoleCode;
  return r in ROLE_META ? r : 'sales';
}

export function mapEmployee(r: Row, onLeave: Set<string>, names: Map<string, string>): Employee {
  const d = one(r.employee_details) ?? {};
  const id = str(r.id);
  const terminated = r.is_active === false || d.employment_status === 'terminated';
  const housing = num(d.housing_allowance);
  const transport = num(r.transport_allowance);
  const other = num(d.other_allowance);
  const role = asRole(r.role);
  const e: Employee = {
    id,
    full_name: str(r.full_name),
    job_title: str(r.job_title) || ROLE_META[role].label,
    department: str(d.department) || 'الإدارة',
    branch: str(one(r.branches)?.city),
    branch_id: (r.branch_id as string | null) ?? null,
    nationality: str(r.nationality) || 'السعودية',
    base_salary: num(r.basic_salary),
    allowances: housing + transport + other,
    housing_allowance: housing,
    transport_allowance: transport,
    other_allowance: other,
    status: terminated ? 'terminated' : onLeave.has(id) ? 'on_leave' : 'active',
    role,
    join_date: str(r.hire_date),
    phone: str(r.phone),
    email: str(d.email),
    // monthly counters are a demo artifact — live pay comes from calculate_payslip()
    absence_days: 0,
    late_count: 0,
    overtime_hours: 0,
  };
  // optional profile fields: set only when present (exactOptionalPropertyTypes)
  const text: [keyof Employee, unknown][] = [
    ['employee_no', r.employee_no],
    ['english_name', d.english_name],
    ['national_id', r.national_id],
    ['iqama_no', d.iqama_no],
    ['passport_no', d.passport_no],
    ['border_no', d.border_no],
    ['dob', d.dob],
    ['marital_status', d.marital_status],
    ['iban', d.iban],
    ['bank_name', d.bank_name],
    ['gosi_reg_date', d.gosi_reg_date],
    ['gosi_subscription_no', d.gosi_subscription_no],
    ['user_id', r.user_id],
    ['manager_id', d.manager_id],
    ['termination_date', r.termination_date],
    ['termination_note', r.termination_note],
  ];
  const opt = e as unknown as Record<string, unknown>;
  text.forEach(([k, v]) => {
    if (v != null && v !== '') opt[k] = String(v);
  });
  if (d.id_type === 'saudi' || d.id_type === 'expat') e.id_type = d.id_type;
  if (d.gender === 'male' || d.gender === 'female') e.gender = d.gender;
  if (
    d.contract_type === 'full_time' ||
    d.contract_type === 'part_time' ||
    d.contract_type === 'temp'
  )
    e.contract_type = d.contract_type;
  if (d.gosi_system === 'old' || d.gosi_system === 'new') e.gosi_system = d.gosi_system;
  if (typeof d.counts_in_saudization === 'boolean')
    e.counts_in_saudization = d.counts_in_saudization;
  const reason = str(r.termination_reason);
  if (reason && reason in TERMINATION_REASON_LABEL)
    e.termination_reason = reason as TerminationReason;
  const manager = d.manager_id ? names.get(str(d.manager_id)) : undefined;
  if (manager) e.manager = manager;
  return e;
}

export async function liveListEmployees(): Promise<Employee[]> {
  const [emps, leave] = await Promise.all([
    supabase.from('employees').select(EMP_SELECT).order('full_name'),
    supabase
      .from('leave_requests')
      .select('employee_id')
      .eq('status', 'approved')
      .lte('start_date', today())
      .gte('end_date', today()),
  ]);
  fail(emps.error, 'تحميل الموظفين');
  const rows = (emps.data ?? []) as unknown as Row[];
  const onLeave = new Set(((leave.data ?? []) as Row[]).map((l) => str(l.employee_id)));
  const names = new Map(rows.map((r) => [str(r.id), str(r.full_name)]));
  return rows.map((r) => mapEmployee(r, onLeave, names));
}

/**
 * Create/update the employee file. Two layers, same as the DB guards (0068/0069):
 *  - team data (identity, job, contact) — hr.edit within scope (branch manager too);
 *  - money (salary, allowances, IBAN/bank, GOSI) — hr.manage only.
 * Status is never written here: terminate_employee()/reactivate_employee() own it.
 */
export async function liveSaveEmployee(
  emp: Employee,
  isNew: boolean,
  canManagePay: boolean,
): Promise<Employee> {
  const branch_id = await branchIdOf(emp.branch);
  const saudi = emp.nationality === 'السعودية';
  const base: Row = {
    full_name: emp.full_name,
    role: emp.role,
    job_title: emp.job_title || null,
    branch_id,
    phone: emp.phone || null,
    nationality: emp.nationality,
    national_id: saudi ? emp.national_id || null : null,
    hire_date: emp.join_date || null,
    user_id: emp.user_id || null,
  };
  if (canManagePay) {
    base.basic_salary = emp.base_salary;
    base.transport_allowance = emp.transport_allowance ?? 0;
  }
  let id = emp.id;
  if (isNew) {
    const { data, error } = await supabase
      .from('employees')
      .insert(base)
      .select('id, employee_no')
      .single();
    fail(error, 'إضافة الموظف');
    id = str((data as Row).id);
    emp = { ...emp, employee_no: str((data as Row).employee_no) };
  } else {
    const { error } = await supabase.from('employees').update(base).eq('id', id);
    fail(error, 'تحديث الموظف');
  }
  const details: Row = {
    employee_id: id,
    english_name: emp.english_name || null,
    dob: emp.dob || null,
    gender: emp.gender ?? null,
    marital_status: emp.marital_status || null,
    email: emp.email || null,
    id_type: saudi ? 'saudi' : 'expat',
    iqama_no: saudi ? null : emp.iqama_no || null,
    passport_no: emp.passport_no || null,
    department: emp.department,
    contract_type: emp.contract_type ?? 'full_time',
    manager_id: emp.manager_id || null,
    counts_in_saudization: saudi,
  };
  if (canManagePay) {
    Object.assign(details, {
      housing_allowance: emp.housing_allowance ?? 0,
      other_allowance: emp.other_allowance ?? 0,
      iban: emp.iban || null,
      bank_name: emp.bank_name || null,
      gosi_system: emp.gosi_system ?? 'new',
      gosi_reg_date: emp.gosi_reg_date || null,
    });
  }
  const { error } = await supabase
    .from('employee_details')
    .upsert(details, { onConflict: 'employee_id' });
  fail(error, 'حفظ ملف الموظف');
  return { ...emp, id, branch_id };
}

export async function liveTerminateEmployee(
  id: string,
  t: { date: string; reason: TerminationReason; note: string },
): Promise<void> {
  const { error } = await supabase.rpc('terminate_employee', {
    p_employee_id: id,
    p_date: t.date,
    p_reason: t.reason,
    p_note: t.note || null,
  });
  fail(error, 'إنهاء الخدمة');
}

export async function liveReactivateEmployee(id: string): Promise<void> {
  const { error } = await supabase.rpc('reactivate_employee', { p_employee_id: id });
  fail(error, 'إعادة التفعيل');
}

/** Login accounts (hr_account_options, 0069 — user_profiles itself is GM-only). */
export async function liveAccountOptions(): Promise<AccountOption[]> {
  const { data, error } = await supabase.rpc('hr_account_options');
  fail(error, 'تحميل الحسابات');
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    full_name: str(r.full_name),
    role: str(r.role),
    branch: (r.branch as string | null) ?? null,
    linked_employee: (r.linked_employee as string | null) ?? null,
  }));
}

/* ------------------------------- attendance ------------------------------- */
const ATT_COLS =
  'id, employee_id, date, check_in, check_out, status, check_in_method, check_out_method, ' +
  'distance_m, late_minutes, note, employees(full_name, branches(city), employee_details(department))';

function mapAttendance(r: Row): AttendanceRecord {
  const emp = one(r.employees);
  const rec: AttendanceRecord = {
    id: str(r.id),
    employee_id: str(r.employee_id),
    employee_name: str(emp?.full_name),
    department: str(one(emp?.employee_details)?.department),
    date: str(r.date),
    branch: str(one(emp?.branches)?.city),
    check_in: hhmm(r.check_in),
    check_out: hhmm(r.check_out),
    status: str(r.status) as AttendanceStatus,
  };
  const m = (v: unknown) => (v === 'qr' || v === 'gps' || v === 'manual' ? v : undefined);
  const ci = m(r.check_in_method);
  const co = m(r.check_out_method);
  if (ci) rec.check_in_method = ci;
  if (co) rec.check_out_method = co;
  if (r.distance_m != null) rec.distance_m = num(r.distance_m);
  if (r.late_minutes != null) rec.late_minutes = num(r.late_minutes);
  if (r.note) rec.note = str(r.note);
  return rec;
}

export async function liveListAttendance(date: string = today()): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase.from('attendance').select(ATT_COLS).eq('date', date);
  fail(error, 'تحميل الحضور');
  return ((data ?? []) as unknown as Row[]).map(mapAttendance);
}

export async function liveMonthAttendance(
  employeeId: string,
  period: string,
): Promise<AttendanceRecord[]> {
  const start = `${period}-01`;
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const { data, error } = await supabase
    .from('attendance')
    .select(ATT_COLS)
    .eq('employee_id', employeeId)
    .gte('date', start)
    .lte('date', end.toISOString().slice(0, 10));
  fail(error, 'تحميل سجل الشهر');
  return ((data ?? []) as unknown as Row[]).map(mapAttendance);
}

export async function liveAttendanceCheck(
  method: 'qr' | 'gps',
  input: { lat?: number; lng?: number; token?: string },
): Promise<{ action: 'in' | 'out'; late_minutes?: number; distance_m?: number; at: string }> {
  const { data, error } = await supabase.rpc('attendance_check', {
    p_method: method,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_token: input.token ? tokenFromQr(input.token) : null,
  });
  if (error) throw new Error(error.message); // server message is already the user-facing Arabic reason
  const r = (data ?? {}) as Row;
  const out: { action: 'in' | 'out'; late_minutes?: number; distance_m?: number; at: string } = {
    action: r.action === 'out' ? 'out' : 'in',
    at: hhmm(r.at) ?? '',
  };
  if (r.late_minutes != null) out.late_minutes = num(r.late_minutes);
  if (r.distance_m != null) out.distance_m = num(r.distance_m);
  return out;
}

export async function liveManualAttendance(m: {
  employee_id: string;
  date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  note: string;
}): Promise<void> {
  const { error } = await supabase.rpc('manual_attendance', {
    p_employee_id: m.employee_id,
    p_date: m.date,
    p_status: m.status,
    p_check_in: m.check_in,
    p_check_out: m.check_out,
    p_note: m.note,
  });
  if (error) throw new Error(error.message);
}

export async function liveCloseDay(
  date: string,
): Promise<{ absent: number; leave: number; workday: boolean }> {
  const { data, error } = await supabase.rpc('close_attendance_day', { p_date: date });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Row;
  return { absent: num(r.absent), leave: num(r.leave), workday: r.workday !== false };
}

export async function liveAttendanceConfig(): Promise<AttendanceConfig> {
  const { data, error } = await supabase.from('attendance_config').select('*').eq('id', 1).single();
  fail(error, 'تحميل إعدادات الحضور');
  const r = data as Row;
  const arr = (v: unknown) => ((v as string[] | null) ?? []).map(String);
  return {
    qr_enabled: r.qr_enabled !== false,
    qr_roles: arr(r.qr_roles),
    gps_enabled: r.gps_enabled !== false,
    gps_roles: arr(r.gps_roles),
    gps_radius_m: num(r.gps_radius_m),
    manual_enabled: r.manual_enabled !== false,
    manual_roles: arr(r.manual_roles),
    worker_barcode_required: r.worker_barcode_required !== false,
    workdays: ((r.workdays as number[] | null) ?? []).map(Number),
  };
}

export async function liveSaveAttendanceConfig(cfg: AttendanceConfig): Promise<void> {
  const { error } = await supabase
    .from('attendance_config')
    .update({ ...cfg, updated_at: new Date().toISOString() })
    .eq('id', 1);
  fail(error, 'حفظ إعدادات الحضور');
}

export async function liveListHolidays(): Promise<PublicHoliday[]> {
  const { data, error } = await supabase.from('public_holidays').select('*').order('from_date');
  fail(error, 'تحميل العطل الرسمية');
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    name_ar: str(r.name_ar),
    from_date: str(r.from_date),
    to_date: str(r.to_date),
    is_active: r.is_active !== false,
  }));
}

export async function liveSaveHoliday(h: PublicHoliday, isNew: boolean): Promise<void> {
  const row = {
    name_ar: h.name_ar.trim(),
    from_date: h.from_date,
    to_date: h.to_date,
    is_active: h.is_active,
  };
  const { error } = isNew
    ? await supabase.from('public_holidays').insert(row)
    : await supabase.from('public_holidays').update(row).eq('id', h.id);
  fail(error, 'حفظ العطلة');
}

export async function liveBranchAttendance(): Promise<BranchAttendance[]> {
  const { data, error } = await supabase.rpc('branch_attendance_settings');
  fail(error, 'تحميل مواقع الفروع');
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    city: str(r.city),
    latitude: r.latitude == null ? null : num(r.latitude),
    longitude: r.longitude == null ? null : num(r.longitude),
    attendance_token: str(r.attendance_token),
  }));
}

export async function liveSetBranchAttendance(
  id: string,
  lat: number | null,
  lng: number | null,
  rotate: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_branch_attendance', {
    p_branch_id: id,
    p_lat: lat,
    p_lng: lng,
    p_rotate: rotate,
  });
  fail(error, 'حفظ موقع الفرع');
}

/** The signed-in user's own employee file (RLS: employees.user_id = auth.uid()). */
export async function liveMyEmployee(): Promise<Employee | null> {
  const uid = useAuth.getState().profile?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('employees')
    .select(EMP_SELECT)
    .eq('user_id', uid)
    .maybeSingle();
  fail(error, 'تحميل ملفك');
  return data ? mapEmployee(data as unknown as Row, new Set(), new Map()) : null;
}

/* --------------------------------- leave ---------------------------------- */
const LEAVE_STATUSES: LeaveStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export async function liveListLeave(): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(
      'id, employee_id, type, start_date, end_date, days, status, notes, decision_note, employees(full_name)',
    )
    .order('start_date', { ascending: false });
  fail(error, 'تحميل الإجازات');
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const from = str(r.start_date);
    const to = str(r.end_date);
    const st = str(r.status) as LeaveStatus;
    const l: LeaveRequest = {
      id: str(r.id),
      employee_id: str(r.employee_id),
      employee_name: empName(r),
      type: str(r.type), // a leave_types code (0070)
      from_date: from,
      to_date: to,
      days: r.days == null ? daysInclusive(from, to) : num(r.days),
      status: LEAVE_STATUSES.includes(st) ? st : 'pending',
      reason: str(r.notes),
    };
    if (r.decision_note) l.decision_note = str(r.decision_note);
    return l;
  });
}

/** Insert — the server validates (validate_leave_request) and computes the days. */
export async function liveAddLeave(l: LeaveRequest): Promise<LeaveRequest> {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: l.employee_id,
      type: l.type,
      start_date: l.from_date,
      end_date: l.to_date,
      status: l.status,
      notes: l.reason || null,
    })
    .select('id, days')
    .single();
  fail(error, 'حفظ الإجازة');
  return { ...l, id: str((data as Row).id), days: num((data as Row).days) };
}

export async function liveUpdateLeave(
  id: string,
  status: LeaveStatus,
  note?: string,
): Promise<void> {
  const patch: Row = { status };
  if (note) patch.decision_note = note;
  const { error } = await supabase.from('leave_requests').update(patch).eq('id', id);
  fail(error, 'تحديث الإجازة');
}

const LEAVE_TYPE_COLS =
  'code, name_ar, category, entitlement_days, entitlement_days_after, after_years, ' +
  'sick_partial_days, sick_partial_pay_pct, sick_unpaid_days, paid, deducts_from_annual, gender, ' +
  'min_service_months, once_per_service, requires_attachment, is_active, sort_order';

export async function liveListLeaveTypes(): Promise<LeaveTypeConfig[]> {
  const { data, error } = await supabase
    .from('leave_types')
    .select(LEAVE_TYPE_COLS)
    .order('sort_order');
  fail(error, 'تحميل أنواع الإجازات');
  const n = (v: unknown) => (v == null ? null : Number(v));
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    code: str(r.code),
    name_ar: str(r.name_ar),
    category: str(r.category) as LeaveTypeConfig['category'],
    entitlement_days: n(r.entitlement_days),
    entitlement_days_after: n(r.entitlement_days_after),
    after_years: n(r.after_years),
    sick_partial_days: n(r.sick_partial_days),
    sick_partial_pay_pct: n(r.sick_partial_pay_pct),
    sick_unpaid_days: n(r.sick_unpaid_days),
    paid: r.paid !== false,
    deducts_from_annual: r.deducts_from_annual === true,
    gender: r.gender === 'male' || r.gender === 'female' ? r.gender : null,
    min_service_months: num(r.min_service_months),
    once_per_service: r.once_per_service === true,
    requires_attachment: r.requires_attachment === true,
    is_active: r.is_active !== false,
    sort_order: num(r.sort_order),
  }));
}

export async function liveSaveLeaveType(t: LeaveTypeConfig, isNew: boolean): Promise<void> {
  const row = { ...t, updated_at: new Date().toISOString() };
  const { error } = isNew
    ? await supabase.from('leave_types').insert(row)
    : await supabase.from('leave_types').update(row).eq('code', t.code);
  fail(error, 'حفظ نوع الإجازة');
}

export async function liveLeaveBalance(employeeId: string, asOf: string): Promise<LeaveBalance> {
  const { data, error } = await supabase.rpc('leave_balance', {
    p_employee_id: employeeId,
    p_as_of: asOf,
  });
  fail(error, 'تحميل رصيد الإجازات');
  const b = (data ?? {}) as Row;
  return {
    annual_accrued: num(b.annual_accrued),
    annual_used: num(b.annual_used),
    annual_pending: num(b.annual_pending),
    annual_remaining: num(b.annual_remaining),
    sick_used_this_year: num(b.sick_used_this_year),
    sick_full_left: num(b.sick_full_left),
    sick_total_limit: num(b.sick_total_limit),
  };
}

/* -------------------------- documents / iqamas ---------------------------- */
export async function liveListDocuments(): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase
    .from('employee_documents')
    .select(
      'id, employee_id, type, doc_number, file_name, issue_date, expiry_date, employees(full_name)',
    )
    .order('expiry_date', { ascending: true, nullsFirst: false });
  fail(error, 'تحميل المستندات');
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: str(r.id),
    employee_id: str(r.employee_id),
    employee_name: empName(r),
    type: DOC_TYPE_LABEL[str(r.type)] ?? str(r.type),
    number: str(r.doc_number) || str(r.file_name),
    issue_date: str(r.issue_date),
    expiry_date: (r.expiry_date as string | null) ?? null,
  }));
}

export async function liveAddDocument(d: Omit<EmployeeDocument, 'id'>): Promise<EmployeeDocument> {
  const { data, error } = await supabase
    .from('employee_documents')
    .insert({
      employee_id: d.employee_id,
      type: docTypeCode(d.type),
      doc_number: d.number,
      issue_date: d.issue_date || null,
      expiry_date: d.expiry_date,
    })
    .select('id')
    .single();
  fail(error, 'رفع المستند');
  return { ...d, id: str((data as Row).id) };
}

/** Iqamas = the employees' iqama documents (+ whether a valid work permit exists). */
export async function liveListIqamas(): Promise<IqamaRecord[]> {
  const { data, error } = await supabase
    .from('employee_documents')
    .select(
      'id, employee_id, type, doc_number, issue_date, expiry_date, employees(full_name, job_title, employee_details(iqama_no))',
    )
    .in('type', ['iqama', 'work_permit']);
  fail(error, 'تحميل الإقامات');
  const rows = (data ?? []) as unknown as Row[];
  const permitOk = new Set(
    rows
      .filter((r) => r.type === 'work_permit' && (!r.expiry_date || str(r.expiry_date) >= today()))
      .map((r) => str(r.employee_id)),
  );
  return rows
    .filter((r) => r.type === 'iqama' && r.expiry_date)
    .map((r) => {
      const e = one(r.employees) ?? {};
      return {
        id: str(r.id),
        employee_id: str(r.employee_id),
        employee_name: str(e.full_name),
        iqama_no: str(r.doc_number) || str(one(e.employee_details)?.iqama_no),
        profession: str(e.job_title) || '—',
        issue_date: str(r.issue_date),
        expiry_date: str(r.expiry_date),
        work_permit: permitOk.has(str(r.employee_id)),
      };
    });
}

/* --------------------------- emergency contacts --------------------------- */
export async function liveListEmergency(): Promise<EmergencyContact[]> {
  const { data, error } = await supabase
    .from('employee_emergency_contacts')
    .select('id, employee_id, name, relation, phone, employees(full_name)');
  fail(error, 'تحميل جهات الطوارئ');
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: str(r.id),
    employee_id: str(r.employee_id),
    employee_name: empName(r),
    name: str(r.name),
    relation: str(r.relation),
    phone: str(r.phone),
  }));
}

export async function liveAddEmergency(c: Omit<EmergencyContact, 'id'>): Promise<EmergencyContact> {
  const { data, error } = await supabase
    .from('employee_emergency_contacts')
    .insert({
      employee_id: c.employee_id,
      name: c.name,
      relation: c.relation || null,
      phone: c.phone,
    })
    .select('id')
    .single();
  fail(error, 'إضافة جهة الطوارئ');
  return { ...c, id: str((data as Row).id) };
}

/* ------------------------------ performance ------------------------------- */
export async function liveListPerformance(): Promise<PerformanceReview[]> {
  const { data, error } = await supabase
    .from('performance_reviews')
    .select('id, employee_id, period, score, reviewer_name, review_date, employees(full_name)')
    .eq('is_active', true)
    .order('review_date', { ascending: false });
  fail(error, 'تحميل التقييمات');
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: str(r.id),
    employee_id: str(r.employee_id),
    employee_name: empName(r),
    period: str(r.period),
    score: num(r.score),
    reviewer: str(r.reviewer_name),
    date: str(r.review_date),
  }));
}

export async function liveAddPerformance(p: PerformanceReview): Promise<PerformanceReview> {
  const { data, error } = await supabase
    .from('performance_reviews')
    .insert({
      employee_id: p.employee_id,
      period: p.period,
      score: p.score,
      reviewer_name: p.reviewer,
      review_date: p.date,
    })
    .select('id')
    .single();
  fail(error, 'حفظ التقييم');
  return { ...p, id: str((data as Row).id) };
}

/* -------------------------- payroll adjustments --------------------------- */
const ADJ_TYPES: AdjustmentType[] = ['bonus', 'allowance', 'overtime', 'penalty', 'advance'];

export async function liveListAdjustments(): Promise<PayrollAdjustment[]> {
  const { data, error } = await supabase
    .from('payroll_adjustments')
    .select(
      'id, employee_id, type, amount, reason, period, status, submitted_by, employees(full_name)',
    )
    .order('created_at', { ascending: false });
  fail(error, 'تحميل طلبات التعديل');
  const rows = (data ?? []) as unknown as Row[];
  const submitters = [...new Set(rows.map((r) => str(r.submitted_by)).filter(Boolean))];
  const names = new Map<string, string>();
  if (submitters.length) {
    // user_profiles is GM-only — names come through user_display_names() (0069)
    const { data: users } = await supabase.rpc('user_display_names', { p_ids: submitters });
    ((users ?? []) as Row[]).forEach((u) => names.set(str(u.id), str(u.full_name)));
  }
  return rows.map((r) => {
    const t = str(r.type) as AdjustmentType;
    return {
      id: str(r.id),
      employee_id: str(r.employee_id),
      employee_name: empName(r),
      type: ADJ_TYPES.includes(t) ? t : 'bonus',
      amount: num(r.amount),
      reason: str(r.reason),
      period: str(r.period),
      submitted_by: names.get(str(r.submitted_by)) ?? '—',
      status: str(r.status) as AdjustmentStatus,
    };
  });
}

export async function liveAddAdjustment(
  a: Omit<PayrollAdjustment, 'id' | 'status'>,
): Promise<PayrollAdjustment> {
  const { data, error } = await supabase
    .from('payroll_adjustments')
    .insert({
      employee_id: a.employee_id,
      type: a.type,
      amount: a.amount,
      reason: a.reason || null,
      period: a.period,
      status: 'pending',
      submitted_by: useAuth.getState().profile?.id ?? null,
    })
    .select('id')
    .single();
  fail(error, 'رفع طلب التعديل');
  return {
    ...a,
    id: str((data as Row).id),
    status: 'pending',
    submitted_by: useAuth.getState().profile?.full_name ?? a.submitted_by,
  };
}

/* ------------------------- payroll (server engine) ------------------------ */
/** The payslip comes from calculate_payslip() — the backend is the source of truth. */
export async function livePayslips(employees: Employee[], period: string): Promise<Payslip[]> {
  const active = employees.filter((e) => e.status !== 'terminated');
  return Promise.all(
    active.map(async (e) => {
      const { data, error } = await supabase.rpc('calculate_payslip', {
        p_employee_id: e.id,
        p_period: period,
      });
      fail(error, `حساب راتب ${e.full_name}`);
      const s = (data ?? {}) as Row;
      return {
        employee_id: e.id,
        employee_name: e.full_name,
        nationality: e.nationality,
        basic: num(s.basic),
        housing_allowance: num(s.housing_allowance),
        transport_allowance: num(s.transport_allowance),
        other_allowance: num(s.other_allowance),
        present_days: num(s.present_days),
        absent_days: num(s.absent_days),
        late_count: 0,
        late_minutes: num(s.late_minutes),
        overtime_hours: num(s.overtime_hours),
        overtime_amount: num(s.overtime_amount),
        additions: num(s.additions),
        absence_deduction: num(s.absence_deduction),
        late_deduction: num(s.late_deduction),
        gosi_system: s.gosi_system === 'old' ? 'old' : 'new',
        gosi_employee: num(s.gosi_employee),
        manual_deductions: num(s.manual_deductions),
        unpaid_leave_days: num(s.unpaid_leave_days),
        sick_deduction_days: num(s.sick_deduction_days),
        leave_deduction: num(s.leave_deduction),
        advance_deductions: num(s.advance_deductions),
        penalty_deductions: num(s.penalty_deductions),
        gosi_employer: num(s.gosi_employer),
        eligible_days: num(s.eligible_days),
        gross: num(s.gross),
        total_deductions: num(s.total_deductions),
        net: num(s.net),
      } satisfies Payslip;
    }),
  );
}

/* ---------------------- house workers = worker_profiles ------------------- */
const WORKER_STATUSES: WorkerStatus[] = ['available', 'reserved', 'on_service', 'medical'];

export function mapWorker(r: Row): HouseWorker {
  const st = str(r.status) as WorkerStatus;
  return {
    id: str(r.id),
    full_name: str(r.full_name),
    photo_url: (r.photo_url as string | null) ?? null,
    nationality: str(r.nationality),
    profession: str(r.profession),
    age: num(r.age),
    experience_years: num(r.experience_years),
    monthly_salary: num(r.monthly_salary),
    languages: (r.languages as string[] | null) ?? [],
    skills: (r.skills as string[] | null) ?? [],
    passport_no: str(r.passport_no),
    iqama_no: str(r.iqama_no),
    status: WORKER_STATUSES.includes(st) ? st : 'available',
    branch: str(one(r.branches)?.city),
    bio: str(r.bio_ar),
  };
}

export async function liveListWorkers(): Promise<HouseWorker[]> {
  const { data, error } = await supabase
    .from('worker_profiles')
    .select(
      'id, full_name, nationality, profession, age, experience_years, languages, skills, monthly_salary, status, photo_url, bio_ar, passport_no, iqama_no, branches(city)',
    )
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  fail(error, 'تحميل العاملات');
  return ((data ?? []) as unknown as Row[]).map(mapWorker);
}

export async function liveSaveWorker(w: HouseWorker, isNew: boolean): Promise<HouseWorker> {
  const row = {
    full_name: w.full_name,
    nationality: w.nationality,
    profession: w.profession,
    age: w.age,
    experience_years: w.experience_years,
    languages: w.languages,
    skills: w.skills,
    monthly_salary: w.monthly_salary,
    status: w.status,
    photo_url: w.photo_url,
    bio_ar: w.bio || null,
    passport_no: w.passport_no || null,
    iqama_no: w.iqama_no || null,
    branch_id: await branchIdOf(w.branch),
  };
  if (isNew) {
    const { data, error } = await supabase
      .from('worker_profiles')
      .insert(row)
      .select('id')
      .single();
    fail(error, 'إضافة العاملة');
    return { ...w, id: str((data as Row).id) };
  }
  const { error } = await supabase.from('worker_profiles').update(row).eq('id', w.id);
  fail(error, 'تحديث العاملة');
  return w;
}

/* ------------------------------ payroll runs ------------------------------ */
export async function liveGetPayrollRun(
  period: string,
): Promise<{ run: PayrollRun; slips: Payslip[] } | null> {
  const { data, error } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('period', period)
    .is('branch_id', null)
    .maybeSingle();
  fail(error, 'تحميل المسير');
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
    total_gosi_employee: num(r.total_gosi_employee),
    total_gosi_employer: num(r.total_gosi_employer),
    total_advances: num(r.total_advances),
    total_penalties: num(r.total_penalties),
  };
  // payslips: RLS returns only what the viewer may see (none for accounting)
  const { data: ps, error: e2 } = await supabase
    .from('payslips')
    .select('*')
    .eq('run_id', run.id)
    .order('employee_name');
  fail(e2, 'تحميل القسائم');
  const slips = ((ps ?? []) as Row[]).map((p) => {
    const slip: Payslip = {
      employee_id: str(p.employee_id),
      employee_name: str(p.employee_name),
      nationality: str(p.nationality),
      basic: num(p.basic),
      housing_allowance: num(p.housing_allowance),
      transport_allowance: num(p.transport_allowance),
      other_allowance: num(p.other_allowance),
      present_days: num(p.present_days),
      absent_days: num(p.absent_days),
      late_count: 0,
      late_minutes: num(p.late_minutes),
      overtime_hours: num(p.overtime_hours),
      overtime_amount: num(p.overtime_amount),
      additions: num(p.additions),
      absence_deduction: num(p.absence_deduction),
      late_deduction: num(p.late_deduction),
      gosi_system: p.gosi_system === 'old' ? 'old' : 'new',
      gosi_employee: num(p.gosi_employee),
      manual_deductions: num(p.manual_deductions),
      unpaid_leave_days: num(p.unpaid_leave_days),
      sick_deduction_days: num(p.sick_deduction_days),
      leave_deduction: num(p.leave_deduction),
      advance_deductions: num(p.advance_deductions),
      penalty_deductions: num(p.penalty_deductions),
      gosi_employer: num(p.gosi_employer),
      eligible_days: num(p.eligible_days),
      gross: num(p.gross),
      total_deductions: num(p.total_deductions),
      net: num(p.net),
    };
    if (p.employee_no) slip.employee_no = str(p.employee_no);
    if (p.id_number) slip.id_number = str(p.id_number);
    if (p.iban) slip.iban = str(p.iban);
    if (p.bank_name) slip.bank_name = str(p.bank_name);
    return slip;
  });
  return { run, slips };
}

export async function liveCalculateRun(period: string): Promise<void> {
  const { error } = await supabase.rpc('calculate_payroll_run', { p_period: period });
  fail(error, 'احتساب المسير');
}
export async function liveApproveRun(runId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_payroll_run', { p_run_id: runId });
  fail(error, 'اعتماد المسير');
}
export async function livePostRun(runId: string): Promise<void> {
  const { error } = await supabase.rpc('post_payroll_run', { p_run_id: runId });
  fail(error, 'ترحيل قيد الرواتب');
}
export async function livePayRun(runId: string, paidOn: string, bankCode: string): Promise<void> {
  const { error } = await supabase.rpc('pay_payroll_run', {
    p_run_id: runId,
    p_paid_on: paidOn,
    p_bank_code: bankCode,
  });
  fail(error, 'تسجيل صرف الرواتب');
}

/* ------------------------------ end of service ---------------------------- */
function mapEosCalc(r: Row): EosCalc {
  const b = str(r.wage_basis);
  return {
    service_years: num(r.service_years),
    wage: num(r.wage),
    full_wage: num(r.full_wage ?? r.wage),
    wage_basis: b === 'basic' || b === 'basic_housing' ? b : 'full',
    award_full: num(r.award_full),
    award_ratio: num(r.award_ratio),
    award: num(r.award),
    leave_days: num(r.leave_days),
    leave_amount: num(r.leave_amount),
    art77_amount: num(r.art77_amount),
    total: num(r.total ?? num(r.award) + num(r.leave_amount) + num(r.art77_amount)),
  };
}

export async function liveEosCalculate(
  employeeId: string,
  end: string,
  reason: TerminationReason,
  art77: boolean,
): Promise<EosCalc> {
  const { data, error } = await supabase.rpc('eos_calculate', {
    p_employee_id: employeeId,
    p_end: end,
    p_reason: reason,
    p_art77: art77,
  });
  if (error) throw new Error(error.message);
  return mapEosCalc((data ?? {}) as Row);
}

export async function liveListEos(): Promise<EosSettlement[]> {
  const { data, error } = await supabase
    .from('eos_settlements')
    .select('*, employees(full_name)')
    .neq('status', 'cancelled')
    .order('prepared_at', { ascending: false });
  fail(error, 'تحميل تسويات نهاية الخدمة');
  const rows = (data ?? []) as unknown as Row[];
  const ids = [
    ...new Set(rows.flatMap((r) => [str(r.prepared_by), str(r.approved_by)]).filter(Boolean)),
  ];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: u } = await supabase.rpc('user_display_names', { p_ids: ids });
    ((u ?? []) as Row[]).forEach((x) => names.set(str(x.id), str(x.full_name)));
  }
  return rows.map((r) => ({
    ...mapEosCalc(r),
    id: str(r.id),
    employee_id: str(r.employee_id),
    employee_name: empName(r),
    end_date: str(r.end_date),
    reason: str(r.reason) as TerminationReason,
    art77: r.art77 === true,
    other_additions: num(r.other_additions),
    other_deductions: num(r.other_deductions),
    note: str(r.note),
    net: num(r.net),
    status: (['draft', 'approved', 'paid', 'cancelled'].includes(str(r.status))
      ? str(r.status)
      : 'draft') as EosSettlement['status'],
    prepared_by: (r.prepared_by as string | null) ?? null,
    prepared_by_name: names.get(str(r.prepared_by)) ?? '—',
    approved_by_name: names.get(str(r.approved_by)) ?? '',
    posted_at: (r.posted_at as string | null) ?? null,
    paid_at: (r.paid_at as string | null) ?? null,
  }));
}

export async function livePrepareEos(input: {
  employee_id: string;
  art77: boolean;
  other_additions: number;
  other_deductions: number;
  note: string;
}): Promise<void> {
  const { error } = await supabase.rpc('prepare_eos_settlement', {
    p_employee_id: input.employee_id,
    p_art77: input.art77,
    p_additions: input.other_additions,
    p_deductions: input.other_deductions,
    p_note: input.note || null,
  });
  if (error) throw new Error(error.message);
}

/** approve / cancel / post / pay / provision — all server functions with their own checks. */
export async function liveEosAction(fn: string, params: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
}

export async function liveEosProvision(
  period: string,
): Promise<{ target: number; balance: number; delta: number; posted: boolean }> {
  const end = new Date(`${period}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const asOf = end.toISOString().slice(0, 10);
  const [t, posted] = await Promise.all([
    supabase.rpc('eos_provision_target', { p_as_of: asOf }),
    supabase
      .from('journal_entries')
      .select('id')
      .eq('reference', `EOS-PROV-${period}`)
      .maybeSingle(),
  ]);
  if (t.error) throw new Error(t.error.message);
  // balance of 2210 up to the month end
  const { data: lines } = await supabase
    .from('journal_entry_lines')
    .select(
      'debit, credit, chart_of_accounts!inner(code), journal_entries!inner(entry_date, status)',
    )
    .eq('chart_of_accounts.code', '2210')
    .eq('journal_entries.status', 'posted')
    .lte('journal_entries.entry_date', asOf);
  const balance = ((lines ?? []) as Row[]).reduce((s, l) => s + num(l.credit) - num(l.debit), 0);
  const target = Math.round(num(t.data) * 100) / 100;
  return {
    target,
    balance: Math.round(balance * 100) / 100,
    delta: Math.round((target - balance) * 100) / 100,
    posted: !!posted.data,
  };
}
