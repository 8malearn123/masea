import { describe, expect, it } from 'vitest';
import {
  buildAcquisitionEntry,
  buildDepreciationEntry,
  monthlyDepreciation,
  netBookValue,
  periodDepreciation,
} from '@/features/accounting/data/assets';
import { assertBalanced } from '@/features/accounting/data/engine';
import type { FixedAsset } from '@/features/accounting/types';

function asset(over: Partial<FixedAsset>): FixedAsset {
  return {
    id: 'fa-1',
    name: 'سيارة',
    category: 'vehicles',
    asset_code: '1230',
    cost: 60000,
    salvage_value: 0,
    useful_life_years: 5,
    acquisition_date: '2026-01-10',
    branch: 'نجران',
    accumulated_dep: 0,
    status: 'active',
    ...over,
  };
}

describe('fixed assets', () => {
  it('straight-line monthly depreciation', () => {
    expect(monthlyDepreciation(asset({}))).toBe(1000); // 60000 / 60 months
    expect(
      monthlyDepreciation(asset({ cost: 24000, salvage_value: 0, useful_life_years: 8 })),
    ).toBe(250);
  });

  it('net book value = cost − accumulated depreciation', () => {
    expect(netBookValue(asset({ accumulated_dep: 12000 }))).toBe(48000);
  });

  it('caps the final period depreciation at the remaining depreciable amount', () => {
    const nearlyDone = asset({ accumulated_dep: 59500 }); // remaining 500 < monthly 1000
    expect(periodDepreciation(nearlyDone)).toBe(500);
    expect(periodDepreciation(asset({ status: 'disposed' }))).toBe(0);
  });

  it('acquisition entry: DR asset / CR pay account, balanced', () => {
    const e = buildAcquisitionEntry(asset({}), '1112', 1);
    expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(e.lines.find((l) => l.account_code === '1230')?.debit).toBe(60000);
    expect(e.lines.find((l) => l.account_code === '1112')?.credit).toBe(60000);
  });

  it('depreciation entry: DR 5900 / CR 1290, balanced', () => {
    const assets = [asset({}), asset({ id: 'fa-2', cost: 12000, useful_life_years: 5 })]; // 1000 + 200
    const e = buildDepreciationEntry(assets, '2026-06');
    expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(e.lines.find((l) => l.account_code === '5900')?.debit).toBe(1200);
    expect(e.lines.find((l) => l.account_code === '1290')?.credit).toBe(1200);
  });
});
