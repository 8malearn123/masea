import { describe, expect, it } from 'vitest';
import {
  applyVat,
  calcPriceDetail,
  DEFAULT_PRICING_CONFIG,
  evaluatePromotion,
  fallbackBase,
  findByCode,
  fallbackPrice,
  priceFromBase,
  ruleFloor,
  VAT_RATE,
  type Promotion,
} from '@/shared/lib/pricing';

function promo(p: Partial<Promotion> = {}): Promotion {
  return {
    id: 'pm-test',
    name: 'خصم تجريبي',
    code: null,
    description: null,
    discount_pct: null,
    discount_amount: null,
    service_codes: [],
    min_base_amount: null,
    max_discount_amount: null,
    starts_at: null,
    ends_at: null,
    usage_limit: null,
    usage_count: 0,
    is_active: true,
    requires_code: false,
    ...p,
  };
}

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
    // base 16000, −10% predefined discount (1600), +10% late penalty (1600) → net 16000
    const d = calcPriceDetail(
      'recruitment',
      { nationality: 'الفلبين', quantity: 1 },
      { promotion: promo({ discount_pct: 10 }), lateDays: 10 },
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
    const d = calcPriceDetail(
      'sponsorship_transfer',
      { quantity: 1 },
      { promotion: promo({ discount_amount: 99999 }) },
    );
    expect(d.discounts).toBe(2000);
    expect(d.net).toBe(0);
    expect(d.total).toBe(0);
  });
});

describe('predefined discounts (evaluate_promotion mirror)', () => {
  const now = new Date('2026-09-20T10:00:00Z');

  it('computes a percentage discount capped by max_discount_amount', () => {
    const p = promo({ discount_pct: 5, max_discount_amount: 500 });
    expect(evaluatePromotion(p, 'recruitment', 16000, now)).toEqual({
      ok: true,
      amount: 500,
      reason: null,
    });
    expect(evaluatePromotion(p, 'recruitment', 8000, now).amount).toBe(400);
  });

  it('computes a fixed-amount discount', () => {
    expect(
      evaluatePromotion(promo({ discount_amount: 300 }), 'daily_rental', 900, now).amount,
    ).toBe(300);
  });

  it('rejects ineligible discounts with a reason (no silent discount)', () => {
    const base = promo({ discount_pct: 10 });
    expect(evaluatePromotion({ ...base, is_active: false }, 'recruitment', 1000, now).ok).toBe(
      false,
    );
    expect(
      evaluatePromotion({ ...base, service_codes: ['monthly_rental'] }, 'recruitment', 1000, now)
        .reason,
    ).toBe('الخصم لا يشمل هذه الخدمة');
    expect(evaluatePromotion({ ...base, min_base_amount: 5000 }, 'recruitment', 1000, now).ok).toBe(
      false,
    );
    expect(
      evaluatePromotion({ ...base, ends_at: '2026-09-01T00:00:00Z' }, 'recruitment', 1000, now)
        .reason,
    ).toBe('انتهت صلاحية الخصم');
    expect(
      evaluatePromotion({ ...base, starts_at: '2026-10-01T00:00:00Z' }, 'recruitment', 1000, now)
        .ok,
    ).toBe(false);
    expect(
      evaluatePromotion({ ...base, usage_limit: 3, usage_count: 3 }, 'recruitment', 1000, now).ok,
    ).toBe(false);
  });

  it('applies no discount when the selected promotion is not eligible', () => {
    const d = calcPriceDetail(
      'recruitment',
      { nationality: 'الفلبين', quantity: 1 },
      { promotion: promo({ discount_pct: 10, service_codes: ['monthly_rental'] }) },
    );
    expect(d.discounts).toBe(0);
    expect(d.total).toBe(18400);
  });

  it('never discounts below the managed floor (min_price)', () => {
    const d = priceFromBase('recruitment', 16000, {
      promotion: promo({ discount_pct: 20 }),
      floor: 15000,
    });
    expect(d.discounts).toBe(1000);
    expect(d.net).toBe(15000);
  });
});

describe('discount coupons', () => {
  const now = new Date('2026-09-20T10:00:00Z');
  const coupon = promo({
    code: 'NJR-VIP',
    requires_code: true,
    discount_pct: 8,
    max_discount_amount: 1200,
  });

  it('applies a coupon only with its code (case-insensitive)', () => {
    expect(evaluatePromotion(coupon, 'recruitment', 16000, now).ok).toBe(false);
    expect(evaluatePromotion(coupon, 'recruitment', 16000, now, 'WRONG').reason).toBe(
      'الخصم يتطلب رمز كوبون صحيح',
    );
    expect(evaluatePromotion(coupon, 'recruitment', 16000, now, ' njr-vip ').amount).toBe(1200);
  });

  it('finds a promotion by its code', () => {
    expect(findByCode([coupon], 'njr-vip')?.id).toBe('pm-test');
    expect(findByCode([coupon], 'nope')).toBeNull();
    expect(findByCode([promo({ code: null })], '')).toBeNull();
  });

  it('prices with a coupon through priceFromBase', () => {
    const d = priceFromBase('monthly_rental', 7500, {
      promotion: coupon,
      promotionCode: 'NJR-VIP',
    });
    expect(d.discounts).toBe(600);
    expect(priceFromBase('monthly_rental', 7500, { promotion: coupon }).discounts).toBe(0);
  });
});

describe('managed price floor', () => {
  const rules = [
    {
      service_code: 'recruitment',
      nationality: null,
      profession: null,
      min_price: 10000,
      is_active: true,
    },
    {
      service_code: 'recruitment',
      nationality: 'الفلبين',
      profession: null,
      min_price: 15000,
      is_active: true,
    },
    {
      service_code: 'monthly_rental',
      nationality: 'كينيا',
      profession: null,
      min_price: 1850,
      is_active: false,
    },
  ];
  it('uses the most specific active rule × quantity', () => {
    expect(ruleFloor(rules, 'recruitment', { nationality: 'الفلبين', quantity: 1 })).toBe(15000);
    expect(ruleFloor(rules, 'recruitment', { nationality: 'كينيا', quantity: 2 })).toBe(20000);
    expect(ruleFloor(rules, 'monthly_rental', { nationality: 'كينيا', quantity: 3 })).toBe(0);
  });
});
