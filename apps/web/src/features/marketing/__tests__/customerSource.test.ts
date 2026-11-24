import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { convertLead, createLead, getLead } from '@/features/crm/api/crm.api';
import { createDraft } from '@/features/contracts/api/contracts.api';
import {
  changeCustomerAcquisition,
  getCustomerAcquisition,
  resetAttributionDemo,
  setCustomerAcquisition,
} from '@/features/marketing/api/attribution.api';
import { marketingError, EMPTY_MARKETING } from '@/features/marketing/components/MarketingSection';
import { listSources } from '@/features/settings/api/settings.api';

beforeEach(() => {
  resetAttributionDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const draft = (customer_id: string, marketing: Record<string, string | null>) =>
  createDraft({
    service_code: 'monthly_rental',
    customer_id,
    customer_name: 'ناصر آل حمد',
    branch: 'نجران',
    start_date: '2027-03-01',
    end_date: '2027-04-30',
    quantity: 2,
    nationality: 'كينيا',
    marketing: { source_code: '', ...marketing },
  });

describe('customer source from first contact to contract (0098 mirror)', () => {
  it('keeps the Snapchat acquisition through conversion and two contracts', async () => {
    const lead = await createLead({
      full_name: 'ناصر آل حمد',
      phone: '0551239801',
      source_code: 'snapchat',
      first_contact_at: '2026-11-01',
      service_code: 'monthly_rental',
      stage_code: 'new',
      est_value: 0,
      notes: null,
    });
    await convertLead(lead.id);
    const customerId = (await getLead(lead.id))!.customer_id!;
    expect((await getCustomerAcquisition(customerId))?.source_code).toBe('snapchat');

    const c1 = await draft(customerId, { source_code: 'tiktok', campaign_id: 'camp-1' });
    expect(c1.acquisition_source_code).toBe('snapchat');
    expect(c1.source_code).toBe('tiktok');
    expect(c1.campaign_id).toBe('camp-1');
    expect(c1.first_contact_at).toBe('2026-11-01');

    const c2 = await draft(customerId, { source_code: 'whatsapp' });
    expect(c2.source_code).toBe('whatsapp');
    expect(c2.acquisition_source_code).toBe('snapchat');
    expect((await getCustomerAcquisition(customerId))?.source_code).toBe('snapchat');
  });

  it('requires the original source for a customer without one, then records it once', async () => {
    await expect(draft('cust-legacy', { source_code: 'walk_in' })).rejects.toThrow(
      'مصدر العميل الأصلي',
    );
    const c = await draft('cust-legacy', {
      acquisition_source_code: 'walk_in',
      source_code: 'walk_in',
    });
    expect(c.acquisition_source_code).toBe('walk_in');
    await expect(
      setCustomerAcquisition('cust-legacy', {
        source_code: 'google',
        source_note: null,
        campaign_id: null,
        first_contact_at: null,
      }),
    ).rejects.toThrow('مسجّل');
    await expect(
      changeCustomerAcquisition('cust-legacy', 'google', null, 'تصحيح', 'sales'),
    ).rejects.toThrow('لمدير');
    await changeCustomerAcquisition(
      'cust-legacy',
      'google',
      null,
      'العميل أكّد المصدر',
      'branch_manager',
    );
    expect((await getCustomerAcquisition('cust-legacy'))?.source_code).toBe('google');
  });

  it('validates the wizard section: source required, «أخرى» needs a note', async () => {
    const sources = await listSources();
    expect(sources.find((s) => s.code === 'campaign')?.is_active).toBe(false);
    expect(marketingError(EMPTY_MARKETING, null, sources)).toMatch('مصدر العميل الأصلي');
    expect(
      marketingError(
        { ...EMPTY_MARKETING, acquisition_source_code: 'other', source_code: 'other' },
        null,
        sources,
      ),
    ).toMatch('وضّح');
    expect(
      marketingError(
        { ...EMPTY_MARKETING, source_code: 'snapchat' },
        { source_code: 'snapchat', source_note: null, campaign_id: null, first_contact_at: null },
        sources,
      ),
    ).toBeNull();
  });
});
