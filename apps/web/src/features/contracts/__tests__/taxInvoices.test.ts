import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  createDraft,
  demoMutateContract,
  getContract,
} from '@/features/contracts/api/contracts.api';
import {
  invoiceNet,
  issueContractInvoice,
  issueContractNote,
  listTaxDocuments,
  resetContractInvoicesDemo,
} from '@/features/contracts/api/contractInvoices.api';
import { decodeQr } from '@/features/accounting/data/zatca';
import { contractKpis } from '@/features/contracts/lib/contractInsights';

beforeEach(() => {
  resetContractInvoicesDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

async function draft() {
  return createDraft({
    service_code: 'monthly_rental',
    customer_id: 'cust-1',
    customer_name: 'محمد الأحمدي',
    branch: 'نجران',
    start_date: '2027-02-01',
    end_date: '2027-04-30',
    quantity: 3,
    nationality: 'كينيا',
  });
}

describe('contract tax invoice (0097 mirror)', () => {
  it('is not issued before signing; one invoice with a ZATCA QR after it', async () => {
    const c = await draft();
    expect(await listTaxDocuments(c.id)).toHaveLength(0);
    await expect(issueContractInvoice(c.id)).rejects.toThrow('بعد توقيع');
    demoMutateContract(c.id, { status: 'signed' });
    const docs = await listTaxDocuments(c.id);
    expect(docs).toHaveLength(1);
    const [inv] = docs;
    expect(inv?.kind).toBe('invoice');
    expect(inv?.total).toBe(c.total_amount);
    const qr = decodeQr(inv!.zatca_qr!);
    expect(qr[2]).toMatch(/^3\d{13}3$/);
    expect(qr[4]).toBe(c.total_amount.toFixed(2));
    // idempotent
    await issueContractInvoice(c.id);
    expect(await listTaxDocuments(c.id)).toHaveLength(1);
  });

  it('follows the paid amount and corrects only by credit/debit notes', async () => {
    const c = await draft();
    demoMutateContract(c.id, { status: 'active', amount_paid: 100 });
    expect((await listTaxDocuments(c.id))[0]?.status).toBe('partial');
    await expect(
      issueContractNote(c.id, {
        kind: 'credit',
        total: c.total_amount + 1,
        reason: 'خصم استثنائي',
      }),
    ).rejects.toThrow('يتجاوز');
    await expect(
      issueContractNote(c.id, { kind: 'credit', total: 10, reason: 'x' }),
    ).rejects.toThrow();
    await issueContractNote(c.id, { kind: 'credit', total: 115, reason: 'تعويض يوم غياب' });
    await issueContractNote(c.id, { kind: 'debit', total: 230, reason: 'رسوم نقل إضافية' });
    const docs = await listTaxDocuments(c.id);
    const cn = docs.find((d) => d.kind === 'credit_note');
    expect(cn?.subtotal).toBe(100);
    expect(cn?.vat_amount).toBe(15);
    expect(invoiceNet(docs)).toBe(Math.round((c.total_amount - 115 + 230) * 100) / 100);
    expect((await getContract(c.id))?.total_amount).toBe(c.total_amount); // the contract is untouched
  });
});

describe('contracts list KPIs', () => {
  it('counts total and cancelled alongside the existing indicators', async () => {
    const a = await draft();
    const b = await draft();
    demoMutateContract(b.id, { status: 'cancelled' });
    const rows = [(await getContract(a.id))!, (await getContract(b.id))!];
    const k = contractKpis(rows, new Date('2027-03-01'), 30);
    expect(k.total).toBe(2);
    expect(k.cancelled).toBe(1);
  });
});
