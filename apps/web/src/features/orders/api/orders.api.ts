import { supabase } from '@/shared/lib/supabase';
import { useAuth } from '@/store/auth';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { tripScanResult } from '@/features/orders/lib/trip';
import type { Driver, Order, OrderFilters, OrderStatus } from '@/features/orders/types';

/** The demo driver account id (mirrors demoProfile id for that role). */
export const DEMO_DRIVER_ID = 'demo-driver';

/* ----------------------------- fallback data ----------------------------- */
const FALLBACK_DRIVERS: Driver[] = [
  {
    id: 'd1',
    full_name: 'عبدالرحمن الفيفي',
    phone: '0501112233',
    branch: 'نجران',
    status: 'available',
    vehicle_no: 'ABC-1234',
    rating: 4.8,
  },
  {
    id: 'd2',
    full_name: 'سلطان آل سعيد',
    phone: '0502223344',
    branch: 'جازان',
    status: 'on_route',
    vehicle_no: 'DEF-5678',
    rating: 4.6,
  },
  {
    id: 'd3',
    full_name: 'تركي الحارثي',
    phone: '0503334455',
    branch: 'شرورة',
    status: 'available',
    vehicle_no: 'GHI-9012',
    rating: 4.9,
  },
  {
    id: 'd4',
    full_name: 'ناصر القرني',
    phone: '0504445566',
    branch: 'حبونا',
    status: 'off_duty',
    vehicle_no: 'JKL-3456',
    rating: 4.5,
  },
];

const FALLBACK_ORDERS: Order[] = [
  {
    id: 'o1',
    request_no: 'REQ-1A2B3C4D',
    customer_name: 'محمد الأحمدي',
    service_code: 'recruitment',
    branch: 'نجران',
    status: 'paid',
    driver_id: null,
    driver_name: null,
    total_amount: 18400,
    created_at: '2026-02-11T09:00:00Z',
    trip_stage: 'none',
  },
  {
    id: 'o2',
    request_no: 'REQ-2B3C4D5E',
    customer_name: 'سارة القحطاني',
    service_code: 'monthly_rental',
    branch: 'جازان',
    status: 'assigned',
    driver_id: 'd2',
    driver_name: 'سلطان آل سعيد',
    total_amount: 7590,
    created_at: '2026-02-10T11:00:00Z',
    trip_stage: 'none',
  },
  {
    id: 'o3',
    request_no: 'REQ-3C4D5E6F',
    customer_name: 'فهد العنزي',
    service_code: 'daily_rental',
    branch: 'شرورة',
    status: 'in_progress',
    driver_id: 'd3',
    driver_name: 'تركي الحارثي',
    total_amount: 506,
    created_at: '2026-02-12T08:00:00Z',
    trip_stage: 'delivered',
  },
  {
    id: 'o4',
    request_no: 'REQ-4D5E6F7G',
    customer_name: 'نورة الشهري',
    service_code: 'sponsorship_transfer',
    branch: 'نجران',
    status: 'completed',
    driver_id: null,
    driver_name: null,
    total_amount: 2300,
    created_at: '2026-02-01T10:00:00Z',
    trip_stage: 'returned',
  },
  {
    id: 'o5',
    request_no: 'REQ-5E6F7G8H',
    customer_name: 'عبدالله الدوسري',
    service_code: 'daily_rental',
    branch: 'حبونا',
    status: 'new',
    driver_id: null,
    driver_name: null,
    total_amount: 253,
    created_at: '2026-02-12T13:00:00Z',
    trip_stage: 'none',
  },
  {
    id: 'o6',
    request_no: 'REQ-6F7G8H9I',
    customer_name: 'ريم المالكي',
    service_code: 'monthly_rental',
    branch: 'جازان',
    status: 'cancelled',
    driver_id: null,
    driver_name: null,
    total_amount: 6600,
    created_at: '2026-01-28T09:00:00Z',
    trip_stage: 'none',
  },
  // Trips assigned to the demo driver (ماجد الحربي — نجران) so "رحلاتي" is populated.
  {
    id: 'o7',
    request_no: 'REQ-7G8H9I0J',
    customer_name: 'محمد الأحمدي',
    service_code: 'recruitment',
    branch: 'نجران',
    status: 'assigned',
    driver_id: DEMO_DRIVER_ID,
    driver_name: 'ماجد الحربي',
    total_amount: 18400,
    created_at: '2026-06-17T07:30:00Z',
    trip_stage: 'none',
    customer_phone: '0551234567',
    customer_address: 'نجران - حي الفيصلية، شارع الملك عبدالعزيز',
    dropoff_at: '2026-06-17T09:00:00Z',
    pickup_at: null,
  },
  {
    id: 'o8',
    request_no: 'REQ-8H9I0J1K',
    customer_name: 'نورة الشهري',
    service_code: 'daily_rental',
    branch: 'نجران',
    status: 'in_progress',
    driver_id: DEMO_DRIVER_ID,
    driver_name: 'ماجد الحربي',
    total_amount: 506,
    created_at: '2026-06-17T06:10:00Z',
    trip_stage: 'picked_up',
    customer_phone: '0567778899',
    customer_address: 'نجران - حي النهضة، طريق الأمير مشعل',
    dropoff_at: '2026-06-17T07:30:00Z',
    pickup_at: '2026-06-17T17:00:00Z',
  },
  {
    id: 'o9',
    request_no: 'REQ-9I0J1K2L',
    customer_name: 'فهد العنزي',
    service_code: 'monthly_rental',
    branch: 'نجران',
    status: 'completed',
    driver_id: DEMO_DRIVER_ID,
    driver_name: 'ماجد الحربي',
    total_amount: 7590,
    created_at: '2026-06-16T15:00:00Z',
    trip_stage: 'returned',
    customer_phone: '0509998877',
    customer_address: 'نجران - حي الفهد، شارع السلام',
    dropoff_at: '2026-06-16T08:00:00Z',
    pickup_at: '2026-06-16T14:30:00Z',
  },
];

/**
 * Register a freshly-created order (from the sales funnel or the call-center
 * deal-close) into the demo orders store so it appears on the dispatch board.
 * In production these come from the service_requests table via Supabase.
 */
export function addLocalOrder(input: {
  request_no: string;
  customer_name: string | null;
  service_code: Order['service_code'];
  branch: string | null;
  total_amount: number;
  beneficiary_type?: string | null;
  event_type?: string | null;
}): void {
  FALLBACK_ORDERS.unshift({
    id: `o-${Date.now()}`,
    request_no: input.request_no,
    customer_name: input.customer_name,
    service_code: input.service_code,
    branch: input.branch,
    status: 'paid',
    driver_id: null,
    driver_name: null,
    total_amount: input.total_amount,
    created_at: new Date().toISOString(),
    trip_stage: 'none',
    beneficiary_type: input.beneficiary_type ?? null,
    event_type: input.event_type ?? null,
  });
}

/** Demo-only: mutate a fallback order in place so offline writes are visible. */
export function demoMutateOrder(id: string, patch: Partial<Order>): boolean {
  const row = FALLBACK_ORDERS.find((o) => o.id === id);
  if (!row) return false;
  Object.assign(row, patch);
  return true;
}

/**
 * A driver must only ever see the trips assigned to him. The backend enforces
 * this in RLS; in demo mode (no Supabase) we mirror it here so the offline
 * experience matches the secured one. Other roles see the full dispatch book.
 */
function scopeForViewer(rows: Order[]): Order[] {
  const profile = useAuth.getState().profile;
  if (profile?.role === 'driver') {
    return rows.filter((o) => o.driver_id === profile.id);
  }
  return rows;
}

function applyFilters(rows: Order[], f: OrderFilters): Order[] {
  return rows.filter((r) => {
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.branch !== 'all' && r.branch !== f.branch) return false;
    if (f.search.trim()) {
      const hay = `${r.request_no} ${r.customer_name ?? ''}`;
      if (!hay.includes(f.search.trim())) return false;
    }
    return true;
  });
}

interface RawOrder {
  id: string;
  request_no: string;
  customer_name: string | null;
  service_code: Order['service_code'];
  status: OrderStatus;
  driver_id: string | null;
  total_amount: number;
  created_at: string;
  trip_stage: Order['trip_stage'];
  customer_phone: string | null;
  customer_address: string | null;
  dropoff_at: string | null;
  pickup_at: string | null;
  branches: { name: string | null } | null;
  drivers: { full_name: string | null } | null;
}

interface RawDriver {
  id: string;
  full_name: string;
  phone: string | null;
  status: Driver['status'];
  vehicle_no: string | null;
  rating: number | null;
  branches: { name: string | null } | null;
}

/* ------------------------------- queries --------------------------------- */
export async function listOrders(filters: OrderFilters): Promise<Order[]> {
  try {
    const { data, error } = await supabase
      .from('service_requests')
      .select(
        'id, request_no, customer_name, service_code, status, driver_id, total_amount, created_at, trip_stage, customer_phone, customer_address, dropoff_at, pickup_at, branches(name), drivers(full_name)',
      )
      .order('created_at', { ascending: false });
    if (!error && data && data.length > 0) {
      const rows = (data as unknown as RawOrder[]).map(({ branches, drivers, ...rest }) => ({
        ...rest,
        branch: branches?.name ?? null,
        driver_name: drivers?.full_name ?? null,
      }));
      return applyFilters(scopeForViewer(rows), filters);
    }
  } catch {
    /* fall through */
  }
  return applyFilters(scopeForViewer(FALLBACK_ORDERS), filters);
}

export async function listDrivers(): Promise<Driver[]> {
  try {
    const { data, error } = await supabase
      .from('drivers')
      .select('id, full_name, phone, status, vehicle_no, rating, branches(name)')
      .order('full_name', { ascending: true });
    if (!error && data && data.length > 0) {
      return (data as unknown as RawDriver[]).map(({ branches, rating, ...rest }) => ({
        ...rest,
        branch: branches?.name ?? null,
        rating: rating ?? 0,
      }));
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_DRIVERS;
}

/* ------------------------------ mutations -------------------------------- */
export async function assignDriver(orderId: string, driverId: string): Promise<void> {
  // Demo order/driver → keep the optimistic update; no real row to write.
  if (isDemoId(orderId) || isDemoId(driverId)) return;
  const { error } = await supabase.rpc('assign_order_driver', {
    p_order_id: orderId,
    p_driver_id: driverId,
  });
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

export async function setOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  if (isDemoId(orderId)) return; // demo order — optimistic update is the truth
  const { error } = await supabase.rpc('set_order_status', {
    p_order_id: orderId,
    p_status: status,
  });
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

/**
 * Advance a trip from a scan event: sets the order's trip_stage + status so the
 * driver's board reflects the worker boarding / handover. Returns the new stage.
 */
export async function advanceTripStage(
  orderId: string,
  scanType: string,
): Promise<{ stage: Order['trip_stage']; status: OrderStatus }> {
  const result = tripScanResult(scanType);
  if (!result) throw new Error('نوع مسح غير صحيح');
  if (!isDemoId(orderId)) {
    const { error } = await supabase.rpc('advance_trip_stage', {
      p_order_id: orderId,
      p_scan_type: scanType,
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  }
  demoMutateOrder(orderId, { trip_stage: result.stage, status: result.status });
  return result;
}
