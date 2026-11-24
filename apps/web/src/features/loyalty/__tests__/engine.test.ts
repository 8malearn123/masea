import { describe, expect, it } from 'vitest';
import {
  awardPoints,
  getAccount,
  redeemPoints,
  activeProbabilityTotal,
  pickPrize,
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

  it('redeem reduces points and credits the SAR value to the wallet (100 pts = 1 ر.س)', () => {
    expect(redeemPoints(1000)).toBe(10);
    expect(getAccount().points_balance).toBe(17000);
    expect(getAccount().wallet_balance).toBe(260); // 250 + 10
    expect(getAccount().wallet_ledger[0]).toMatchObject({ type: 'credit', amount: 10 });
  });

  it('award_points applies the tier multiplier (silver ×1.25)', () => {
    expect(awardPoints(10000)).toBe(12500);
    expect(getAccount().points_balance).toBe(29500);
  });

  it('approved odds (0105): five active prizes total exactly 100%, the two undefined at 0% and disabled', () => {
    const odds = Object.fromEntries(WHEEL_PRIZES.map((p) => [p.label, [p.probability, p.active]]));
    expect(odds).toEqual({
      '100 نقطة': [40, true],
      '20 ريال محفظة': [25, true],
      'خصم 10٪': [0, false],
      '500 نقطة': [10, true],
      'تأجيل مجاني': [0, false],
      '50 ريال محفظة': [5, true],
      'حظ أوفر': [20, true],
    });
    expect(activeProbabilityTotal(WHEEL_PRIZES)).toBe(100);
    // القيم لم تتغيّر
    expect(WHEEL_PRIZES.map((p) => p.value)).toEqual([100, 20, 10, 500, 1, 50, 0]);
  });

  it('pick = cumulative ranges of active prizes in display order (mirror of wheel_pick_prize)', () => {
    const at = (r: number) => pickPrize(WHEEL_PRIZES, r)?.label;
    expect(at(0)).toBe('100 نقطة');
    expect(at(39.999)).toBe('100 نقطة');
    expect(at(40)).toBe('20 ريال محفظة');
    expect(at(65)).toBe('500 نقطة'); // «خصم 10٪» المعطّلة لا تأخذ مجالاً
    expect(at(75)).toBe('50 ريال محفظة'); // «تأجيل مجاني» المعطّلة لا تأخذ مجالاً
    expect(at(80)).toBe('حظ أوفر');
    expect(at(99.9999)).toBe('حظ أوفر');
  });

  it('a 100,000-draw sample lands within ±1 point of each approved odd', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 100_000; i++) {
      const p = pickPrize(WHEEL_PRIZES, Math.random() * 100)!;
      counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(
      WHEEL_PRIZES.filter((p) => p.active)
        .map((p) => p.label)
        .sort(),
    );
    for (const p of WHEEL_PRIZES.filter((x) => x.active))
      expect(Math.abs((counts.get(p.label) ?? 0) / 1000 - p.probability)).toBeLessThan(1);
  });

  it('wheel returns a valid prize, grants it once, then enforces the per-customer limit', () => {
    const before = getAccount();
    const prize = spinWheel();
    expect(WHEEL_PRIZES.some((p) => p.id === prize.id && p.active)).toBe(true);
    const after = getAccount();
    expect(after.points_balance - before.points_balance).toBe(
      prize.prize_type === 'points' ? prize.value : 0,
    );
    expect(after.wallet_balance - before.wallet_balance).toBe(
      prize.prize_type === 'wallet' ? prize.value : 0,
    );
    expect(() => spinWheel()).toThrow(); // wheel_spins_per_customer = 1
    expect(getAccount().points_balance).toBe(after.points_balance); // لا منح مكرر
  });
});
