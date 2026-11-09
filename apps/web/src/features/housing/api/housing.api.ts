import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { inViewerScope, scopeToViewerBranch } from '@/lib/branchScope';
import { useAuth } from '@/store/auth';
import { attendanceConfigSnapshot } from '@/features/hr/api/hr.api';
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
    occupied: 0,
    supervisor: 'هيفاء القحطاني',
  },
  {
    id: 'h2',
    name: 'سكن نجران - ب',
    branch: 'نجران',
    capacity: 16,
    occupied: 0,
    supervisor: 'هيفاء القحطاني',
  },
  {
    id: 'h3',
    name: 'سكن جازان',
    branch: 'جازان',
    capacity: 18,
    occupied: 0,
    supervisor: 'منى الغامدي',
  },
  {
    id: 'h4',
    name: 'سكن شرورة',
    branch: 'شرورة',
    capacity: 12,
    occupied: 0,
    supervisor: 'راجيش كومار',
  },
  {
    id: 'h5',
    name: 'سكن حبونا',
    branch: 'حبونا',
    capacity: 10,
    occupied: 0,
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

/**
 * مستهدفات السكن المُسندة لكل مشرفة (housing_targets: supervisor_id + branch_id).
 * المحقَّق يُحسب من السكن نفسه (الإشغال والحضور) — لا أرقام ثابتة.
 */
interface TargetSeed {
  id: string;
  supervisor: string;
  branch: string;
  occupancy_target_pct: number;
  attendance_target_pct: number;
  notes: string | null;
}
const DEMO_TARGETS: TargetSeed[] = [
  {
    id: 't-housing-jzn',
    supervisor: 'منى الغامدي',
    branch: 'جازان',
    occupancy_target_pct: 85,
    attendance_target_pct: 95,
    notes: 'رفع نسبة الإشغال في سكن جازان والالتزام بحضور المساء.',
  },
  {
    id: 't-housing-njr',
    supervisor: 'هيفاء القحطاني',
    branch: 'نجران',
    occupancy_target_pct: 80,
    attendance_target_pct: 90,
    notes: null,
  },
];

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** الإشغال = عدد المقيمات المسجّلات في السكن (لا رقم مخزّن يتقادم). */
function withOccupancy(d: Dorm): Dorm {
  return { ...d, occupied: RESIDENTS.filter((r) => r.dorm === d.name).length };
}

function targetOf(t: TargetSeed, now: Date): HousingTarget {
  const dorms = DORMS.filter((d) => d.branch === t.branch).map(withOccupancy);
  const capacity = dorms.reduce((a, d) => a + d.capacity, 0);
  const occupied = dorms.reduce((a, d) => a + d.occupied, 0);
  const residents = RESIDENTS.filter((r) => r.branch === t.branch);
  // في خدمة لدى عميل = ملتزمة (ليست غيابًا)
  const committed = residents.filter((r) => r.status === 'present' || r.status === 'on_service');
  return {
    id: t.id,
    supervisor: t.supervisor,
    branch: t.branch,
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    occupancy_target_pct: t.occupancy_target_pct,
    attendance_target_pct: t.attendance_target_pct,
    occupancy_actual_pct: pct(occupied, capacity),
    attendance_actual_pct: pct(committed.length, residents.length),
    notes: t.notes,
  };
}

/* ------------------------------- queries --------------------------------- */
export async function listDorms(): Promise<Dorm[]> {
  return scopeToViewerBranch(DORMS, (d) => d.branch).map(withOccupancy);
}

export async function listResidents(): Promise<Resident[]> {
  return scopeToViewerBranch(RESIDENTS, (r) => r.branch).map((r) => ({ ...r }));
}

export async function listHousingScans(workerId?: string): Promise<HousingScan[]> {
  const branchOf = (s: HousingScan) => RESIDENTS.find((r) => r.id === s.worker_id)?.branch;
  const scoped = scopeToViewerBranch(DEMO_SCANS, branchOf);
  const rows = workerId ? scoped.filter((s) => s.worker_id === workerId) : scoped;
  return [...rows].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
}

/**
 * المشرفة ترى مستهدفاتها هي؛ الإدارة ترى مستهدفات المشرفات ضمن نطاق فرعها
 * (نفس سياسة htarget_read).
 */
export async function listMyHousingTargets(): Promise<HousingTarget[]> {
  const profile = useAuth.getState().profile;
  const now = new Date();
  const rows =
    profile?.role === 'housing_supervisor'
      ? DEMO_TARGETS.filter((t) => t.supervisor === profile.full_name)
      : scopeToViewerBranch(DEMO_TARGETS, (t) => t.branch);
  return rows.map((t) => targetOf(t, now));
}

/**
 * Demo mirror of sync_ops_worker (0078): the HR worker file is the source —
 * her barcode and dorm make her a resident the scan station resolves.
 */
export function upsertResidentFromWorker(w: {
  full_name: string;
  nationality: string;
  branch: string;
  dorm: string;
  barcode: string;
  iqama_no: string;
}): void {
  if (!w.barcode) return;
  const i = RESIDENTS.findIndex((r) => r.barcode === w.barcode);
  const base = {
    full_name: w.full_name,
    nationality: w.nationality,
    branch: w.branch,
    dorm: w.dorm,
    barcode: w.barcode,
    iqama_no: w.iqama_no,
  };
  if (i >= 0) RESIDENTS[i] = { ...RESIDENTS[i]!, ...base };
  else if (w.dorm)
    RESIDENTS.push({
      ...base,
      id: `r-${w.barcode}`,
      status: 'absent',
      check_in: new Date().toISOString().slice(0, 10),
    });
}

export function resolveWorkerByBarcode(code: string): Resident | null {
  const q = code.trim();
  return RESIDENTS.find((r) => r.barcode === q || r.iqama_no === q) ?? null;
}

export const OUT_OF_BRANCH = 'هذه العاملة من فرع آخر — خارج نطاق سكنك.';

/** محطة المسح: العاملة ضمن نطاق فرع المستخدم فقط (نفس سياسة housing_scans). */
export function resolveResidentForViewer(code: string): {
  resident: Resident | null;
  outOfScope: boolean;
} {
  const r = resolveWorkerByBarcode(code);
  if (!r) return { resident: null, outOfScope: false };
  return inViewerScope(r.branch)
    ? { resident: r, outOfScope: false }
    : { resident: null, outOfScope: true };
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
  // presence is proven by a barcode entry scan today (guard_housing_presence, 0072)
  if (
    r &&
    status === 'present' &&
    r.status !== 'present' &&
    attendanceConfigSnapshot().worker_barcode_required
  ) {
    const today = new Date().toISOString().slice(0, 10);
    const scanned = DEMO_SCANS.some(
      (sc) =>
        sc.worker_id === r.id && sc.direction === 'in' && sc.scanned_at.slice(0, 10) === today,
    );
    if (!scanned) throw new Error('تحضير العاملة يكون بمسح باركودها');
  }
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
  if (!inViewerScope(worker.branch)) throw new Error(OUT_OF_BRANCH);

  if (!isDemoId(worker.id)) {
    const { error } = await supabase.rpc('log_housing_scan', {
      p_barcode: code.trim(),
      p_direction: direction,
      p_note: note,
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  }
  // a dorm entry scan IS the worker's attendance for the day (log_housing_scan, 0072)
  if (direction === 'in') worker.status = 'present';
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
