/**
 * Worker file rules (0078) — the same checks the database enforces on
 * worker_details (phone, IBAN, birth date) plus the form's own.
 */
import { z } from 'zod';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const optionalDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, { message: 'تاريخ غير صحيح' });

export const workerSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(2, { message: 'اسم العاملة مطلوب' })
      .max(80, { message: 'الاسم طويل جدًا' }),
    nationality: z.string().min(1, { message: 'اختر الجنسية' }),
    profession: z.string().min(1, { message: 'اختر المهنة' }),
    age: z
      .number({ message: 'العمر رقم' })
      .int({ message: 'العمر عدد صحيح' })
      .min(18, { message: 'العمر من 18 سنة' })
      .max(65, { message: 'العمر حتى 65 سنة' }),
    experience_years: z
      .number({ message: 'الخبرة رقم' })
      .min(0, { message: 'الخبرة لا تكون سالبة' })
      .max(45, { message: 'سنوات خبرة غير منطقية' }),
    monthly_salary: z
      .number({ message: 'الراتب رقم' })
      .min(0, { message: 'الراتب لا يكون سالبًا' }),
    branch: z.string().min(1, { message: 'اختر الفرع' }),
    phone: z
      .string()
      .regex(/^(05\d{8})?$/, { message: 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام' }),
    passport_no: z.string().trim().max(20, { message: 'رقم الجواز طويل' }),
    iqama_no: z.string().regex(/^(2\d{9})?$/, { message: 'رقم الإقامة 10 أرقام يبدأ بـ 2' }),
    border_no: z.string().regex(/^(\d{10})?$/, { message: 'رقم الحدود 10 أرقام' }),
    birth_date: optionalDate,
    arrival_date: optionalDate,
    payment_method: z.enum(['bank', 'cash']),
    bank_name: z.string(),
    iban: z.string().regex(/^(SA\d{22})?$/, { message: 'الآيبان يبدأ بـ SA ويليه 22 رقمًا' }),
    account_holder: z.string().max(80, { message: 'اسم صاحب الحساب طويل' }),
  })
  .refine((w) => !w.birth_date || w.birth_date < new Date().toISOString().slice(0, 10), {
    message: 'تاريخ الميلاد يجب أن يكون في الماضي',
    path: ['birth_date'],
  })
  .refine((w) => !w.arrival_date || w.arrival_date <= new Date().toISOString().slice(0, 10), {
    message: 'تاريخ الوصول لا يكون في المستقبل',
    path: ['arrival_date'],
  })
  .refine((w) => w.payment_method === 'cash' || !w.iban || !!w.bank_name, {
    message: 'اختر البنك للآيبان',
    path: ['bank_name'],
  });

export type WorkerFormErrors = Partial<Record<string, string>>;

/** Field → first message (for inline errors under each input). */
export function workerErrors(input: unknown): WorkerFormErrors {
  const r = workerSchema.safeParse(input);
  if (r.success) return {};
  const out: WorkerFormErrors = {};
  r.error.issues.forEach((i) => {
    const k = String(i.path[0] ?? 'form');
    out[k] ??= i.message;
  });
  return out;
}

/** Normalise what people type: IBAN without spaces, upper case. */
export function cleanIban(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase();
}

/** Age in whole years from a birth date (the catalog shows age). */
export function ageFrom(
  birth: string,
  today = new Date().toISOString().slice(0, 10),
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  let age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  if (today.slice(5) < birth.slice(5)) age -= 1;
  return age;
}

export function validatePhoto(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return 'الصورة JPG أو PNG أو WEBP';
  if (file.size > PHOTO_MAX_BYTES) return 'حجم الصورة يتجاوز 5 ميجابايت';
  return null;
}
