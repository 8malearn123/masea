/** صفحة الهبوط: التحقق، المحتوى من البيانات الحقيقية فقط، والطلب يصل خط المبيعات. */
import { describe, expect, it } from 'vitest';
import { displayPhone, webLeadErrors, whatsappLink } from '@/features/site/lib/webLead';
import { faqs, promises, visibleServices } from '@/features/site/lib/siteContent';
import { buildJsonLd } from '@/features/site/lib/seo';
import {
  companyProfileError,
  getPublicSiteInfo,
  saveCompanyProfile,
  submitWebLead,
} from '@/features/site/api/site.api';
import { listLeads } from '@/features/crm/api/crm.api';
import { EMPTY_COMPANY, type PublicSiteInfo } from '@/features/site/types';

const info = (p: Partial<PublicSiteInfo> = {}): PublicSiteInfo => ({
  company: { ...EMPTY_COMPANY, display_name: 'ماسية الشرق للاستقدام' },
  branches: ['نجران', 'جازان'],
  services: [
    { code: 'recruitment', name: 'استقدام' },
    { code: 'hourly_rental', name: 'تأجير بالساعة' },
    { code: 'sponsorship_transfer', name: 'نقل كفالة' },
  ],
  nationalities: 6,
  hourly_min_hours: 4,
  hourly_max_hours: 12,
  replacement_guarantee_days: null,
  ...p,
});

const lead = {
  full_name: 'عبدالله الحربي',
  phone: '+966 55 999 1101',
  service_code: 'hourly_rental',
  city: 'نجران',
  notes: '',
  website: '',
};

describe('نموذج الطلب', () => {
  it('أخطاء لكل حقل، والجوال الدولي يُقبل', () => {
    expect(
      webLeadErrors({ ...lead, full_name: 'ع', phone: '12', service_code: '', city: '' }),
    ).toMatchObject({
      full_name: expect.stringContaining('اسمك'),
      phone: expect.stringContaining('05'),
      service_code: expect.stringContaining('الخدمة'),
      city: expect.stringContaining('فرع'),
    });
    expect(webLeadErrors(lead)).toEqual({});
  });
  it('روابط واتساب وعرض الرقم', () => {
    expect(whatsappLink('966550001122', 'مرحبا')).toBe(
      'https://wa.me/966550001122?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7',
    );
    expect(displayPhone('966550001122')).toBe('055 000 1122');
    expect(displayPhone('920012345')).toBe('9200 12 345');
  });
});

describe('المحتوى من البيانات فقط', () => {
  it('الخدمات الأربع الفعّالة فقط وبترتيبها، و«بالساعة» بالحدود المُدارة', () => {
    const list = visibleServices(info());
    expect(list.map((s) => s.code)).toEqual(['recruitment', 'hourly_rental']);
    expect(list[1]!.fact(info())).toBe('من 4 إلى 12 ساعة في الزيارة الواحدة');
    expect(list[1]!.fact(info({ hourly_min_hours: null }))).toBeNull();
  });
  it('لا ضمان يُذكر ما لم يُضبط في النظام', () => {
    expect(promises(info()).some((p) => p.title.includes('ضمان'))).toBe(false);
    expect(
      promises(info({ replacement_guarantee_days: 90 })).some((p) => p.title.includes('90')),
    ).toBe(true);
    expect(faqs(info()).find((f) => f.q.includes('ضمان'))!.a).not.toMatch(/\d/);
  });
  it('البيانات المنظمة بلا هاتف أو عنوان مختلَق', () => {
    const ld = buildJsonLd(info(), 'https://example.sa/');
    expect(ld).not.toHaveProperty('telephone');
    expect(ld).not.toHaveProperty('address');
    const full = buildJsonLd(
      info({ company: { ...EMPTY_COMPANY, phone: '920012345', founded_year: 2012 } }),
      'https://example.sa/',
    );
    expect(full).toMatchObject({ telephone: '920012345', foundingDate: '2012' });
  });
});

describe('الطلب يصل خط المبيعات (وضع العرض)', () => {
  it('عميل محتمل جديد من «الموقع الإلكتروني» في فرع المدينة', async () => {
    const r = await submitWebLead(lead);
    expect(r.ref).toBeTruthy();
    const found = (await listLeads()).find((l) => l.full_name === 'عبدالله الحربي')!;
    expect(found).toMatchObject({
      phone: '0559991101',
      source_code: 'website',
      stage_code: 'new',
      branch: 'نجران',
    });
  });
  it('حقل الفخّ: لا يُحفظ شيء', async () => {
    const before = (await listLeads()).length;
    await submitWebLead({ ...lead, full_name: 'روبوت آلي', website: 'http://x' });
    expect((await listLeads()).length).toBe(before);
  });
  it('بيانات الشركة: تحقق ثم ظهور في الصفحة', async () => {
    expect(companyProfileError({ ...EMPTY_COMPANY, whatsapp: '0551234567' })).toContain('الدولية');
    expect(companyProfileError({ ...EMPTY_COMPANY, instagram_url: 'http://x' })).toContain('https');
    await saveCompanyProfile({
      ...EMPTY_COMPANY,
      display_name: 'ماسية الشرق للاستقدام',
      whatsapp: '+966 55 000 1122',
    });
    expect((await getPublicSiteInfo()).company.whatsapp).toBe('966550001122');
  });
});
