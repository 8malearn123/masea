/**
 * Attendance rules — demo mirror of supabase/migrations/0072_attendance.sql
 * (attendance_check / manual_attendance / close_attendance_day / is_workday /
 * attendance_late_minutes). Same rules and Arabic messages; with a backend the
 * server decides.
 */
import type { AttendanceConfig, PublicHoliday } from '@/features/hr/types';

/** QR printed at each branch door: a prefix + the branch's token. */
export const QR_PREFIX = 'MASEA-ATT:';
export const qrPayload = (token: string) => `${QR_PREFIX}${token}`;
export const tokenFromQr = (raw: string) =>
  raw.startsWith(QR_PREFIX) ? raw.slice(QR_PREFIX.length) : raw.trim();

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = {
  qr_enabled: true,
  qr_roles: [
    'admin',
    'operations_manager',
    'branch_manager',
    'sales',
    'call_center',
    'hr',
    'accountant',
  ],
  gps_enabled: true,
  gps_roles: [
    'admin',
    'operations_manager',
    'branch_manager',
    'sales',
    'call_center',
    'hr',
    'accountant',
  ],
  gps_radius_m: 200,
  manual_enabled: true,
  manual_roles: ['admin', 'hr'],
  worker_barcode_required: true,
  workdays: [0, 1, 2, 3, 4],
};

/** Great-circle distance in metres (same formula as distance_m in SQL). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}

/** Minutes late: check-in vs shift start (decimal hour) minus the grace period. */
export function lateMinutes(
  checkInHHMM: string,
  shiftStartHour: number,
  graceMinutes: number,
): number {
  const [h, m] = checkInHHMM.split(':').map(Number);
  const mins = (h ?? 0) * 60 + (m ?? 0) - Math.round(shiftStartHour * 60);
  return Math.max(Math.floor(mins) - graceMinutes, 0);
}

export function isHoliday(date: string, holidays: PublicHoliday[]): PublicHoliday | undefined {
  return holidays.find((h) => h.is_active && date >= h.from_date && date <= h.to_date);
}

export function isWorkday(date: string, cfg: AttendanceConfig, holidays: PublicHoliday[]): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return cfg.workdays.includes(dow) && !isHoliday(date, holidays);
}

/** Throws when the method is off or the role may not use it (same as the server). */
export function assertMethodAllowed(
  method: 'qr' | 'gps',
  role: string,
  cfg: AttendanceConfig,
): void {
  if (method === 'qr') {
    if (!cfg.qr_enabled) throw new Error('التسجيل بالباركود غير مفعّل');
    if (!cfg.qr_roles.includes(role)) throw new Error('دورك لا يسمح بالتسجيل بالباركود');
  } else {
    if (!cfg.gps_enabled) throw new Error('التسجيل بالموقع غير مفعّل');
    if (!cfg.gps_roles.includes(role)) throw new Error('دورك لا يسمح بالتسجيل بالموقع');
  }
}

export function methodsFor(
  role: string | undefined,
  cfg: AttendanceConfig,
): { qr: boolean; gps: boolean; manual: boolean } {
  const r = role ?? '';
  return {
    qr: cfg.qr_enabled && cfg.qr_roles.includes(r),
    gps: cfg.gps_enabled && cfg.gps_roles.includes(r),
    manual: cfg.manual_enabled && cfg.manual_roles.includes(r),
  };
}

/** "HH:MM" in Riyadh time for an instant (demo stores local times). */
export function nowRiyadh(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}
