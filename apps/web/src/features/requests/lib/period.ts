/**
 * حساب مدة الطلب وتاريخ النهاية — مصدر واحد للحساب يستخدمه نموذج الطلب
 * وجدول التوفّر وملف الطلب، فلا يحسب أحد تاريخ النهاية بنفسه.
 * التواريخ بصيغة yyyy-mm-dd وتُعالَج بالتوقيت العالمي لتجنّب انزلاق اليوم.
 */
import type { PeriodUnit, RequestPeriod } from '@/features/requests/types';
import { PERIOD_UNIT_LABEL } from '@/features/requests/types';

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
 * تاريخ نهاية المدة. اليوم الأول محسوب داخل المدة، فطلب يوم واحد يبدأ وينتهي
 * في نفس التاريخ، وطلب ٣ أيام يبدأ الأحد وينتهي الثلاثاء.
 */
export function computeEndDate(startDate: string, unit: PeriodUnit, count: number): string {
  const n = Math.max(1, Math.floor(count));
  if (!parseDay(startDate)) return '';
  return unit === 'day' ? addDays(startDate, n - 1) : addDays(addMonths(startDate, n), -1);
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

/** «٣ أشهر» / «٥ أيام» — صياغة عربية سليمة للعدد. */
export function periodLabel(period: RequestPeriod): string {
  const n = period.count;
  const unit = PERIOD_UNIT_LABEL[period.unit];
  if (n === 1) return unit === 'يوم' ? 'يوم واحد' : 'شهر واحد';
  if (n === 2) return unit === 'يوم' ? 'يومان' : 'شهران';
  if (n <= 10) return `${n} ${unit === 'يوم' ? 'أيام' : 'أشهر'}`;
  return `${n} ${unit}`;
}

/** تقاطُع مدّتين (لفحص التواريخ المحجوزة). */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
