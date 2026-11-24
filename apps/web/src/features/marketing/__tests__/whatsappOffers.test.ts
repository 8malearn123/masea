import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  listCampaignMessages,
  resetOffersDemo,
  setConsent,
} from '@/features/marketing/api/offers.api';
import {
  campaignWhatsappReport,
  eligibility,
  queueWhatsappOffer,
  renderTemplate,
  resetWhatsappDemo,
  riyadhEndOfDay,
  saveTemplate,
  listTemplates,
  type WaTemplate,
} from '@/features/marketing/api/whatsapp.api';

beforeEach(() => {
  resetOffersDemo();
  resetWhatsappDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const exp = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

async function approvedTemplate(): Promise<WaTemplate> {
  await expect(
    saveTemplate({
      name_ar: 'بلا متغيرات',
      provider_name: 'bad',
      body: 'نص بدون متغيرات كافية',
      meta_status: 'approved',
      is_active: true,
    }),
  ).rejects.toThrow();
  await saveTemplate({
    name_ar: 'عرض عودة العملاء',
    provider_name: 'masea_comeback_offer',
    body: 'أهلاً {{1}}، {{2}} — حتى {{3}}',
    meta_status: 'approved',
    is_active: true,
  });
  return (await listTemplates())[0]!;
}

describe('WhatsApp offers from the customers page', () => {
  it('sends only to eligible customers, stays «قيد الانتظار» without a provider, respects the daily limit', async () => {
    const t = await approvedTemplate();
    await setConsent('cust-00001', true, ['whatsapp'], 'موافقة مكتوبة');
    await setConsent('cust-00002', true, ['whatsapp'], 'موافقة مكتوبة');
    const el = await eligibility(['cust-00001', 'cust-00002', 'cust-00003']);
    expect(el.filter((e) => e.eligible)).toHaveLength(2);
    expect(el.find((e) => e.customer_id === 'cust-00003')?.reason).toBe('no_consent');

    await expect(
      queueWhatsappOffer({
        campaign_id: 'cm-a',
        campaign_active: false,
        customer_ids: ['cust-00001'],
        template: t,
        offer: 'خصم',
        expires: exp,
        daily_limit: 10,
      }),
    ).rejects.toThrow('غير نشطة');
    await expect(
      queueWhatsappOffer({
        campaign_id: 'cm-a',
        campaign_active: true,
        customer_ids: ['cust-00001'],
        template: { ...t, meta_status: 'pending' },
        offer: 'خصم',
        expires: exp,
        daily_limit: 10,
      }),
    ).rejects.toThrow('معتمداً');

    const r = await queueWhatsappOffer({
      campaign_id: 'cm-a',
      campaign_active: true,
      customer_ids: ['cust-00001', 'cust-00002', 'cust-00003'],
      template: t,
      offer: 'خصم 10٪ على التأجير الشهري',
      expires: exp,
      daily_limit: 1,
    });
    expect(r).toMatchObject({ queued: 1, not_eligible: 1, over_limit: 1 });
    const [m] = await listCampaignMessages('cm-a');
    expect(m?.status).toBe('queued');
    expect(m?.body).toBe(`أهلاً محمد، خصم 10٪ على التأجير الشهري — حتى ${exp}`);
    const again = await queueWhatsappOffer({
      campaign_id: 'cm-a',
      campaign_active: true,
      customer_ids: ['cust-00001'],
      template: t,
      offer: 'خصم',
      expires: exp,
      daily_limit: 10,
    });
    expect(again.duplicate).toBe(1);
    const rep = await campaignWhatsappReport('cm-a');
    expect(rep.messages).toBe(1);
    expect(rep.queued).toBe(1);
    expect(rep.sent).toBe(0);
  });

  it('renders templates and ends offers at 23:59:59 Riyadh time', () => {
    expect(renderTemplate('مرحباً {{1}} {{2}} {{3}}', 'سارة القحطاني', 'خصم', '2026-12-01')).toBe(
      'مرحباً سارة خصم 2026-12-01',
    );
    expect(riyadhEndOfDay('2026-11-30')).toBe('2026-11-30T20:59:59.000Z');
  });
});
