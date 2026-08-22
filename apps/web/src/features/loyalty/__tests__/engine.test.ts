import { describe, expect, it } from 'vitest';
import {
  awardPoints,
  getAccount,
  redeemPoints,
  spinWheel,
  WHEEL_PRIZES,
} from '@/features/loyalty/data/engine';

// NOTE: the engine uses a shared in-memory store; these run in order.
describe('loyalty engine (ledger mirror of 0020)', () => {
  it('balance = sum of ledger entries; tier derived from spend', () => {
    const a = getAccount();
    expect(a.points_balance).toBe(18000); // 16000 + 5000 − 3000
    expect(a.wallet_balance).toBe(250); // 200 + 50
    expect(a.tier).toBe('silver'); // spend 21000 ≥ 10000
    expect(a.next_tier?.tier).toBe('gold');
    expect(a.progress_pct).toBe(70); // 21000 / 30000
  });

  it('redeem guards an insufficient balance', () => {
    expect(() => redeemPoints(10_000_000)).toThrow();
  });

  it('redeem reduces points and returns SAR value (100 pts = 1 ر.س)', () => {
    expect(redeemPoints(1000)).toBe(10);
    expect(getAccount().points_balance).toBe(17000);
  });

  it('award_points applies the tier multiplier (silver ×1.25)', () => {
    expect(awardPoints(10000)).toBe(12500);
    expect(getAccount().points_balance).toBe(29500);
  });

  it('wheel returns a valid prize then enforces the per-customer limit', () => {
    const prize = spinWheel();
    expect(WHEEL_PRIZES.some((p) => p.id === prize.id)).toBe(true);
    expect(() => spinWheel()).toThrow(); // wheel_spins_per_customer = 1
  });
});
