import { describe, expect, it } from 'vitest';
import { computeVatReturn } from '@/features/accounting/data/vat';
import type { JournalEntry } from '@/features/accounting/types';

const entries: JournalEntry[] = [
  {
    id: 'e1',
    entry_no: 1,
    entry_date: '2026-06-05',
    branch: 'نجران',
    description: 'بيع',
    reference: 'S1',
    source_type: 'manual',
    status: 'posted',
    lines: [
      { account_code: '1120', debit: 11500, credit: 0 },
      { account_code: '4100', debit: 0, credit: 10000 },
      { account_code: '2120', debit: 0, credit: 1500 },
    ],
  },
  {
    id: 'e2',
    entry_no: 2,
    entry_date: '2026-06-10',
    branch: 'نجران',
    description: 'شراء',
    reference: 'B1',
    source_type: 'manual',
    status: 'posted',
    lines: [
      { account_code: '5400', debit: 5000, credit: 0 },
      { account_code: '1140', debit: 750, credit: 0 },
      { account_code: '2110', debit: 0, credit: 5750 },
    ],
  },
  {
    id: 'e3',
    entry_no: 3,
    entry_date: '2026-05-01',
    branch: 'نجران',
    description: 'فترة أخرى',
    reference: 'X',
    source_type: 'manual',
    status: 'posted',
    lines: [
      { account_code: '1120', debit: 2300, credit: 0 },
      { account_code: '4100', debit: 0, credit: 2000 },
      { account_code: '2120', debit: 0, credit: 300 },
    ],
  },
];

describe('VAT return computation', () => {
  it('nets output − input for the selected period only', () => {
    const r = computeVatReturn(entries, '2026-06', 0.15);
    expect(r.output_vat).toBe(1500);
    expect(r.input_vat).toBe(750);
    expect(r.net_vat).toBe(750);
    expect(r.sales_base).toBe(10000); // output / rate
    expect(r.purchases_base).toBe(5000);
  });

  it('isolates a different period', () => {
    const r = computeVatReturn(entries, '2026-05', 0.15);
    expect(r.output_vat).toBe(300);
    expect(r.input_vat).toBe(0);
    expect(r.net_vat).toBe(300);
  });

  it('returns zeros for an empty period', () => {
    expect(computeVatReturn(entries, '2026-01', 0.15).net_vat).toBe(0);
  });
});
