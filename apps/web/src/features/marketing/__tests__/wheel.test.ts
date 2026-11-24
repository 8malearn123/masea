import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { WHEEL_PRIZES } from '@/features/loyalty/data/engine';
import type { WheelPrize } from '@/features/loyalty/types';
import {
  createWheelLink,
  customerWheelPrizes,
  extendCampaign,
  prizeActivationError,
  probabilityTotal,
  redeemWheelPrize,
  resetWheelLinksDemo,
  spinByToken,
  wheelPublicView,
  wheelReport,
} from '@/features/marketing/api/wheel.api';

const DELIVERY: WheelPrize = {
  id: 'wt-1',
  label: 'توصيل مجاني للعاملة',
  prize_type: 'free_service',
  value: 0,
  probability: 100,
  active: true,
  coupon_code: null,
  service_codes: ['monthly_rental'],
  coupon_valid_days: 30,
  usage_limit: 1,
  max_awards: null,
  terms: 'توصيل العاملة لمنزل العميل مجاناً داخل المدينة عند عقد تأجير شهري واحد.',
};
let saved: WheelPrize[] = [];
const CUSTOMER = {
  customerId: 'cust-00001',
  fullName: 'محمد الأحمدي',
  nationalId: '1012345678',
  phone: '0551234567',
  campaign: { id: 'cm1', name: 'عجلة اليوم الوطني', terms: 'لعملاء نجران المسجّلين' },
  validHours: 72,
};
const contract = (
  over: Partial<{
    id: string;
    customer_id: string;
    service_code: string;
    parent_contract_id: string | null;
  }> = {},
) => ({
  id: 'ct-1',
  customer_id: 'cust-00001',
  service_code: 'monthly_rental',
  total_amount: 2300,
  parent_contract_id: 'ct-0',
  ...over,
});

beforeEach(() => {
  resetWheelLinksDemo();
  saved = WHEEL_PRIZES.splice(0, WHEEL_PRIZES.length, { ...DELIVERY });
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  WHEEL_PRIZES.splice(0, WHEEL_PRIZES.length, ...saved);
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('wheel (mirror of 0104)', () => {
  it('undefined prizes cannot be activated', () => {
    const base = {
      value: 10,
      service_codes: [],
      max_discount_amount: null,
      coupon_valid_days: 30,
      active: true,
    };
    expect(prizeActivationError({ ...base, prize_type: 'discount' })).toMatch('الحد الأعلى');
    expect(
      prizeActivationError({
        ...base,
        prize_type: 'discount',
        service_codes: ['monthly_rental'],
        max_discount_amount: 300,
      }),
    ).toBeNull();
    expect(
      prizeActivationError({
        ...base,
        prize_type: 'free_service',
        service_codes: ['monthly_rental'],
      }),
    ).toMatch('تعريفها');
    expect(prizeActivationError({ ...base, prize_type: 'discount', active: false })).toBeNull();
    expect(prizeActivationError({ ...base, prize_type: 'points' })).toBeNull();
  });

  it('the wheel refuses links until active probabilities total 100%', async () => {
    WHEEL_PRIZES[0]!.probability = 72;
    expect(probabilityTotal(WHEEL_PRIZES)).toBe(72);
    await expect(createWheelLink(CUSTOMER)).rejects.toThrow('100٪');
    expect(WHEEL_PRIZES[0]!.probability).toBe(72);
  });

  it('identity check, once per campaign, lockout', async () => {
    await expect(createWheelLink({ ...CUSTOMER, nationalId: null })).rejects.toThrow('رقم الهوية');
    const { token } = await createWheelLink(CUSTOMER);
    const v = await wheelPublicView(token, 5);
    expect(v.campaign_name).toBe('عجلة اليوم الوطني');
    expect(v.campaign_terms).toBe('لعملاء نجران المسجّلين');
    expect(v.prizes[0]!.terms).toMatch('توصيل العاملة');
    await expect(spinByToken(token, '0000', '4567', 5)).rejects.toThrow('غير مطابقة');
    const r = await spinByToken(token, '5678', '4567', 5);
    expect(r.reference).toMatch(/^MAS-PRIZE-/);
    expect(r.valid_until).toBeTruthy();
    await expect(spinByToken(token, '5678', '4567', 5)).rejects.toThrow('مسبقاً');
    const again = await createWheelLink(CUSTOMER);
    await expect(spinByToken(again.token, '5678', '4567', 5)).rejects.toThrow('سبق لك المشاركة');
    const other = await createWheelLink({
      ...CUSTOMER,
      campaign: { id: 'cm2', name: 'عجلة ديسمبر' },
    });
    for (let i = 0; i < 2; i++)
      await expect(spinByToken(other.token, '1111', '1111', 2)).rejects.toThrow('غير مطابقة');
    await expect(spinByToken(other.token, '5678', '4567', 2)).rejects.toThrow('أُوقف الرابط');
    await expect(wheelPublicView('bad', 5)).rejects.toThrow('غير صحيح');
  });

  it('max awards reached → no prize', async () => {
    WHEEL_PRIZES[0]!.max_awards = 1;
    await spinByToken((await createWheelLink(CUSTOMER)).token, '5678', '4567', 5);
    const r = await spinByToken(
      (await createWheelLink({ ...CUSTOMER, customerId: 'cust-00002' })).token,
      '5678',
      '4567',
      5,
    );
    expect(r.prize_type).toBe('none');
    expect(r.reference).toBeNull();
  });

  it('prize used on the right contract; report counts only that renewal', async () => {
    const r = await spinByToken((await createWheelLink(CUSTOMER)).token, '5678', '4567', 5);
    const ref = r.reference!;
    await expect(redeemWheelPrize(ref, contract({ customer_id: 'cust-00009' }))).rejects.toThrow(
      'عميلاً آخر',
    );
    await expect(redeemWheelPrize(ref, contract({ service_code: 'recruitment' }))).rejects.toThrow(
      'لا تشمل',
    );
    await redeemWheelPrize(ref, contract());
    await expect(redeemWheelPrize(ref, contract({ id: 'ct-2' }))).rejects.toThrow('بالعدد المسموح');
    const prizes = await customerWheelPrizes('cust-00001');
    expect(prizes[0]!.uses).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await wheelReport({ from: today, to: today, campaignId: 'cm1', branch: null });
    expect(rows[0]).toMatchObject({
      participants: 1,
      spins: 1,
      winners: 1,
      used: 1,
      renewals: 1,
      renewals_value: 2300,
      contracts: 0,
    });
    expect(
      await wheelReport({ from: today, to: today, campaignId: 'cm2', branch: null }),
    ).toHaveLength(0);
  });

  it('extending a campaign needs a manager and a reason', async () => {
    const until = new Date(Date.now() + 7 * 86400000).toISOString();
    await expect(extendCampaign('cm1', until, 'x', 'admin')).rejects.toThrow('سبب');
    await expect(extendCampaign('cm1', until, 'تمديد لنهاية الشهر', 'sales')).rejects.toThrow(
      'صلاحية إدارية',
    );
  });
});
