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
import {
  DOC_TYPE_LABEL,
  docTypeCode,
  type AdjustmentStatus,
  type AttendanceRecord,
  type AttendanceStatus,
  type EmergencyContact,
  type Employee,
  type EmployeeDocument,
  type HouseWorker,
  type IqamaRecord,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
  type PayrollAdjustment,
  type AdjustmentType,
  type Payslip,
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
  'national_id, nationality, hire_date, is_active, employee_no, user_id, branches(city), ' +
  'employee_details(english_name, dob, gender, marital_status, email, id_type, iqama_no, ' +
  'passport_no, border_no, department, contract_type, manager_id, employment_status, iban, ' +
  'bank_name, housing_allowance, other_allowance, gosi_system, gosi_reg_date, counts_in_saudization)';

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
 * Create/update an employee. Pay fields are written only by hr.manage (the
 * guard_employee_pay trigger enforces it); profile details likewise (0021).
 */
export async function liveSaveEmployee(
  emp: Employee,
  isNew: boolean,
  canManagePay: boolean,
): Promise<Employee> {
  const branch_id = await branchIdOf(emp.branch);
  const transport = emp.transport_allowance ?? 0;
  const other = emp.other_allowance ?? 0;
  const base: Row = {
    full_name: emp.full_name,
    role: emp.role,
    job_title: emp.job_title || null,
    branch_id,
    phone: emp.phone || null,
    nationality: emp.nationality,
    hire_date: emp.join_date || null,
    is_active: emp.status !== 'terminated',
  };
  if (canManagePay) {
    base.basic_salary = emp.base_salary;
    base.transport_allowance = transport;
  }
  let id = emp.id;
  if (isNew) {
    const { data, error } = await supabase.from('employees').insert(base).select('id').single();
    fail(error, 'إضافة الموظف');
    id = str((data as Row).id);
  } else {
    const { error } = await supabase.from('employees').update(base).eq('id', id);
    fail(error, 'تحديث الموظف');
  }
  if (canManagePay) {
    const saudi = emp.nationality === 'السعودية';
    const { error } = await supabase.from('employee_details').upsert(
      {
        employee_id: id,
        department: emp.department,
        email: emp.email || null,
        id_type: saudi ? 'saudi' : 'expat',
        counts_in_saudization: saudi,
        employment_status: emp.status === 'terminated' ? 'terminated' : 'active',
        // the form edits the allowance total; transport/other keep their split
        housing_allowance: Math.max(0, emp.allowances - transport - other),
      },
      { onConflict: 'employee_id' },
    );
    fail(error, 'حفظ ملف الموظف');
  }
  return { ...emp, id, branch_id };
}

/* ------------------------------- attendance ------------------------------- */
export async function liveListAttendance(): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select(
      'id, employee_id, check_in, check_out, status, employees(full_name, employee_details(department))',
    )
    .eq('date', today());
  fail(error, 'تحميل الحضور');
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: str(r.id),
    employee_id: str(r.employee_id),
    employee_name: empName(r),
    department: str(one(one(r.employees)?.employee_details)?.department),
    check_in: hhmm(r.check_in),
    check_out: hhmm(r.check_out),
    status: str(r.status) as AttendanceStatus,
  }));
}

/* --------------------------------- leave ---------------------------------- */
const LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'emergency', 'unpaid'];

export async function liveListLeave(): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id, employee_id, type, start_date, end_date, status, notes, employees(full_name)')
    .order('start_date', { ascending: false });
  fail(error, 'تحميل الإجازات');
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const from = str(r.start_date);
    const to = str(r.end_date);
    const t = str(r.type) as LeaveType;
    return {
      id: str(r.id),
      employee_id: str(r.employee_id),
      employee_name: empName(r),
      type: LEAVE_TYPES.includes(t) ? t : 'annual',
      from_date: from,
      to_date: to,
      days: daysInclusive(from, to),
      status: str(r.status) as LeaveStatus,
      reason: str(r.notes),
    };
  });
}

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
    .select('id')
    .single();
  fail(error, 'حفظ الإجازة');
  return { ...l, id: str((data as Row).id) };
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
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, full_name')
      .in('id', submitters);
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
