/**
 * مدة العقد وتاريخ نهايته — يعيد استخدام حساب المدة الموحّد في
 * `features/requests/lib/period.ts` (نفس المصدر الذي يستخدمه نموذج الطلب وجدول
 * التوفّر)، فلا يحسب أحد تاريخ نهاية العقد بنفسه.
 *
 * وحدة المدة مشتقّة من الخدمة كما في معالج العقد القائم:
 *   استقدام → أشهر (من خيارات مدة عقد الاستقدام) · تأجير شهري → أشهر ·
 *   تأجير يومي → أيام · نقل كفالة → بلا مدة (لا تاريخ نهاية).
 */
import {
  computeEndDate,
  daysBetween,
  isValidDay,
  periodLabel,
} from '@/features/requests/lib/period';
import type { PeriodUnit } from '@/features/requests/types';
import type { ContractServiceCode } from '@/features/contracts/types';

/** خيارات مدة عقد الاستقدام (بالأشهر) — القائمة الموجودة في معالج العقد. */
export const RECRUITMENT_TERM_MONTHS = [12, 24] as const;

/** أطول مدة يُبحث فيها عند استنتاج عدد الأشهر من تاريخَي عقد قائم. */
const MAX_INFER_MONTHS = 600;

export function contractTermUnit(service: ContractServiceCode | null): PeriodUnit | null {
  switch (service) {
    case 'recruitment':
    case 'monthly_rental':
      return 'month';
    case 'daily_rental':
      return 'day';
    default:
      return null;
  }
}

/** تاريخ النهاية المحسوب، أو null لخدمة بلا مدة أو مدخلات غير صالحة. */
export function contractEndDate(
  service: ContractServiceCode | null,
  startDate: string,
  count: number,
): string | null {
  const unit = contractTermUnit(service);
  if (!unit || !isValidDay(startDate) || !Number.isInteger(count) || count < 1) return null;
  const end = computeEndDate(startDate, unit, count);
  return isValidDay(end) ? end : null;
}

/** رسالة الخطأ الأولى في مدة العقد، أو null إذا كانت صالحة. */
export function validateContractTerm(
  service: ContractServiceCode | null,
  startDate: string,
  count: number,
): string | null {
  if (!startDate) return 'حدّد تاريخ البداية';
  if (!isValidDay(startDate)) return 'تاريخ البداية غير صالح';
  const unit = contractTermUnit(service);
  if (!unit) return null;
  if (!Number.isInteger(count) || count < 1) {
    return unit === 'day'
      ? 'عدد الأيام يجب أن يكون رقمًا صحيحًا لا يقل عن ١'
      : 'عدد الأشهر يجب أن يكون رقمًا صحيحًا لا يقل عن ١';
  }
  if (
    service === 'recruitment' &&
    !(RECRUITMENT_TERM_MONTHS as readonly number[]).includes(count)
  ) {
    return 'اختر مدة عقد الاستقدام من الخيارات المتاحة';
  }
  const end = contractEndDate(service, startDate, count);
  if (!end || end < startDate) return 'مدة العقد غير منطقية — راجع تاريخ البداية والمدة';
  return null;
}

/**
 * عدد وحدات المدة لعقد قائم من تاريخَي بدايته ونهايته (لتعبئة نموذج التعديل
 * ولعرض «٣ أشهر» في التفاصيل). null إذا لم تطابق التواريخ مدة كاملة.
 */
export function inferTermCount(
  service: ContractServiceCode | null,
  startDate: string | null,
  endDate: string | null,
): number | null {
  const unit = contractTermUnit(service);
  if (!unit || !startDate || !endDate || !isValidDay(startDate) || !isValidDay(endDate)) {
    return null;
  }
  if (endDate < startDate) return null;
  if (unit === 'day') return daysBetween(startDate, endDate) + 1;
  for (let n = 1; n <= MAX_INFER_MONTHS; n += 1) {
    const end = computeEndDate(startDate, 'month', n);
    if (end === endDate) return n;
    if (end > endDate) return null;
  }
  return null;
}

/** «٣ أشهر» / «٥ أيام» لعقد قائم، أو null إذا تعذّر اشتقاق المدة. */
export function contractTermLabel(c: {
  service_code: ContractServiceCode | null;
  start_date: string | null;
  end_date: string | null;
}): string | null {
  const unit = contractTermUnit(c.service_code);
  const count = inferTermCount(c.service_code, c.start_date, c.end_date);
  if (!unit || count === null || !c.start_date || !c.end_date) return null;
  return periodLabel({ startDate: c.start_date, endDate: c.end_date, unit, count });
}
