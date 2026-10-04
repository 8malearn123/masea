import { describe, expect, it } from 'vitest';
import {
  addBooking,
  bookedRangesOf,
  conflictFor,
  dayState,
  freeDaysInHorizon,
  isFreeBetween,
  monthGrid,
  nextFreeDay,
} from '@/features/catalog/lib/availability';
import { addDays, today } from '@/features/requests/lib/period';

const FROM = '2026-09-20';

describe('جدول توفّر العاملة', () => {
  it('يولّد نفس الحجوزات للعاملة نفسها في كل مرة', () => {
    expect(bookedRangesOf('w1', FROM)).toEqual(bookedRangesOf('w1', FROM));
    expect(bookedRangesOf('w1', FROM)).not.toEqual(bookedRangesOf('w2', FROM));
  });

  it('يرتّب الحجوزات زمنيًا ويجعل أيامها محجوزة', () => {
    const ranges = bookedRangesOf('w3', FROM);
    expect(ranges.length).toBeGreaterThan(0);
    const first = ranges[0]!;
    expect(first.start <= first.end).toBe(true);
    expect(dayState('w3', first.start, FROM)).toBe('booked');
    expect(dayState('w3', addDays(FROM, -1), FROM)).toBe('past');
  });

  it('يكشف تعارض المدة المطلوبة مع حجز قائم', () => {
    const booked = bookedRangesOf('w5', FROM)[0]!;
    expect(isFreeBetween('w5', booked.start, booked.end, FROM)).toBe(false);
    expect(conflictFor('w5', booked.start, booked.end, FROM)?.start).toBe(booked.start);
  });

  it('يقترح أقرب تاريخ متاح للمدة المطلوبة', () => {
    const next = nextFreeDay('w5', 3, FROM);
    expect(next).not.toBeNull();
    expect(isFreeBetween('w5', next!, addDays(next!, 2), FROM)).toBe(true);
  });

  it('يضيف حجز طلب جديد إلى الجدول مرة واحدة', () => {
    const start = addDays(today(), 200); // خارج نطاق الحجوزات المُولَّدة
    const end = addDays(start, 2);
    addBooking('w7', { start, end, reason: 'طلب تأجير شهري', request_no: 'REQ-TEST' });
    addBooking('w7', { start, end, reason: 'طلب تأجير شهري', request_no: 'REQ-TEST' });
    const mine = bookedRangesOf('w7').filter((r) => r.request_no === 'REQ-TEST');
    expect(mine).toHaveLength(1);
    expect(isFreeBetween('w7', start, end)).toBe(false);
  });

  it('يعطي شبكة شهر بأيامه كاملة', () => {
    const grid = monthGrid(2026, 9); // أكتوبر ٢٠٢٦
    expect(grid.cells.filter(Boolean)).toHaveLength(31);
    expect(grid.label).toBe('أكتوبر 2026');
  });

  it('يحسب الأيام المتاحة ضمن الأفق', () => {
    expect(freeDaysInHorizon('w1', FROM)).toBeGreaterThan(0);
  });
});
