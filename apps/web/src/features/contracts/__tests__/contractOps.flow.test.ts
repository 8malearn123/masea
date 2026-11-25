import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import {
  createDraft,
  demoMutateContract,
  getContract,
  signContract,
  transitionContract,
} from '@/features/contracts/api/contracts.api';
import {
  listOpsEvents,
  listRefunds,
  listReturns,
  listSettlements,
  prepareSettlement,
  recordPayout,
  refundStep,
  requestReturn,
  resetContractOpsDemo,
  returnStep,
  settlementStep,
  settleSettlement,
  updateRefundDetails,
} from '@/features/contracts/api/contractOps.api';

/** صورة توقيع بصيغة PNG (يتحقق منها التوقيع على الخادم — 0107). */
const SIG_PNG = `data:image/png;base64,${'A'.repeat(300)}`;

function as(role: AppRole): void {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

beforeEach(() => resetContractOpsDemo());
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

async function deliveredContract() {
  as('admin');
  const c = await createDraft({
    service_code: 'monthly_rental',
    customer_id: 'cust-1',
    customer_name: 'محمد الأحمدي',
    worker_profile_id: 'wp-ops-1',
    worker_name: 'نورما ديلا كروز',
    branch: 'جازان', // the demo branch manager's branch
    start_date: daysAgo(20),
    end_date: iso(new Date(Date.now() + 39 * 86_400_000)),
    quantity: 1,
    nationality: 'الفلبين',
  });
  await transitionContract(c.id, 'pending_approval');
  await transitionContract(c.id, 'approved');
  await transitionContract(c.id, 'awaiting_signature');
  await signContract(c.id, {
    customer: SIG_PNG,
    company: SIG_PNG,
    customerName: 'محمد الأحمدي',
    nationalId: '1012345678',
    ipAddress: '10.0.0.1',
  });
  await transitionContract(c.id, 'active');
  // the customer paid the whole contract (payments ledger → amount_paid, 0089)
  demoMutateContract(c.id, { amount_paid: c.total_amount });
  return c.id;
}

describe('return → settlement → refund (demo mirror of 0090)', () => {
  it('runs the whole cycle with four eyes, partial payouts and no duplicates', async () => {
    const id = await deliveredContract();
    const c = await getContract(id);
    expect(c?.status).toBe('active');
    // direct cancellation of an active contract is refused
    await expect(transitionContract(id, 'cancelled')).rejects.toThrow('وتسويته');

    // the worker comes back
    as('branch_manager');
    const r = await requestReturn({
      contractId: id,
      requestedDate: daysAgo(1),
      reasonCode: 'early_cancel',
    });
    await expect(returnStep(r, 'ready')).rejects.toThrow('بعد الاستلام');
    await returnStep(r, 'receive', { date: daysAgo(1), condition: 'good' });
    await expect(returnStep(r, 'ready')).rejects.toThrow('سوِّ العقد');

    // settlement prepared by the branch manager …
    const s = await prepareSettlement({
      contractId: id,
      effectiveDate: daysAgo(1),
      reasonCode: 'customer_request',
      returnId: r.id,
    });
    expect(s.kind).toBe('return');
    expect(s.days_used).toBe(20);
    expect(s.due_basis).toBe('prorata');
    await expect(
      prepareSettlement({ contractId: id, effectiveDate: daysAgo(1), reasonCode: 'x' }),
    ).rejects.toThrow('قائمة');
    await settlementStep(s, 'submit');
    await expect(settlementStep(s, 'review')).rejects.toThrow('أربع أعين');

    // … reviewed by operations, approved and executed by the accountant
    as('operations_manager');
    await settlementStep(s, 'review');
    await expect(settleSettlement(s)).rejects.toThrow('اعتمادها مالياً');
    as('accountant');
    await settlementStep(s, 'approve');
    await settleSettlement(s);

    expect((await getContract(id))?.status).toBe('cancelled');
    const [settled] = await listSettlements(id);
    expect(settled?.status).toBe('settled');
    const [refund] = await listRefunds(id);
    if (!refund || !settled) throw new Error('missing refund');
    expect(refund.amount).toBe(settled.balance);
    expect(refund.status).toBe('draft');

    // refund cycle
    as('branch_manager');
    await expect(
      updateRefundDetails(refund, {
        method: 'transfer',
        beneficiary: 'محمد الأحمدي',
        iban: 'SA12',
        bank: 'الراجحي',
      }),
    ).rejects.toThrow();
    await updateRefundDetails(refund, {
      method: 'transfer',
      beneficiary: 'محمد الأحمدي',
      iban: 'SA03 8000 0000 6080 1016 7519',
      bank: 'مصرف الراجحي',
    });
    await refundStep(refund, 'submit');
    as('operations_manager');
    await refundStep(refund, 'review');
    as('accountant');
    await expect(
      recordPayout(refund, { amount: 1, transferRef: 'T-1', paidOn: daysAgo(0), bankCode: '1112' }),
    ).rejects.toThrow('معتمد');
    await refundStep(refund, 'approve');
    await refundStep(refund, 'queue');

    const half = Math.round((refund.amount / 2) * 100) / 100;
    await recordPayout(refund, {
      amount: half,
      transferRef: 'T-1',
      paidOn: daysAgo(0),
      bankCode: '1112',
    });
    expect((await listRefunds(id))[0]?.status).toBe('partially_refunded');
    await expect(
      recordPayout(refund, {
        amount: 1,
        transferRef: ' t-1',
        paidOn: daysAgo(0),
        bankCode: '1112',
      }),
    ).rejects.toThrow('مسجّل مسبقاً');
    await expect(
      recordPayout(refund, {
        amount: refund.amount,
        transferRef: 'T-2',
        paidOn: daysAgo(0),
        bankCode: '1112',
      }),
    ).rejects.toThrow('يتجاوز');
    await recordPayout(refund, {
      amount: Math.round((refund.amount - half) * 100) / 100,
      transferRef: 'T-2',
      paidOn: daysAgo(0),
      bankCode: '1112',
    });
    expect((await listRefunds(id))[0]?.status).toBe('refunded');

    // now the worker can be made available
    as('branch_manager');
    await returnStep(r, 'ready');
    expect((await listReturns(id))[0]?.status).toBe('ready');

    const log = await listOpsEvents(id);
    expect(log.map((e) => `${e.entity}:${e.action}`)).toEqual(
      expect.arrayContaining([
        'return:receive',
        'settlement:review',
        'settlement:settle',
        'refund:payout',
        'return:ready',
      ]),
    );
  });

  it('cancel before start refunds everything paid', async () => {
    as('admin');
    const c = await createDraft({
      service_code: 'daily_rental',
      customer_id: 'cust-3',
      customer_name: 'فهد العنزي',
      branch: 'شرورة',
      start_date: iso(new Date(Date.now() + 10 * 86_400_000)),
      end_date: iso(new Date(Date.now() + 12 * 86_400_000)),
      quantity: 1,
      profession: 'طبخ',
    });
    await transitionContract(c.id, 'pending_approval');
    await transitionContract(c.id, 'approved');
    await transitionContract(c.id, 'awaiting_signature');
    await signContract(c.id, {
      customer: SIG_PNG,
      company: SIG_PNG,
      customerName: 'فهد العنزي',
      nationalId: '1012345679',
      ipAddress: '10.0.0.2',
    });
    demoMutateContract(c.id, { amount_paid: c.total_amount });
    const s = await prepareSettlement({
      contractId: c.id,
      effectiveDate: daysAgo(0),
      reasonCode: 'customer_travel',
    });
    expect(s.kind).toBe('cancel_before_start');
    expect(s.service_due).toBe(0);
    expect(s.amount_paid).toBe(c.total_amount);
    expect(s.balance).toBe(c.total_amount);
  });
});
