import { z } from 'zod';
import { normalizeSaudiPhone } from '@/features/crm/lib/leadInput';
import type { WebLeadInput } from '@/features/site/types';

/** نفس تحقق submit_web_lead (0086) — رسائل فورية قبل الإرسال. */
export const webLeadSchema = z.object({
  full_name: z.string().trim().min(3, 'اكتب اسمك (3 أحرف على الأقل)').max(80, 'الاسم طويل جدًا'),
  phone: z.string().regex(/^05\d{8}$/, 'رقم الجوال بصيغة 05xxxxxxxx'),
  service_code: z.string().min(1, 'اختر الخدمة المطلوبة'),
  city: z.string().min(1, 'اختر أقرب فرع لك'),
  notes: z.string().max(500, 'الملاحظات 500 حرف كحد أقصى'),
  website: z.string(),
});

export type WebLeadErrors = Partial<Record<keyof WebLeadInput, string>>;

export function cleanWebLead(input: WebLeadInput): WebLeadInput {
  return {
    ...input,
    full_name: input.full_name.trim(),
    phone: normalizeSaudiPhone(input.phone) ?? '',
    notes: input.notes.trim(),
  };
}

/** أخطاء كل حقل (أول خطأ لكل حقل). */
export function webLeadErrors(input: WebLeadInput): WebLeadErrors {
  const r = webLeadSchema.safeParse(cleanWebLead(input));
  if (r.success) return {};
  const out: WebLeadErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0] as keyof WebLeadInput;
    out[key] ??= issue.message;
  }
  return out;
}

/** رابط واتساب من الرقم الدولي المُدار مع نص افتتاحي. */
export function whatsappLink(intl: string, text: string): string {
  return `https://wa.me/${intl.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** رقم للعرض: 9665xxxxxxxx → 05x xxx xxxx */
export function displayPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const local = d.startsWith('966') ? `0${d.slice(3)}` : d;
  if (/^05\d{8}$/.test(local)) return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  if (/^9200\d{5}$/.test(local))
    return `${local.slice(0, 4)} ${local.slice(4, 6)} ${local.slice(6)}`;
  return local;
}
