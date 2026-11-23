import { afterEach, describe, expect, it } from 'vitest';
import type { AppRole } from '@masiat/shared';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { demoMutateContract, listContracts } from '@/features/contracts/api/contracts.api';
import {
  addSaleNote,
  applySalesFilters,
  contractIsSold,
  listSaleNotes,
  listSales,
  salesTotals,
} from '@/features/sales/api/sales.api';
import { EMPTY_SALES_FILTERS, type Sale } from '@/features/sales/types';
import { listDemoAudit } from '@/shared/lib/auditTrail';

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(role);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

describe('sales pulled from contracts', () => {
  it('lists exactly one sale per sold contract — nothing entered by hand', async () => {
    signIn('admin');
    const contracts = await listContracts(ALL);
    const sales = await listSales();
    const sold = contracts.filter((c) => contractIsSold(c.status));
    expect(sales.filter((s) => s.status !== 'cancelled')).toHaveLength(sold.length);
    expect(new Set(sales.map((s) => s.contract_id)).size).toBe(sales.length);
    for (const s of sales) {
      const c = contracts.find((x) => x.id === s.contract_id);
      expect(s.net_amount).toBe(c?.base_amount);
      expect(s.total_amount).toBe(c?.total_amount);
    }
  });

  it('a newly signed contract appears as a sale on the next read, and only once', async () => {
    signIn('admin');
    const draft = (await listContracts(ALL)).find(
      (c) => !contractIsSold(c.status) && c.status !== 'cancelled',
    );
    if (!draft) throw new Error('no unsold contract in the demo store');
    const before = (await listSales()).length;
    demoMutateContract(draft.id, { status: 'signed', signed_at: new Date().toISOString() });
    demoMutateContract(draft.id, { status: 'active' });
    const after = await listSales();
    expect(after).toHaveLength(before + 1);
    expect(after.filter((s) => s.contract_id === draft.id)).toHaveLength(1);
  });

  it('totals ignore cancelled sales; filters by branch, employee, service and period', () => {
    const base: Omit<
      Sale,
      'id' | 'contract_id' | 'branch' | 'service_code' | 'status' | 'sold_by_name' | 'sold_at'
    > = {
      sale_no: 1,
      contract_no: null,
      quote_id: null,
      customer_id: null,
      customer_name: 'عميل',
      worker_name: null,
      gross_amount: 1000,
      discount_amount: 100,
      net_amount: 900,
      vat_amount: 135,
      total_amount: 1035,
      collected: 500,
      coupon_code: null,
      is_renewal: false,
    };
    const rows: Sale[] = [
      {
        ...base,
        id: 'a',
        contract_id: 'a',
        branch: 'نجران',
        service_code: 'recruitment',
        status: 'confirmed',
        sold_by_name: 'نايف اليامي',
        sold_at: '2026-10-05T09:00:00Z',
      },
      {
        ...base,
        id: 'b',
        contract_id: 'b',
        branch: 'جازان',
        service_code: 'monthly_rental',
        status: 'completed',
        sold_by_name: 'ريم الشهري',
        sold_at: '2026-10-20T09:00:00Z',
      },
      {
        ...base,
        id: 'c',
        contract_id: 'c',
        branch: 'نجران',
        service_code: 'recruitment',
        status: 'cancelled',
        sold_by_name: 'نايف اليامي',
        sold_at: '2026-10-21T09:00:00Z',
      },
    ];
    const t = salesTotals(rows);
    expect(t).toMatchObject({
      count: 2,
      gross: 2000,
      discounts: 200,
      net: 1800,
      total: 2070,
      collected: 1000,
      cancelled: 1,
    });
    expect(applySalesFilters(rows, { ...EMPTY_SALES_FILTERS, branch: 'نجران' })).toHaveLength(2);
    expect(
      applySalesFilters(rows, { ...EMPTY_SALES_FILTERS, employee: 'ريم الشهري' }),
    ).toHaveLength(1);
    expect(
      applySalesFilters(rows, { ...EMPTY_SALES_FILTERS, service: 'monthly_rental' }),
    ).toHaveLength(1);
    expect(
      applySalesFilters(rows, { ...EMPTY_SALES_FILTERS, from: '2026-10-10', to: '2026-10-20' }),
    ).toHaveLength(1);
    // البحث برقم العملية كما يُعرض (SL-n) وبحروف صغيرة
    const no = rows[0]!.sale_no;
    const hit = applySalesFilters(rows, { ...EMPTY_SALES_FILTERS, search: `SL-${no}` });
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((r) => r.sale_no === no)).toBe(true);
    expect(applySalesFilters(rows, { ...EMPTY_SALES_FILTERS, search: `sl-${no}` })).toEqual(hit);
    expect(applySalesFilters(rows, { ...EMPTY_SALES_FILTERS, search: 'SL-99999' })).toHaveLength(0);
  });

  it('a branch manager sees their branch only; a sales rep their own sales only', async () => {
    const bm = signIn('branch_manager');
    const bmSales = await listSales();
    expect(bmSales.length).toBeGreaterThan(0);
    expect(bmSales.every((s) => s.branch === bm.branch)).toBe(true);

    const rep = signIn('sales');
    const repSales = await listSales();
    expect(repSales.every((s) => s.sold_by_name === rep.name)).toBe(true);
  });

  it('notes are added per sale and audited', async () => {
    signIn('admin');
    const [sale] = await listSales();
    if (!sale) throw new Error('no sale');
    await addSaleNote(sale, 'العميل طلب فاتورة باسم المؤسسة');
    const notes = await listSaleNotes(sale.id);
    expect(notes.at(-1)?.note).toBe('العميل طلب فاتورة باسم المؤسسة');
    expect(notes.at(-1)?.created_by_name).toBe('منصور المكرمي');
    expect(listDemoAudit()[0]?.entity).toBe('sale_notes');
    await expect(addSaleNote(sale, ' ')).rejects.toThrow();
  });
});
