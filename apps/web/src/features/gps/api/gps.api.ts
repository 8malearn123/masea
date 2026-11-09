import { supabase } from '@/shared/lib/supabase';
import { useAuth } from '@/store/auth';
import { isDemoId, isDemoMode, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { scopeToViewerBranch, viewerScope } from '@/lib/branchScope';
import { DEMO_DRIVER_ID, advanceTripStage, listDrivers } from '@/features/orders/api/orders.api';
import type { Order, OrderStatus } from '@/features/orders/types';
import { resolveWorkerByBarcode } from '@/features/housing/api/housing.api';
import { SCAN_TYPE_LABEL, type DriverLocation, type ScanEvent } from '@/features/gps/types';

const FALLBACK_LOCATIONS: DriverLocation[] = [
  // the demo driver's own position (ماجد الحربي — نجران)
  {
    id: DEMO_DRIVER_ID,
    full_name: 'ماجد الحربي',
    status: 'on_route',
    vehicle_no: 'NJR-7781',
    branch: 'نجران',
    lat: 17.5031,
    lng: 44.1561,
    updated_at: '2026-06-17T07:25:00Z',
  },
  {
    id: 'd1',
    full_name: 'عبدالرحمن الفيفي',
    status: 'on_route',
    vehicle_no: 'ABC-1234',
    branch: 'نجران',
    lat: 17.4917,
    lng: 44.1322,
    updated_at: '2026-06-12T08:40:00Z',
  },
  {
    id: 'd2',
    full_name: 'سلطان آل سعيد',
    status: 'on_route',
    vehicle_no: 'DEF-5678',
    branch: 'جازان',
    lat: 16.8892,
    lng: 42.5511,
    updated_at: '2026-06-12T08:36:00Z',
  },
  {
    id: 'd3',
    full_name: 'تركي الحارثي',
    status: 'available',
    vehicle_no: 'GHI-9012',
    branch: 'شرورة',
    lat: 17.4866,
    lng: 47.1071,
    updated_at: '2026-06-12T08:30:00Z',
  },
  {
    id: 'd4',
    full_name: 'ناصر القرني',
    status: 'off_duty',
    vehicle_no: 'JKL-3456',
    branch: 'حبونا',
    lat: 17.7333,
    lng: 44.0667,
    updated_at: '2026-06-12T07:10:00Z',
  },
];

const FALLBACK_SCANS: ScanEvent[] = [
  {
    id: 's1',
    branch: 'نجران',
    scan_type: 'warehouse_out',
    subject: 'العاملة ماريا سانتوس',
    lat: 17.49,
    lng: 44.13,
    scanned_at: '2026-06-12T08:00:00Z',
  },
  {
    id: 's2',
    branch: 'نجران',
    scan_type: 'customer_arrived',
    subject: 'العميل محمد الأحمدي',
    lat: 17.52,
    lng: 44.18,
    scanned_at: '2026-06-12T08:25:00Z',
  },
  {
    id: 's3',
    branch: 'جازان',
    scan_type: 'service_end',
    subject: 'العميل سارة القحطاني',
    lat: 16.89,
    lng: 42.55,
    scanned_at: '2026-06-12T08:35:00Z',
  },
  {
    id: 's4',
    branch: 'نجران',
    scan_type: 'warehouse_in',
    subject: 'العاملة سيتي نورهاليزا',
    lat: 17.49,
    lng: 44.13,
    scanned_at: '2026-06-12T07:05:00Z',
  },
];

const isDriverViewer = () => useAuth.getState().profile?.role === 'driver';

/** «اليوم» بالتوقيت المحلي — مؤشر «عمليات مسح اليوم» لا يعدّ الأيام السابقة. */
export function isToday(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

interface RawPosition {
  driver_id: string | null;
  latitude: number | null;
  longitude: number | null;
  scanned_at: string;
}

/**
 * مواقع السائقين: حالة السائق من جدول السائقين، والموقع = آخر مسح سجّله
 * (`scans_log` يحمل driver_id والإحداثيات). السائق يرى موقعه فقط، ومدير الفرع
 * سائقي فرعه فقط (RLS على الخادم، و`scopeToViewerBranch` في العرض).
 */
export async function listDriverLocations(): Promise<DriverLocation[]> {
  const profile = useAuth.getState().profile;
  const drivers = await listDrivers();
  if (isDemoMode()) {
    const rows = drivers.map((d) => {
      const pos = FALLBACK_LOCATIONS.find((l) => l.id === d.id);
      const mine =
        d.id === DEMO_DRIVER_ID
          ? MY_TRIP_SCANS.find((s) => s.lat !== null && s.lng !== null)
          : undefined;
      return {
        id: d.id,
        full_name: d.full_name,
        status: d.status,
        vehicle_no: d.vehicle_no,
        branch: d.branch,
        lat: mine?.lat ?? pos?.lat ?? null,
        lng: mine?.lng ?? pos?.lng ?? null,
        updated_at: mine?.scanned_at ?? pos?.updated_at ?? null,
      };
    });
    return profile?.role === 'driver' ? rows.filter((l) => l.id === profile.id) : rows;
  }
  const { data, error } = await supabase
    .from('scans_log')
    .select('driver_id, latitude, longitude, scanned_at')
    .not('driver_id', 'is', null)
    .not('latitude', 'is', null)
    .order('scanned_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const latest = new Map<string, RawPosition>();
  for (const r of (data ?? []) as RawPosition[]) {
    if (r.driver_id && !latest.has(r.driver_id)) latest.set(r.driver_id, r);
  }
  let rows: DriverLocation[] = drivers.map((d) => {
    const p = latest.get(d.id);
    return {
      id: d.id,
      full_name: d.full_name,
      status: d.status,
      vehicle_no: d.vehicle_no,
      branch: d.branch,
      lat: p?.latitude ?? null,
      lng: p?.longitude ?? null,
      updated_at: p?.scanned_at ?? null,
    };
  });
  if (profile?.role === 'driver') {
    const own = await myDriverId();
    rows = rows.filter((l) => l.id === own);
  }
  return rows;
}

/** سجل السائق المرتبط بالحساب الحالي (drivers.user_id). */
async function myDriverId(): Promise<string | null> {
  const uid = useAuth.getState().profile?.id;
  if (!uid) return null;
  const { data } = await supabase.from('drivers').select('id').eq('user_id', uid).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/* ----------------------- driver trip scans (barcode) --------------------- */
let tripSeq = 500;
/** The current driver's trip scans this session (demo + optimistic). */
const MY_TRIP_SCANS: ScanEvent[] = [];

export async function listMyTripScans(): Promise<ScanEvent[]> {
  return [...MY_TRIP_SCANS];
}

/** Driver scans a worker's barcode at a trip leg → logs a scan event. */
export async function logTripScan(
  barcode: string,
  scanType: string,
  lat: number | null = null,
  lng: number | null = null,
  requestNo: string | null = null,
): Promise<{ id: string; worker_name: string; scan_label: string }> {
  const worker = resolveWorkerByBarcode(barcode);
  if (!worker) throw new Error('لا توجد عاملة بهذا الباركود');

  if (!isDemoId(worker.id)) {
    const { error } = await supabase.rpc('log_trip_scan', {
      p_barcode: barcode.trim(),
      p_scan_type: scanType,
      p_lat: lat,
      p_lng: lng,
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  }
  const id = `trip-${++tripSeq}`;
  MY_TRIP_SCANS.unshift({
    id,
    scan_type: scanType,
    subject: `العاملة ${worker.full_name}`,
    lat,
    lng,
    scanned_at: new Date().toISOString(),
    branch: viewerScope().branch,
    ...(requestNo ? { request_no: requestNo } : {}),
  });
  return { id, worker_name: worker.full_name, scan_label: SCAN_TYPE_LABEL[scanType] ?? scanType };
}

/**
 * مسح خطوة رحلة من شاشة السائق: يُسجَّل المسح أولًا (يتحقق من الباركود، ويبقى
 * دليل المحاولة في السجل دائمًا)، ثم تُطبَّق الخطوة على الطلب عبر
 * `advanceTripStage` بقواعده المركزية. النتيجة تُوسم على سجل المسح نفسه:
 * «مقبول»، أو «مرفوض» مع السبب — والطلب والرحلة بلا تغيير عند الرفض.
 */
export async function recordTripScan(input: {
  orderId: string;
  requestNo: string;
  barcode: string;
  scanType: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<{
  id: string;
  worker_name: string;
  scan_label: string;
  stage: Order['trip_stage'];
  status: OrderStatus;
}> {
  const logged = await logTripScan(
    input.barcode,
    input.scanType,
    input.lat ?? null,
    input.lng ?? null,
    input.requestNo,
  );
  const entry = MY_TRIP_SCANS.find((e) => e.id === logged.id);
  try {
    const result = await advanceTripStage(input.orderId, input.scanType);
    if (entry) entry.outcome = 'accepted';
    return { ...logged, ...result };
  } catch (e) {
    if (entry) {
      entry.outcome = 'rejected';
      entry.reason = e instanceof Error ? e.message : 'تعذّر تطبيق المسح';
    }
    throw e;
  }
}

interface RawScan {
  id: string;
  scan_type: string;
  driver_id: string | null;
  latitude: number | null;
  longitude: number | null;
  scanned_at: string;
  workers: { full_name: string | null } | null;
}

/**
 * سجل الحركة: السائق يرى مسحاته فقط؛ الإدارة ترى مسح الأسطول ضمن نطاق فرعها.
 * خادم حقيقي بلا مسح = سجل فارغ (لا بيانات تجريبية).
 */
export async function listRecentScans(): Promise<ScanEvent[]> {
  if (isDemoMode()) {
    if (isDriverViewer()) return [...MY_TRIP_SCANS];
    const rows = [...MY_TRIP_SCANS, ...FALLBACK_SCANS].sort((a, b) =>
      b.scanned_at.localeCompare(a.scanned_at),
    );
    return scopeToViewerBranch(rows, (s) => s.branch);
  }
  let q = supabase
    .from('scans_log')
    .select('id, scan_type, driver_id, latitude, longitude, scanned_at, workers(full_name)')
    .order('scanned_at', { ascending: false })
    .limit(50);
  if (isDriverViewer()) {
    const own = await myDriverId();
    if (!own) return [];
    q = q.eq('driver_id', own);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawScan[]).map((r) => ({
    id: r.id,
    scan_type: r.scan_type,
    subject: r.workers?.full_name ? `العاملة ${r.workers.full_name}` : '—',
    lat: r.latitude,
    lng: r.longitude,
    scanned_at: r.scanned_at,
  }));
}
