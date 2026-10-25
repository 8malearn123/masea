/**
 * حساب مدة الطلب وتاريخ النهاية — مصدر واحد للحساب يستخدمه نموذج الطلب
 * وجدول التوفّر وملف الطلب، فلا يحسب أحد تاريخ النهاية بنفسه.
 * التواريخ بصيغة yyyy-mm-dd وتُعالَج بالتوقيت العالمي لتجنّب انزلاق اليوم.
 */
import type { PeriodUnit, RequestPeriod } from '@/features/requests/types';

const DAY_MS = 86_400_000;

/** yyyy-mm-dd → Date بمنتصف ليل UTC (null إذا كانت الصيغة غير صحيحة). */
export function parseDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** تاريخ تقويمي حقيقي بصيغة yyyy-mm-dd (يرفض ٣٠ فبراير و١٣/٠١ وما شابه). */
export function isValidDay(iso: string): boolean {
  const d = parseDay(iso);
  return d !== null && toDay(d) === iso;
}

/** تاريخ اليوم بصيغة yyyy-mm-dd. */
export function today(now: Date = new Date()): string {
  return toDay(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: string, days: number): string {
  const d = parseDay(iso);
  if (!d) return iso;
  return toDay(new Date(d.getTime() + days * DAY_MS));
}

/** إضافة أشهر مع تثبيت آخر يوم في الشهر الأقصر (٣١ يناير + شهر = ٢٨/٢٩ فبراير). */
export function addMonths(iso: string, months: number): string {
  const d = parseDay(iso);
  if (!d) return iso;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toDay(target);
}

/** فرق الأيام بين تاريخين (سالب إذا كان الثاني قبل الأول). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseDay(fromIso);
  const b = parseDay(toIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * تاريخ نهاية المدة — الدالة الوحيدة لحساب النهاية (الطلبات والعقود وجدول التوفّر).
 * اليوم الأول محسوب داخل المدة، فطلب يوم واحد يبدأ وينتهي في نفس التاريخ، وطلب
 * ٣ أيام يبدأ الأحد وينتهي الثلاثاء، والأسبوع = ٧ أيام (يبدأ الأحد وينتهي السبت).
 * المدة بالأشهر تنتهي في اليوم السابق لنفس التاريخ بعد N شهر؛ فإن لم يوجد ذلك
 * التاريخ في الشهر الأقصر (٣١ يناير + شهر، ٢٩ فبراير + سنة) تنتهي المدة في آخر
 * يوم من ذلك الشهر، فلا يسقط يوم من المدة.
 */
export function computeEndDate(startDate: string, unit: PeriodUnit, count: number): string {
  const n = Math.max(1, Math.floor(count));
  const start = parseDay(startDate);
  if (!start) return '';
  if (unit === 'day') return addDays(startDate, n - 1);
  if (unit === 'week') return addDays(startDate, n * 7 - 1);
  const anniversary = addMonths(startDate, n);
  const clamped = parseDay(anniversary)?.getUTCDate() !== start.getUTCDate();
  return clamped ? anniversary : addDays(anniversary, -1);
}

export function buildPeriod(startDate: string, unit: PeriodUnit, count: number): RequestPeriod {
  const n = Math.max(1, Math.floor(count));
  return { startDate, unit, count: n, endDate: computeEndDate(startDate, unit, n) };
}

/** عدد أيام المدة فعليًا (لفحص التوفّر). */
export function periodDays(period: RequestPeriod): number {
  if (!period.startDate || !period.endDate) return 0;
  return daysBetween(period.startDate, period.endDate) + 1;
}

/** صيغ العدد لكل وحدة: واحد، مثنى، جمع (٣–١٠)، تمييز (١١ فأكثر). */
const COUNT_FORMS: Record<PeriodUnit, [string, string, string, string]> = {
  day: ['يوم واحد', 'يومان', 'أيام', 'يومًا'],
  week: ['أسبوع واحد', 'أسبوعان', 'أسابيع', 'أسبوعًا'],
  month: ['شهر واحد', 'شهران', 'أشهر', 'شهرًا'],
};

/** «٣ أشهر» / «٥ أيام» / «أسبوعان» — صياغة عربية سليمة للعدد. */
export function periodLabel(period: RequestPeriod): string {
  const n = period.count;
  const [one, two, few, many] = COUNT_FORMS[period.unit];
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${n <= 10 ? few : many}`;
}

/** تقاطُع مدّتين (لفحص التواريخ المحجوزة). */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
