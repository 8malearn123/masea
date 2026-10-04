/**
 * جدول توفّر العاملة — التواريخ المحجوزة والمتاحة (Prototype / Mock).
 *
 * لا مفهوم جديد: التوفّر يُشتق من نفس العاملة الموجودة في `worker_profiles`
 * (`availabilityOf` في catalog.ts يعطي حالتها العامة)، وهذا الملف يفصّلها على
 * التقويم. الحجوزات مُولَّدة بشكل ثابت من مُعرّف العاملة (لا تتغيّر بين
 * التحميلات) ومحسوبة نسبةً إلى اليوم، مع مخزن إضافي في الذاكرة يستقبل حجوزات
 * الطلبات التي تُنشأ داخل الـprototype.
 */
import {
  addDays,
  daysBetween,
  parseDay,
  rangesOverlap,
  today,
  toDay,
} from '@/features/requests/lib/period';

/** فترة محجوزة في جدول العاملة. */
export interface BookedRange {
  start: string; // yyyy-mm-dd
  end: string; // yyyy-mm-dd
  reason: string;
  /** رقم الطلب إن كان الحجز ناتجًا عن طلب داخل النظام. */
  request_no?: string;
}

export type DayState = 'past' | 'booked' | 'available';

/** عدد أيام أفق الجدول المعروض للعميل. */
export const HORIZON_DAYS = 120;

/** رقم شبه عشوائي ثابت في [0,1) من نص — نفس أسلوب catalog.ts. */
function hash01(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 100000;
  return h / 100000;
}

const SEED_REASONS = [
  'عقد تأجير شهري قائم',
  'حجز مناسبة مؤكّد',
  'تأجير يومي محجوز',
  'إجازة سنوية',
  'فحص طبي وتجديد إقامة',
];

/** حجوزات إضافية أنشأها الـprototype (طلبات العميل) — تُدمج مع المُولّدة. */
const EXTRA_BOOKINGS = new Map<string, BookedRange[]>();

/** تسجيل حجز جديد على جدول العاملة (يُستدعى عند تأكيد الطلب). */
export function addBooking(workerId: string, range: BookedRange): void {
  const list = EXTRA_BOOKINGS.get(workerId) ?? [];
  if (list.some((r) => r.request_no && r.request_no === range.request_no)) return;
  list.push(range);
  EXTRA_BOOKINGS.set(workerId, list);
}

/** الحجوزات المُولَّدة بثبات لعاملة داخل أفق الجدول. */
function seededRanges(workerId: string, from: string): BookedRange[] {
  const h = hash01(workerId);
  const count = 1 + Math.floor(hash01(`${workerId}:n`) * 3); // ١–٣ فترات
  const ranges: BookedRange[] = [];
  let cursor = Math.floor(h * 12) + 2; // أول حجز بعد ٢–١٣ يومًا
  for (let i = 0; i < count; i++) {
    const length = 2 + Math.floor(hash01(`${workerId}:l${i}`) * 12); // ٢–١٣ يومًا
    const start = addDays(from, cursor);
    const end = addDays(start, length - 1);
    if (daysBetween(from, start) > HORIZON_DAYS) break;
    ranges.push({
      start,
      end,
      reason:
        SEED_REASONS[Math.floor(hash01(`${workerId}:r${i}`) * SEED_REASONS.length)] ??
        SEED_REASONS[0]!,
    });
    cursor += length + 6 + Math.floor(hash01(`${workerId}:g${i}`) * 20);
  }
  return ranges;
}

/** كل الفترات المحجوزة للعاملة، مرتّبة زمنيًا. */
export function bookedRangesOf(workerId: string, from: string = today()): BookedRange[] {
  return [...seededRanges(workerId, from), ...(EXTRA_BOOKINGS.get(workerId) ?? [])].sort((a, b) =>
    a.start < b.start ? -1 : 1,
  );
}

/** حالة يوم واحد في جدول العاملة. */
export function dayState(workerId: string, iso: string, from: string = today()): DayState {
  if (iso < from) return 'past';
  return bookedRangesOf(workerId, from).some((r) => iso >= r.start && iso <= r.end)
    ? 'booked'
    : 'available';
}

/** الحجز الذي يتعارض مع المدة المطلوبة — null إذا كانت المدة متاحة بالكامل. */
export function conflictFor(
  workerId: string,
  startDate: string,
  endDate: string,
  from: string = today(),
): BookedRange | null {
  if (!startDate || !endDate) return null;
  return (
    bookedRangesOf(workerId, from).find((r) => rangesOverlap(startDate, endDate, r.start, r.end)) ??
    null
  );
}

export function isFreeBetween(
  workerId: string,
  startDate: string,
  endDate: string,
  from: string = today(),
): boolean {
  if (!startDate || !endDate) return true;
  return conflictFor(workerId, startDate, endDate, from) === null;
}

/** أول تاريخ تتوفّر فيه العاملة لمدة بعدد الأيام المطلوب. */
export function nextFreeDay(
  workerId: string,
  wantedDays: number,
  from: string = today(),
): string | null {
  const span = Math.max(1, wantedDays);
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const start = addDays(from, i);
    if (isFreeBetween(workerId, start, addDays(start, span - 1), from)) return start;
  }
  return null;
}

/** عدد الأيام المتاحة داخل الأفق — مؤشّر سريع على سعة جدول العاملة. */
export function freeDaysInHorizon(workerId: string, from: string = today()): number {
  const booked = bookedRangesOf(workerId, from).reduce((sum, r) => {
    const start = r.start < from ? from : r.start;
    const capped = addDays(from, HORIZON_DAYS);
    const end = r.end > capped ? capped : r.end;
    return sum + Math.max(0, daysBetween(start, end) + 1);
  }, 0);
  return Math.max(0, HORIZON_DAYS + 1 - booked);
}

/* ------------------------------ شبكة التقويم ------------------------------ */
export interface MonthGrid {
  year: number;
  month: number; // 0-based
  label: string;
  /** ٤٢ خلية (٦ أسابيع)؛ null = خارج الشهر. */
  cells: (string | null)[];
}

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/** أسماء الأيام بدءًا من الأحد (أول أيام الأسبوع في السعودية). */
export const WEEKDAYS_AR = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

/** شبكة شهر ميلادي بالأيام مرتّبة أسبوعيًا (الأحد أولًا). */
export function monthGrid(year: number, month: number): MonthGrid {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = الأحد
  const cells: (string | null)[] = Array.from({ length: 42 }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells[lead + d - 1] = toDay(new Date(Date.UTC(year, month, d)));
  }
  return { year, month, label: `${MONTHS_AR[month]} ${year}`, cells };
}

/** شبكة الشهر الذي يقع فيه تاريخ معيّن (أو الشهر الحالي). */
export function gridForDay(iso: string): MonthGrid {
  const d = parseDay(iso) ?? new Date();
  return monthGrid(d.getUTCFullYear(), d.getUTCMonth());
}

export function shiftMonth(grid: MonthGrid, delta: number): MonthGrid {
  const d = new Date(Date.UTC(grid.year, grid.month + delta, 1));
  return monthGrid(d.getUTCFullYear(), d.getUTCMonth());
}
