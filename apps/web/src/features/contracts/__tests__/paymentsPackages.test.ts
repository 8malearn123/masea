import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  createDraft,
  getContract,
  transitionContract,
} from '@/features/contracts/api/contracts.api';
import {
  allocateInstallments,
  buildSchedule,
  listContractPayments,
  listInstallments,
  listReceivingAccounts,
  recordContractPayment,
  resetContractPaymentsDemo,
  setInstallments,
  setPaymentStatus,
} from '@/features/contracts/api/contractPayments.api';
import { listPricingRules } from '@/features/pricing/api/pricing.api';
import { managedBase, packagesFor, resolveRule } from '@/features/pricing/lib/engine';
import { ruleFloor } from '@/shared/lib/pricing';
import { bankAccountSchema } from '@/features/accounting/api/accounting.api';

beforeEach(() => {
  resetContractPaymentsDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('packages = named pricing rules (0096 mirror)', () => {
  it('never leak into the generic price, and price as unit × fixed duration', async () => {
    const rules = await listPricingRules();
    const args = { nationality: 'الفلبين', quantity: 3 };
    expect(resolveRule(rules, 'monthly_rental', args)?.package_name ?? null).toBeNull();
    expect(managedBase(rules, 'monthly_rental', args)).toBe(2500 * 3);
    const [six, year] = packagesFor(rules, 'monthly_rental', { nationality: 'الفلبين' });
    expect(six?.duration_count).toBe(6);
    expect(year?.duration_count).toBe(12);
    // quantity entered is ignored — the package fixes the duration
    expect(managedBase(rules, 'monthly_rental', { ...args, package_id: six!.id })).toBe(2350 * 6);
    expect(ruleFloor(rules, 'monthly_rental', { ...args, package_id: six!.id })).toBe(2200 * 6);
    expect(packagesFor(rules, 'monthly_rental', { nationality: 'كينيا' })).toHaveLength(0);
  });

  it('a contract on a package carries the package price', async () => {
    const rules = await listPricingRules();
    const six = packagesFor(rules, 'monthly_rental', { nationality: 'الفلبين' })[0]!;
    const c = await createDraft({
      service_code: 'monthly_rental',
      customer_id: 'cust-1',
      customer_name: 'محمد الأحمدي',
      branch: 'نجران',
      start_date: '2027-01-01',
      end_date: '2027-06-30',
      quantity: 6,
      nationality: 'الفلبين',
      package_id: six.id,
    });
    expect(c.gross_amount).toBe(2350 * 6);
  });
});

async function liveContract() {
  const c = await createDraft({
    service_code: 'monthly_rental',
    customer_id: 'cust-1',
    customer_name: 'محمد الأحمدي',
    branch: 'نجران',
    start_date: '2026-10-01',
    end_date: '2026-12-31',
    quantity: 3,
    nationality: 'كينيا',
  });
  await transitionContract(c.id, 'pending_approval');
  return (await getContract(c.id))!;
}

describe('contract payments with receiving account and status', () => {
  it('requires the receiving bank account and transaction no for transfers', async () => {
    const c = await liveContract();
    await expect(
      recordContractPayment(c.id, { amount: 100, method: 'transfer', paid_on: '2026-11-20' }),
    ).rejects.toThrow('الحساب البنكي');
    await expect(
      recordContractPayment(c.id, {
        amount: 100,
        method: 'transfer',
        bank_account_id: 'bank-3',
        paid_on: '2026-11-20',
      }),
    ).rejects.toThrow('رقم عملية');
    await recordContractPayment(c.id, {
      amount: 1000,
      method: 'transfer',
      bank_account_id: 'bank-3',
      transaction_no: 'TRX-55120',
      paid_on: '2026-11-20',
    });
    const [p] = await listContractPayments(c.id);
    expect(p?.bank_account_name).toBe('الحساب الجاري - الأهلي');
    expect(p?.status).toBe('received');
    expect((await getContract(c.id))?.amount_paid).toBe(1000);
  });

  it('counts a pending cheque only once cleared, and a bounce reverses it', async () => {
    const c = await liveContract();
    await recordContractPayment(c.id, {
      amount: 2000,
      method: 'cash',
      reference_no: 'شيك 7710',
      paid_on: '2026-11-20',
      status: 'pending_clearance',
    });
    expect((await getContract(c.id))?.amount_paid).toBe(0);
    // the pending amount is reserved against the remaining
    await expect(
      recordContractPayment(c.id, {
        amount: c.total_amount,
        method: 'cash',
        paid_on: '2026-11-20',
      }),
    ).rejects.toThrow('يتجاوز');
    let [p] = await listContractPayments(c.id);
    await setPaymentStatus(p!, 'received');
    expect((await getContract(c.id))?.amount_paid).toBe(2000);
    [p] = await listContractPayments(c.id);
    await expect(setPaymentStatus(p!, 'bounced')).rejects.toThrow('سبب');
    await setPaymentStatus(p!, 'bounced', 'بدون رصيد');
    expect((await getContract(c.id))?.amount_paid).toBe(0);
    [p] = await listContractPayments(c.id);
    await expect(setPaymentStatus(p!, 'received')).rejects.toThrow('لا يمكن');
  });

  it('lists only active receiving accounts with a masked IBAN', async () => {
    const accounts = await listReceivingAccounts();
    const rajhi = accounts.find((a) => a.id === 'bank-2');
    expect(rajhi?.iban_masked).toBe('SA••7519');
    expect(accounts.find((a) => a.id === 'bank-1')?.is_cash).toBe(true);
  });
});

describe('installments', () => {
  it('splits the total monthly and covers the oldest first', async () => {
    const plan = buildSchedule(1000, '2027-01-31', 3);
    expect(plan.map((p) => p.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(plan[1]?.due_date).toBe('2027-03-03');
    const alloc = allocateInstallments(
      [
        { seq: 1, due_date: '2026-10-01', amount: 500 },
        { seq: 2, due_date: '2026-11-01', amount: 500 },
        { seq: 3, due_date: '2027-12-01', amount: 500 },
      ],
      700,
      '2026-11-23',
    );
    expect(alloc.map((a) => a.status)).toEqual(['paid', 'overdue', 'due']);
    expect(alloc[1]?.paid_amount).toBe(200);
  });

  it('refuses a schedule that does not sum to the contract total', async () => {
    const c = await liveContract();
    await expect(setInstallments(c.id, [{ due_date: '2026-10-01', amount: 10 }])).rejects.toThrow(
      'لا يساوي',
    );
    await setInstallments(c.id, buildSchedule(c.total_amount, '2026-10-01', 3));
    await recordContractPayment(c.id, { amount: 100, method: 'cash', paid_on: '2026-11-20' });
    const rows = await listInstallments(c.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.paid_amount).toBe(100);
  });
});

describe('company bank account validation', () => {
  it('normalizes and validates the IBAN and currency', () => {
    const ok = bankAccountSchema.parse({
      name: 'حساب التحصيل',
      bank: 'مصرف الإنماء',
      iban: 'sa05 0500 0068 2010 0000 1234',
      currency: 'sar',
      branch: 'نجران',
    });
    expect(ok.iban).toBe('SA0505000068201000001234');
    expect(ok.currency).toBe('SAR');
    expect(
      bankAccountSchema.safeParse({ name: 'حساب', bank: 'بنك', iban: 'SA12', branch: null })
        .success,
    ).toBe(false);
  });
});
