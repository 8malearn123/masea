import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  addAdjustment,
  addEmergencyContact,
  addEmployeeDocument,
  decideAdjustment,
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
import type {
  AdjustmentStatus,
  EmergencyContact,
  EmployeeDocument,
  LeaveRequest,
  LeaveStatus,
  PayrollAdjustment,
} from '@/features/hr/types';

const ADJ_KEY = ['hr', 'adjustments'] as const;

const LEAVE_KEY = ['hr', 'leave'] as const;

export function useEmployees() {
  return useQuery({
    queryKey: ['hr', 'employees'],
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
    mutationFn: async (input) => addEmployeeDocument(input),
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
    mutationFn: async (input) => addEmergencyContact(input),
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
    mutationFn: async (input) => addAdjustment(input),
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
    onSuccess: (_d, { status }) =>
      toast.success(status === 'approved' ? 'تم اعتماد التعديل' : 'تم رفض الطلب'),
  });
}

export function useUpdateLeave() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { id: string; status: LeaveStatus },
    { prev: LeaveRequest[] | undefined }
  >({
    mutationFn: ({ id, status }) => updateLeaveStatus(id, status),
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
    onSuccess: (_d, { status }) =>
      toast.success(status === 'approved' ? 'تم اعتماد الإجازة' : 'تم تحديث الطلب'),
  });
}
