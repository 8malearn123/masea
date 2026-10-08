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
  isValidDay,
  parseDay,
  rangesOverlap,
  today,
  toDay,
} from '@/features/requests/lib/period';

/**
 * فترة مشغولة في جدول العاملة. الفترة **شاملة الطرفين** (start و end من أيام
 * الحجز) — نفس معنى `computeEndDate` حيث يوم البداية جزء من المدة.
 */
export interface BookedRange {
  start: string; // yyyy-mm-dd
  end: string; // yyyy-mm-dd (شامل)
  reason: string;
  /** حجز لطلب/عقد (افتراضي)، أو عدم توفّر لسبب آخر (إجازة، فحص طبي). */
  kind?: 'booking' | 'unavailable';
  /** رقم الطلب إن كان الحجز ناتجًا عن طلب داخل النظام (لا يُعرض للعميل). */
  request_no?: string;
}

export type DayState = 'past' | 'booked' | 'unavailable' | 'available';

/** أسباب عدم التوفّر التي ليست حجزًا لعميل. */
const UNAVAILABLE_REASONS = new Set(['إجازة سنوية', 'فحص طبي وتجديد إقامة']);

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

/**
 * جداول تجريبية مقصودة لعدد قليل من العاملات (تحلّ محل الجدول المُولَّد لهن)
 * لتظهر الحالات بوضوح في العرض: عاملة متاحة بالكامل، وعاملة لديها حجز قريب،
 * وعاملة محجوزة بالكامل لفترة طويلة، وحجزا طلبَي العرض الجاهزين في
 * `requests.api.ts` (نفس الفترات المحسوبة هناك).
 */
const DEMO_SCHEDULES: Record<string, (from: string) => BookedRange[]> = {
  w1: () => [],
  w2: (from) => [{ start: addDays(from, 3), end: addDays(from, 6), reason: 'تأجير يومي محجوز' }],
  w6: (from) => [{ start: from, end: addDays(from, 44), reason: 'عقد تأجير شهري قائم' }],
  w3: () => [
    {
      start: '2026-10-01',
      end: '2026-12-31',
      reason: 'طلب تأجير شهري',
      request_no: 'REQ-2A7F41C9',
    },
  ],
  w4: () => [
    {
      start: '2026-10-09',
      end: '2026-10-10',
      reason: 'طلب تأجير يومي',
      request_no: 'REQ-93BD5E08',
    },
  ],
};

/** حجوزات إضافية أنشأها الـprototype (طلبات العميل) — تُدمج مع الجدول الأساسي. */
const EXTRA_BOOKINGS = new Map<string, BookedRange[]>();

export type BookingResult =
  | { ok: true; booking: BookedRange; created: boolean }
  | { ok: false; reason: 'invalid_range' | 'conflict'; conflict: BookedRange | null };

/**
 * تسجيل حجز على جدول العاملة (عند تأكيد الطلب). نقطة الحجز الوحيدة:
 *   - نفس رقم الطلب مرة ثانية → لا حجز جديد (يُعاد الحجز القائم).
 *   - أي تداخل مع حجز أو عدم توفّر قائم → يُرفض ولا يتغيّر الجدول.
 */
export function addBooking(
  workerId: string,
  range: BookedRange,
  from: string = today(),
): BookingResult {
  if (!isValidDay(range.start) || !isValidDay(range.end) || range.end < range.start) {
    return { ok: false, reason: 'invalid_range', conflict: null };
  }
  const list = EXTRA_BOOKINGS.get(workerId) ?? [];
  const same = range.request_no ? list.find((r) => r.request_no === range.request_no) : undefined;
  if (same) return { ok: true, booking: same, created: false };
  const conflict = isWorkerAvailable(workerId, range.start, range.end, from).conflicts[0];
  if (conflict) return { ok: false, reason: 'conflict', conflict };
  const booking: BookedRange = { kind: 'booking', ...range };
  EXTRA_BOOKINGS.set(workerId, [...list, booking]);
  return { ok: true, booking, created: true };
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
    const reason =
      SEED_REASONS[Math.floor(hash01(`${workerId}:r${i}`) * SEED_REASONS.length)] ??
      SEED_REASONS[0]!;
    ranges.push({
      start,
      end,
      reason,
      kind: UNAVAILABLE_REASONS.has(reason) ? 'unavailable' : 'booking',
    });
    cursor += length + 6 + Math.floor(hash01(`${workerId}:g${i}`) * 20);
  }
  return ranges;
}

/** كل الفترات المشغولة للعاملة، مرتّبة زمنيًا. */
export function bookedRangesOf(workerId: string, from: string = today()): BookedRange[] {
  const base = DEMO_SCHEDULES[workerId]?.(from) ?? seededRanges(workerId, from);
  return [...base, ...(EXTRA_BOOKINGS.get(workerId) ?? [])]
    .map((r) => ({ ...r, kind: r.kind ?? 'booking' }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** حالة يوم واحد في جدول العاملة. */
export function dayState(workerId: string, iso: string, from: string = today()): DayState {
  if (iso < from) return 'past';
  const hit = bookedRangesOf(workerId, from).find((r) => iso >= r.start && iso <= r.end);
  if (!hit) return 'available';
  return hit.kind === 'unavailable' ? 'unavailable' : 'booked';
}

/**
 * نتيجة توفّر العاملة لفترة:
 *   available   — لا تعارض في أي يوم.
 *   partial     — بعض أيام الفترة مشغولة (تعارض جزئي).
 *   unavailable — كل أيام الفترة مشغولة.
 *   unknown     — لا فترة صالحة بعد، فلا يُدّعى التوفّر.
 */
export type AvailabilityStatus = 'available' | 'partial' | 'unavailable' | 'unknown';

export interface AvailabilityResult {
  status: AvailabilityStatus;
  /** true فقط إذا كانت الفترة صالحة ومتاحة بالكامل. */
  available: boolean;
  startDate: string;
  endDate: string;
  /** كل الفترات المشغولة المتداخلة مع الفترة المطلوبة، مرتّبة زمنيًا. */
  conflicts: BookedRange[];
  /** أيام الفترة المطلوبة (شاملة الطرفين) والمشغول منها. */
  totalDays: number;
  busyDays: number;
  message: string;
}

export const AVAILABILITY_MESSAGE = {
  unknown: 'حدد تاريخ البداية والمدة للتحقق من التوفر.',
  invalid: 'فترة الطلب غير صالحة — راجع تاريخ البداية والمدة.',
  available: 'العاملة متاحة طوال الفترة المحددة.',
  unavailable: 'العاملة غير متاحة خلال الفترة المحددة.',
} as const;

/**
 * الدالة المركزية لفحص توفّر العاملة لفترة كاملة (شاملة الطرفين). يتداخل حجزان
 * إذا اشتركا في يوم واحد على الأقل: حجز ينتهي يوم بداية الطلب تعارض، وحجز
 * ينتهي في اليوم السابق لا يتعارض.
 */
export function isWorkerAvailable(
  workerId: string,
  startDate: string,
  endDate: string,
  from: string = today(),
): AvailabilityResult {
  const base = { startDate, endDate, conflicts: [] as BookedRange[], totalDays: 0, busyDays: 0 };
  if (!startDate || !endDate) {
    return { ...base, status: 'unknown', available: false, message: AVAILABILITY_MESSAGE.unknown };
  }
  if (!isValidDay(startDate) || !isValidDay(endDate) || endDate < startDate) {
    return { ...base, status: 'unknown', available: false, message: AVAILABILITY_MESSAGE.invalid };
  }
  const totalDays = daysBetween(startDate, endDate) + 1;
  const conflicts = bookedRangesOf(workerId, from).filter((r) =>
    rangesOverlap(startDate, endDate, r.start, r.end),
  );
  // الأيام المشغولة داخل الفترة (اتحاد الفترات المتعارضة، دون عدّ اليوم مرتين)
  let busyDays = 0;
  let cursor = '';
  for (const r of conflicts) {
    const s = r.start > startDate ? r.start : startDate;
    const e = r.end < endDate ? r.end : endDate;
    const from2 = cursor && cursor >= s ? addDays(cursor, 1) : s;
    if (from2 <= e) busyDays += daysBetween(from2, e) + 1;
    if (!cursor || e > cursor) cursor = e;
  }
  const status: AvailabilityStatus =
    conflicts.length === 0 ? 'available' : busyDays >= totalDays ? 'unavailable' : 'partial';
  return {
    status,
    available: status === 'available',
    startDate,
    endDate,
    conflicts,
    totalDays,
    busyDays,
    message:
      status === 'available' ? AVAILABILITY_MESSAGE.available : AVAILABILITY_MESSAGE.unavailable,
  };
}

/** أول فترة تتعارض مع المدة المطلوبة — null إذا كانت متاحة أو لا فترة بعد. */
export function conflictFor(
  workerId: string,
  startDate: string,
  endDate: string,
  from: string = today(),
): BookedRange | null {
  return isWorkerAvailable(workerId, startDate, endDate, from).conflicts[0] ?? null;
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
