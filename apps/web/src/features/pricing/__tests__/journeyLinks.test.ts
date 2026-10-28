/**
 * Journey links found by the QA report (docs/qa/2026-10-27-journeys-report.md):
 * the managed price list reaches contracts, and loyalty coupons are real
 * discounts in the calculator.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { DEFAULT_PRICING_CONFIG, findByCode } from '@/shared/lib/pricing';
import {
  getPricingConfig,
  listPricingRules,
  managedPrice,
  updatePricingConfig,
  updatePricingRule,
} from '@/features/pricing/api/pricing.api';
import { listPromotions } from '@/features/pricing/api/promotions.api';
import { calculate, EMPTY_CALC } from '@/features/pricing/lib/engine';
import { createDraft } from '@/features/contracts/api/contracts.api';
import {
  addCampaign,
  issueWheelCoupon,
  removeCampaign,
  retireCampaignCoupon,
  syncCampaignCoupon,
} from '@/features/loyalty/api/loyalty.api';
import type { WheelPrize } from '@/features/loyalty/types';

afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

function signIn() {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === 'admin')!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}

describe('one price source for every screen', () => {
  it('a price-list change reaches the contract price and the order price', async () => {
    signIn();
    const rule = (await listPricingRules()).find(
      (r) => r.service_code === 'monthly_rental' && r.nationality === 'كينيا',
    )!;
    await updatePricingRule(
      rule.id,
      {
        base_price: 2100,
        min_price: 1900,
        effective_from: '2026-11-01',
        reason: 'تحديث سعر التأجير الشهري',
      },
      'منصور المكرمي',
    );
    expect((await managedPrice('monthly_rental', { nationality: 'كينيا', quantity: 2 })).base).toBe(
      4200,
    );
    const c = await createDraft({
      service_code: 'monthly_rental',
      customer_id: 'cust-2',
      customer_name: 'سارة القحطاني',
      branch: 'جازان',
      start_date: '2026-11-01',
      quantity: 2,
      nationality: 'كينيا',
    });
    expect(c.gross_amount).toBe(4200);
    expect(c.total_amount).toBe(4830); // + 15%
  });

  it('the managed VAT rate is used for new contracts', async () => {
    signIn();
    const cfg = await getPricingConfig();
    await updatePricingConfig({ ...cfg, vat_rate: 0.1 }, 'منصور المكرمي');
    const c = await createDraft({
      service_code: 'sponsorship_transfer',
      customer_id: 'cust-2',
      branch: 'جازان',
      start_date: '2026-11-01',
      quantity: 1,
    });
    expect(c.vat_amount).toBe(200); // 2,000 × 10%
    await updatePricingConfig(cfg, 'منصور المكرمي');
  });
});

describe('loyalty coupons are real discounts', () => {
  const calcWith = async (code: string) => {
    const promotion = findByCode(await listPromotions(), code);
    return calculate(
      { ...EMPTY_CALC, promotion, couponCode: code },
      await listPricingRules(),
      DEFAULT_PRICING_CONFIG,
    );
  };

  it('a wheel discount becomes a single-use coupon the calculator accepts', async () => {
    const prize: WheelPrize = {
      id: 'w3',
      label: 'خصم 10٪',
      prize_type: 'discount',
      value: 10,
      probability: 20,
      active: true,
      coupon_code: 'MAS-DISC10-T3ST',
    };
    await issueWheelCoupon(prize, 'محمد الأحمدي');
    const r = await calcWith('MAS-DISC10-T3ST');
    expect(r.promotion?.ok).toBe(true);
    // 10% of 16,000 = 1,600, capped at the managed floor (16,000 − 15,000)
    expect(r.detail.discounts).toBe(1000);
    expect(findByCode(await listPromotions(), 'MAS-DISC10-T3ST')?.usage_limit).toBe(1);
  });

  it('a campaign coupon works until the campaign stops or is removed', async () => {
    const c = addCampaign({
      name: 'عرض العودة للمدارس',
      type: 'discount',
      discount_pct: 5,
      start_at: '2026-10-01T00:00:00Z',
      end_at: '2026-12-31T00:00:00Z',
      is_active: true,
      coupon_code: 'MAS-DISC5-SCHL',
    });
    await syncCampaignCoupon(c);
    expect((await calcWith('MAS-DISC5-SCHL')).detail.discounts).toBe(800);

    await syncCampaignCoupon({ ...c, is_active: false });
    expect((await calcWith('MAS-DISC5-SCHL')).promotion?.ok).toBe(false);

    await syncCampaignCoupon(c);
    await retireCampaignCoupon(removeCampaign(c.id).coupon_code);
    expect((await calcWith('MAS-DISC5-SCHL')).promotion?.ok).toBe(false);
  });

  it('seeded campaign coupons are known to pricing; cashback codes are not price coupons', async () => {
    expect(findByCode(await listPromotions(), 'MAS-REF10-M4X8')).not.toBeNull();
    expect(findByCode(await listPromotions(), 'MAS-CASH5-9QF3')).toBeNull();
  });
});
