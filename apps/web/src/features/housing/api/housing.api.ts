import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import type {
  Dorm,
  HousingScan,
  HousingTarget,
  Resident,
  ResidentStatus,
  ScanDirection,
} from '@/features/housing/types';

const DORMS: Dorm[] = [
  {
    id: 'h1',
    name: 'سكن نجران - أ',
    branch: 'نجران',
    capacity: 20,
    occupied: 16,
    supervisor: 'منى الغامدي',
  },
  {
    id: 'h2',
    name: 'سكن نجران - ب',
    branch: 'نجران',
    capacity: 16,
    occupied: 9,
    supervisor: 'منى الغامدي',
  },
  {
    id: 'h3',
    name: 'سكن جازان',
    branch: 'جازان',
    capacity: 18,
    occupied: 18,
    supervisor: 'منى الغامدي',
  },
  {
    id: 'h4',
    name: 'سكن شرورة',
    branch: 'شرورة',
    capacity: 12,
    occupied: 7,
    supervisor: 'راجيش كومار',
  },
  {
    id: 'h5',
    name: 'سكن حبونا',
    branch: 'حبونا',
    capacity: 10,
    occupied: 4,
    supervisor: 'راجيش كومار',
  },
];

// Demo residents carry a barcode + iqama so the scan station resolves them.
const RESIDENTS: Resident[] = [
  {
    id: 'r1',
    full_name: 'ماريا سانتوس',
    nationality: 'الفلبين',
    dorm: 'سكن نجران - أ',
    branch: 'نجران',
    status: 'present',
    check_in: '2024-01-15',
    barcode: 'MAS-W-1001',
    iqama_no: '2412345678',
  },
  {
    id: 'r2',
    full_name: 'سيتي نورهاليزا',
    nationality: 'إندونيسيا',
    dorm: 'سكن جازان',
    branch: 'جازان',
    status: 'on_service',
    check_in: '2023-11-20',
    barcode: 'MAS-W-1002',
    iqama_no: '2423456789',
  },
  {
    id: 'r3',
    full_name: 'غريس وانجيرو',
    nationality: 'كينيا',
    dorm: 'سكن شرورة',
    branch: 'شرورة',
    status: 'present',
    check_in: '2024-03-01',
    barcode: 'MAS-W-1003',
    iqama_no: '2434567890',
  },
  {
    id: 'r4',
    full_name: 'نيلوكا فرناندو',
    nationality: 'سريلانكا',
    dorm: 'سكن نجران - أ',
    branch: 'نجران',
    status: 'present',
    check_in: '2024-02-10',
    barcode: 'MAS-W-1004',
    iqama_no: '2445678901',
  },
  {
    id: 'r5',
    full_name: 'روكسانا بيغم',
    nationality: 'بنغلاديش',
    dorm: 'سكن حبونا',
    branch: 'حبونا',
    status: 'medical',
    check_in: '2023-12-05',
    barcode: 'MAS-W-1005',
    iqama_no: '2456789012',
  },
  {
    id: 'r6',
    full_name: 'ديوي أنغرايني',
    nationality: 'إندونيسيا',
    dorm: 'سكن جازان',
    branch: 'جازان',
    status: 'present',
    check_in: '2024-01-22',
    barcode: 'MAS-W-1006',
    iqama_no: '2467890123',
  },
  {
    id: 'r7',
    full_name: 'فيث أتيينو',
    nationality: 'كينيا',
    dorm: 'سكن نجران - ب',
    branch: 'نجران',
    status: 'absent',
    check_in: '2024-04-02',
    barcode: 'MAS-W-1007',
    iqama_no: '2478901234',
  },
  {
    id: 'r8',
    full_name: 'نسرين أكتر',
    nationality: 'بنغلاديش',
    dorm: 'سكن شرورة',
    branch: 'شرورة',
    status: 'present',
    check_in: '2024-03-18',
    barcode: 'MAS-W-1008',
    iqama_no: '2489012345',
  },
];

/** Demo entry/exit log, seeded + appended in-session. */
let scanSeq = 100;
const DEMO_SCANS: HousingScan[] = [
  {
    id: 's1',
    worker_id: 'r1',
    worker_name: 'ماريا سانتوس',
    dorm: 'سكن نجران - أ',
    direction: 'in',
    note: 'رجعت من العمل',
    scanned_at: '2026-06-16T20:10:00Z',
  },
  {
    id: 's2',
    worker_id: 'r4',
    worker_name: 'نيلوكا فرناندو',
    dorm: 'سكن نجران - أ',
    direction: 'out',
    note: 'خرجت للعمل',
    scanned_at: '2026-06-17T06:30:00Z',
  },
  {
    id: 's3',
    worker_id: 'r1',
    worker_name: 'ماريا سانتوس',
    dorm: 'سكن نجران - أ',
    direction: 'out',
    note: null,
    scanned_at: '2026-06-17T06:45:00Z',
  },
];

/** Demo housing targets assigned to the supervisor (منى الغامدي). */
const DEMO_TARGETS: HousingTarget[] = [
  {
    id: 't-housing-1',
    month: 6,
    year: 2026,
    occupancy_target_pct: 85,
    attendance_target_pct: 95,
    occupancy_actual_pct: 71,
    attendance_actual_pct: 88,
    notes: 'رفع نسبة الإشغال في سكن نجران - ب والالتزام بحضور المساء.',
  },
];

/* ------------------------------- queries --------------------------------- */
export async function listDorms(): Promise<Dorm[]> {
  return DORMS;
}

export async function listResidents(): Promise<Resident[]> {
  return RESIDENTS;
}

export async function listHousingScans(workerId?: string): Promise<HousingScan[]> {
  const rows = workerId ? DEMO_SCANS.filter((s) => s.worker_id === workerId) : DEMO_SCANS;
  return [...rows].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
}

export async function listMyHousingTargets(): Promise<HousingTarget[]> {
  return DEMO_TARGETS;
}

export function resolveWorkerByBarcode(code: string): Resident | null {
  const q = code.trim();
  return RESIDENTS.find((r) => r.barcode === q || r.iqama_no === q) ?? null;
}

/* ------------------------------ mutations -------------------------------- */
/** Take attendance for one worker (housing_attendance upsert). */
export async function markAttendance(residentId: string, status: ResidentStatus): Promise<void> {
  if (!isDemoId(residentId)) {
    const { error } = await supabase
      .from('housing_attendance')
      .upsert(
        { worker_id: residentId, date: new Date().toISOString().slice(0, 10), status },
        { onConflict: 'worker_id,date' },
      );
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  const r = RESIDENTS.find((x) => x.id === residentId);
  if (r) r.status = status; // demo: optimistic source of truth
}

/** Scan a worker barcode → log a dorm entry/exit and return her profile. */
export async function logHousingScan(
  code: string,
  direction: ScanDirection,
  note: string | null,
): Promise<Resident> {
  const worker = resolveWorkerByBarcode(code);
  if (!worker) throw new Error('لا توجد عاملة بهذا الباركود');

  if (!isDemoId(worker.id)) {
    const { error } = await supabase.rpc('log_housing_scan', {
      p_barcode: code.trim(),
      p_direction: direction,
      p_note: note,
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  }
  DEMO_SCANS.push({
    id: `scan-${++scanSeq}`,
    worker_id: worker.id,
    worker_name: worker.full_name,
    dorm: worker.dorm,
    direction,
    note: note && note.trim() ? note.trim() : null,
    scanned_at: new Date().toISOString(),
  });
  return worker;
}
