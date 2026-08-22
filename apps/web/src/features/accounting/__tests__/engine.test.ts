import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertBalanced,
  buildManualEntry,
  cashAccountFor,
  financialSnapshot,
  NonPostableAccountError,
  postContract,
  postPayment,
  resetEntryCounter,
  revenueAccountFor,
  trialBalance,
  UnbalancedEntryError,
} from '@/features/accounting/data/engine';
import type { ContractEvent, JournalEntry, PaymentEvent } from '@/features/accounting/types';

const contract: ContractEvent = {
  id: 'c-1',
  contract_no: 1,
  customer_name: 'محمد الأحمدي',
  branch: 'نجران',
  service: 'direct',
  base: 10000,
  start_date: '2026-04-03',
};

beforeEach(() => resetEntryCounter());

describe('double-entry balance enforcement', () => {
  it('rejects an unbalanced entry', () => {
    expect(() =>
      buildManualEntry({
        entry_date: '2026-04-01',
        branch: 'نجران',
        description: 'غير متوازن',
        lines: [
          { account_code: '1111', debit: 500, credit: 0 },
          { account_code: '4500', debit: 0, credit: 300 },
        ],
      }),
    ).toThrow(UnbalancedEntryError);
  });

  it('rejects posting to a non-postable (header) account', () => {
    expect(() =>
      buildManualEntry({
        entry_date: '2026-04-01',
        branch: 'نجران',
        description: 'حساب رئيسي',
        lines: [
          { account_code: '1000', debit: 100, credit: 0 },
          { account_code: '4500', debit: 0, credit: 100 },
        ],
      }),
    ).toThrow(NonPostableAccountError);
  });

  it('accepts a balanced entry', () => {
    expect(() =>
      assertBalanced([
        { account_code: '1111', debit: 100, credit: 0 },
        { account_code: '4500', debit: 0, credit: 100 },
      ]),
    ).not.toThrow();
  });
});

describe('auto-posting: contract signed', () => {
  it('books AR (total) against pre-VAT revenue + VAT liability, balanced', () => {
    const e = postContract(contract);
    const ar = e.lines.find((l) => l.account_code === '1120');
    const rev = e.lines.find((l) => l.account_code === '4100');
    const vat = e.lines.find((l) => l.account_code === '2120');
    expect(ar?.debit).toBe(11500); // 10000 + 15%
    expect(rev?.credit).toBe(10000); // revenue is PRE-VAT
    expect(vat?.credit).toBe(1500); // VAT is a liability, not revenue
    const debit = e.lines.reduce((s, l) => s + l.debit, 0);
    const credit = e.lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
  });

  it('maps each service to its revenue account', () => {
    expect(revenueAccountFor('direct')).toBe('4100');
    expect(revenueAccountFor('kafala')).toBe('4400');
    expect(revenueAccountFor('monthly')).toBe('4200');
    expect(revenueAccountFor('daily')).toBe('4300');
    expect(revenueAccountFor('cleaning')).toBe('4300');
  });
});

describe('auto-posting: payment received', () => {
  const payment: PaymentEvent = {
    id: 'p-1',
    contract_id: 'c-1',
    amount: 11500,
    method: 'mada',
    reference_no: 'PMT-1',
    paid_at: '2026-04-05',
  };

  it('debits the gateway/cash account and clears AR, balanced', () => {
    const e = postPayment(payment, 'نجران');
    expect(e.lines.find((l) => l.account_code === '1131')?.debit).toBe(11500); // mada → مُيسّر
    expect(e.lines.find((l) => l.account_code === '1120')?.credit).toBe(11500);
  });

  it('routes payment methods to the right cash account', () => {
    expect(cashAccountFor('cash')).toBe('1111');
    expect(cashAccountFor('transfer')).toBe('1112');
    expect(cashAccountFor('tamara')).toBe('1132');
    expect(cashAccountFor('apple_pay')).toBe('1131');
  });
});

describe('reporting from the journal', () => {
  function fullCycle(): JournalEntry[] {
    resetEntryCounter();
    return [
      postContract(contract),
      postPayment(
        {
          id: 'p-1',
          contract_id: 'c-1',
          amount: 11500,
          method: 'mada',
          reference_no: 'r',
          paid_at: '2026-04-05',
        },
        'نجران',
      ),
    ];
  }

  it('trial balance balances (Σ debit = Σ credit)', () => {
    const rows = trialBalance(fullCycle());
    const debit = rows.reduce((s, r) => s + r.debit, 0);
    const credit = rows.reduce((s, r) => s + r.credit, 0);
    expect(debit).toBe(credit);
  });

  it('snapshot keeps revenue pre-VAT and VAT as a separate payable; AR clears after payment', () => {
    const snap = financialSnapshot(fullCycle());
    expect(snap.revenue).toBe(10000); // pre-VAT
    expect(snap.vatPayable).toBe(1500); // separate liability
    expect(snap.receivables).toBe(0); // fully collected
    expect(snap.balanced).toBe(true);
  });
});
