import { describe, expect, it } from 'vitest';
import {
  addWheelPrize,
  generateCouponCode,
  listWheelPrizes,
  removeWheelPrize,
  updateWheelPrize,
} from '@/features/loyalty/data/engine';

// إدارة جوائز العجلة (CRUD + كوبونات). كل ملف اختبار يبدأ ببذرة نظيفة.
describe('wheel prize admin store', () => {
  it('seeds the default prizes', () => {
    expect(listWheelPrizes().length).toBeGreaterThanOrEqual(7);
  });

  it('adds a new prize with a generated id', () => {
    const before = listWheelPrizes().length;
    const p = addWheelPrize({
      label: 'خصم 25٪',
      prize_type: 'discount',
      value: 25,
      probability: 5,
      active: true,
      coupon_code: null,
    });
    expect(p.id).toMatch(/^w-/);
    expect(listWheelPrizes().length).toBe(before + 1);
  });

  it('updates an existing prize', () => {
    const p = listWheelPrizes()[0]!;
    const updated = updateWheelPrize(p.id, { probability: 42, active: false });
    expect(updated.probability).toBe(42);
    expect(updated.active).toBe(false);
  });

  it('removes a prize', () => {
    const added = addWheelPrize({
      label: 'مؤقتة',
      prize_type: 'none',
      value: 0,
      probability: 1,
      active: true,
      coupon_code: null,
    });
    const before = listWheelPrizes().length;
    removeWheelPrize(added.id);
    expect(listWheelPrizes().length).toBe(before - 1);
  });

  it('builds a coupon code for the prize type', () => {
    expect(generateCouponCode('discount', 15)).toMatch(/^MAS-DISC15-[A-Z0-9]{4}$/);
    expect(generateCouponCode('free_service', 1)).toMatch(/^MAS-FREE-[A-Z0-9]{4}$/);
  });
});
