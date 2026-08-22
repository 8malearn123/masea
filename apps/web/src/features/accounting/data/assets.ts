import type { FixedAsset, JournalEntry, JournalLine } from '@/features/accounting/types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Straight-line monthly depreciation for an asset. */
export function monthlyDepreciation(a: FixedAsset): number {
  return round2((a.cost - a.salvage_value) / (a.useful_life_years * 12));
}

/** Remaining depreciable amount (never below salvage). */
export function remainingDepreciable(a: FixedAsset): number {
  return round2(Math.max(a.cost - a.salvage_value - a.accumulated_dep, 0));
}

/** Net book value = cost − accumulated depreciation. */
export function netBookValue(a: FixedAsset): number {
  return round2(a.cost - a.accumulated_dep);
}

/** This period's depreciation for an asset (capped at remaining). */
export function periodDepreciation(a: FixedAsset): number {
  if (a.status !== 'active') return 0;
  return Math.min(monthlyDepreciation(a), remainingDepreciable(a));
}

/** Acquisition entry: DR asset / CR pay account. */
export function buildAcquisitionEntry(a: FixedAsset, payCode: string, seq: number): JournalEntry {
  const lines: JournalLine[] = [
    { account_code: a.asset_code, debit: a.cost, credit: 0, description: 'تكلفة الأصل' },
    { account_code: payCode, debit: 0, credit: a.cost, description: 'سداد ثمن الأصل' },
  ];
  return {
    id: `je-asset-${a.id}`,
    entry_no: 9000 + seq,
    entry_date: a.acquisition_date,
    branch: a.branch,
    description: `شراء أصل ثابت: ${a.name}`,
    reference: `ASSET-${a.id}`,
    source_type: 'manual',
    status: 'posted',
    lines,
  };
}

/** Period depreciation entry across active assets: DR 5900 / CR 1290. */
export function buildDepreciationEntry(assets: FixedAsset[], period: string): JournalEntry {
  const total = round2(assets.reduce((s, a) => s + periodDepreciation(a), 0));
  const endOfMonth = new Date(new Date(`${period}-01`).getFullYear(), Number(period.slice(5, 7)), 0)
    .toISOString()
    .slice(0, 10);
  return {
    id: `je-dep-${period}`,
    entry_no: 9500 + (Number(period.slice(5, 7)) || 0),
    entry_date: endOfMonth,
    branch: null,
    description: `إهلاك الأصول الثابتة ${period}`,
    reference: `DEP-${period}`,
    source_type: 'manual',
    status: 'posted',
    lines: [
      { account_code: '5900', debit: total, credit: 0, description: 'مصروف الإهلاك' },
      { account_code: '1290', debit: 0, credit: total, description: 'مجمع الإهلاك' },
    ],
  };
}
