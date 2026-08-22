import { describe, expect, it } from 'vitest';
import {
  addAccount,
  listChart,
  listJournal,
  listPeriods,
  setPeriodStatus,
  toggleAccountActive,
  updateAccount,
} from '@/features/accounting/api/accounting.api';

describe('chart of accounts CRUD (editable)', () => {
  it('adds a validated account and lists it', async () => {
    const acc = addAccount({
      code: '5950',
      name_ar: 'مصروف صيانة',
      type: 'expense',
      parent_code: '5000',
      normal_balance: 'debit',
    });
    expect(acc.is_active).toBe(true);
    const chart = await listChart();
    expect(chart.some((a) => a.code === '5950')).toBe(true);
  });

  it('rejects an invalid code and a duplicate', () => {
    expect(() =>
      addAccount({
        code: 'abc',
        name_ar: 'x',
        type: 'expense',
        parent_code: null,
        normal_balance: 'debit',
      }),
    ).toThrow();
    expect(() =>
      addAccount({
        code: '1111',
        name_ar: 'مكرر',
        type: 'asset',
        parent_code: '1110',
        normal_balance: 'debit',
      }),
    ).toThrow('الرمز مستخدم');
  });

  it('edits a name and disables (soft delete) an account', async () => {
    updateAccount('5950', { name_ar: 'مصروف صيانة وإصلاح' });
    toggleAccountActive('5950', false);
    const chart = await listChart();
    const a = chart.find((x) => x.code === '5950');
    expect(a?.name_ar).toBe('مصروف صيانة وإصلاح');
    expect(a?.is_active).toBe(false);
  });
});

describe('accounting periods (editable open/close)', () => {
  it('seeds 12 periods for 2026, all open', async () => {
    const periods = await listPeriods();
    expect(periods).toHaveLength(12);
    expect(periods.every((p) => p.status === 'open')).toBe(true);
  });

  it('closes and reopens a period', () => {
    expect(setPeriodStatus('2026-03', 'closed').status).toBe('closed');
    expect(setPeriodStatus('2026-03', 'open').status).toBe('open');
  });
});

describe('opening balances per cost center', () => {
  it('posts one balanced opening entry per branch', async () => {
    const journal = await listJournal();
    const openings = journal.filter((e) => e.description.startsWith('رصيد افتتاحي'));
    expect(openings).toHaveLength(4); // نجران/جازان/شرورة/حبونا
    for (const e of openings) {
      const debit = e.lines.reduce((s, l) => s + l.debit, 0);
      const credit = e.lines.reduce((s, l) => s + l.credit, 0);
      expect(debit).toBe(credit);
    }
  });

  it('whole demo ledger balances (Σ debit = Σ credit)', async () => {
    const journal = await listJournal();
    const debit = journal.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit, 0), 0);
    const credit = journal.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.credit, 0), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
  });
});
