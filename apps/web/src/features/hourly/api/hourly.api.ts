/**
 * حجوزات التأجير بالساعة — جدول `worker_bookings` (0065).
 * مع قاعدة البيانات: book_hourly يسعّر ويفحص التوفّر ويحجز وينشئ الطلب ومسودة
 * العقد في معاملة واحدة، وقيد الاستبعاد يمنع التعارض حتى مع حجزين متزامنين.
 * في الوضع التجريبي تُطبَّق نفس القواعد على مخزن العرض.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { scopeToViewerBranch, viewerScope } from '@/lib/branchScope';
import { recordAudit } from '@/shared/lib/auditTrail';
import { listPricingRules, getPricingConfig } from '@/features/pricing/api/pricing.api';
import { calculate, EMPTY_CALC } from '@/features/pricing/lib/engine';
import { addDemoHourlyContract, getTemplates } from '@/features/contracts/api/contracts.api';
import { renderClauses } from '@/features/contracts/lib/clauses';
import { addLocalOrder } from '@/features/orders/api/orders.api';
import { listConfig, configValue } from '@/features/settings/api/settings.api';
import {
  conflictFor,
  DEFAULT_HOURLY_CONFIG,
  hoursBetween,
  validateHours,
  type BookingStatus,
  type HourlyConfig,
  type Slot,
} from '@/features/hourly/lib/hourly';

export interface HourlyBooking {
  id: string;
  booking_no: number;
  worker_profile_id: string;
  worker_name: string | null;
  branch: string | null;
  profession: string | null;
  booking_date: string; // yyyy-mm-dd
  start_time: string; // HH:MM (Riyadh)
  end_time: string;
  hours: number;
  status: BookingStatus;
  actual_start_at: string | null;
  actual_end_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  hourly_rate: number;
  base_amount: number;
  discount_amount: number;
  vat_amount: number;
  total_amount: number;
  contract_id: string | null;
  contract_no: string | null;
  notes: string | null;
  created_at: string;
}

export interface BookingInput {
  worker_profile_id: string;
  worker_name: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  profession: string;
  customer_name: string;
  customer_phone: string;
  address: string | null;
  notes: string | null;
  branch: string | null;
}

export async function getHourlyConfig(): Promise<HourlyConfig> {
  const items = await listConfig();
  const d = DEFAULT_HOURLY_CONFIG;
  return {
    minHours: configValue(items, 'hourly_min_hours', d.minHours),
    maxHours: configValue(items, 'hourly_max_hours', d.maxHours),
    bufferMinutes: configValue(items, 'hourly_buffer_minutes', d.bufferMinutes),
    slotMinutes: configValue(items, 'hourly_slot_minutes', d.slotMinutes),
  };
}

/* ------------------------------ demo store ---------------------------------- */
const iso = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};
let seq = 0;
let bookingNo = 100;

function demoBooking(o: {
  worker_profile_id: string;
  worker_name: string;
  branch: string;
  profession: string;
  day: number;
  start: string;
  end: string;
  status: BookingStatus;
  customer: string;
  phone: string;
  rate: number;
}): HourlyBooking {
  const hours = hoursBetween(o.start, o.end);
  const base = Math.round(o.rate * hours * 100) / 100;
  const vat = Math.round(base * 0.15 * 100) / 100;
  return {
    id: `hb-${++seq}`,
    booking_no: ++bookingNo,
    worker_profile_id: o.worker_profile_id,
    worker_name: o.worker_name,
    branch: o.branch,
    profession: o.profession,
    booking_date: iso(o.day),
    start_time: o.start,
    end_time: o.end,
    hours,
    status: o.status,
    actual_start_at:
      o.status === 'completed' || o.status === 'in_progress'
        ? `${iso(o.day)}T${o.start}:00+03:00`
        : null,
    actual_end_at: o.status === 'completed' ? `${iso(o.day)}T${o.end}:00+03:00` : null,
    customer_name: o.customer,
    customer_phone: o.phone,
    address: `${o.branch} — حي الفيصلية`,
    hourly_rate: o.rate,
    base_amount: base,
    discount_amount: 0,
    vat_amount: vat,
    total_amount: base + vat,
    contract_id: null,
    contract_no: null,
    notes: null,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
  };
}

// demo worker ids = FALLBACK_WORKERS ids (lib/funnel)
const DEMO_BOOKINGS: HourlyBooking[] = [
  demoBooking({
    worker_profile_id: 'w1',
    worker_name: 'ماريا سانتوس',
    branch: 'نجران',
    profession: 'تنظيف',
    day: 0,
    start: '08:00',
    end: '12:00',
    status: 'in_progress',
    customer: 'جواهر آل منصور',
    phone: '0554000001',
    rate: 38,
  }),
  demoBooking({
    worker_profile_id: 'w3',
    worker_name: 'سيتي نورهاليزا',
    branch: 'نجران',
    profession: 'طبخ',
    day: 0,
    start: '14:00',
    end: '20:00',
    status: 'booked',
    customer: 'نوال اليامي',
    phone: '0554000004',
    rate: 50,
  }),
  demoBooking({
    worker_profile_id: 'w5',
    worker_name: 'غريس وانجيرو',
    branch: 'جازان',
    profession: 'رعاية',
    day: 0,
    start: '09:00',
    end: '15:00',
    status: 'booked',
    customer: 'عبير الحارثي',
    phone: '0554000005',
    rate: 55,
  }),
  demoBooking({
    worker_profile_id: 'w2',
    worker_name: 'غريس ريّس',
    branch: 'جازان',
    profession: 'تنظيف',
    day: 1,
    start: '10:00',
    end: '16:00',
    status: 'booked',
    customer: 'هند المدخلي',
    phone: '0554000006',
    rate: 40,
  }),
  demoBooking({
    worker_profile_id: 'w7',
    worker_name: 'سارة ناكاتو',
    branch: 'شرورة',
    profession: 'تنظيف',
    day: -1,
    start: '08:00',
    end: '13:00',
    status: 'completed',
    customer: 'منيرة الصيعري',
    phone: '0554000007',
    rate: 40,
  }),
  demoBooking({
    worker_profile_id: 'w9',
    worker_name: 'روكسانا بيغم',
    branch: 'حبونا',
    profession: 'رعاية',
    day: -2,
    start: '16:00',
    end: '22:00',
    status: 'completed',
    customer: 'لطيفة آل سالم',
    phone: '0554000008',
    rate: 55,
  }),
  demoBooking({
    worker_profile_id: 'w1',
    worker_name: 'ماريا سانتوس',
    branch: 'نجران',
    profession: 'تنظيف',
    day: -3,
    start: '09:00',
    end: '13:00',
    status: 'cancelled',
    customer: 'سلمى الدوسري',
    phone: '0554000009',
    rate: 38,
  }),
];

/* ------------------------------- queries ------------------------------------ */
const riyadhTime = (isoTs: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoTs));

interface RawBooking extends Omit<
  HourlyBooking,
  'branch' | 'start_time' | 'end_time' | 'contract_no'
> {
  start_at: string;
  end_at: string;
  branches: { city: string | null } | null;
  contracts: { contract_no: string | null } | null;
}

export async function listBookings(): Promise<HourlyBooking[]> {
  if (isDemoMode()) {
    return scopeToViewerBranch([...DEMO_BOOKINGS], (b) => b.branch).sort((a, b) =>
      `${b.booking_date}${b.start_time}`.localeCompare(`${a.booking_date}${a.start_time}`),
    );
  }
  const { data, error } = await supabase
    .from('worker_bookings')
    .select('*, branches(city), contracts(contract_no)')
    .order('start_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`تعذّر جلب الحجوزات: ${error.message}`);
  return ((data ?? []) as unknown as RawBooking[]).map(
    ({ branches, contracts, start_at, end_at, ...b }) => ({
      ...b,
      hours: Number(b.hours),
      hourly_rate: Number(b.hourly_rate),
      base_amount: Number(b.base_amount),
      discount_amount: Number(b.discount_amount),
      vat_amount: Number(b.vat_amount),
      total_amount: Number(b.total_amount),
      start_time: riyadhTime(start_at),
      end_time: riyadhTime(end_at),
      branch: branches?.city ?? null,
      contract_no: contracts?.contract_no ?? null,
    }),
  );
}

/* ------------------------------- writes ------------------------------------- */
export async function bookHourly(input: BookingInput): Promise<HourlyBooking> {
  const cfg = await getHourlyConfig();
  const err = validateHours(input.start_time, input.end_time, cfg);
  if (err) throw new Error(err);
  if (input.customer_name.trim().length < 3) throw new Error('اسم العميل مطلوب');
  if (!/^05\d{8}$/.test(input.customer_phone.trim()))
    throw new Error('رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام');
  const now = new Date();
  const todayRiyadh = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now);
  if (input.booking_date < todayRiyadh) throw new Error('تاريخ الحجز لا يسبق اليوم');
  if (input.booking_date === todayRiyadh && input.start_time <= riyadhTime(now.toISOString()))
    throw new Error('وقت الوصول مضى — اختر وقتًا لاحقًا');

  const scope = viewerScope();
  const branch = scope.crossBranch ? input.branch : scope.branch;
  if (!branch) throw new Error('حدّد الفرع');

  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('book_hourly', {
      p_input: { ...input, branch },
    });
    if (error) throw new Error(error.message);
    const rows = await listBookings();
    return rows.find((b) => b.id === (data as { id: string }).id) ?? (data as HourlyBooking);
  }

  const clash = conflictFor(DEMO_BOOKINGS, { ...input }, cfg);
  if (clash)
    throw new Error(
      `العاملة محجوزة في هذه الفترة (${clash.start_time}–${clash.end_time}) — اختر وقتًا أو عاملة أخرى`,
    );

  const hours = hoursBetween(input.start_time, input.end_time);
  const [rules, pcfg, templates] = await Promise.all([
    listPricingRules(),
    getPricingConfig(),
    getTemplates(),
  ]);
  const price = calculate(
    {
      ...EMPTY_CALC,
      service: 'hourly_rental',
      profession: input.profession,
      quantity: hours,
      branch,
    },
    rules,
    pcfg,
  );
  if (price.blockers.length) throw new Error(price.blockers.join(' · '));
  const template = templates.find((t) => t.service_code === 'hourly_rental' && t.is_active);
  const contract = addDemoHourlyContract({
    customer_name: input.customer_name.trim(),
    branch,
    date: input.booking_date,
    amounts: {
      gross: price.detail.base,
      discount: price.detail.discounts,
      net: price.detail.net,
      vat: price.detail.vat,
      total: price.detail.total,
    },
    clauses: template
      ? renderClauses(template.clauses, {
          customer_name: input.customer_name.trim(),
          task: input.profession,
          duration: String(hours),
        })
      : [],
    notes: input.notes,
  });
  addLocalOrder({
    request_no: `REQ-H${Date.now().toString(36).toUpperCase().slice(-7)}`,
    customer_name: input.customer_name.trim(),
    service_code: 'hourly_rental',
    branch,
    total_amount: price.detail.total,
    contract: { id: contract.id, contract_no: contract.contract_no },
    status: 'new',
  });
  const row: HourlyBooking = {
    id: `hb-${Date.now()}-${++seq}`,
    booking_no: ++bookingNo,
    worker_profile_id: input.worker_profile_id,
    worker_name: input.worker_name,
    branch,
    profession: input.profession,
    booking_date: input.booking_date,
    start_time: input.start_time,
    end_time: input.end_time,
    hours,
    status: 'booked',
    actual_start_at: null,
    actual_end_at: null,
    customer_name: input.customer_name.trim(),
    customer_phone: input.customer_phone.trim(),
    address: input.address,
    hourly_rate: price.unitPrice,
    base_amount: price.detail.net,
    discount_amount: price.detail.discounts,
    vat_amount: price.detail.vat,
    total_amount: price.detail.total,
    contract_id: contract.id,
    contract_no: contract.contract_no,
    notes: input.notes,
    created_at: new Date().toISOString(),
  };
  DEMO_BOOKINGS.unshift(row);
  recordAudit({
    action: 'insert',
    entity: 'worker_bookings',
    record_ref: `HB-${row.booking_no}`,
    old_data: null,
    new_data: {
      worker: row.worker_name,
      date: row.booking_date,
      from: row.start_time,
      to: row.end_time,
      hours,
    },
    branch,
  });
  return { ...row };
}

const NEXT: Record<BookingStatus, BookingStatus[]> = {
  booked: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};
export const canMoveBooking = (from: BookingStatus, to: BookingStatus) => NEXT[from].includes(to);

/** Check-in (in_progress) / check-out (completed) / cancel / no-show — set_booking_status. */
export async function setBookingStatus(id: string, to: BookingStatus): Promise<void> {
  if (!isDemoMode() && !isDemoId(id)) {
    const { error } = await supabase.rpc('set_booking_status', {
      p_id: id,
      p_status: to,
      p_note: null,
    });
    if (error) throw new Error(error.message);
    return;
  }
  const row = DEMO_BOOKINGS.find((b) => b.id === id);
  if (!row) throw new Error('الحجز غير موجود');
  if (!canMoveBooking(row.status, to)) throw new Error('لا يمكن نقل الحجز إلى هذه الحالة');
  const from = row.status;
  row.status = to;
  if (to === 'in_progress') row.actual_start_at = new Date().toISOString();
  if (to === 'completed') row.actual_end_at = new Date().toISOString();
  recordAudit({
    action: 'update',
    entity: 'worker_bookings',
    record_ref: `HB-${row.booking_no}`,
    old_data: { status: from },
    new_data: { status: to },
    branch: row.branch,
  });
}

/**
 * Demo mirror of the hourly branch of convert_quote_to_contract (0065): the
 * accepted hourly quote books its worker at the quoted price. `check` runs
 * before the contract is created so a conflict stops the whole conversion.
 */
export async function demoBookingForQuote(
  q: {
    id: string;
    worker_profile_id?: string | null;
    worker_name?: string | null;
    start_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    profession: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    branch?: string | null;
    base_amount: number;
    gross_amount?: number | null;
    discount_amount?: number;
    vat_amount: number;
    total_amount: number;
    notes: string | null;
  },
  contract: { id: string; contract_no: string | null; branch: string | null } | null,
): Promise<void> {
  if (!q.worker_profile_id || !q.start_date || !q.start_time || !q.end_time)
    throw new Error(
      'عرض التأجير بالساعة يحتاج العاملة وتاريخ الحجز ووقت الوصول والانصراف قبل تحويله لعقد',
    );
  const cfg = await getHourlyConfig();
  const err = validateHours(q.start_time, q.end_time, cfg);
  if (err) throw new Error(err);
  const want = {
    worker_profile_id: q.worker_profile_id,
    booking_date: q.start_date,
    start_time: q.start_time,
    end_time: q.end_time,
  };
  const clash = conflictFor(DEMO_BOOKINGS, want, cfg);
  if (clash)
    throw new Error(
      `العاملة محجوزة في هذه الفترة (${clash.start_time}–${clash.end_time}) — عدّل العرض أو اختر عاملة أخرى`,
    );
  if (!contract) return; // check only
  const hours = hoursBetween(q.start_time, q.end_time);
  DEMO_BOOKINGS.unshift({
    id: `hb-${Date.now()}-${++seq}`,
    booking_no: ++bookingNo,
    ...want,
    worker_name: q.worker_name ?? null,
    branch: contract.branch ?? q.branch ?? null,
    profession: q.profession,
    hours,
    status: 'booked',
    actual_start_at: null,
    actual_end_at: null,
    customer_name: q.customer_name,
    customer_phone: q.customer_phone,
    address: null,
    hourly_rate: Math.round(((q.gross_amount ?? q.base_amount) / hours) * 100) / 100,
    base_amount: q.base_amount,
    discount_amount: q.discount_amount ?? 0,
    vat_amount: q.vat_amount,
    total_amount: q.total_amount,
    contract_id: contract.id,
    contract_no: contract.contract_no,
    notes: q.notes,
    created_at: new Date().toISOString(),
  });
}

/**
 * Busy windows of every worker on a day, across branches (times only — no
 * customer data), so the booking form shows who is really free. Backend:
 * worker_busy_slots (0065); demo: the whole store, not the branch-scoped list.
 */
export async function listBusySlots(date: string): Promise<Slot[]> {
  if (isDemoMode()) {
    return DEMO_BOOKINGS.filter((b) => b.booking_date === date).map((b) => ({
      id: b.id,
      worker_profile_id: b.worker_profile_id,
      booking_date: b.booking_date,
      start_time: b.start_time,
      end_time: b.end_time,
      status: b.status,
    }));
  }
  const { data, error } = await supabase.rpc('worker_busy_slots', { p_date: date });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Omit<Slot, 'booking_date'>[]).map((s) => ({ ...s, booking_date: date }));
}
