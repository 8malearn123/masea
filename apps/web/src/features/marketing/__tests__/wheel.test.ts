import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  createWheelLink,
  extendCampaign,
  prizeRuleError,
  resetWheelLinksDemo,
  spinByToken,
  wheelPublicView,
  wheelReport,
} from '@/features/marketing/api/wheel.api';

beforeEach(() => {
  resetWheelLinksDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('wheel (mirror of 0101)', () => {
  it('large discounts must be restricted to services', () => {
    expect(prizeRuleError({ prize_type: 'discount', value: 30, service_codes: [] }, 10)).toMatch(
      'حدّد الخدمات',
    );
    expect(
      prizeRuleError({ prize_type: 'discount', value: 30, service_codes: ['monthly_rental'] }, 10),
    ).toBeNull();
    expect(prizeRuleError({ prize_type: 'discount', value: 10, service_codes: [] }, 10)).toBeNull();
    expect(prizeRuleError({ prize_type: 'points', value: 500, service_codes: [] }, 10)).toBeNull();
  });

  it('a customer link spins once, then refuses reuse and a second link', async () => {
    const { token } = await createWheelLink('cust-00001', 'محمد الأحمدي');
    const v = await wheelPublicView(token);
    expect(v.first_name).toBe('محمد');
    expect(v.prizes.length).toBeGreaterThan(0);
    expect(Math.round(v.prizes.reduce((s, p) => s + p.chance, 0))).toBe(100);
    const r = await spinByToken(token);
    expect(r.label).toBeTruthy();
    await expect(spinByToken(token)).rejects.toThrow('مسبقاً');
    const second = await createWheelLink('cust-00001', 'محمد الأحمدي');
    await expect(spinByToken(second.token)).rejects.toThrow('تجاوزت');
    await expect(wheelPublicView('bad')).rejects.toThrow('غير صحيح');
    const today = new Date().toISOString().slice(0, 10);
    expect((await wheelReport(today, today)).reduce((s, x) => s + x.spins, 0)).toBe(1);
  });

  it('extending a campaign needs a manager and a reason', async () => {
    const until = new Date(Date.now() + 7 * 86400000).toISOString();
    await expect(extendCampaign('cm1', until, 'x', 'admin')).rejects.toThrow('سبب');
    await expect(extendCampaign('cm1', until, 'تمديد لنهاية الشهر', 'sales')).rejects.toThrow(
      'صلاحية إدارية',
    );
  });
});
