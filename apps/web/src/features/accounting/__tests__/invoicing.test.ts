import { describe, expect, it } from 'vitest';
import {
  aging,
  buildInvoiceForContract,
  lineFrom,
  postBill,
  postSalesInvoice,
} from '@/features/accounting/data/invoicing';
import { assertBalanced } from '@/features/accounting/data/engine';
import type { Bill, ContractEvent, Invoice } from '@/features/accounting/types';

const contract: ContractEvent = {
  id: 'c-1',
  contract_no: 7,
  customer_name: 'محمد الأحمدي',
  branch: 'نجران',
  service: 'direct',
  base: 10000,
  start_date: '2026-04-03',
};

describe('invoice from contract', () => {
  it('separates VAT from the pre-VAT subtotal', () => {
    const inv = buildInvoiceForContract(contract, { amount_paid: 0 });
    expect(inv.subtotal).toBe(10000);
    expect(inv.vat_amount).toBe(1500);
    expect(inv.total).toBe(11500);
    expect(inv.status).toBe('issued'); // unpaid
  });

  it('flags large invoices as standard (B2B) and marks paid when collected', () => {
    const big = buildInvoiceForContract({ ...contract, base: 16000 }, { amount_paid: 18400 });
    expect(big.type).toBe('standard');
    expect(big.status).toBe('paid');
  });
});

describe('AP bill posting', () => {
  it('books expense + input VAT against payables, balanced', () => {
    const bill: Bill = {
      id: 'b1',
      bill_no: 1,
      vendor_name: 'وكالة تسويق',
      vendor_type: 'supplier',
      branch: 'نجران',
      issue_date: '2026-03-20',
      due_date: '2026-04-19',
      subtotal: 5000,
      vat_amount: 750,
      total: 5750,
      amount_paid: 0,
      expense_code: '5300',
      status: 'open',
    };
    const e = postBill(bill);
    expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(e.lines.find((l) => l.account_code === '5300')?.debit).toBe(5000);
    expect(e.lines.find((l) => l.account_code === '1140')?.debit).toBe(750);
    expect(e.lines.find((l) => l.account_code === '2110')?.credit).toBe(5750);
  });

  it('omits the input-VAT line for a zero-VAT bill (no 0/0 line)', () => {
    const bill: Bill = {
      id: 'b2',
      bill_no: 2,
      vendor_name: 'التأمينات الاجتماعية',
      vendor_type: 'gosi',
      branch: null,
      issue_date: '2026-05-01',
      due_date: '2026-05-15',
      subtotal: 3200,
      vat_amount: 0,
      total: 3200,
      amount_paid: 0,
      expense_code: '5200',
      status: 'open',
    };
    const e = postBill(bill);
    expect(e.lines).toHaveLength(2);
    expect(e.lines.some((l) => l.account_code === '1140')).toBe(false);
    expect(() => assertBalanced(e.lines)).not.toThrow();
  });
});

describe('ad-hoc sales invoice (Phase 3)', () => {
  it('computes a VAT-separated line', () => {
    const l = lineFrom('خدمة استقدام', 2, 5000);
    expect(l.line_subtotal).toBe(10000);
    expect(l.line_vat).toBe(1500);
    expect(l.line_total).toBe(11500);
  });

  it('posts DR AR / CR revenue (pre-VAT) + CR output VAT, balanced', () => {
    const inv: Invoice = {
      id: 'sinv-1',
      invoice_no: 1001,
      type: 'simplified',
      contract_no: null,
      customer_name: 'عميل نقدي',
      branch: 'نجران',
      issue_date: '2026-06-01',
      due_date: '2026-07-01',
      subtotal: 4000,
      vat_amount: 600,
      total: 4600,
      amount_paid: 0,
      status: 'issued',
      lines: [lineFrom('بند', 1, 4000)],
      manual: true,
      revenue_code: '4500',
    };
    const e = postSalesInvoice(inv, '4500');
    expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(e.lines.find((l) => l.account_code === '1120')?.debit).toBe(4600);
    expect(e.lines.find((l) => l.account_code === '4500')?.credit).toBe(4000);
    expect(e.lines.find((l) => l.account_code === '2120')?.credit).toBe(600);
  });
});

describe('AR/AP aging buckets', () => {
  it('buckets outstanding amounts by days past due', () => {
    const asOf = new Date('2026-06-16');
    const report = aging(
      [
        { due_date: '2026-07-01', outstanding: 100 }, // future → current
        { due_date: '2026-06-01', outstanding: 200 }, // 15 days → 1-30
        { due_date: '2026-05-01', outstanding: 300 }, // 46 days → 31-60
        { due_date: '2026-02-01', outstanding: 400 }, // >90
        { due_date: '2026-06-10', outstanding: 0 }, // ignored
      ],
      asOf,
    );
    expect(report.current).toBe(100);
    expect(report.d1_30).toBe(200);
    expect(report.d31_60).toBe(300);
    expect(report.d90_plus).toBe(400);
    expect(report.total).toBe(1000);
  });
});
