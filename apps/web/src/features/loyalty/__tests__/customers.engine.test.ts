import { describe, expect, it } from 'vitest';
import { getAccount, listLoyaltyCustomers, redeemPoints } from '@/features/loyalty/data/engine';

// تعدُّد عملاء الولاء والاستعلام عنهم. ملف مستقل ببذرة نظيفة.
describe('loyalty multi-customer store', () => {
  it('lists all loyalty customers with tier + balance', () => {
    const list = listLoyaltyCustomers();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.every((c) => c.id && c.name && c.phone)).toBe(true);
  });

  it('resolves the account for a specific customer id', () => {
    const noura = getAccount('c-noura');
    expect(noura.customer_name).toBe('نورة الشهري');
    expect(noura.tier).toBe('gold'); // spend 34000 ≥ 30000
    expect(noura.next_tier).toBeNull();

    const fahd = getAccount('c-fahd');
    expect(fahd.tier).toBe('bronze'); // spend 5200 < 10000
  });

  it('defaults to the primary customer when no id is given', () => {
    expect(getAccount().customer_name).toBe('محمد الأحمدي');
  });

  it('redeeming for one customer does not touch another', () => {
    const otherBefore = getAccount('c-noura').points_balance;
    redeemPoints(500, 'c-sara');
    expect(getAccount('c-noura').points_balance).toBe(otherBefore);
    expect(getAccount('c-sara').points_balance).toBe(12500 - 500);
  });
});
