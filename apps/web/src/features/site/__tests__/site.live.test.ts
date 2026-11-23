/** صفحة الهبوط مع خادم حقيقي: البيانات من public_site_info والطلب عبر submit_web_lead. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rpcs: [] as { fn: string; params: unknown }[], fail: '' }));
vi.mock('@/shared/lib/demoBackend', async (orig) => ({
  ...(await orig<typeof import('@/shared/lib/demoBackend')>()),
  isDemoMode: () => false,
}));
vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, params: unknown) => {
      db.rpcs.push({ fn, params });
      if (db.fail) return Promise.resolve({ data: null, error: { message: db.fail } });
      if (fn === 'public_site_info')
        return Promise.resolve({
          data: {
            company: { display_name: 'ماسية الشرق للاستقدام', phone: null },
            branches: ['نجران'],
            services: [],
            nationalities: 3,
            hourly_min_hours: 4,
            hourly_max_hours: 12,
            replacement_guarantee_days: null,
          },
          error: null,
        });
      return Promise.resolve({ data: { ok: true, ref: 'AB12CD34' }, error: null });
    },
  },
}));

import { getPublicSiteInfo, submitWebLead } from '@/features/site/api/site.api';

beforeEach(() => {
  db.rpcs = [];
  db.fail = '';
});

describe('مع خادم حقيقي', () => {
  it('البيانات من public_site_info', async () => {
    const i = await getPublicSiteInfo();
    expect(i).toMatchObject({ branches: ['نجران'], nationalities: 3, hourly_max_hours: 12 });
    expect(i.company.phone).toBeNull();
  });
  it('الطلب يُرسل بالجوال المطبَّع، ورسالة الخادم تظهر عند الرفض', async () => {
    const lead = {
      full_name: 'عبدالله الحربي',
      phone: '+966559991101',
      service_code: 'recruitment',
      city: 'نجران',
      notes: ' ',
      website: '',
    };
    expect(await submitWebLead(lead)).toEqual({ ref: 'AB12CD34', duplicate: false });
    expect(db.rpcs.at(-1)).toMatchObject({
      fn: 'submit_web_lead',
      params: { p_phone: '0559991101', p_notes: null, p_website: null },
    });
    db.fail = 'ERROR: استلمنا طلباتك اليوم وسيتواصل معك فريقنا قريبًا';
    await expect(submitWebLead(lead)).rejects.toThrow('استلمنا طلباتك اليوم');
  });
});
