import { describe, expect, it } from 'vitest';
import {
  balanceSheet,
  buildClosingEntry,
  cashFlow,
  incomeStatement,
} from '@/features/accounting/data/reports';
import { assertBalanced } from '@/features/accounting/data/engine';
import type { JournalEntry } from '@/features/accounting/types';

// Capital injection + a sale + an expense paid in cash (all balanced, 2026-06).
const entries: JournalEntry[] = [
  {
    id: 'open',
    entry_no: 1,
    entry_date: '2026-06-01',
    branch: 'نجران',
    description: 'رأس المال',
    reference: 'OPEN',
    source_type: 'manual',
    status: 'posted',
    lines: [
      { account_code: '1112', debit: 50000, credit: 0 },
      { account_code: '3100', debit: 0, credit: 50000 },
    ],
  },
  {
    id: 'sale',
    entry_no: 2,
    entry_date: '2026-06-05',
    branch: 'نجران',
    description: 'بيع نقدي',
    reference: 'S',
    source_type: 'manual',
    status: 'posted',
    lines: [
      { account_code: '1111', debit: 11500, credit: 0 },
      { account_code: '4100', debit: 0, credit: 10000 },
      { account_code: '2120', debit: 0, credit: 1500 },
    ],
  },
  {
    id: 'exp',
    entry_no: 3,
    entry_date: '2026-06-10',
    branch: 'نجران',
    description: 'إيجار',
    reference: 'E',
    source_type: 'manual',
    status: 'posted',
    lines: [
      { account_code: '5700', debit: 4000, credit: 0 },
      { account_code: '1111', debit: 0, credit: 4000 },
    ],
  },
];

describe('financial reports', () => {
  it('income statement: revenue − expenses = net profit', () => {
    const is = incomeStatement(entries, { period: '2026-06' });
    expect(is.totalRevenue).toBe(10000);
    expect(is.totalExpenses).toBe(4000);
    expect(is.netProfit).toBe(6000);
  });

  it('balance sheet balances (A = L + E incl. net profit)', () => {
    const bs = balanceSheet(entries);
    // assets: bank 50000 + cash (11500−4000=7500) = 57500
    expect(bs.totalAssets).toBe(57500);
    // liabilities: output VAT 1500 ; equity: capital 50000 + net profit 6000 = 56000
    expect(bs.totalLiabilities).toBe(1500);
    expect(bs.totalEquity).toBe(56000);
    expect(bs.balanced).toBe(true);
  });

  it('cash flow nets cash inflow vs outflow', () => {
    const cf = cashFlow(entries, { period: '2026-06' });
    // inflow: 50000 (bank) + 11500 (cash) ; outflow: 4000
    expect(cf.inflow).toBe(61500);
    expect(cf.outflow).toBe(4000);
    expect(cf.net).toBe(57500);
  });

  it('closing entry zeros P&L into retained earnings and is balanced', () => {
    const e = buildClosingEntry(entries, '2026-06');
    expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(e.lines.find((l) => l.account_code === '4100')?.debit).toBe(10000); // close revenue
    expect(e.lines.find((l) => l.account_code === '5700')?.credit).toBe(4000); // close expense
    expect(e.lines.find((l) => l.account_code === '3200')?.credit).toBe(6000); // net profit → retained
  });
});
