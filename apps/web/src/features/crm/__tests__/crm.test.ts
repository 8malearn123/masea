import { describe, expect, it } from 'vitest';
import {
  captureLead,
  convertQuoteToContract,
  createLead,
  createQuote,
  getMyTarget,
  listLeads,
  listQuotes,
  setLeadStage,
} from '@/features/crm/api/crm.api';

describe('sales CRM pipeline (demo)', () => {
  it('seeds the شرورة pipeline across stages', async () => {
    const leads = await listLeads();
    expect(leads.length).toBeGreaterThanOrEqual(7);
    expect(leads.some((l) => l.stage_code === 'won')).toBe(true);
    expect(leads.some((l) => l.stage_code === 'negotiation')).toBe(true);
  });

  it('creates a lead and moves it across the pipeline', async () => {
    const before = (await listLeads()).length;
    const lead = await createLead({
      full_name: 'مبارك آل سعيد',
      phone: '0555199999',
      source_code: 'walk_in',
      service_code: 'recruitment',
      stage_code: 'new',
      est_value: 16000,
      notes: null,
    });
    expect((await listLeads()).length).toBe(before + 1);
    await setLeadStage(lead.id, 'contacted');
    const moved = (await listLeads()).find((l) => l.id === lead.id);
    expect(moved?.stage_code).toBe('contacted');
  });

  it('exposes my monthly target + leaderboard rank', async () => {
    const t = await getMyTarget();
    expect(t.contracts_target).toBeGreaterThan(0);
    expect(t.rank).toBeGreaterThan(0);
    expect(t.rank_total).toBeGreaterThanOrEqual(t.rank);
  });

  it('creates a quote (moves lead to quoted) then converts it to a contract (won)', async () => {
    const lead = await createLead({
      full_name: 'تركي آل سعد',
      phone: '0555123456',
      source_code: 'referral',
      service_code: 'recruitment',
      stage_code: 'contacted',
      est_value: 16000,
      notes: null,
    });
    const quote = await createQuote({
      lead_id: lead.id,
      customer_name: lead.full_name,
      service_code: 'recruitment',
      base_amount: 16000,
      vat_amount: 2400,
      total_amount: 18400,
      valid_until: null,
    });
    expect((await listLeads()).find((l) => l.id === lead.id)?.stage_code).toBe('quoted');
    expect((await listQuotes(lead.id)).length).toBe(1);

    await convertQuoteToContract(quote.id);
    expect((await listLeads()).find((l) => l.id === lead.id)?.stage_code).toBe('won');
  });

  it('auto-captures a lead from an external touch point (landing/call-center)', async () => {
    const before = (await listLeads()).length;
    captureLead({
      full_name: 'عميل من الموقع',
      phone: '0555000111',
      source_code: 'website',
      service_code: 'monthly_rental',
      est_value: 7500,
      stage_code: 'won',
    });
    expect((await listLeads()).length).toBe(before + 1);
  });
});
