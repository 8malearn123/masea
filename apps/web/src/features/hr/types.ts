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
}

export interface EmergencyContact {
  id: string;
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

export interface AttendanceRecord {
  id: string;
  employee_name: string;
  department: string;
  check_in: string | null;
  check_out: string | null;
  status: AttendanceStatus;
}

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
export type LeaveType = 'annual' | 'sick' | 'emergency' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequest {
  id: string;
  employee_name: string;
  type: LeaveType;
  from_date: string;
  to_date: string;
  days: number;
  status: LeaveStatus;
  reason: string;
}

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: 'سنوية',
  sick: 'مرضية',
  emergency: 'اضطرارية',
  unpaid: 'بدون راتب',
};
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
};
export const LEAVE_STATUS_TONE: Record<LeaveStatus, BadgeTone> = {
  pending: 'gold',
  approved: 'success',
  rejected: 'danger',
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
  employee_name: string;
  type: string;
  number: string;
  issue_date: string;
  expiry_date: string | null;
}

export interface IqamaRecord {
  id: string;
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
  gross: number;
  total_deductions: number;
  net: number;
}
