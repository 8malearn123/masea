import { z } from 'zod';

/**
 * Saudi identity / bank rules for the employee file — the frontend mirror of
 * the 0069 CHECK constraints, plus the check digits the DB does not verify.
 */

/** National ID (starts 1) / Iqama (starts 2): 10 digits + Luhn check digit. */
export function isValidSaudiId(id: string): boolean {
  if (!/^[12]\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = Number(id[i]);
    if (i % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else {
      sum += d;
    }
  }
  return sum % 10 === 0;
}

/** Saudi IBAN: SA + 22 digits, ISO 13616 mod-97 = 1. Spaces are ignored. */
export function normalizeIban(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase();
}
export function isValidSaudiIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^SA\d{22}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

export const SAUDI_MOBILE = /^05\d{8}$/;

const optionalText = z.string().trim().optional().or(z.literal(''));

/**
 * The editable employee file. `idNumber` is the national ID for Saudis and the
 * iqama for expats. Check digits are enforced on new/changed values only, so a
 * legacy record never blocks an unrelated edit.
 */
export function employeeFormSchema(opts: { initialId?: string; initialIban?: string } = {}) {
  return z
    .object({
      full_name: z.string().trim().min(3, { message: 'الاسم الكامل مطلوب' }),
      english_name: optionalText,
      nationality: z.string().min(1),
      id_number: z.string().trim(),
      passport_no: optionalText,
      dob: optionalText,
      gender: z.enum(['male', 'female']).optional(),
      marital_status: optionalText,
      phone: z
        .string()
        .trim()
        .regex(SAUDI_MOBILE, { message: 'رقم جوال سعودي: 05 ثم 8 أرقام' })
        .or(z.literal('')),
      email: z.string().trim().email({ message: 'بريد غير صحيح' }).or(z.literal('')),
      job_title: z.string().trim().min(2, { message: 'المسمى الوظيفي مطلوب' }),
      department: z.string().min(1),
      branch: z.string().min(1),
      join_date: z.string().min(1, { message: 'تاريخ التعيين مطلوب (تُحتسب منه نهاية الخدمة)' }),
      contract_type: z.enum(['full_time', 'part_time', 'temp']),
      manager_id: optionalText,
      base_salary: z.number({ message: 'أدخل رقمًا' }).min(0),
      housing_allowance: z.number({ message: 'أدخل رقمًا' }).min(0, { message: 'لا يقل عن صفر' }),
      transport_allowance: z.number({ message: 'أدخل رقمًا' }).min(0, { message: 'لا يقل عن صفر' }),
      other_allowance: z.number({ message: 'أدخل رقمًا' }).min(0, { message: 'لا يقل عن صفر' }),
      iban: z.string().trim(),
      bank_name: optionalText,
      gosi_system: z.enum(['old', 'new']),
      gosi_reg_date: optionalText,
      user_id: optionalText,
    })
    .superRefine((v, ctx) => {
      const saudi = v.nationality === 'السعودية';
      if (v.id_number) {
        const prefix = saudi ? '1' : '2';
        if (!v.id_number.startsWith(prefix) || !/^\d{10}$/.test(v.id_number)) {
          ctx.addIssue({
            code: 'custom',
            path: ['id_number'],
            message: saudi ? 'الهوية الوطنية 10 أرقام تبدأ بـ 1' : 'رقم الإقامة 10 أرقام يبدأ بـ 2',
          });
        } else if (v.id_number !== opts.initialId && !isValidSaudiId(v.id_number)) {
          ctx.addIssue({
            code: 'custom',
            path: ['id_number'],
            message: 'رقم الهوية غير صحيح (رقم التحقق)',
          });
        }
      }
      const iban = normalizeIban(v.iban);
      if (iban && iban !== normalizeIban(opts.initialIban ?? '')) {
        if (!/^SA\d{22}$/.test(iban)) {
          ctx.addIssue({ code: 'custom', path: ['iban'], message: 'الآيبان: SA ثم 22 رقمًا' });
        } else if (!isValidSaudiIban(iban)) {
          ctx.addIssue({
            code: 'custom',
            path: ['iban'],
            message: 'الآيبان غير صحيح (رقم التحقق)',
          });
        }
      }
      if (iban && !v.bank_name) {
        ctx.addIssue({ code: 'custom', path: ['bank_name'], message: 'اختر البنك' });
      }
    });
}

export type EmployeeFormValues = z.infer<ReturnType<typeof employeeFormSchema>>;

/** Saudi banks paying salaries (WPS) — the bank list for the IBAN. */
export const SAUDI_BANKS = [
  'الراجحي',
  'الأهلي السعودي',
  'الرياض',
  'الإنماء',
  'البلاد',
  'الجزيرة',
  'العربي الوطني',
  'ساب',
  'السعودي الفرنسي',
  'الاستثمار',
] as const;
