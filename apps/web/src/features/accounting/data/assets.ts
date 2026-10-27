import type { FixedAsset, JournalEntry, JournalLine } from '@/features/accounting/types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Monthly depreciation: straight-line (default) or double-declining balance on NBV. */
export function monthlyDepreciation(a: FixedAsset): number {
  if (a.method === 'declining_balance') {
    const rate = 2 / a.useful_life_years / 12;
    return round2(Math.max(a.cost - a.accumulated_dep, 0) * rate);
  }
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

/** Year-by-year schedule (projection) until the asset reaches its salvage value. */
export function depreciationSchedule(
  a: FixedAsset,
): { year: number; depreciation: number; accumulated: number; nbv: number }[] {
  const rows: { year: number; depreciation: number; accumulated: number; nbv: number }[] = [];
  let sim: FixedAsset = { ...a, accumulated_dep: 0, status: 'active' };
  const start = Number(a.acquisition_date.slice(0, 4));
  for (let y = 0; y < a.useful_life_years + 1 && remainingDepreciable(sim) > 0; y++) {
    let dep = 0;
    for (let m = 0; m < 12; m++) {
      const d = periodDepreciation(sim);
      dep = round2(dep + d);
      sim = { ...sim, accumulated_dep: round2(sim.accumulated_dep + d) };
    }
    rows.push({
      year: start + y,
      depreciation: dep,
      accumulated: sim.accumulated_dep,
      nbv: netBookValue(sim),
    });
  }
  return rows;
}

/**
 * Disposal / sale: DR proceeds (bank) + DR مجمع الإهلاك / CR asset cost, with the
 * difference to أرباح (4600) or خسائر (5960) استبعاد الأصول.
 */
export function buildDisposalEntry(
  a: FixedAsset,
  input: { date: string; proceeds: number; pay_code: string },
  seq: number,
): JournalEntry {
  if (a.status !== 'active') throw new Error('الأصل مستبعد بالفعل');
  const nbv = netBookValue(a);
  const gain = round2(input.proceeds - nbv);
  const lines: JournalLine[] = [
    ...(input.proceeds > 0
      ? [
          {
            account_code: input.pay_code,
            debit: input.proceeds,
            credit: 0,
            description: 'متحصلات البيع',
          },
        ]
      : []),
    ...(a.accumulated_dep > 0
      ? [
          {
            account_code: '1290',
            debit: a.accumulated_dep,
            credit: 0,
            description: 'إقفال مجمع الإهلاك',
          },
        ]
      : []),
    { account_code: a.asset_code, debit: 0, credit: a.cost, description: 'استبعاد تكلفة الأصل' },
    ...(gain > 0
      ? [{ account_code: '4600', debit: 0, credit: gain, description: 'ربح الاستبعاد' }]
      : gain < 0
        ? [{ account_code: '5960', debit: -gain, credit: 0, description: 'خسارة الاستبعاد' }]
        : []),
  ];
  return {
    id: `je-disp-${a.id}`,
    entry_no: 9700 + seq,
    entry_date: input.date,
    branch: a.branch,
    description: `${input.proceeds > 0 ? 'بيع' : 'استبعاد'} أصل ثابت: ${a.name}`,
    reference: `DISP-${a.id}`,
    source_type: 'adjustment',
    status: 'posted',
    kind: 'auto',
    lines,
  };
}

/** Branch transfer: moves cost and accumulated depreciation between cost centers. */
export function buildTransferEntry(
  a: FixedAsset,
  toBranch: string | null,
  date: string,
  seq: number,
): JournalEntry {
  if (a.status !== 'active') throw new Error('لا يُنقل أصل مستبعد');
  if (toBranch === a.branch) throw new Error('الأصل في هذا الفرع بالفعل');
  const lines: JournalLine[] = [
    {
      account_code: a.asset_code,
      debit: a.cost,
      credit: 0,
      branch: toBranch,
      description: 'استلام الأصل',
    },
    {
      account_code: a.asset_code,
      debit: 0,
      credit: a.cost,
      branch: a.branch,
      description: 'تسليم الأصل',
    },
    ...(a.accumulated_dep > 0
      ? [
          {
            account_code: '1290',
            debit: a.accumulated_dep,
            credit: 0,
            branch: a.branch,
            description: 'نقل مجمع الإهلاك',
          },
          {
            account_code: '1290',
            debit: 0,
            credit: a.accumulated_dep,
            branch: toBranch,
            description: 'نقل مجمع الإهلاك',
          },
        ]
      : []),
  ];
  return {
    id: `je-xfer-${a.id}-${seq}`,
    entry_no: 9800 + seq,
    entry_date: date,
    branch: null,
    description: `نقل أصل «${a.name}» إلى ${toBranch ?? 'المركز الرئيسي'}`,
    reference: `AXFER-${a.id}`,
    source_type: 'adjustment',
    status: 'posted',
    kind: 'auto',
    lines,
  };
}
