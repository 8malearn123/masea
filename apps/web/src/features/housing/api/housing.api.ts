import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { nowRiyadh } from '@/features/hr/lib/attendanceEngine';
import { inViewerScope, scopeToViewerBranch } from '@/lib/branchScope';
import { useAuth } from '@/store/auth';
import { attendanceConfigSnapshot } from '@/features/hr/api/hr.api';
import { dormAssignError, dormChangeError, type DormInput } from '@/features/housing/lib/dormRules';
import { targetChangeError, type HousingTargetInput } from '@/features/housing/lib/targetRules';
import type {
  Dorm,
  HousingScan,
  HousingSupervisor,
  HousingTarget,
  Resident,
  ResidentStatus,
  ScanDirection,
} from '@/features/housing/types';

/** مشرفات السكن في مخزن العرض (مستخدمون بدور «مشرفة السكن»). */
const DEMO_SUPERVISORS: HousingSupervisor[] = [
  { id: 'demo-housing_supervisor', full_name: 'منى الغامدي', branch: 'جازان' },
  { id: 'sup-njr', full_name: 'هيفاء القحطاني', branch: 'نجران' },
  { id: 'sup-srr', full_name: 'نوف الدوسري', branch: 'شرورة' },
  { id: 'sup-hbn', full_name: 'أمل اليامي', branch: 'حبونا' },
];

const sup = (id: string) => ({
  supervisor_id: id,
  supervisor: DEMO_SUPERVISORS.find((x) => x.id === id)?.full_name ?? '',
});

const DORMS: Dorm[] = [
  {
    id: 'h1',
    name: 'سكن نجران - أ',
    branch: 'نجران',
    capacity: 20,
    occupied: 0,
    ...sup('sup-njr'),
    is_active: true,
    notes: null,
  },
  {
    id: 'h2',
    name: 'سكن نجران - ب',
    branch: 'نجران',
    capacity: 16,
    occupied: 0,
    ...sup('sup-njr'),
    is_active: true,
    notes: null,
  },
  {
    id: 'h3',
    name: 'سكن جازان',
    branch: 'جازان',
    capacity: 18,
    occupied: 0,
    ...sup('demo-housing_supervisor'),
    is_active: true,
    notes: null,
  },
  {
    id: 'h4',
    name: 'سكن شرورة',
    branch: 'شرورة',
    capacity: 12,
    occupied: 0,
    ...sup('sup-srr'),
    is_active: true,
    notes: null,
  },
  {
    id: 'h5',
    name: 'سكن حبونا',
    branch: 'حبونا',
    capacity: 10,
    occupied: 0,
    ...sup('sup-hbn'),
    is_active: true,
    notes: null,
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
  supervisor_id: string;
  month: number;
  year: number;
  occupancy_target_pct: number;
  attendance_target_pct: number;
  notes: string | null;
  is_active: boolean;
}
const NOW = new Date();
const DEMO_TARGETS: TargetSeed[] = [
  {
    id: 't-housing-jzn',
    supervisor_id: 'demo-housing_supervisor',
    month: NOW.getMonth() + 1,
    year: NOW.getFullYear(),
    occupancy_target_pct: 85,
    attendance_target_pct: 95,
    notes: 'رفع نسبة الإشغال في سكن جازان والالتزام بحضور المساء.',
    is_active: true,
  },
  {
    id: 't-housing-njr',
    supervisor_id: 'sup-njr',
    month: NOW.getMonth() + 1,
    year: NOW.getFullYear(),
    occupancy_target_pct: 80,
    attendance_target_pct: 90,
    notes: null,
    is_active: true,
  },
];

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** الإشغال = عدد المقيمات المسجّلات في السكن (لا رقم مخزّن يتقادم). */
function withOccupancy(d: Dorm): Dorm {
  return { ...d, occupied: RESIDENTS.filter((r) => r.dorm === d.name).length };
}

/** مرآة supervisor_dorms (0083): مساكن المشرفة، أو مساكن فرعها إن لم تُسند لها مساكن. */
function supervisorDorms(supervisorId: string, branch: string): Dorm[] {
  const active = DORMS.filter((d) => d.is_active);
  const own = active.filter((d) => d.supervisor_id === supervisorId);
  return (own.length ? own : active.filter((d) => d.branch === branch)).map(withOccupancy);
}

function targetOf(t: TargetSeed): HousingTarget {
  const sv = DEMO_SUPERVISORS.find((x) => x.id === t.supervisor_id);
  const branch = sv?.branch ?? '';
  const dorms = supervisorDorms(t.supervisor_id, branch);
  const capacity = dorms.reduce((a, d) => a + (d.capacity ?? 0), 0);
  const occupied = dorms.reduce((a, d) => a + d.occupied, 0);
  const names = new Set(dorms.map((d) => d.name));
  const residents = RESIDENTS.filter((r) => names.has(r.dorm));
  // في خدمة لدى عميل = ملتزمة (ليست غيابًا)؛ العرض بلا سجل شهري = حالة اليوم
  const committed = residents.filter((r) => r.status === 'present' || r.status === 'on_service');
  return {
    id: t.id,
    supervisor_id: t.supervisor_id,
    supervisor: sv?.full_name ?? '—',
    branch,
    month: t.month,
    year: t.year,
    occupancy_target_pct: t.occupancy_target_pct,
    attendance_target_pct: t.attendance_target_pct,
    occupancy_actual_pct: pct(occupied, capacity),
    attendance_actual_pct: pct(committed.length, residents.length),
    notes: t.notes,
    is_active: t.is_active,
  };
}

/* ------------------------------- queries --------------------------------- */
interface RawDorm {
  id: string;
  name: string;
  branch: string | null;
  capacity: number | null;
  occupied: number;
  supervisor_id: string | null;
  supervisor: string | null;
  is_active: boolean;
  notes: string | null;
}

/** كل المساكن ضمن نطاق المستخدم (النشطة والمعطّلة) مع الإشغال المحسوب. */
export async function listDorms(): Promise<Dorm[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('list_housing_dorms');
    if (error) throw new Error(`تعذّر تحميل المساكن: ${error.message}`);
    return ((data ?? []) as RawDorm[]).map((d) => ({
      ...d,
      branch: d.branch ?? '',
      supervisor: d.supervisor ?? '',
    }));
  }
  return scopeToViewerBranch(DORMS, (d) => d.branch).map(withOccupancy);
}

/** المشرفات المتاحات للإسناد ضمن نطاق مدير السكن. */
export async function listHousingSupervisors(): Promise<HousingSupervisor[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('list_housing_supervisors');
    if (error) throw new Error(`تعذّر تحميل المشرفات: ${error.message}`);
    return ((data ?? []) as { id: string; full_name: string | null; branch: string | null }[]).map(
      (u) => ({ id: u.id, full_name: u.full_name ?? '—', branch: u.branch }),
    );
  }
  return scopeToViewerBranch(DEMO_SUPERVISORS, (x) => x.branch);
}

/** إضافة/تعديل/تعطيل سكن (housing.manage — RLS + guard_housing_dorm). */
export async function saveDorm(input: DormInput): Promise<void> {
  const all = await listDorms();
  const current = input.id ? (all.find((d) => d.id === input.id) ?? null) : null;
  const invalid = dormChangeError(input, {
    current,
    others: isDemoMode() ? DORMS : all,
    supervisors: await listHousingSupervisors(),
  });
  if (invalid) throw new Error(invalid);
  const name = input.name.trim();
  if (!isDemoMode()) {
    const { data: b } = await supabase
      .from('branches')
      .select('id')
      .eq('city', input.branch)
      .maybeSingle();
    const row = {
      name,
      branch_id: (b as { id: string } | null)?.id ?? null,
      capacity: input.capacity,
      supervisor_id: input.supervisor_id,
      notes: input.notes?.trim() || null,
      is_active: input.is_active,
    };
    const q = input.id
      ? supabase.from('housing_dorms').update(row).eq('id', input.id).select('id')
      : supabase.from('housing_dorms').insert(row).select('id');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('لا تملك صلاحية إدارة هذا السكن');
    return;
  }
  const sv = DEMO_SUPERVISORS.find((x) => x.id === input.supervisor_id);
  const patch = {
    name,
    branch: input.branch,
    capacity: input.capacity,
    supervisor_id: input.supervisor_id,
    supervisor: sv?.full_name ?? '',
    notes: input.notes?.trim() || null,
    is_active: input.is_active,
  };
  if (current) {
    const row = DORMS.find((d) => d.id === current.id)!;
    // السكن يُعرَف بالاسم في ملف العاملة: تغيير الاسم يتبعه المقيمات
    if (row.name !== name) RESIDENTS.forEach((r) => r.dorm === row.name && (r.dorm = name));
    Object.assign(row, patch);
  } else {
    DORMS.push({ id: `h-${Date.now().toString(36)}`, occupied: 0, ...patch });
  }
}

/**
 * مرآة `guard_worker_dorm` في مخزن العرض: هل يقبل السكن هذه العاملة؟
 * `barcode` = العاملة نفسها (بقاؤها في سكنها الحالي ليس تسكينًا جديدًا).
 */
export function workerDormError(
  dormName: string,
  workerBranch: string,
  barcode: string,
): string | null {
  if (!dormName) return null;
  const resident = RESIDENTS.find((r) => r.barcode === barcode && barcode !== '');
  if (resident?.dorm === dormName) return null;
  const dorm = DORMS.find((d) => d.name === dormName);
  return dormAssignError(dorm ? withOccupancy(dorm) : undefined, workerBranch);
}

interface RawResident {
  id: string;
  full_name: string | null;
  nationality: string | null;
  dorm: string | null;
  branch: string | null;
  status: ResidentStatus;
  check_in: string | null;
  barcode: string | null;
  iqama_no: string | null;
}

const residentOf = (r: RawResident): Resident => ({
  id: r.id,
  full_name: r.full_name ?? '—',
  nationality: r.nationality ?? '',
  dorm: r.dorm ?? '',
  branch: r.branch ?? '',
  status: r.status,
  check_in: r.check_in ?? '',
  barcode: r.barcode ?? '',
  iqama_no: r.iqama_no ?? '',
});

/** العاملات المسكّنات ضمن نطاق المستخدم مع حالة اليوم (list_housing_residents، 0082). */
export async function listResidents(): Promise<Resident[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('list_housing_residents');
    if (error) throw new Error(`تعذّر تحميل العاملات: ${error.message}`);
    return ((data ?? []) as RawResident[]).map(residentOf);
  }
  return scopeToViewerBranch(RESIDENTS, (r) => r.branch).map((r) => ({ ...r }));
}

interface RawHousingScan {
  id: string;
  worker_id: string;
  direction: ScanDirection;
  note: string | null;
  scanned_at: string;
  workers: { full_name: string | null } | null;
  housing_dorms: { name: string | null } | null;
}

export async function listHousingScans(workerId?: string): Promise<HousingScan[]> {
  if (!isDemoMode()) {
    let q = supabase
      .from('housing_scans')
      .select('id, worker_id, direction, note, scanned_at, workers(full_name), housing_dorms(name)')
      .order('scanned_at', { ascending: false })
      .limit(200);
    if (workerId) q = q.eq('worker_id', workerId);
    const { data, error } = await q;
    if (error) throw new Error(`تعذّر تحميل سجل المسح: ${error.message}`);
    return ((data ?? []) as unknown as RawHousingScan[]).map((r) => ({
      id: r.id,
      worker_id: r.worker_id,
      worker_name: r.workers?.full_name ?? '—',
      dorm: r.housing_dorms?.name ?? '',
      direction: r.direction,
      note: r.note,
      scanned_at: r.scanned_at,
    }));
  }
  const branchOf = (s: HousingScan) => RESIDENTS.find((r) => r.id === s.worker_id)?.branch;
  const scoped = scopeToViewerBranch(DEMO_SCANS, branchOf);
  const rows = workerId ? scoped.filter((s) => s.worker_id === workerId) : scoped;
  return [...rows].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));
}

interface RawTarget extends Omit<HousingTarget, 'supervisor' | 'branch'> {
  supervisor: string | null;
  branch: string | null;
}

/**
 * مستهدفات الشهر (أو كلها) ضمن نطاق المستخدم مع المحقَّق المحسوب في الخادم
 * (list_housing_targets، 0083). المشرفة ترى مستهدفاتها، والإدارة مستهدفات فرعها.
 */
export async function listHousingTargets(
  period: { year: number; month: number } | null = null,
): Promise<HousingTarget[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('list_housing_targets', {
      p_year: period?.year ?? null,
      p_month: period?.month ?? null,
    });
    if (error) throw new Error(`تعذّر تحميل المستهدفات: ${error.message}`);
    return ((data ?? []) as RawTarget[]).map((t) => ({
      ...t,
      supervisor: t.supervisor ?? '—',
      branch: t.branch ?? '',
    }));
  }
  const profile = useAuth.getState().profile;
  const rows = DEMO_TARGETS.filter(
    (t) => !period || (t.year === period.year && t.month === period.month),
  ).map(targetOf);
  const visible = rows.filter((t) => t.supervisor_id === profile?.id || inViewerScope(t.branch));
  return visible.sort((a, b) => b.year - a.year || b.month - a.month);
}

/**
 * «مستهدفاتي»: المشرفة ترى مستهدفاتها النشطة؛ الإدارة ترى مستهدفات المشرفات ضمن
 * نطاق فرعها (نفس سياسة htarget_read).
 */
export async function listMyHousingTargets(): Promise<HousingTarget[]> {
  const profile = useAuth.getState().profile;
  const rows = (await listHousingTargets()).filter((t) => t.is_active);
  return profile?.role === 'housing_supervisor'
    ? rows.filter((t) => t.supervisor_id === profile.id)
    : rows;
}

/** إسناد/تعديل/تعطيل مستهدف (housing.manage — RLS + guard_housing_target). */
export async function saveHousingTarget(input: HousingTargetInput): Promise<void> {
  const existing = await listHousingTargets({ year: input.year, month: input.month });
  const invalid = targetChangeError(input, existing);
  if (invalid) throw new Error(invalid);
  const row = {
    occupancy_target_pct: input.occupancy_target_pct,
    attendance_target_pct: input.attendance_target_pct,
    notes: input.notes?.trim() || null,
    is_active: input.is_active,
  };
  if (!isDemoMode()) {
    const q = input.id
      ? supabase.from('housing_targets').update(row).eq('id', input.id).select('id')
      : supabase
          .from('housing_targets')
          .insert({
            ...row,
            supervisor_id: input.supervisor_id,
            month: input.month,
            year: input.year,
          })
          .select('id');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('لا تملك صلاحية إدارة هذا المستهدف');
    return;
  }
  const sv = DEMO_SUPERVISORS.find((x) => x.id === input.supervisor_id);
  if (!sv) throw new Error('المستهدف يُسند لمستخدمة نشطة بدور «مشرفة السكن»');
  if (!inViewerScope(sv.branch)) throw new Error('هذه المشرفة خارج نطاق فرعك');
  const cur = input.id ? DEMO_TARGETS.find((t) => t.id === input.id) : undefined;
  if (cur) Object.assign(cur, row);
  else
    DEMO_TARGETS.push({
      id: `t-${Date.now().toString(36)}`,
      supervisor_id: input.supervisor_id,
      month: input.month,
      year: input.year,
      ...row,
    });
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

/**
 * البحث عن عاملة بالباركود أو رقم الإقامة ضمن نطاق المستخدم (find_worker_by_code، 0082).
 * `outOfScope` = موجودة لكن في فرع آخر.
 */
export async function findWorkerByCode(
  code: string,
): Promise<{ resident: Resident | null; outOfScope: boolean }> {
  if (isDemoMode()) return resolveResidentForViewer(code);
  const { data, error } = await supabase.rpc('find_worker_by_code', { p_code: code.trim() });
  if (error) {
    if (error.message.includes('خارج نطاق')) return { resident: null, outOfScope: true };
    throw new Error(error.message);
  }
  const row = ((data ?? []) as RawResident[])[0];
  if (!row) return { resident: null, outOfScope: false };
  // حالة اليوم وتاريخ السكن من قائمة المقيمات إن كانت مسكّنة
  const listed = (await listResidents().catch(() => [])).find((r) => r.id === row.id);
  return {
    resident: listed ?? residentOf({ ...row, status: 'absent', check_in: null }),
    outOfScope: false,
  };
}

/* ------------------------------ mutations -------------------------------- */
/** Take attendance for one worker (housing_attendance upsert). */
export async function markAttendance(residentId: string, status: ResidentStatus): Promise<void> {
  if (!isDemoMode()) {
    // اليوم بتوقيت الرياض (نفس الخادم)؛ السكن يُملأ من ملف العاملة (0082)
    const { error } = await supabase
      .from('housing_attendance')
      .upsert(
        { worker_id: residentId, date: nowRiyadh().date, status },
        { onConflict: 'worker_id,date' },
      );
    if (error) throw new Error(error.message);
    return;
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
  if (!isDemoMode()) {
    // الخادم يتحقق من الباركود/الإقامة والنطاق والصلاحية ويسجّل الحضور عند الدخول
    const { data, error } = await supabase.rpc('log_housing_scan', {
      p_barcode: code.trim(),
      p_direction: direction,
      p_note: note,
    });
    if (error) throw new Error(error.message);
    const id = (data as { id?: string } | null)?.id;
    const found = (await listResidents()).find((r) => r.id === id);
    if (found) return found;
    const w = data as {
      id: string;
      full_name: string | null;
      barcode: string | null;
      iqama_no: string | null;
    };
    return residentOf({
      ...w,
      nationality: null,
      dorm: null,
      branch: null,
      status: direction === 'in' ? 'present' : 'absent',
      check_in: null,
    });
  }
  const worker = resolveWorkerByBarcode(code);
  if (!worker) throw new Error('لا توجد عاملة بهذا الباركود');
  if (!inViewerScope(worker.branch)) throw new Error(OUT_OF_BRANCH);
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
