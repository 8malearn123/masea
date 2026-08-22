import { describe, expect, it } from 'vitest';
import {
  addCustomerSale,
  listCustomerSales,
  settleCustomerSale,
  voidCustomerSale,
} from '@/shared/lib/salesLedger';

describe('shared customer-sales ledger', () => {
  it('seeds the contract invoices', () => {
    const seeded = listCustomerSales();
    expect(seeded.length).toBeGreaterThanOrEqual(6);
    expect(seeded.every((s) => s.source === 'contract')).toBe(true);
  });

  it('raises a manual invoice with 15% VAT that reflects in the ledger', () => {
    const before = listCustomerSales().length;
    const sale = addCustomerSale({
      customer_name: 'عميل تجريبي',
      branch: 'نجران',
      type: 'simplified',
      issue_date: '2026-06-10',
      revenue_code: '4100',
      lines: [{ description: 'خدمة', qty: 2, unit_price: 1000 }],
    });
    expect(sale.subtotal).toBe(2000);
    expect(sale.vat).toBe(300);
    expect(sale.total).toBe(2300);
    expect(sale.source).toBe('manual');
    expect(listCustomerSales().length).toBe(before + 1);
  });

  it('settles a collection and voids', () => {
    const s = addCustomerSale({
      customer_name: 'عميل ٢',
      branch: null,
      type: 'simplified',
      issue_date: '2026-06-11',
      revenue_code: '4100',
      lines: [{ description: 'خدمة', qty: 1, unit_price: 1000 }],
    });
    settleCustomerSale(s.id, 575); // half of 1150
    expect(listCustomerSales().find((x) => x.id === s.id)?.status).toBe('partial');
    settleCustomerSale(s.id, 575);
    expect(listCustomerSales().find((x) => x.id === s.id)?.status).toBe('paid');
    voidCustomerSale(s.id);
    expect(listCustomerSales().find((x) => x.id === s.id)?.status).toBe('void');
  });
});
