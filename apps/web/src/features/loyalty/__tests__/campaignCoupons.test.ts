import { afterEach, describe, expect, it } from 'vitest';
import type { AppRole } from '@masiat/shared';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { calculate, EMPTY_CALC } from '@/features/pricing/lib/engine';
import { getPricingConfig, listPricingRules } from '@/features/pricing/api/pricing.api';
import { listPromotions } from '@/features/pricing/api/promotions.api';
import { findByCode } from '@/shared/lib/pricing';
import { getQuoteRecord } from '@/shared/lib/quotesLedger';
import { getContract } from '@/features/contracts/api/contracts.api';
import { listSales } from '@/features/sales/api/sales.api';
import { demoMutateContract } from '@/features/contracts/api/contracts.api';
import {
  convertQuote,
  createLeadQuote,
  getLead,
  setLeadQuoteStatus,
} from '@/features/crm/api/crm.api';
import { addCampaign, updateCampaign } from '@/features/loyalty/api/loyalty.api';
import {
  campaignPerformance,
  issueCampaignCoupons,
  listCampaignCoupons,
  validateIssue,
} from '@/features/loyalty/api/campaignCoupons.api';

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(role);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const POLICY = { presets: [5, 10], canCustom: false };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function calcWith(
  code: string,
  service: 'monthly_rental' | 'recruitment' = 'monthly_rental',
) {
  const [rules, cfg, promos] = await Promise.all([
    listPricingRules(),
    getPricingConfig(),
    listPromotions(),
  ]);
  return calculate(
    {
      ...EMPTY_CALC,
      service,
      nationality: 'الفلبين',
      quantity: 3,
      promotion: findByCode(promos, code),
      couponCode: code,
    },
    rules,
    cfg,
  );
}

describe('campaign referral coupons', () => {
  it('presets for everyone, a custom % only with management rights', () => {
    const base = { count: 1, pct: 10, usageLimit: 1, referrer: null, prefix: 'MAS-REF' };
    expect(validateIssue(base, POLICY)).toBeNull();
    expect(validateIssue({ ...base, pct: 5 }, POLICY)).toBeNull();
    expect(validateIssue({ ...base, pct: 15 }, POLICY)).toMatch(/صلاحية الإدارة/);
    expect(validateIssue({ ...base, pct: 15 }, { ...POLICY, canCustom: true })).toBeNull();
    expect(validateIssue({ ...base, count: 3, referrer: { id: 'c', name: 'م' } }, POLICY)).toMatch(
      /واحدًا/,
    );
    expect(validateIssue({ ...base, usageLimit: 0 }, POLICY)).toMatch(/1 على الأقل/);
  });

  it('a coupon of the campaign discounts the quote, the contract and the sale; usage and total discount are tracked', async () => {
    const acc = signIn('sales'); // شرورة
    const campaign = await addCampaign({
      name: 'عرض الإحالة',
      type: 'referral',
      discount_pct: 10,
      start_at: day(-1),
      end_at: day(30),
      is_active: true,
      coupon_code: null,
      description: 'خصم 10٪ لمن يحضر عميلاً جديدًا',
      service_codes: ['monthly_rental'],
    });
    const [coupon] = await issueCampaignCoupons(
      campaign,
      {
        count: 1,
        pct: 10,
        usageLimit: 1,
        referrer: { id: 'cust-00007', name: 'عبدالعزيز اليامي' },
        prefix: 'SHR-REF',
      },
      POLICY,
    );
    expect(coupon?.code).toMatch(/^SHR-REF10-/);
    expect(coupon?.referrer_name).toBe('عبدالعزيز اليامي');
    const code = coupon!.code;

    expect((await calcWith(code)).detail.discounts).toBeGreaterThan(0);
    expect((await calcWith(code, 'recruitment')).promotion?.ok).toBe(false); // not a covered service

    const lead = await getLead('lead-3');
    if (!lead) throw new Error('lead-3 missing');
    const [rules, cfg, promos] = await Promise.all([
      listPricingRules(),
      getPricingConfig(),
      listPromotions(),
    ]);
    const q = await createLeadQuote(
      {
        lead,
        calc: {
          ...EMPTY_CALC,
          service: 'monthly_rental',
          nationality: 'الفلبين',
          quantity: 3,
          promotion: findByCode(promos, code),
          couponCode: code,
        },
        valid_days: 7,
        notes: null,
        extra: {
          start_date: day(3).slice(0, 10),
          duration_unit: 'month',
          duration_count: 3,
          terms: [],
        },
      },
      { rules, cfg, actor: acc.name },
    );
    expect(q.coupon_code).toBe(code);
    expect(q.discount_amount).toBeGreaterThan(0);

    const policy = { thresholdPct: 100, canApprove: false };
    await setLeadQuoteStatus(q.id, 'sent', acc.name, policy);
    await setLeadQuoteStatus(q.id, 'accepted', acc.name, policy);
    const { contract_id } = await convertQuote(getQuoteRecord(q.id)!, acc.name);
    const contract = await getContract(contract_id);
    expect(contract?.discount_amount).toBe(q.discount_amount);

    demoMutateContract(contract_id, { status: 'signed', signed_at: new Date().toISOString() });
    const sale = (await listSales()).find((s) => s.contract_id === contract_id);
    expect(sale?.discount_amount).toBe(q.discount_amount);
    expect(sale?.coupon_code).toBe(code);

    const stats = await listCampaignCoupons(campaign);
    const row = stats.find((c) => c.code === code);
    expect(row?.uses).toBe(1);
    expect(row?.total_discount).toBe(q.discount_amount);
    expect(campaignPerformance(stats).uses).toBe(1);

    // single use → refused the second time
    expect((await calcWith(code)).promotion?.ok).toBe(false);
  });

  it('switching the campaign off stops its coupons', async () => {
    signIn('admin');
    const campaign = await addCampaign({
      name: 'عرض اليوم الوطني',
      type: 'seasonal',
      discount_pct: 5,
      start_at: day(-1),
      end_at: day(10),
      is_active: true,
      coupon_code: null,
      service_codes: [],
    });
    const [coupon] = await issueCampaignCoupons(
      campaign,
      { count: 1, pct: 5, usageLimit: null, referrer: null, prefix: 'NAT' },
      POLICY,
    );
    expect((await calcWith(coupon!.code)).promotion?.ok).toBe(true);
    await updateCampaign(campaign.id, { is_active: false });
    expect((await calcWith(coupon!.code)).promotion?.ok).toBe(false);
    await updateCampaign(campaign.id, { is_active: true, end_at: day(-1) });
    expect((await calcWith(coupon!.code)).promotion?.reason).toMatch(/انتهت/);
  });
});
