import { describe, expect, it } from 'vitest';
import {
  applyVat,
  calcPriceDetail,
  DEFAULT_PRICING_CONFIG,
  fallbackBase,
  fallbackPrice,
  VAT_RATE,
} from '@/shared/lib/pricing';

describe('VAT (15%)', () => {
  it('applies 15% VAT correctly', () => {
    expect(VAT_RATE).toBe(0.15);
    expect(applyVat(100)).toEqual({ base: 100, vat: 15, total: 115 });
    expect(applyVat(16000)).toEqual({ base: 16000, vat: 2400, total: 18400 });
  });

  it('rounds to two decimals', () => {
    const p = applyVat(99.99);
    expect(p.vat).toBeCloseTo(15.0, 2);
    expect(p.total).toBeCloseTo(114.99, 2);
  });
});

describe('fallback pricing', () => {
  it('prices recruitment by nationality (fixed, qty=1)', () => {
    expect(fallbackBase('recruitment', { nationality: 'الفلبين', quantity: 1 })).toBe(16000);
    expect(fallbackPrice('recruitment', { nationality: 'الفلبين', quantity: 1 })).toEqual({
      base: 16000,
      vat: 2400,
      total: 18400,
    });
  });

  it('scales monthly rental by months', () => {
    expect(fallbackBase('monthly_rental', { nationality: 'الفلبين', quantity: 3 })).toBe(7500);
    expect(fallbackPrice('monthly_rental', { quantity: 3 }).total).toBe(7590); // default 2200*3 + VAT
  });

  it('scales daily rental by days and task', () => {
    expect(fallbackBase('daily_rental', { profession: 'طبخ', quantity: 2 })).toBe(440);
  });

  it('uses a fixed fee for sponsorship transfer', () => {
    expect(fallbackBase('sponsorship_transfer', { quantity: 1 })).toBe(2000);
  });
});

describe('layered pricing (calc_price mirror)', () => {
  it('prices every service type with no modifiers', () => {
    expect(calcPriceDetail('recruitment', { nationality: 'الفلبين', quantity: 1 }).total).toBe(
      18400,
    );
    expect(calcPriceDetail('monthly_rental', { nationality: 'الفلبين', quantity: 3 }).total).toBe(
      8625,
    );
    expect(calcPriceDetail('daily_rental', { profession: 'تنظيف', quantity: 5 }).total).toBe(1035);
    expect(calcPriceDetail('sponsorship_transfer', { quantity: 1 }).total).toBe(2300);
  });

  it('applies VAT on the NET (after discount & penalty), not the base', () => {
    // base 16000, −10% discount (1600), +10% late penalty (1600) → net 16000
    const d = calcPriceDetail(
      'recruitment',
      { nationality: 'الفلبين', quantity: 1 },
      { discountPct: 10, lateDays: 10 },
    );
    expect(d).toEqual({
      base: 16000,
      discounts: 1600,
      penalties: 1600,
      net: 16000,
      vat: 2400,
      total: 18400,
    });
  });

  it('caps the late penalty at late_max_pct', () => {
    const d = calcPriceDetail(
      'recruitment',
      { nationality: 'الفلبين', quantity: 1 },
      { lateDays: 100 },
    );
    expect(d.penalties).toBe(16000 * (DEFAULT_PRICING_CONFIG.late_max_pct / 100)); // 1600
  });

  it('does not penalize within the grace period', () => {
    const d = calcPriceDetail(
      'recruitment',
      { nationality: 'الفلبين', quantity: 1 },
      { lateDays: 3 },
    );
    expect(d.penalties).toBe(0);
  });

  it('combines cancellation fee and absence compensation discount', () => {
    // base 2500, cancel 25% (625) penalty, absence 3 days × 50 (150) discount
    const d = calcPriceDetail(
      'monthly_rental',
      { nationality: 'الفلبين', quantity: 1 },
      { cancelled: true, absenceDays: 3 },
    );
    expect(d.discounts).toBe(150);
    expect(d.penalties).toBe(625);
    expect(d.net).toBe(2975);
    expect(d.total).toBeCloseTo(3421.25, 2);
  });

  it('never discounts below zero', () => {
    const d = calcPriceDetail('sponsorship_transfer', { quantity: 1 }, { discountAmount: 99999 });
    expect(d.discounts).toBe(2000);
    expect(d.net).toBe(0);
    expect(d.total).toBe(0);
  });
});
