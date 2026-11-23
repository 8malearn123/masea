import { z } from 'zod';
import type { LeadInput } from '@/features/crm/api/crm.api';

/**
 * قواعد العميل المحتمل — مرآة guard_lead وقيود الجدول (0085): الاسم مطلوب، الجوال
 * 05xxxxxxxx (يُقبل +966 / 966 / 5xxxxxxxx ويُطبَّع)، القيمة المتوقعة رقم غير سالب.
 */
export function normalizeSaudiPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.startsWith('9665') && d.length === 12) d = `0${d.slice(3)}`;
  if (d.startsWith('5') && d.length === 9) d = `0${d}`;
  return d === '' ? null : d;
}

export const leadInputSchema = z.object({
  full_name: z.string().trim().min(1, 'اسم العميل مطلوب'),
  phone: z
    .string()
    .regex(/^05\d{8}$/, 'الجوال بصيغة 05xxxxxxxx')
    .nullable(),
  source_code: z.string().nullable(),
  service_code: z.string().nullable(),
  stage_code: z.string().min(1, 'اختر المرحلة'),
  est_value: z
    .number({ error: 'القيمة المتوقعة رقم' })
    .finite('القيمة المتوقعة رقم')
    .min(0, 'القيمة المتوقعة لا تكون سالبة'),
  notes: z.string().nullable(),
});

const clean = <T extends Partial<LeadInput>>(input: T): T => ({
  ...input,
  ...('full_name' in input ? { full_name: input.full_name?.trim() } : {}),
  ...('phone' in input ? { phone: normalizeSaudiPhone(input.phone) } : {}),
  ...('notes' in input ? { notes: input.notes?.trim() || null } : {}),
});

/** أول خطأ في بيانات العميل المحتمل، أو `null`. */
export function leadInputError(input: LeadInput): string | null {
  const r = leadInputSchema.safeParse(clean(input));
  return r.success ? null : (r.error.issues[0]?.message ?? 'بيانات غير صالحة');
}

export function parseLeadInput(input: LeadInput): LeadInput {
  const c = clean(input);
  const r = leadInputSchema.safeParse(c);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'بيانات غير صالحة');
  return c;
}

export function parseLeadPatch(patch: Partial<LeadInput>): Partial<LeadInput> {
  const c = clean(patch);
  const r = leadInputSchema.partial().safeParse(c);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'بيانات غير صالحة');
  return c;
}
