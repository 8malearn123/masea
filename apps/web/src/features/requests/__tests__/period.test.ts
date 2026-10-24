import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  buildPeriod,
  computeEndDate,
  daysBetween,
  isValidDay,
  periodDays,
  periodLabel,
  rangesOverlap,
} from '@/features/requests/lib/period';

describe('مدة الطلب وتاريخ النهاية', () => {
  it('يوم واحد يبدأ وينتهي في نفس التاريخ', () => {
    expect(computeEndDate('2026-10-01', 'day', 1)).toBe('2026-10-01');
  });

  it('يحسب نهاية مدة بالأيام مع احتساب يوم البداية', () => {
    expect(computeEndDate('2026-10-01', 'day', 3)).toBe('2026-10-03');
  });

  it('يحسب نهاية مدة بالأشهر (اليوم السابق لنفس التاريخ)', () => {
    expect(computeEndDate('2026-10-01', 'month', 3)).toBe('2026-12-31');
  });

  it('يثبّت آخر يوم في الشهر الأقصر', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
  });

  it('يبني مدة كاملة ويصوغ اسمها بالعربية', () => {
    const p = buildPeriod('2026-10-05', 'month', 2);
    expect(p.endDate).toBe('2026-12-04');
    expect(periodLabel(p)).toBe('شهران');
    expect(periodLabel(buildPeriod('2026-10-05', 'day', 5))).toBe('5 أيام');
  });

  it('يعدّ أيام المدة فعليًا', () => {
    expect(periodDays(buildPeriod('2026-10-01', 'day', 4))).toBe(4);
  });

  it('يتجاهل التواريخ غير الصالحة بدل الانهيار', () => {
    expect(computeEndDate('', 'day', 3)).toBe('');
    expect(daysBetween('2026-10-01', '2026-10-11')).toBe(10);
    expect(addDays('2026-10-01', 10)).toBe('2026-10-11');
  });

  it('لا يُسقط يومًا عند بدء المدة في آخر الشهر', () => {
    // ٣١ يناير + شهر: لا يوجد ٣١ فبراير → تنتهي المدة في آخر فبراير
    expect(computeEndDate('2027-01-31', 'month', 1)).toBe('2027-02-28');
    expect(computeEndDate('2028-01-31', 'month', 1)).toBe('2028-02-29'); // سنة كبيسة
    expect(computeEndDate('2026-08-31', 'month', 1)).toBe('2026-09-30');
    // تاريخ موجود في الشهر الهدف → اليوم السابق كالمعتاد
    expect(computeEndDate('2027-01-28', 'month', 1)).toBe('2027-02-27');
  });

  it('يعالج ٢٩ فبراير ونهاية السنة', () => {
    expect(computeEndDate('2028-02-29', 'month', 12)).toBe('2029-02-28');
    expect(computeEndDate('2028-02-29', 'month', 48)).toBe('2032-02-28');
    expect(computeEndDate('2026-12-15', 'month', 1)).toBe('2027-01-14');
    expect(computeEndDate('2026-12-31', 'day', 2)).toBe('2027-01-01');
    expect(computeEndDate('2028-02-28', 'day', 2)).toBe('2028-02-29');
  });

  it('يرفض التواريخ غير الموجودة في التقويم', () => {
    expect(isValidDay('2026-10-01')).toBe(true);
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(isValidDay('2027-02-29')).toBe(false);
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(isValidDay('2026-1-1')).toBe(false);
    expect(isValidDay('')).toBe(false);
  });

  it('يكشف تقاطع المدد', () => {
    expect(rangesOverlap('2026-10-01', '2026-10-10', '2026-10-09', '2026-10-15')).toBe(true);
    expect(rangesOverlap('2026-10-01', '2026-10-10', '2026-10-11', '2026-10-15')).toBe(false);
  });
});
