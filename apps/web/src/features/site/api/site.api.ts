/**
 * الموقع العام (صفحة الهبوط) — بيانات حقيقية فقط:
 * مع قاعدة البيانات: public_site_info() و submit_web_lead() (0086) — الطلب يصل خط
 * المبيعات كعميل محتمل جديد. في وضع العرض: نفس مخازن العرض الموجودة (الفروع،
 * الخدمات، قيم النظام، العملاء المحتملون) — لا أرقام أو بيانات تواصل مختلَقة.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { BRANCHES_AR, FALLBACK_SERVICES, FALLBACK_WORKERS } from '@/lib/funnel';
import { configValue, listConfig } from '@/features/settings/api/settings.api';
import { captureLead } from '@/features/crm/api/crm.api';
import { cleanWebLead, webLeadErrors } from '@/features/site/lib/webLead';
import {
  EMPTY_COMPANY,
  type CompanyProfile,
  type PublicSiteInfo,
  type WebLeadInput,
} from '@/features/site/types';
import type { Lead } from '@/features/crm/types';

/** بيانات الشركة في وضع العرض: الاسم الرسمي فقط حتى يُدخل الإداري البقية. */
let DEMO_COMPANY: CompanyProfile = { ...EMPTY_COMPANY, display_name: 'ماسية الشرق للاستقدام' };

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);

export async function getPublicSiteInfo(): Promise<PublicSiteInfo> {
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('public_site_info');
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      company: { ...EMPTY_COMPANY, ...((d.company as Partial<CompanyProfile> | null) ?? {}) },
      branches: (d.branches as string[] | null) ?? [],
      services: (d.services as { code: string; name: string }[] | null) ?? [],
      nationalities: num(d.nationalities) ?? 0,
      hourly_min_hours: num(d.hourly_min_hours),
      hourly_max_hours: num(d.hourly_max_hours),
      replacement_guarantee_days: num(d.replacement_guarantee_days),
    };
  }
  const config = await listConfig();
  const has = (k: string) => config.some((c) => c.key === k);
  return {
    company: { ...DEMO_COMPANY },
    branches: [...BRANCHES_AR],
    services: [
      ...FALLBACK_SERVICES.map((s) => ({ code: s.code, name: s.name_ar })),
      { code: 'hourly_rental', name: 'تأجير بالساعة' },
    ],
    nationalities: new Set(FALLBACK_WORKERS.map((w) => w.nationality)).size,
    hourly_min_hours: has('hourly_min_hours') ? configValue(config, 'hourly_min_hours', 0) : null,
    hourly_max_hours: has('hourly_max_hours') ? configValue(config, 'hourly_max_hours', 0) : null,
    replacement_guarantee_days: has('replacement_guarantee_days')
      ? configValue(config, 'replacement_guarantee_days', 0) || null
      : null,
  };
}

export interface WebLeadResult {
  /** رقم مرجعي يُعرض للزائر (null لطلب رُفض بصمت كروبوت) */
  ref: string | null;
  duplicate: boolean;
}

/** طلب خدمة من الزائر → عميل محتمل «جديد» في فرع مدينته (المصدر: الموقع الإلكتروني). */
export async function submitWebLead(input: WebLeadInput): Promise<WebLeadResult> {
  const errs = webLeadErrors(input);
  const first = Object.values(errs)[0];
  if (first) throw new Error(first);
  const v = cleanWebLead(input);
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('submit_web_lead', {
      p_full_name: v.full_name,
      p_phone: v.phone,
      p_service_code: v.service_code,
      p_city: v.city,
      p_notes: v.notes || null,
      p_website: v.website || null,
    });
    if (error) throw new Error(error.message.replace(/^.*?ERROR:\s*/, ''));
    const r = (data ?? {}) as { ref?: string | null; duplicate?: boolean };
    return { ref: r.ref ?? null, duplicate: Boolean(r.duplicate) };
  }
  if (v.website) return { ref: null, duplicate: false };
  const id = captureLead({
    full_name: v.full_name,
    phone: v.phone,
    source_code: 'website',
    service_code: v.service_code as Lead['service_code'],
    est_value: 0,
    branch: v.city,
    notes: v.notes || null,
  });
  return { ref: id.replace(/\D/g, '').padStart(6, '0'), duplicate: false };
}

/* ------------------------- إدارة بيانات الشركة (الإعدادات) ------------------------ */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  return (await getPublicSiteInfo()).company;
}

const URL_FIELDS: (keyof CompanyProfile)[] = [
  'maps_url',
  'instagram_url',
  'x_url',
  'snapchat_url',
  'tiktok_url',
  'linkedin_url',
  'hero_image_url',
  'experience_image_url',
  'privacy_url',
  'terms_url',
];

/** نفس قيود company_profile (0086) — أول خطأ أو null. */
export function companyProfileError(p: CompanyProfile): string | null {
  const phone = p.phone?.replace(/\D/g, '') ?? '';
  if (phone && !/^(05\d{8}|9200\d{5}|800\d{7}|01\d{7,8})$/.test(phone))
    return 'رقم الهاتف: جوال 05xxxxxxxx أو موحّد 9200xxxxx أو مجاني 800xxxxxxx';
  const wa = p.whatsapp?.replace(/\D/g, '') ?? '';
  if (wa && !/^9665\d{8}$/.test(wa)) return 'واتساب بالصيغة الدولية 9665xxxxxxxx';
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email.trim()))
    return 'البريد الإلكتروني غير صحيح';
  if (
    p.founded_year !== null &&
    (p.founded_year < 1950 || p.founded_year > new Date().getFullYear())
  )
    return 'سنة التأسيس غير صحيحة';
  for (const k of URL_FIELDS) {
    const val = p[k];
    // وضع العرض يحفظ الصورة المرفوعة محليًا (data:) — مع الخادم رابط site-media العام
    const demoImage =
      isDemoMode() &&
      (k === 'hero_image_url' || k === 'experience_image_url') &&
      /^data:image\//.test(String(val));
    if (typeof val === 'string' && val.trim() && !demoImage && !/^https:\/\//.test(val.trim()))
      return 'الروابط تبدأ بـ https://';
  }
  return null;
}

export async function saveCompanyProfile(p: CompanyProfile): Promise<void> {
  const invalid = companyProfileError(p);
  if (invalid) throw new Error(invalid);
  const clean = Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
  ) as unknown as CompanyProfile;
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('company_profile')
      .update(clean)
      .eq('id', 1)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('لا تملك صلاحية تعديل بيانات الشركة');
    return;
  }
  DEMO_COMPANY = {
    ...clean,
    phone: clean.phone?.replace(/\D/g, '') || null,
    whatsapp: clean.whatsapp?.replace(/\D/g, '') || null,
    email: clean.email?.toLowerCase() || null,
  };
}

const MAX_IMAGE = 3 * 1024 * 1024;

/** صورة للموقع (حاوية site-media العامة) — يعيد رابطها العام. */
export async function uploadSiteImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('الصورة بصيغة JPG أو PNG أو WebP');
  if (file.size > MAX_IMAGE) throw new Error('حجم الصورة 3 ميجابايت كحد أقصى');
  if (!isDemoMode()) {
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `site/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from('site-media')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(`تعذّر رفع الصورة: ${error.message}`);
    return supabase.storage.from('site-media').getPublicUrl(path).data.publicUrl;
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
    r.readAsDataURL(file);
  });
}
