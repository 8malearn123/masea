import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  campaignAudience,
  getConsent,
  listCampaignMessages,
  markManual,
  personalize,
  queueOffer,
  recordResponse,
  resetOffersDemo,
  setConsent,
} from '@/features/marketing/api/offers.api';

beforeEach(() => {
  resetOffersDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('offers go only to consenting customers and are never faked as sent', () => {
  it('queues for consent, skips others, logs manual WhatsApp as unconfirmed', async () => {
    await expect(setConsent('cust-1', true, ['whatsapp'], '')).rejects.toThrow();
    await setConsent('cust-1', true, ['whatsapp'], 'موافقة مكتوبة في فرع نجران');
    expect((await getConsent('cust-1')).granted).toBe(true);
    expect((await campaignAudience('whatsapp')).map((c) => c.id)).toEqual(['cust-1']);

    await expect(
      queueOffer('cm-x', false, ['cust-1'], 'whatsapp', 'عرض خاص لك يا {الاسم}'),
    ).rejects.toThrow('غير نشطة');
    const r = await queueOffer(
      'cm-x',
      true,
      ['cust-1', 'cust-2'],
      'whatsapp',
      'أهلاً {الاسم}، خصم خاص هذا الأسبوع',
    );
    expect(r).toEqual({
      queued: 1,
      skipped_no_consent: 1,
      skipped_no_phone: 0,
      skipped_duplicate: 0,
    });
    const again = await queueOffer(
      'cm-x',
      true,
      ['cust-1'],
      'whatsapp',
      'أهلاً {الاسم}، خصم خاص هذا الأسبوع',
    );
    expect(again.skipped_duplicate).toBe(1);

    const [m] = await listCampaignMessages('cm-x');
    expect(m?.status).toBe('queued');
    expect(m?.body.startsWith('أهلاً محمد')).toBe(true);
    await markManual(m!);
    await recordResponse(m!, 'interested');
    const [after] = await listCampaignMessages('cm-x');
    expect(after?.status).toBe('opened_manually');
    expect(after?.response).toBe('interested');

    await setConsent('cust-1', false, [], '');
    expect(await campaignAudience('whatsapp')).toHaveLength(0);
  });

  it('personalises with the first name', () => {
    expect(personalize('مرحباً {الاسم}!', 'سارة القحطاني')).toBe('مرحباً سارة!');
  });
});
