import type { BadgeTone } from '@/shared/ui/Badge';

export type ResidentStatus = 'present' | 'absent' | 'on_service' | 'medical';

export interface Dorm {
  id: string;
  name: string;
  branch: string;
  capacity: number;
  occupied: number;
  supervisor: string;
}

export interface Resident {
  id: string;
  full_name: string;
  nationality: string;
  dorm: string;
  branch: string;
  status: ResidentStatus;
  check_in: string;
  barcode: string;
  iqama_no: string;
}

export type ScanDirection = 'in' | 'out';

export interface HousingScan {
  id: string;
  worker_id: string;
  worker_name: string;
  dorm: string;
  direction: ScanDirection;
  note: string | null;
  scanned_at: string;
}

/** A housing target assigned to a supervisor (admin-managed) + live progress. */
export interface HousingTarget {
  id: string;
  month: number;
  year: number;
  occupancy_target_pct: number;
  attendance_target_pct: number;
  occupancy_actual_pct: number;
  attendance_actual_pct: number;
  notes: string | null;
}

export const SCAN_DIRECTION_LABEL: Record<ScanDirection, string> = {
  in: 'دخول السكن',
  out: 'خروج من السكن',
};

export const RESIDENT_STATUS_LABEL: Record<ResidentStatus, string> = {
  present: 'حاضرة',
  absent: 'غائبة',
  on_service: 'في خدمة',
  medical: 'إجازة مرضية',
};

export const RESIDENT_STATUS_TONE: Record<ResidentStatus, BadgeTone> = {
  present: 'success',
  absent: 'danger',
  on_service: 'navy',
  medical: 'gold',
};
