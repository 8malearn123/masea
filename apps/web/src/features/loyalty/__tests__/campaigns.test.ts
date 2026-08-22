import { describe, expect, it } from 'vitest';
import {
  addCampaign,
  generateCampaignCoupon,
  listCampaigns,
  removeCampaign,
  updateCampaign,
} from '@/features/loyalty/api/loyalty.api';

// إدارة الحملات التسويقية (CRUD + كوبونات). كل ملف اختبار يبدأ ببذرة نظيفة.
describe('marketing campaign store', () => {
  it('seeds the default campaigns', async () => {
    expect((await listCampaigns()).length).toBeGreaterThanOrEqual(4);
  });

  it('adds a campaign with a generated id and zero usage', async () => {
    const before = (await listCampaigns()).length;
    const c = addCampaign({
      name: 'عرض العودة للمدارس',
      type: 'discount',
      discount_pct: 12,
      start_at: '2026-08-01T00:00:00Z',
      end_at: '2026-09-01T00:00:00Z',
      is_active: true,
      coupon_code: null,
    });
    expect(c.id).toMatch(/^cm-/);
    expect(c.usage_count).toBe(0);
    expect((await listCampaigns()).length).toBe(before + 1);
  });

  it('updates a campaign', async () => {
    const c = (await listCampaigns())[0]!;
    const updated = updateCampaign(c.id, { discount_pct: 33, is_active: false });
    expect(updated.discount_pct).toBe(33);
    expect(updated.is_active).toBe(false);
  });

  it('removes a campaign', async () => {
    const added = addCampaign({
      name: 'مؤقتة',
      type: 'seasonal',
      discount_pct: 5,
      start_at: '2026-01-01T00:00:00Z',
      end_at: '2026-01-10T00:00:00Z',
      is_active: true,
      coupon_code: null,
    });
    const before = (await listCampaigns()).length;
    removeCampaign(added.id);
    expect((await listCampaigns()).length).toBe(before - 1);
  });

  it('builds a coupon code per campaign type', () => {
    expect(generateCampaignCoupon('discount', 15)).toMatch(/^MAS-DISC15-[A-Z0-9]{4}$/);
    expect(generateCampaignCoupon('cashback', 5)).toMatch(/^MAS-CASH5-[A-Z0-9]{4}$/);
    expect(generateCampaignCoupon('referral', 10)).toMatch(/^MAS-REF10-[A-Z0-9]{4}$/);
  });
});
