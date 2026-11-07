import type { AppRole } from '@masiat/shared';
import type { BadgeTone } from '@/shared/ui/Badge';

/* ------------------------------- employees ------------------------------- */
export type EmployeeStatus = 'active' | 'on_leave' | 'terminated';

export interface Employee {
  id: string;
  full_name: string;
  job_title: string;
  department: string;
  branch: string;
  nationality: string;
  base_salary: number;
  allowances: number;
  status: EmployeeStatus;
  role: AppRole; // system role → permissions
  join_date: string;
  phone: string;
  email: string;
  absence_days: number; // monthly
  late_count: number; // monthly
  overtime_hours?: number; // monthly approved overtime hours (attendance-derived)
  // extended profile (optional — module 05). Saudi → national id; expat → iqama.
  english_name?: string;
  id_type?: 'saudi' | 'expat';
  national_id?: string;
  iqama_no?: string;
  passport_no?: string;
  border_no?: string;
  dob?: string;
  gender?: 'male' | 'female';
  marital_status?: string;
  contract_type?: 'full_time' | 'part_time' | 'temp';
  manager?: string;
  iban?: string;
  bank_name?: string;
  gosi_system?: 'old' | 'new';
  gosi_reg_date?: string;
  counts_in_saudization?: boolean;
  // backend link (live mode) — employees + employee_details (0004/0021)
  employee_no?: string;
  branch_id?: string | null;
  /** allowance split (employee_details.housing/other + employees.transport). */
  housing_allowance?: number;
  transport_allowance?: number;
  other_allowance?: number;
  manager_id?: string;
  gosi_subscription_no?: string;
  /** linked login account (employees.user_id) — one account per employee. */
  user_id?: string;
  // end of service (0069) — base of the EOS settlement
  termination_date?: string;
  termination_reason?: TerminationReason;
  termination_note?: string;
}

export type TerminationReason =
  | 'resignation'
  | 'resignation_art87'
  | 'employer_termination'
  | 'contract_end'
  | 'article_80'
  | 'retirement'
  | 'death'
  | 'other';

export const TERMINATION_REASON_LABEL: Record<TerminationReason, string> = {
  resignation: 'استقالة',
  resignation_art87: 'استقالة بمكافأة كاملة (م87)',
  employer_termination: 'إنهاء من صاحب العمل',
  contract_end: 'انتهاء العقد',
  article_80: 'فصل وفق المادة 80',
  retirement: 'تقاعد',
  death: 'وفاة',
  other: 'أخرى',
};

export const CONTRACT_TYPE_LABEL: Record<NonNullable<Employee['contract_type']>, string> = {
  full_time: 'دوام كامل',
  part_time: 'دوام جزئي',
  temp: 'مؤقت',
};

/** A login account HR can link an employee to (hr_account_options, 0069). */
export interface AccountOption {
  id: string;
  full_name: string;
  role: string;
  branch: string | null;
  linked_employee: string | null;
}

export interface EmergencyContact {
  id: string;
  employee_id?: string;
  employee_name: string;
  name: string;
  relation: string;
  phone: string;
}

export const NATIONALITY_OPTIONS = [
  'السعودية',
  'الهند',
  'الفلبين',
  'بنغلاديش',
  'مصر',
  'باكستان',
] as const;

/* ------------------------------ deductions ------------------------------- */
export type DeductionType = 'absence' | 'late' | 'warning' | 'other';

export interface Deduction {
  id: string;
  type: DeductionType;
  amount: number;
  note: string;
}

export const DEDUCTION_TYPE_LABEL: Record<DeductionType, string> = {
  absence: 'تغيّب',
  late: 'تأخير',
  warning: 'إنذار',
  other: 'أخرى',
};

export const EMP_STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: 'على رأس العمل',
  on_leave: 'في إجازة',
  terminated: 'منتهي الخدمة',
};
export const EMP_STATUS_TONE: Record<EmployeeStatus, BadgeTone> = {
  active: 'success',
  on_leave: 'gold',
  terminated: 'neutral',
};

export const DEPARTMENTS = [
  'الإدارة',
  'العمليات',
  'المالية',
  'الموارد البشرية',
  'المبيعات',
  'مركز الاتصال',
  'السكن',
] as const;

/* ------------------------------ attendance ------------------------------- */
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';

export type AttendanceMethod = 'qr' | 'gps' | 'manual';

export interface AttendanceRecord {
  id: string;
  employee_id?: string;
  employee_name: string;
  department: string;
  /** 'YYYY-MM-DD' (absent on legacy demo rows = today) */
  date?: string;
  branch?: string;
  check_in: string | null;
  check_out: string | null;
  status: AttendanceStatus;
  check_in_method?: AttendanceMethod;
  check_out_method?: AttendanceMethod;
  distance_m?: number;
  late_minutes?: number;
  note?: string;
}

export const ATT_METHOD_LABEL: Record<AttendanceMethod, string> = {
  qr: 'باركود الفرع',
  gps: 'الموقع',
  manual: 'يدوي',
};

/** attendance_config (0072) — every method and who may use it, managed from settings. */
export interface AttendanceConfig {
  qr_enabled: boolean;
  qr_roles: string[];
  gps_enabled: boolean;
  gps_roles: string[];
  gps_radius_m: number;
  manual_enabled: boolean;
  manual_roles: string[];
  worker_barcode_required: boolean;
  /** 0 = Sunday … 6 = Saturday */
  workdays: number[];
}

export interface PublicHoliday {
  id: string;
  name_ar: string;
  from_date: string;
  to_date: string;
  is_active: boolean;
}

export interface BranchAttendance {
  id: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  attendance_token: string;
}

export const WEEKDAY_LABEL = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

export const ATT_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غائب',
  late: 'متأخر',
  leave: 'إجازة',
};
export const ATT_STATUS_TONE: Record<AttendanceStatus, BadgeTone> = {
  present: 'success',
  absent: 'danger',
  late: 'gold',
  leave: 'teal',
};

/* -------------------------------- leave ---------------------------------- */
/** Leave type code — managed in `leave_types` (0070), not a fixed enum. */
export type LeaveType = string;
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type LeaveCategory = 'annual' | 'sick' | 'statutory' | 'unpaid' | 'other';

/** One row of `leave_types` — the rules HR manages from the settings screen. */
export interface LeaveTypeConfig {
  code: string;
  name_ar: string;
  category: LeaveCategory;
  /** annual: days/year (first years) · sick: full-pay days · statutory/other: max days */
  entitlement_days: number | null;
  entitlement_days_after: number | null;
  after_years: number | null;
  sick_partial_days: number | null;
  sick_partial_pay_pct: number | null;
  sick_unpaid_days: number | null;
  paid: boolean;
  deducts_from_annual: boolean;
  gender: 'male' | 'female' | null;
  min_service_months: number;
  once_per_service: boolean;
  requires_attachment: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface LeaveRequest {
  id: string;
  employee_id?: string;
  employee_name: string;
  type: LeaveType;
  from_date: string;
  to_date: string;
  days: number;
  status: LeaveStatus;
  reason: string;
  decision_note?: string;
}

export interface LeaveBalance {
  annual_accrued: number;
  annual_used: number;
  annual_pending: number;
  annual_remaining: number;
  sick_used_this_year: number;
  sick_full_left: number;
  sick_total_limit: number;
}

export const LEAVE_CATEGORY_LABEL: Record<LeaveCategory, string> = {
  annual: 'سنوية (رصيد تراكمي)',
  sick: 'مرضية (شرائح أجر)',
  statutory: 'نظامية (عدد أيام ثابت)',
  unpaid: 'بدون أجر',
  other: 'أخرى (حد سنوي)',
};
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
  cancelled: 'ملغاة',
};
export const LEAVE_STATUS_TONE: Record<LeaveStatus, BadgeTone> = {
  pending: 'gold',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/* --------------------------- house workers (عاملات) ---------------------- */
export type WorkerStatus = 'available' | 'reserved' | 'on_service' | 'medical';

export interface HouseWorker {
  id: string;
  full_name: string;
  photo_url: string | null;
  nationality: string;
  profession: string;
  age: number;
  experience_years: number;
  monthly_salary: number;
  languages: string[];
  skills: string[];
  passport_no: string;
  iqama_no: string;
  status: WorkerStatus;
  branch: string;
  bio: string;
}

export const WORKER_STATUS_LABEL: Record<WorkerStatus, string> = {
  available: 'متاحة',
  reserved: 'محجوزة',
  on_service: 'في خدمة',
  medical: 'إجازة مرضية',
};
export const WORKER_STATUS_TONE: Record<WorkerStatus, BadgeTone> = {
  available: 'success',
  reserved: 'gold',
  on_service: 'navy',
  medical: 'danger',
};

/** Labour-source countries for house workers (عاملات) — expat only. */
export const WORKER_NATIONALITIES = [
  'الفلبين',
  'إندونيسيا',
  'كينيا',
  'أوغندا',
  'إثيوبيا',
  'سريلانكا',
  'بنغلاديش',
  'الهند',
  'باكستان',
] as const;

export const WORKER_PROFESSIONS = [
  'عاملة منزلية',
  'طباخة',
  'مربية أطفال',
  'عاملة نظافة',
  'سائق',
] as const;
export const SKILL_OPTIONS = [
  'محبة للأطفال',
  'تجيد الطبخ',
  'العناية بكبار السن',
  'التنظيف',
  'الكي',
  'رعاية ذوي الإعاقة',
  'تجيد القيادة',
] as const;
export const WORKER_LANGUAGES = [
  'العربية',
  'الإنجليزية',
  'الفلبينية',
  'الإندونيسية',
  'السواحيلية',
  'الأردية',
  'البنغالية',
  'السنهالية',
] as const;

/* ------------------------- documents / iqamas ---------------------------- */
/** employee_documents.type codes (0021) ↔ Arabic labels shown in the UI. */
export const DOC_TYPE_LABEL: Record<string, string> = {
  national_id: 'الهوية الوطنية',
  iqama: 'الإقامة',
  passport: 'جواز سفر',
  work_permit: 'رخصة العمل',
  visa: 'التأشيرة',
  contract: 'عقد عمل',
  cv: 'السيرة الذاتية',
  certificate: 'شهادة علمية/مهنية',
  medical: 'التأمين الطبي',
  driving_license: 'رخصة قيادة',
  photo: 'صورة شخصية',
  other: 'أخرى',
};
/** Arabic label → stored code (unknown labels are stored as 'other'). */
export function docTypeCode(label: string): string {
  return Object.entries(DOC_TYPE_LABEL).find(([, l]) => l === label)?.[0] ?? 'other';
}
export const DOC_TYPE_OPTIONS = Object.values(DOC_TYPE_LABEL).filter((l) => l !== 'صورة شخصية');

export type DocStatus = 'valid' | 'expiring' | 'expired';

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  valid: 'سارية',
  expiring: 'قاربت الانتهاء',
  expired: 'منتهية',
};
export const DOC_STATUS_TONE: Record<DocStatus, BadgeTone> = {
  valid: 'success',
  expiring: 'gold',
  expired: 'danger',
};

export interface EmployeeDocument {
  id: string;
  employee_id?: string;
  employee_name: string;
  type: string;
  number: string;
  issue_date: string;
  expiry_date: string | null;
}

export interface IqamaRecord {
  id: string;
  employee_id?: string;
  employee_name: string;
  iqama_no: string;
  profession: string;
  issue_date: string;
  expiry_date: string;
  work_permit: boolean;
}

/* ----------------------------- performance ------------------------------- */
export interface PerformanceReview {
  id: string;
  employee_id?: string;
  employee_name: string;
  period: string;
  score: number; // 0..100
  reviewer: string;
  date: string;
}

/* -------------------------------- payroll -------------------------------- */
export interface PayrollRow {
  id: string;
  employee_name: string;
  nationality: string;
  base: number;
  allowances: number;
  gosi: number;
  absence_ded: number;
  late_ded: number;
  manual_ded: number;
  deductions: number;
  net: number;
}

/* ----- payroll engine (module 05) — salary COMPUTED from sources ----- */
/** Approval workflow: manager/supervisor submits → HR approves → flows into run. */
export type AdjustmentType = 'bonus' | 'penalty' | 'advance' | 'allowance' | 'overtime';
export type AdjustmentStatus = 'pending' | 'approved' | 'rejected';

export interface PayrollAdjustment {
  id: string;
  employee_id: string;
  employee_name: string;
  type: AdjustmentType;
  amount: number;
  reason: string;
  period: string; // 'YYYY-MM'
  submitted_by: string;
  status: AdjustmentStatus;
}

export const ADJ_TYPE_LABEL: Record<AdjustmentType, string> = {
  bonus: 'مكافأة',
  allowance: 'بدل إضافي',
  overtime: 'عمل إضافي معتمد',
  penalty: 'جزاء/خصم',
  advance: 'سلفة',
};
/** bonus/allowance/overtime add to gross; penalty/advance are deductions. */
export const ADJ_IS_ADDITION: Record<AdjustmentType, boolean> = {
  bonus: true,
  allowance: true,
  overtime: true,
  penalty: false,
  advance: false,
};
export const ADJ_STATUS_LABEL: Record<AdjustmentStatus, string> = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد',
  rejected: 'مرفوض',
};
export const ADJ_STATUS_TONE: Record<AdjustmentStatus, BadgeTone> = {
  pending: 'gold',
  approved: 'success',
  rejected: 'danger',
};

/** Full payslip breakdown — every number traceable to its source. */
export interface Payslip {
  employee_id: string;
  employee_name: string;
  nationality: string;
  basic: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowance: number;
  present_days: number;
  absent_days: number;
  late_count: number;
  late_minutes: number;
  overtime_hours: number;
  overtime_amount: number;
  additions: number; // approved bonus/allowance/overtime
  absence_deduction: number;
  late_deduction: number;
  gosi_system: 'old' | 'new';
  gosi_employee: number;
  manual_deductions: number; // approved penalty/advance
  /** approved leave: unpaid days + sick days in a reduced-pay tier (0070). */
  unpaid_leave_days: number;
  sick_deduction_days: number;
  leave_deduction: number;
  /** approved advances (recovered → 1160) and penalties (workers' fund → 2170), 0071 */
  advance_deductions: number;
  penalty_deductions: number;
  /** employer GOSI share (expense 5200) */
  gosi_employer: number;
  /** days employed in the month (hired / terminated mid-month → prorated) */
  eligible_days: number;
  // frozen snapshot fields (payroll_runs / payslips) — for WPS and the printed slip
  employee_no?: string;
  id_number?: string;
  iban?: string;
  bank_name?: string;
  gross: number;
  total_deductions: number;
  net: number;
}

/* ------------------------------ payroll runs ----------------------------- */
/** calculated (snapshot, editable by recalculation) → approved (frozen) → paid. */
export type PayrollRunStatus = 'calculated' | 'approved' | 'paid';

export interface PayrollRun {
  id: string;
  period: string;
  status: PayrollRunStatus;
  run_by: string | null;
  run_by_name: string;
  calculated_at: string | null;
  approved_by_name: string;
  approved_at: string | null;
  posted_at: string | null;
  paid_at: string | null;
  employee_count: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  /** expense: gross − absence − late − leave */
  total_earnings: number;
  total_gosi_employee: number;
  total_gosi_employer: number;
  total_advances: number;
  total_penalties: number;
}

export const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  calculated: 'محتسب — بانتظار الاعتماد',
  approved: 'معتمد ومجمّد',
  paid: 'مصروف',
};
export const RUN_STATUS_TONE: Record<PayrollRunStatus, BadgeTone> = {
  calculated: 'gold',
  approved: 'success',
  paid: 'navy',
};

/* ----------------------------- end of service ---------------------------- */
export type EosWageBasis = 'full' | 'basic_housing' | 'basic';
export const EOS_WAGE_BASIS_LABEL: Record<EosWageBasis, string> = {
  full: 'الأجر الكامل (الأساسي + كل البدلات)',
  basic_housing: 'الأساسي + بدل السكن',
  basic: 'الأساسي فقط',
};

export type EosStatus = 'draft' | 'approved' | 'paid' | 'cancelled';
export const EOS_STATUS_LABEL: Record<EosStatus, string> = {
  draft: 'مسودة — بانتظار الاعتماد',
  approved: 'معتمدة ومجمّدة',
  paid: 'مصروفة',
  cancelled: 'ملغاة',
};
export const EOS_STATUS_TONE: Record<EosStatus, BadgeTone> = {
  draft: 'gold',
  approved: 'success',
  paid: 'navy',
  cancelled: 'neutral',
};

/** The computed entitlement (eos_calculate, 0073). */
export interface EosCalc {
  service_years: number;
  wage: number;
  full_wage: number;
  wage_basis: EosWageBasis;
  award_full: number;
  award_ratio: number;
  award: number;
  leave_days: number;
  leave_amount: number;
  art77_amount: number;
  total: number;
}

export interface EosSettlement extends EosCalc {
  id: string;
  employee_id: string;
  employee_name: string;
  end_date: string;
  reason: TerminationReason;
  art77: boolean;
  other_additions: number;
  other_deductions: number;
  note: string;
  net: number;
  status: EosStatus;
  prepared_by: string | null;
  prepared_by_name: string;
  approved_by_name: string;
  posted_at: string | null;
  paid_at: string | null;
}
