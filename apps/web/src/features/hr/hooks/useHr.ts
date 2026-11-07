import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  computePayslips,
  createAdjustment,
  createEmergencyContact,
  createEmployeeDocument,
  createLeaveRequest,
  createPerformanceReview,
  decideAdjustment,
  listAccountOptions,
  demoLeaveContext,
  getLeaveBalance,
  listLeaveTypes,
  persistEmployee,
  persistHouseWorker,
  saveLeaveType,
  reactivateEmployee,
  terminateEmployee,
  type TerminationInput,
  runPayroll,
  listAdjustments,
  listAttendance,
  listDocuments,
  listEmergencyContacts,
  listEmployees,
  listHouseWorkers,
  listIqamas,
  listLeaveRequests,
  listPerformance,
  updateLeaveStatus,
  type NewAdjustmentInput,
  type NewDocInput,
} from '@/features/hr/api/hr.api';
import {
  getPayrollSettings,
  updateGosiConfig,
  updatePayrollConfig,
  type PayrollSettings,
} from '@/features/hr/api/payrollSettings.api';
import type { GosiConfig, PayrollConfig } from '@/features/hr/api/hr.api';
import type {
  AdjustmentStatus,
  EmergencyContact,
  Employee,
  EmployeeDocument,
  HouseWorker,
  LeaveRequest,
  LeaveStatus,
  LeaveTypeConfig,
  PayrollAdjustment,
  Payslip,
  PerformanceReview,
} from '@/features/hr/types';

const EMP_KEY = ['hr', 'employees'] as const;
const PAYSLIPS_KEY = ['hr', 'payslips'] as const;

const ADJ_KEY = ['hr', 'adjustments'] as const;

const LEAVE_KEY = ['hr', 'leave'] as const;
const LEAVE_TYPES_KEY = ['hr', 'leave-types'] as const;
const BALANCE_KEY = ['hr', 'leave-balance'] as const;

export function useEmployees() {
  return useQuery({
    queryKey: EMP_KEY,
    queryFn: listEmployees,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useAttendance() {
  return useQuery({
    queryKey: ['hr', 'attendance'],
    queryFn: listAttendance,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useLeaveRequests() {
  return useQuery({
    queryKey: LEAVE_KEY,
    queryFn: listLeaveRequests,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useDocuments() {
  return useQuery({
    queryKey: ['hr', 'documents'],
    queryFn: listDocuments,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useIqamas() {
  return useQuery({
    queryKey: ['hr', 'iqamas'],
    queryFn: listIqamas,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function usePerformance() {
  return useQuery({
    queryKey: ['hr', 'performance'],
    queryFn: listPerformance,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useHouseWorkers() {
  return useQuery({
    queryKey: ['hr', 'workers'],
    queryFn: listHouseWorkers,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useEmergencyContacts() {
  return useQuery({
    queryKey: ['hr', 'emergency'],
    queryFn: listEmergencyContacts,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useAddDocument() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<EmployeeDocument, Error, NewDocInput>({
    mutationFn: createEmployeeDocument,
    onSuccess: (doc) => {
      qc.setQueryData<EmployeeDocument[]>(['hr', 'documents'], (old) => [doc, ...(old ?? [])]);
      toast.success('تم رفع المستند');
    },
    onError: (e) => toast.error(e.message || 'تعذّر رفع المستند'),
  });
}

export function useAddEmergencyContact() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<EmergencyContact, Error, Omit<EmergencyContact, 'id'>>({
    mutationFn: createEmergencyContact,
    onSuccess: (c) => {
      qc.setQueryData<EmergencyContact[]>(['hr', 'emergency'], (old) => [c, ...(old ?? [])]);
      toast.success('تمت إضافة جهة الطوارئ');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الإضافة'),
  });
}

export function useAdjustments() {
  return useQuery({
    queryKey: ADJ_KEY,
    queryFn: listAdjustments,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useAddAdjustment() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<PayrollAdjustment, Error, NewAdjustmentInput>({
    mutationFn: createAdjustment,
    onSuccess: (a) => {
      qc.setQueryData<PayrollAdjustment[]>(ADJ_KEY, (old) => [a, ...(old ?? [])]);
      toast.success('تم رفع طلب التعديل للاعتماد');
    },
    onError: (e) => toast.error(e.message || 'تعذّر رفع الطلب'),
  });
}

export function useDecideAdjustment() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { id: string; status: Exclude<AdjustmentStatus, 'pending'> },
    { prev: PayrollAdjustment[] | undefined }
  >({
    mutationFn: ({ id, status }) => decideAdjustment(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ADJ_KEY });
      const prev = qc.getQueryData<PayrollAdjustment[]>(ADJ_KEY);
      qc.setQueryData<PayrollAdjustment[]>(ADJ_KEY, (old) =>
        old?.map((a) => (a.id === id ? { ...a, status } : a)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ADJ_KEY, ctx.prev);
      toast.error(e.message || 'تعذّر اتخاذ القرار');
    },
    onSuccess: (_d, { status }) => {
      void qc.invalidateQueries({ queryKey: PAYSLIPS_KEY }); // the run reflects the decision
      toast.success(status === 'approved' ? 'تم اعتماد التعديل' : 'تم رفض الطلب');
    },
  });
}

export function useUpdateLeave() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { id: string; status: LeaveStatus; note?: string },
    { prev: LeaveRequest[] | undefined }
  >({
    mutationFn: ({ id, status, note }) => updateLeaveStatus(id, status, note),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: LEAVE_KEY });
      const prev = qc.getQueryData<LeaveRequest[]>(LEAVE_KEY);
      qc.setQueryData<LeaveRequest[]>(LEAVE_KEY, (old) =>
        old?.map((l) => (l.id === id ? { ...l, status } : l)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(LEAVE_KEY, ctx.prev);
      toast.error(e.message || 'تعذّر تحديث الطلب');
    },
    onSuccess: (_d, { status }) => {
      // status (في إجازة), balances and pay (unpaid/sick tiers) all follow the decision
      void qc.invalidateQueries({ queryKey: EMP_KEY });
      void qc.invalidateQueries({ queryKey: LEAVE_KEY });
      void qc.invalidateQueries({ queryKey: BALANCE_KEY });
      void qc.invalidateQueries({ queryKey: PAYSLIPS_KEY });
      toast.success(
        status === 'approved'
          ? 'تم اعتماد الإجازة'
          : status === 'cancelled'
            ? 'تم إلغاء الإجازة'
            : 'تم رفض الطلب',
      );
    },
  });
}

/* ----------------------- payroll & GOSI settings ------------------------ */
export const PAYROLL_SETTINGS_KEY = ['hr', 'payroll-settings'] as const;

/** Live payroll/GOSI config. Screens that compute pay subscribe to it so a
 *  saved setting recomputes the run, payslips and costs immediately. */
export function usePayrollSettings() {
  return useQuery<PayrollSettings>({
    queryKey: PAYROLL_SETTINGS_KEY,
    queryFn: getPayrollSettings,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

function useSaveSettings<T>(save: (v: T) => Promise<void>, okMsg: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, T>({
    mutationFn: save,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PAYROLL_SETTINGS_KEY });
      void qc.invalidateQueries({ queryKey: ['audit-log'] });
      void qc.invalidateQueries({ queryKey: PAYSLIPS_KEY });
      toast.success(okMsg);
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ الإعدادات'),
  });
}

export function useUpdatePayrollConfig() {
  return useSaveSettings<PayrollConfig>(updatePayrollConfig, 'تم حفظ إعدادات الرواتب');
}

export function useUpdateGosiConfig() {
  return useSaveSettings<GosiConfig>(updateGosiConfig, 'تم حفظ إعدادات التأمينات');
}

/* ------------------------------ writes ----------------------------------- */
export function useSaveEmployee() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    Employee,
    Error,
    { employee: Employee; isNew: boolean; canManagePay: boolean }
  >({
    mutationFn: ({ employee, isNew, canManagePay }) =>
      persistEmployee(employee, isNew, canManagePay),
    onSuccess: (saved, { isNew }) => {
      qc.setQueryData<Employee[]>(EMP_KEY, (old) =>
        isNew ? [saved, ...(old ?? [])] : (old ?? []).map((e) => (e.id === saved.id ? saved : e)),
      );
      if (!isDemoMode()) void qc.invalidateQueries({ queryKey: EMP_KEY });
      toast.success(isNew ? 'تمت إضافة الموظف' : 'تم تحديث بيانات الموظف');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ الموظف'),
  });
}

export function useAddLeave() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<LeaveRequest, Error, LeaveRequest>({
    mutationFn: createLeaveRequest,
    onSuccess: (l) => {
      qc.setQueryData<LeaveRequest[]>(LEAVE_KEY, (old) => [l, ...(old ?? [])]);
      void qc.invalidateQueries({ queryKey: EMP_KEY });
      void qc.invalidateQueries({ queryKey: BALANCE_KEY });
      void qc.invalidateQueries({ queryKey: PAYSLIPS_KEY });
      toast.success(
        l.status === 'approved' ? 'تم تعيين الإجازة للموظف' : 'تم رفع طلب الإجازة للاعتماد',
      );
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ الإجازة'),
  });
}

export function useAddPerformance() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<PerformanceReview, Error, PerformanceReview>({
    mutationFn: createPerformanceReview,
    onSuccess: (r) => {
      qc.setQueryData<PerformanceReview[]>(['hr', 'performance'], (old) => [r, ...(old ?? [])]);
      toast.success('تم حفظ التقييم');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ التقييم'),
  });
}

export function useSaveHouseWorker() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<HouseWorker, Error, { worker: HouseWorker; isNew: boolean }>({
    mutationFn: ({ worker, isNew }) => persistHouseWorker(worker, isNew),
    onSuccess: (w, { isNew }) => {
      qc.setQueryData<HouseWorker[]>(['hr', 'workers'], (old) =>
        isNew ? [w, ...(old ?? [])] : (old ?? []).map((x) => (x.id === w.id ? w : x)),
      );
      // same record as the customer catalog / contracts / quotes
      void qc.invalidateQueries({ queryKey: ['worker_profiles'] });
      toast.success(isNew ? 'تمت إضافة العاملة' : 'تم تحديث بيانات العاملة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ العاملة'),
  });
}

/* ------------------------------ payroll run ------------------------------ */
/**
 * Payslips for a period. Live: calculate_payslip() on the backend (the source
 * of truth). Demo: the mirror engine, recomputed whenever employees,
 * adjustments or settings change. `period = null` → not run yet.
 */
export function usePayslips(
  employees: Employee[],
  period: string | null,
  adjustments: PayrollAdjustment[],
  settingsStamp: unknown,
) {
  const demo = isDemoMode();
  // leave affects pay (unpaid / sick tiers): recompute when leave or its rules change
  const { data: leaves } = useLeaveRequests();
  const { data: leaveTypes } = useLeaveTypes();
  const demoSlips = useMemo<Payslip[] | null>(() => {
    if (!demo || !period) return null;
    const ctx = demoLeaveContext();
    return runPayroll(employees, period, adjustments, ctx.leaves, ctx.types);
    // settingsStamp / leaves / leaveTypes: the engine reads live stores, so recompute on change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, employees, period, adjustments, settingsStamp, leaves, leaveTypes]);
  const q = useQuery<Payslip[]>({
    queryKey: [...PAYSLIPS_KEY, period, employees.map((e) => e.id).join(',')],
    queryFn: () => computePayslips(employees, period ?? '', adjustments),
    enabled: !demo && !!period && employees.length > 0,
    staleTime: 30_000,
  });
  if (demo)
    return { data: demoSlips, isLoading: false, isError: false, error: null, refetch: q.refetch };
  return {
    data: period ? (q.data ?? null) : null,
    isLoading: q.isLoading && !!period,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/* ------------------------- end of service / account ---------------------- */
export function useTerminateEmployee() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; input: TerminationInput }>({
    mutationFn: ({ id, input }) => terminateEmployee(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EMP_KEY });
      void qc.invalidateQueries({ queryKey: PAYSLIPS_KEY });
      toast.success('تم تسجيل إنهاء الخدمة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنهاء الخدمة'),
  });
}

export function useReactivateEmployee() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: reactivateEmployee,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EMP_KEY });
      void qc.invalidateQueries({ queryKey: PAYSLIPS_KEY });
      toast.success('أُعيد تفعيل الموظف');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إعادة التفعيل'),
  });
}

/** Login accounts for linking (hr.manage only — the query is disabled otherwise). */
export function useAccountOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['hr', 'accounts'],
    queryFn: listAccountOptions,
    enabled,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

/* ------------------------------ leave types ------------------------------ */
export function useLeaveTypes() {
  return useQuery({
    queryKey: LEAVE_TYPES_KEY,
    queryFn: listLeaveTypes,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useSaveLeaveType() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { type: LeaveTypeConfig; isNew: boolean }>({
    mutationFn: ({ type, isNew }) => saveLeaveType(type, isNew),
    onSuccess: (_d, { isNew }) => {
      void qc.invalidateQueries({ queryKey: LEAVE_TYPES_KEY });
      void qc.invalidateQueries({ queryKey: BALANCE_KEY });
      void qc.invalidateQueries({ queryKey: ['audit-log'] });
      toast.success(isNew ? 'تمت إضافة نوع الإجازة' : 'تم حفظ نوع الإجازة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ نوع الإجازة'),
  });
}

/** Leave balance of one employee as of a date (null employee → disabled). */
export function useLeaveBalance(employee: Employee | null | undefined, asOf: string) {
  return useQuery({
    queryKey: [...BALANCE_KEY, employee?.id ?? '', asOf],
    queryFn: () => getLeaveBalance(employee as Employee, asOf),
    enabled: !!employee && !!asOf,
    staleTime: 30_000,
  });
}

/** Balances of many employees (the «الأرصدة» view) in one query. */
export function useLeaveBalances(employees: Employee[], asOf: string) {
  return useQuery({
    queryKey: [...BALANCE_KEY, 'all', employees.map((e) => e.id).join(','), asOf],
    queryFn: async () => {
      const rows = await Promise.all(employees.map((e) => getLeaveBalance(e, asOf)));
      return new Map(employees.map((e, i) => [e.id, rows[i]!]));
    },
    enabled: employees.length > 0,
    staleTime: 30_000,
  });
}
