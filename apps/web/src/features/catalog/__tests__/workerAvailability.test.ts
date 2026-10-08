/**
 * توفّر العاملة لفترة (المرحلة الثامنة): الدالة المركزية isWorkerAvailable،
 * حالات الحدود (الفترة شاملة الطرفين)، والحجز دون تداخل.
 * كل اختبار يستخدم عاملة مستقلة وتواريخ خارج أفق الجدول المُولَّد، فلا يتأثر
 * إلا بالحجوزات التي يضيفها بنفسه.
 */
import { describe, expect, it } from 'vitest';
import {
  addBooking,
  AVAILABILITY_MESSAGE,
  bookedRangesOf,
  dayState,
  isWorkerAvailable,
} from '@/features/catalog/lib/availability';
import { addDays, buildPeriod, today } from '@/features/requests/lib/period';
import { FALLBACK_WORKERS } from '@/lib/funnel';

/** «اليوم» الثابت للاختبار: حجوزات ٢٠٢٧ خارج أفق الـ١٢٠ يومًا المُولَّد. */
const FROM = '2026-01-01';
let seq = 0;
/** عاملة جديدة بحجوزات محددة فقط. */
function workerWith(...ranges: [string, string][]): string {
  seq += 1;
  const id = `wt-${seq}`;
  ranges.forEach(([start, end], i) => {
    const r = addBooking(
      id,
      { start, end, reason: 'حجز اختبار', request_no: `T-${seq}-${i}` },
      FROM,
    );
    expect(r.ok).toBe(true);
  });
  return id;
}
const check = (id: string, start: string, end: string) => isWorkerAvailable(id, start, end, FROM);

describe('isWorkerAvailable — الفترة شاملة الطرفين', () => {
  // حجز ١٠–١٥ أكتوبر ٢٠٢٧ (مثال المتطلبات)
  const booked = (): string => workerWith(['2027-10-10', '2027-10-15']);

  it('مثال المتطلبات: ١٢–١٤ غير متاحة، و١٦–٢٠ متاحة', () => {
    const id = booked();
    expect(check(id, '2027-10-12', '2027-10-14')).toMatchObject({
      status: 'unavailable',
      available: false,
      message: AVAILABILITY_MESSAGE.unavailable,
    });
    expect(check(id, '2027-10-16', '2027-10-20')).toMatchObject({
      status: 'available',
      available: true,
      conflicts: [],
    });
  });

  it('يوم متاح ويوم محجوز', () => {
    const id = booked();
    expect(check(id, '2027-10-09', '2027-10-09').available).toBe(true);
    expect(check(id, '2027-10-10', '2027-10-10').status).toBe('unavailable');
    expect(check(id, '2027-10-15', '2027-10-15').status).toBe('unavailable');
    expect(dayState(id, '2027-10-12', FROM)).toBe('booked');
    expect(dayState(id, '2027-10-16', FROM)).toBe('available');
  });

  it('حجز ينتهي يوم بداية الطلب = تعارض (اليوم الأخير محجوز)', () => {
    const r = check(booked(), '2027-10-15', '2027-10-18');
    expect(r.status).toBe('partial');
    expect(r.busyDays).toBe(1);
  });

  it('حجز يبدأ يوم نهاية الطلب = تعارض', () => {
    const r = check(booked(), '2027-10-07', '2027-10-10');
    expect(r).toMatchObject({ status: 'partial', busyDays: 1, totalDays: 4 });
  });

  it('حجز قبل الطلب مباشرة أو بعده مباشرة = متاحة', () => {
    const id = booked();
    expect(check(id, '2027-10-16', '2027-10-16').available).toBe(true); // بعد الحجز مباشرة
    expect(check(id, '2027-10-01', '2027-10-09').available).toBe(true); // قبل الحجز مباشرة
  });

  it('حجز يغطي الطلب كله = غير متاحة بالكامل', () => {
    const r = check(booked(), '2027-10-11', '2027-10-14');
    expect(r).toMatchObject({ status: 'unavailable', busyDays: 4, totalDays: 4 });
  });

  it('الطلب يغطي الحجز (حجز داخل الطلب) = تعارض جزئي', () => {
    const r = check(booked(), '2027-10-05', '2027-10-20');
    expect(r).toMatchObject({ status: 'partial', busyDays: 6, totalDays: 16 });
    expect(r.conflicts).toHaveLength(1);
  });

  it('أكثر من حجز: كل التعارضات مرتّبة، والأيام المشغولة بلا تكرار', () => {
    const id = workerWith(['2027-11-20', '2027-11-22'], ['2027-11-01', '2027-11-05']);
    const r = check(id, '2027-11-03', '2027-11-21');
    expect(r.conflicts.map((c) => c.start)).toEqual(['2027-11-01', '2027-11-20']);
    expect(r).toMatchObject({ status: 'partial', busyDays: 3 + 2, totalDays: 19 });
    // بين الحجزين متاحة
    expect(check(id, '2027-11-06', '2027-11-19').available).toBe(true);
    // حجزان متتاليان يغطيان الطلب كاملًا
    const back2back = workerWith(['2027-12-01', '2027-12-03'], ['2027-12-04', '2027-12-06']);
    expect(check(back2back, '2027-12-02', '2027-12-05').status).toBe('unavailable');
  });

  it('لا يدّعي التوفّر بلا فترة صالحة', () => {
    const id = booked();
    expect(check(id, '', '')).toMatchObject({
      status: 'unknown',
      available: false,
      message: 'حدد تاريخ البداية والمدة للتحقق من التوفر.',
    });
    expect(check(id, '2027-10-20', '2027-10-18').status).toBe('unknown'); // نهاية قبل البداية
    expect(check(id, '2027-02-30', '2027-03-02').status).toBe('unknown');
  });

  it('يعمل مع فترات computeEndDate مباشرة (نفس معنى الشمول)', () => {
    const id = booked();
    const p = buildPeriod('2027-10-16', 'week', 1); // ١٦–٢٢
    expect(check(id, p.startDate, p.endDate).available).toBe(true);
    const q = buildPeriod('2027-10-13', 'day', 3); // ١٣–١٥
    expect(check(id, q.startDate, q.endDate).status).toBe('unavailable');
  });
});

describe('addBooking — حجز الفترة كاملة بلا تداخل', () => {
  it('يحجز الفترة كاملة: كل أيامها محجوزة في التقويم', () => {
    const id = workerWith(['2027-10-10', '2027-10-15']);
    for (let i = 0; i < 6; i++) {
      expect(dayState(id, addDays('2027-10-10', i), FROM)).toBe('booked');
    }
    expect(dayState(id, '2027-10-09', FROM)).toBe('available');
    expect(dayState(id, '2027-10-16', FROM)).toBe('available');
  });

  it('يرفض الحجز المتعارض ولا يغيّر الحجز القائم', () => {
    const id = workerWith(['2027-10-10', '2027-10-15']);
    const before = bookedRangesOf(id, FROM);
    const r = addBooking(
      id,
      { start: '2027-10-15', end: '2027-10-18', reason: 'x', request_no: 'N1' },
      FROM,
    );
    expect(r).toMatchObject({ ok: false, reason: 'conflict', conflict: { start: '2027-10-10' } });
    expect(bookedRangesOf(id, FROM)).toEqual(before);
    expect(dayState(id, '2027-10-17', FROM)).toBe('available');
  });

  it('نفس رقم الطلب مرتين لا ينشئ حجزًا ثانيًا', () => {
    const id = 'wt-dup';
    const range = { start: '2027-09-01', end: '2027-09-03', reason: 'x', request_no: 'DUP-1' };
    expect(addBooking(id, range, FROM)).toMatchObject({ ok: true, created: true });
    expect(addBooking(id, range, FROM)).toMatchObject({ ok: true, created: false });
    expect(bookedRangesOf(id, FROM).filter((r) => r.request_no === 'DUP-1')).toHaveLength(1);
  });

  it('يرفض فترة غير صالحة', () => {
    expect(
      addBooking('wt-bad', { start: '2027-09-05', end: '2027-09-01', reason: 'x' }, FROM),
    ).toMatchObject({ ok: false, reason: 'invalid_range' });
    expect(bookedRangesOf('wt-bad', FROM).filter((r) => r.start === '2027-09-05')).toHaveLength(0);
  });

  it('حجز ملاصق (يبدأ بعد نهاية القائم بيوم) مقبول', () => {
    const id = workerWith(['2027-10-10', '2027-10-15']);
    expect(
      addBooking(
        id,
        { start: '2027-10-16', end: '2027-10-17', reason: 'x', request_no: 'ADJ' },
        FROM,
      ),
    ).toMatchObject({ ok: true, created: true });
  });
});

describe('الجداول التجريبية المقصودة', () => {
  const from = today();

  it('عاملة متاحة بالكامل، وأخرى بحجز قريب، وثالثة محجوزة لفترة طويلة', () => {
    expect(bookedRangesOf('w1', from)).toEqual([]);
    expect(isWorkerAvailable('w1', from, addDays(from, 60), from).available).toBe(true);

    const near = bookedRangesOf('w2', from);
    expect(near).toEqual([
      expect.objectContaining({ start: addDays(from, 3), end: addDays(from, 6) }),
    ]);
    expect(isWorkerAvailable('w2', from, addDays(from, 2), from).available).toBe(true);

    expect(isWorkerAvailable('w6', addDays(from, 5), addDays(from, 10), from).status).toBe(
      'unavailable',
    );
  });

  it('حجزا طلبَي العرض الجاهزين يطابقان فترتيهما في ملف الطلب', () => {
    expect(bookedRangesOf('w3')).toContainEqual(
      expect.objectContaining({ ...pick(buildPeriod('2026-10-01', 'month', 3)) }),
    );
    expect(bookedRangesOf('w4')).toContainEqual(
      expect.objectContaining({ ...pick(buildPeriod('2026-10-09', 'day', 2)) }),
    );
  });

  it('يميّز عدم التوفّر (إجازة/فحص) عن الحجز', () => {
    const kinds = new Set(
      FALLBACK_WORKERS.flatMap((w) => bookedRangesOf(w.id, from).map((r) => r.kind)),
    );
    expect(kinds.has('booking')).toBe(true);
    for (const w of FALLBACK_WORKERS) {
      for (const r of bookedRangesOf(w.id, from)) {
        if (r.kind === 'unavailable') expect(dayState(w.id, r.start, from)).toBe('unavailable');
      }
    }
  });
});

function pick(p: { startDate: string; endDate: string }) {
  return { start: p.startDate, end: p.endDate };
}
