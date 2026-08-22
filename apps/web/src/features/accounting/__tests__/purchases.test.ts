import { describe, expect, it } from 'vitest';
import { postCashExpense, postDebitNote, postVoucher } from '@/features/accounting/data/purchases';
import { assertBalanced } from '@/features/accounting/data/engine';
import type { CashExpense, DebitNote, PaymentVoucher } from '@/features/accounting/types';

describe('purchase document postings (Phase 4)', () => {
  it('vendor voucher: DR payables (2110) / CR bank — balanced', () => {
    const v: PaymentVoucher = {
      id: 'pv1',
      voucher_no: 1,
      bill_id: 'b1',
      vendor_name: 'مورّد',
      amount: 2000,
      pay_account_code: '1112',
      branch: 'نجران',
      voucher_date: '2026-05-10',
    };
    const e = postVoucher(v);
    expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(e.lines.find((l) => l.account_code === '2110')?.debit).toBe(2000);
    expect(e.lines.find((l) => l.account_code === '1112')?.credit).toBe(2000);
  });

  it('cash expense: DR expense + input VAT / CR cash — balanced', () => {
    const e: CashExpense = {
      id: 'ce1',
      expense_no: 1,
      description: 'قرطاسية',
      expense_code: '5400',
      subtotal: 200,
      vat_amount: 30,
      total: 230,
      pay_account_code: '1111',
      branch: 'نجران',
      expense_date: '2026-05-12',
    };
    const j = postCashExpense(e);
    expect(() => assertBalanced(j.lines)).not.toThrow();
    expect(j.lines.find((l) => l.account_code === '5400')?.debit).toBe(200);
    expect(j.lines.find((l) => l.account_code === '1140')?.debit).toBe(30);
    expect(j.lines.find((l) => l.account_code === '1111')?.credit).toBe(230);
  });

  it('debit note: DR payables / CR expense + reverse input VAT — balanced', () => {
    const n: DebitNote = {
      id: 'dn1',
      note_no: 1,
      bill_id: 'b1',
      vendor_name: 'مورّد',
      expense_code: '5300',
      subtotal: 1000,
      vat_amount: 150,
      total: 1150,
      reason: 'مرتجع',
      branch: 'نجران',
      note_date: '2026-05-13',
    };
    const j = postDebitNote(n);
    expect(() => assertBalanced(j.lines)).not.toThrow();
    expect(j.lines.find((l) => l.account_code === '2110')?.debit).toBe(1150);
    expect(j.lines.find((l) => l.account_code === '5300')?.credit).toBe(1000);
    expect(j.lines.find((l) => l.account_code === '1140')?.credit).toBe(150);
  });

  it('cash expense without VAT omits the input-VAT line', () => {
    const e: CashExpense = {
      id: 'ce2',
      expense_no: 2,
      description: 'رسوم حكومية',
      expense_code: '5400',
      subtotal: 500,
      vat_amount: 0,
      total: 500,
      pay_account_code: '1111',
      branch: null,
      expense_date: '2026-05-14',
    };
    const j = postCashExpense(e);
    expect(j.lines).toHaveLength(2);
    expect(j.lines.some((l) => l.account_code === '1140')).toBe(false);
  });
});
