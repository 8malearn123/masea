/**
 * Phase 3 of the QA report (docs/qa/2026-10-27-journeys-report.md): calls and
 * tickets stay in step, callbacks are dated, payments earn loyalty points, the
 * call center and loyalty show the same balance, renewals use the managed VAT
 * and a used discount counts towards its limit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  addCall,
  listCalls,
  overdueCallbacks,
  updateCallStatus,
} from '@/features/call-center/api/calls.api';
import { createTicket, updateTicketStatus } from '@/features/call-center/api/tickets.api';
import { lookupCustomer } from '@/features/call-center/data/directory';
import { getAccount, loyaltyPointsByPhone } from '@/features/loyalty/data/engine';
import { recordPayment } from '@/features/payments/api/payments.api';
import { listCustomerSales } from '@/shared/lib/salesLedger';
import { getPricingConfig, updatePricingConfig } from '@/features/pricing/api/pricing.api';
import { listPromotions } from '@/features/pricing/api/promotions.api';
import {
  createDraft,
  demoMutateContract,
  getContract,
  renewContract,
} from '@/features/contracts/api/contracts.api';
import { defaultRenewalStart, renewalTerm } from '@/features/contracts/lib/contractRenewal';
import { contractEndDate } from '@/features/contracts/lib/contractTerm';

afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});
function signIn() {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === 'admin')!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}

describe('call center journeys', () => {
  it('resolving a ticket closes the call that opened it', async () => {
    const t = await createTicket({
      customer_name: 'نورة الشهري',
      phone: '0544567890',
      subject: 'تأخر مباشرة العاملة',
      team: 'العمليات',
      priority: 'high',
      description: '',
      by: 'ريم الزهراني',
    });
    const call = await addCall({
      customer_name: 'نورة الشهري',
      phone: '0544567890',
      topic: 'تأخر مباشرة العاملة',
      type: 'complaint',
      priority: 'high',
      channel: 'phone',
      agent: 'ريم الزهراني',
      notes: '',
      ticket_no: t.ticket_no,
      status: 'in_progress',
    });
    await updateTicketStatus(t.id, 'resolved');
    expect((await listCalls()).find((c) => c.id === call.id)?.status).toBe('resolved');
  });

  it('a callback needs a future time; overdue callbacks are listed', async () => {
    const [c] = await listCalls();
    await expect(updateCallStatus(c!.id, 'callback')).rejects.toThrow('موعد');
    await expect(updateCallStatus(c!.id, 'callback', '2020-01-01T10:00:00Z')).rejects.toThrow(
      'المستقبل',
    );
    const later = new Date(Date.now() + 3_600_000).toISOString();
    await updateCallStatus(c!.id, 'callback', later);
    expect((await listCalls()).find((x) => x.id === c!.id)?.callback_at).toBe(later);
    // seeded callback (c3) is in the past
    expect(overdueCallbacks(await listCalls()).map((x) => x.id)).toContain('c3');
    expect(overdueCallbacks(await listCalls()).map((x) => x.id)).not.toContain(c!.id);
  });
});

describe('loyalty — one balance, earned on payment', () => {
  it('the call center shows the loyalty ledger balance', () => {
    expect(lookupCustomer('0501234567')?.loyalty_points).toBe(loyaltyPointsByPhone('0501234567'));
    expect(lookupCustomer('0501234567')?.loyalty_points).toBe(getAccount('c-mhd').points_balance);
  });

  it('a payment earns points once (tier multiplier)', async () => {
    const sale = listCustomerSales().find(
      (s) => s.customer_name === 'عبدالله الدوسري' && s.total > s.amount_paid,
    );
    expect(sale).toBeDefined();
    const before = getAccount('c-abdullah').points_balance;
    await recordPayment(sale!.id, 'cash', 1000);
    // bronze ×1 (spend 3,400) — 1 point per riyal
    expect(getAccount('c-abdullah').points_balance).toBe(before + 1000);
    expect(lookupCustomer('0500001111')?.loyalty_points).toBe(before + 1000);
  });
});

describe('contracts — managed VAT on renewal, discount usage', () => {
  it('a renewal is priced with the managed VAT rate', async () => {
    signIn();
    const start = '2026-02-01';
    const c = await createDraft({
      service_code: 'monthly_rental',
      customer_id: 'cust-2',
      customer_name: 'سارة القحطاني',
      branch: 'جازان',
      start_date: start,
      end_date: contractEndDate('monthly_rental', start, 3),
      quantity: 3,
      nationality: 'الفلبين',
    });
    demoMutateContract(c.id, { status: 'active', signed_at: `${start}T10:00:00Z` });
    const parent = (await getContract(c.id))!;
    const cfg = await getPricingConfig();
    await updatePricingConfig({ ...cfg, vat_rate: 0.1 }, 'منصور المكرمي');
    const plan = renewalTerm(parent, defaultRenewalStart(parent));
    if (plan.error !== null) throw new Error(plan.error);
    const r = await renewContract(c.id, plan.term.start_date, plan.term.end_date);
    await updatePricingConfig(cfg, 'منصور المكرمي');
    expect(r.vat_amount).toBe(Math.round(r.base_amount * 0.1 * 100) / 100);
    expect(r.vat_amount).toBe(750); // 7,500 × 10%
  });

  it('a discount used on a contract counts towards its usage limit', async () => {
    signIn();
    const before = (await listPromotions()).find((p) => p.id === 'pm-3')!.usage_count;
    await createDraft({
      service_code: 'monthly_rental',
      customer_id: 'cust-2',
      branch: 'نجران',
      start_date: '2026-11-01',
      quantity: 6,
      nationality: 'الفلبين',
      promotion_id: 'pm-3',
    });
    expect((await listPromotions()).find((p) => p.id === 'pm-3')!.usage_count).toBe(before + 1);
  });
});
