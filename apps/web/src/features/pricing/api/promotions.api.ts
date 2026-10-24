import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import type { Promotion } from '@/shared/lib/pricing';

/**
 * Predefined discounts (supabase `promotions`, 0020 + 0051). The only source of
 * a discount on a quote or contract — managed here (add / edit / disable), never
 * typed freely on the order. Demo mode keeps an in-memory store.
 */

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(3, { message: 'اسم الخصم مطلوب (3 أحرف على الأقل)' }),
    code: z
      .string()
      .trim()
      .max(20, { message: 'الرمز طويل' })
      .regex(/^[A-Za-z0-9_-]*$/, { message: 'الرمز حروف إنجليزية وأرقام فقط' })
      .transform((v) => (v ? v.toUpperCase() : null)),
    description: z
      .string()
      .trim()
      .transform((v) => v || null),
    kind: z.enum(['pct', 'amount']),
    value: z.number({ message: 'أدخل قيمة الخصم' }).positive({ message: 'القيمة أكبر من صفر' }),
    service_codes: z.array(z.string()),
    min_base_amount: z.number().nonnegative().nullable(),
    max_discount_amount: z.number().positive({ message: 'السقف أكبر من صفر' }).nullable(),
    starts_at: z.string().nullable(),
    ends_at: z.string().nullable(),
    usage_limit: z.number().int().positive({ message: 'الحد عدد صحيح موجب' }).nullable(),
    is_active: z.boolean(),
  })
  .refine((v) => v.kind === 'amount' || v.value <= 100, {
    message: 'النسبة لا تتجاوز 100٪',
    path: ['value'],
  })
  .refine((v) => !v.starts_at || !v.ends_at || v.starts_at <= v.ends_at, {
    message: 'تاريخ الانتهاء قبل تاريخ البدء',
    path: ['ends_at'],
  });

export type PromotionInput = z.input<typeof promotionInputSchema>;

/** Convert a validated form into the stored promotion row shape. */
export function toPromotionRow(
  input: z.output<typeof promotionInputSchema>,
): Omit<Promotion, 'id' | 'usage_count'> {
  return {
    name: input.name,
    code: input.code,
    description: input.description,
    discount_pct: input.kind === 'pct' ? input.value : null,
    discount_amount: input.kind === 'amount' ? input.value : null,
    service_codes: input.service_codes,
    min_base_amount: input.min_base_amount,
    // a cap only makes sense for a percentage
    max_discount_amount: input.kind === 'pct' ? input.max_discount_amount : null,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    usage_limit: input.usage_limit,
    is_active: input.is_active,
  };
}

// Mirrors the 0020/0051 seed — realistic Masiat Alsharq discounts.
const STORE: Promotion[] = [
  {
    id: 'pm-1',
    name: 'خصم الطلب الأول',
    code: 'FIRST10',
    description: 'خصم لأول عقد للعميل الجديد.',
    discount_pct: 10,
    discount_amount: null,
    service_codes: [],
    min_base_amount: null,
    max_discount_amount: 1500,
    starts_at: null,
    ends_at: null,
    usage_limit: null,
    usage_count: 14,
    is_active: true,
  },
  {
    id: 'pm-2',
    name: 'خصم اليوم الوطني — استقدام',
    code: 'NATIONAL95',
    description: 'خصم موسمي على عقود الاستقدام خلال فترة اليوم الوطني.',
    discount_pct: 5,
    discount_amount: null,
    service_codes: ['recruitment'],
    min_base_amount: 10000,
    max_discount_amount: 1000,
    starts_at: null,
    ends_at: null,
    usage_limit: 200,
    usage_count: 37,
    is_active: true,
  },
  {
    id: 'pm-3',
    name: 'خصم التأجير الشهري الطويل',
    code: 'RENT6M',
    description: 'خصم ثابت على عقود التأجير الشهري التي لا تقل عن 6 أشهر.',
    discount_pct: null,
    discount_amount: 500,
    service_codes: ['monthly_rental'],
    min_base_amount: 12000,
    max_discount_amount: null,
    starts_at: null,
    ends_at: null,
    usage_limit: null,
    usage_count: 9,
    is_active: true,
  },
  {
    id: 'pm-4',
    name: 'عرض الساعة — تأجير شهري',
    code: null,
    description: 'عرض محدود انتهت مدته.',
    discount_pct: 15,
    discount_amount: null,
    service_codes: ['monthly_rental'],
    min_base_amount: null,
    max_discount_amount: null,
    starts_at: '2026-06-01T00:00:00Z',
    ends_at: '2026-06-30T23:59:59Z',
    usage_limit: null,
    usage_count: 22,
    is_active: false,
  },
];

const COLUMNS =
  'id, name, code, description, discount_pct, discount_amount, service_codes, min_base_amount, max_discount_amount, starts_at, ends_at, usage_limit, usage_count, is_active';

function normalize(r: Record<string, unknown>): Promotion {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    code: (r.code as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    discount_pct: num(r.discount_pct),
    discount_amount: num(r.discount_amount),
    service_codes: (r.service_codes as string[] | null) ?? [],
    min_base_amount: num(r.min_base_amount),
    max_discount_amount: num(r.max_discount_amount),
    starts_at: (r.starts_at as string | null) ?? null,
    ends_at: (r.ends_at as string | null) ?? null,
    usage_limit: num(r.usage_limit),
    usage_count: Number(r.usage_count ?? 0),
    is_active: Boolean(r.is_active),
  };
}

export async function listPromotions(): Promise<Promotion[]> {
  try {
    const { data, error } = await supabase
      .from('promotions')
      .select(COLUMNS)
      .order('created_at', { ascending: false });
    if (!error && data && data.length > 0) {
      return (data as Record<string, unknown>[]).map(normalize);
    }
  } catch {
    /* fall through */
  }
  return STORE.map((p) => ({ ...p, service_codes: [...p.service_codes] }));
}

export async function createPromotion(
  row: Omit<Promotion, 'id' | 'usage_count'>,
): Promise<Promotion> {
  const { data, error } = await supabase
    .from('promotions')
    .insert({ ...row, type: 'manual' })
    .select(COLUMNS)
    .single();
  if (!error && data) return normalize(data as Record<string, unknown>);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  const local: Promotion = { ...row, id: `pm-${Date.now()}`, usage_count: 0 };
  STORE.unshift(local);
  return { ...local };
}

export async function updatePromotion(
  id: string,
  patch: Partial<Omit<Promotion, 'id' | 'usage_count'>>,
): Promise<void> {
  const local = STORE.find((p) => p.id === id);
  if (local) Object.assign(local, patch);
  if (isDemoId(id)) return;
  const { error } = await supabase
    .from('promotions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}
