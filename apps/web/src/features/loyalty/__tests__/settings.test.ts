import { describe, expect, it } from 'vitest';
import {
  getLoyaltyConfig,
  listPackages,
  listTiers,
  savePackage,
  tiersOrdered,
  updateLoyaltyConfig,
  updateTier,
} from '@/features/loyalty/api/loyaltySettings.api';
import { getAccount, redeemPoints } from '@/features/loyalty/data/engine';

describe('managed loyalty settings (no hardcoded display)', () => {
  it('edits the config and the engine uses the new value immediately', async () => {
    const cfg = await getLoyaltyConfig();
    await updateLoyaltyConfig({ ...cfg, redeem_points_per_riyal: 50 });
    expect((await getLoyaltyConfig()).redeem_points_per_riyal).toBe(50);
    expect(getAccount().points_balance).toBeGreaterThanOrEqual(100);
    expect(redeemPoints(100)).toBe(2); // engine reads the live config: 100 / 50
    await updateLoyaltyConfig({ ...cfg });
  });

  it('rejects invalid config values', async () => {
    const cfg = await getLoyaltyConfig();
    await expect(updateLoyaltyConfig({ ...cfg, referral_commission_pct: 150 })).rejects.toThrow();
    await expect(updateLoyaltyConfig({ ...cfg, points_per_riyal: 0 })).rejects.toThrow();
  });

  it('edits a tier but keeps thresholds ascending', async () => {
    await updateTier('silver', { label: 'فضي مميّز', min_spend: 12000, multiplier: 1.3 });
    const silver = (await listTiers()).find((t) => t.tier === 'silver');
    expect(silver).toMatchObject({ label: 'فضي مميّز', min_spend: 12000, multiplier: 1.3 });
    await expect(
      updateTier('silver', { label: 'فضي', min_spend: 40000, multiplier: 1.25 }),
    ).rejects.toThrow();
    expect(tiersOrdered([{ min_spend: 0 }, { min_spend: 5 }, { min_spend: 5 }])).toBe(false);
  });

  it('adds, edits and disables packages', async () => {
    await savePackage(null, {
      name: 'باقة رمضان',
      included: ['تأجير شهري', 'تأجير يومي'],
      special_price: 3900,
      is_active: true,
    });
    const added = (await listPackages()).find((p) => p.name === 'باقة رمضان');
    expect(added).toBeTruthy();
    await savePackage(added!.id, { ...added!, is_active: false });
    expect((await listPackages()).find((p) => p.id === added!.id)?.is_active).toBe(false);
    await expect(
      savePackage(null, { name: 'ب', included: [], special_price: 0, is_active: true }),
    ).rejects.toThrow();
  });
});
