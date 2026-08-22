import { supabase } from '@/shared/lib/supabase';
import { useAuth } from '@/store/auth';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { DEMO_DRIVER_ID } from '@/features/orders/api/orders.api';
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
    scan_type: 'warehouse_out',
    subject: 'العاملة ماريا سانتوس',
    lat: 17.49,
    lng: 44.13,
    scanned_at: '2026-06-12T08:00:00Z',
  },
  {
    id: 's2',
    scan_type: 'customer_arrived',
    subject: 'العميل محمد الأحمدي',
    lat: 17.52,
    lng: 44.18,
    scanned_at: '2026-06-12T08:25:00Z',
  },
  {
    id: 's3',
    scan_type: 'service_end',
    subject: 'العميل سارة القحطاني',
    lat: 16.89,
    lng: 42.55,
    scanned_at: '2026-06-12T08:35:00Z',
  },
  {
    id: 's4',
    scan_type: 'warehouse_in',
    subject: 'العاملة سيتي نورهاليزا',
    lat: 17.49,
    lng: 44.13,
    scanned_at: '2026-06-12T07:05:00Z',
  },
];

export async function listDriverLocations(): Promise<DriverLocation[]> {
  // Live positions are fed by the driver app into scans_log; until that data
  // (and a maps key) exist, show representative fallback positions.
  // A driver only ever sees his own position — never the rest of the fleet.
  const profile = useAuth.getState().profile;
  if (profile?.role === 'driver') {
    return FALLBACK_LOCATIONS.filter((l) => l.id === profile.id);
  }
  return FALLBACK_LOCATIONS;
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
): Promise<{ worker_name: string; scan_label: string }> {
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
  MY_TRIP_SCANS.unshift({
    id: `trip-${++tripSeq}`,
    scan_type: scanType,
    subject: `العاملة ${worker.full_name}`,
    lat: lat ?? 0,
    lng: lng ?? 0,
    scanned_at: new Date().toISOString(),
  });
  return { worker_name: worker.full_name, scan_label: SCAN_TYPE_LABEL[scanType] ?? scanType };
}

interface RawScan {
  id: string;
  scan_type: string;
  latitude: number | null;
  longitude: number | null;
  scanned_at: string;
  workers: { full_name: string | null } | null;
}

export async function listRecentScans(): Promise<ScanEvent[]> {
  try {
    const { data, error } = await supabase
      .from('scans_log')
      .select('id, scan_type, latitude, longitude, scanned_at, workers(full_name)')
      .order('scanned_at', { ascending: false })
      .limit(20);
    if (!error && data && data.length > 0) {
      return (data as unknown as RawScan[]).map((r) => ({
        id: r.id,
        scan_type: r.scan_type,
        subject: r.workers?.full_name ?? '—',
        lat: r.latitude ?? 0,
        lng: r.longitude ?? 0,
        scanned_at: r.scanned_at,
      }));
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_SCANS;
}
