/**
 * قواعد التأجير بالساعة — مرآة الواجهة لـ hourly_hours / worker_is_free (0065).
 * الحدود (4–12 ساعة، الفاصل بين حجزين، وحدة الوقت) من الإعدادات لا من الكود.
 */
export interface HourlyConfig {
  minHours: number;
  maxHours: number;
  bufferMinutes: number;
  slotMinutes: number;
}

export const DEFAULT_HOURLY_CONFIG: HourlyConfig = {
  minHours: 4,
  maxHours: 12,
  bufferMinutes: 30,
  slotMinutes: 30,
};

export type BookingStatus = 'booked' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  booked: 'محجوز',
  in_progress: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  no_show: 'لم تتم (غياب العميل)',
};

/** Live bookings hold the worker's time; finished or cancelled ones free it. */
export const LIVE_STATUSES: BookingStatus[] = ['booked', 'in_progress'];

/** 'HH:MM' → minutes since midnight (NaN when malformed). */
export function minutesOf(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hoursBetween(start: string, end: string): number {
  return Math.round(((minutesOf(end) - minutesOf(start)) / 60) * 100) / 100;
}

/** Same messages as the backend hourly_hours(); null = valid. */
export function validateHours(start: string, end: string, cfg: HourlyConfig): string | null {
  if (!start || !end) return 'حدّد ساعة الوصول وساعة الانصراف';
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 'صيغة الوقت غير صحيحة';
  if (e <= s) return 'ساعة الانصراف يجب أن تكون بعد ساعة الوصول (في نفس اليوم)';
  if ((e - s) % cfg.slotMinutes !== 0) return `المدة تُحتسب بمضاعفات ${cfg.slotMinutes} دقيقة`;
  const h = (e - s) / 60;
  if (h < cfg.minHours) return `الحد الأدنى للتأجير بالساعة ${cfg.minHours} ساعات`;
  if (h > cfg.maxHours) return `الحد الأقصى للتأجير بالساعة ${cfg.maxHours} ساعة`;
  return null;
}

export interface Slot {
  worker_profile_id: string;
  booking_date: string; // yyyy-mm-dd
  start_time: string; // HH:MM
  end_time: string;
  status: BookingStatus;
  id?: string;
}

/** [start, end + buffer) of two bookings on the same day overlap? */
export function slotsOverlap(
  a: Pick<Slot, 'start_time' | 'end_time'>,
  b: Pick<Slot, 'start_time' | 'end_time'>,
  bufferMinutes: number,
): boolean {
  const a0 = minutesOf(a.start_time);
  const a1 = minutesOf(a.end_time) + bufferMinutes;
  const b0 = minutesOf(b.start_time);
  const b1 = minutesOf(b.end_time) + bufferMinutes;
  return a0 < b1 && b0 < a1;
}

/** The live booking that blocks this worker/time, if any. */
export function conflictFor<T extends Slot>(
  bookings: T[],
  want: Omit<Slot, 'status'>,
  cfg: HourlyConfig,
): T | null {
  return (
    bookings.find(
      (b) =>
        (want.id === undefined || b.id !== want.id) &&
        b.worker_profile_id === want.worker_profile_id &&
        b.booking_date === want.booking_date &&
        LIVE_STATUSES.includes(b.status) &&
        slotsOverlap(b, want, cfg.bufferMinutes),
    ) ?? null
  );
}

export interface HourlyTotals {
  count: number;
  hours: number;
  revenue: number; // net before VAT, cancelled/no-show excluded
  completed: number;
  cancelled: number;
}

export function hourlyTotals(
  rows: { status: BookingStatus; hours: number; base_amount: number }[],
): HourlyTotals {
  const live = rows.filter((r) => r.status !== 'cancelled' && r.status !== 'no_show');
  return {
    count: live.length,
    hours: Math.round(live.reduce((s, r) => s + r.hours, 0) * 100) / 100,
    revenue: Math.round(live.reduce((s, r) => s + r.base_amount, 0) * 100) / 100,
    completed: rows.filter((r) => r.status === 'completed').length,
    cancelled: rows.length - live.length,
  };
}
