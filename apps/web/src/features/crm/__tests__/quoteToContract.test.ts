import { afterEach, describe, expect, it } from 'vitest';
import type { AppRole } from '@masiat/shared';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { EMPTY_CALC } from '@/features/pricing/lib/engine';
import { listPricingRules, getPricingConfig } from '@/features/pricing/api/pricing.api';
import { listPromotions } from '@/features/pricing/api/promotions.api';
import { findByCode } from '@/shared/lib/pricing';
import { getQuoteRecord, quoteNeedsApproval } from '@/shared/lib/quotesLedger';
import { buildQuoteHtml } from '@/features/pricing/lib/quoteHtml';
import { getClauses, getContract } from '@/features/contracts/api/contracts.api';
import { listOrders } from '@/features/orders/api/orders.api';
import {
  convertQuote,
  createLeadQuote,
  getLead,
  listLeads,
  setLeadQuoteStatus,
} from '@/features/crm/api/crm.api';

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

const POLICY = { thresholdPct: 10, canApprove: false };

describe('lead → quote → contract (demo mode)', () => {
  it('a branch role sees only the leads of its branch', async () => {
    const acc = signIn('sales'); // شرورة
    const leads = await listLeads();
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.branch === acc.branch)).toBe(true);
  });

  it('creates a complete quote from the lead file and converts the accepted quote into a linked contract + order', async () => {
    const acc = signIn('sales');
    const lead = await getLead('lead-1');
    expect(lead?.branch).toBe(acc.branch);
    if (!lead) return;
    const [rules, cfg] = await Promise.all([listPricingRules(), getPricingConfig()]);

    const q = await createLeadQuote(
      {
        lead,
        calc: { ...EMPTY_CALC, service: 'monthly_rental', nationality: 'الفلبين', quantity: 3 },
        valid_days: 7,
        notes: 'يشمل التوصيل',
        extra: {
          worker_name: 'ماريا سانتوس',
          start_date: '2026-12-01',
          duration_unit: 'month',
          duration_count: 3,
          end_date: '2027-02-28',
          terms: ['مدة العقد ثلاثة أشهر قابلة للتجديد', 'السداد مقدمًا'],
        },
      },
      { rules, cfg, actor: acc.name },
    );
    expect(q.lead_id).toBe('lead-1');
    expect(q.branch).toBe('شرورة');
    expect(q.total_amount).toBeGreaterThan(0);
    expect((await getLead('lead-1'))?.stage_code).toBe('quoted');

    // the professional document carries every block the business asked for
    const html = buildQuoteHtml(q);
    for (const part of [
      'تفاصيل الخدمة',
      'ماريا سانتوس',
      '3 أشهر',
      'الشروط والأحكام',
      'السداد مقدمًا',
      'صالح حتى',
      'ضريبة القيمة المضافة',
      'توقيع العميل',
    ])
      expect(html).toContain(part);

    await expect(convertQuote(q, acc.name)).rejects.toThrow(/المقبول/);
    await setLeadQuoteStatus(q.id, 'sent', acc.name, POLICY);
    await setLeadQuoteStatus(q.id, 'accepted', acc.name, POLICY);
    const accepted = getQuoteRecord(q.id);
    if (!accepted) throw new Error('quote missing');

    const { contract_id } = await convertQuote(accepted, acc.name);
    const contract = await getContract(contract_id);
    expect(contract?.quote_id).toBe(q.id);
    expect(contract?.status).toBe('draft');
    expect(contract?.branch_id).toBe('شرورة');
    expect(contract?.total_amount).toBe(q.total_amount); // frozen — no re-pricing
    expect(contract?.start_date).toBe('2026-12-01');
    expect((await getClauses(contract_id)).map((c) => c.body)).toEqual(q.terms);

    const linked = getQuoteRecord(q.id);
    expect(linked?.contract_id).toBe(contract_id);
    const orders = await listOrders({ status: 'all', branch: 'all', search: '' });
    expect(orders.some((o) => o.contract_id === contract_id && o.status === 'new')).toBe(true);
    const wonLead = await getLead('lead-1');
    expect(wonLead?.stage_code).toBe('won');
    expect(wonLead?.customer_id).toBe(contract?.customer_id);

    // one quote = one contract
    await expect(convertQuote(linked ?? accepted, acc.name)).rejects.toThrow(/مرتبط بعقد/);
  });

  it('a discount above the managed threshold needs the branch manager before it can be sent', async () => {
    const acc = signIn('sales');
    const lead = await getLead('lead-3');
    if (!lead) throw new Error('lead-3 missing');
    const [rules, cfg, promos] = await Promise.all([
      listPricingRules(),
      getPricingConfig(),
      listPromotions(),
    ]);
    const promo = findByCode(promos, 'FIRST10');
    const q = await createLeadQuote(
      {
        lead,
        calc: { ...EMPTY_CALC, service: 'recruitment', nationality: 'الفلبين', promotion: promo },
        valid_days: 7,
        notes: null,
        extra: { terms: [] },
      },
      { rules, cfg, actor: acc.name },
    );
    expect(q.discount_amount ?? 0).toBeGreaterThan(0);
    const strict = { thresholdPct: 1, canApprove: false };
    expect(quoteNeedsApproval(q, strict.thresholdPct)).toBe(true);
    await expect(setLeadQuoteStatus(q.id, 'sent', acc.name, strict)).rejects.toThrow(
      /اعتماد مدير الفرع/,
    );
    await setLeadQuoteStatus(q.id, 'pending_approval', acc.name, strict);
    await expect(setLeadQuoteStatus(q.id, 'sent', acc.name, strict)).rejects.toThrow(/لمدير الفرع/);

    const approved = await setLeadQuoteStatus(q.id, 'sent', 'مدير الفرع', {
      thresholdPct: 1,
      canApprove: true,
    });
    expect(approved.status).toBe('sent');
    expect(approved.approved_by).toBe('مدير الفرع');
    expect(approved.approved_at).not.toBeNull();
  });
});
