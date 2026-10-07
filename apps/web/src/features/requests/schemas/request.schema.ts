import { z } from 'zod';
import { isValidDay } from '@/features/requests/lib/period';

/**
 * التحقق من الطلب قبل الإرسال — نفس القواعد لكل مصادر الطلب (المعالج، مركز
 * الاتصال) ولكل تنفيذ لخدمة الطلبات (Mock اليوم، Supabase لاحقًا). قواعد كل خطوة
 * في المعالج تبقى في StepWizard؛ هنا الحد الأدنى الذي لا يُقبل طلب بدونه.
 */

/** جوال سعودي بأي صيغة شائعة → 05XXXXXXXX، أو null إن لم يكن جوالًا سعوديًا. */
export function normalizeSaudiMobile(raw: string): string | null {
  const digits = raw
    .replace(/[\s\-()]/g, '')
    .replace(/^\+/, '')
    .replace(/^00/, '');
  const m = /^(?:966|0)?(5\d{8})$/.exec(digits);
  return m ? `0${m[1]}` : null;
}

export const SERVICE_CODES = [
  'recruitment',
  'monthly_rental',
  'daily_rental',
  'sponsorship_transfer',
] as const;

export const customerNameSchema = z
  .string()
  .trim()
  .min(3, { message: 'أدخل الاسم الكامل (٣ أحرف على الأقل)' });

export const mobileSchema = z
  .string()
  .trim()
  .min(1, { message: 'أدخل رقم الجوال' })
  .refine((v) => normalizeSaudiMobile(v) !== null, {
    message: 'رقم الجوال غير صحيح — مثال: 0501234567',
  })
  .transform((v) => normalizeSaudiMobile(v) as string);

/** الهوية الوطنية / الإقامة اختيارية، وإن أُدخلت فـ ١٠ أرقام تبدأ بـ ١ أو ٢. */
export const nationalIdSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[12]\d{9}$/.test(v), {
    message: 'رقم الهوية/الإقامة ١٠ أرقام يبدأ بـ 1 أو 2',
  });

/** بيانات العميل/صاحب العمل — تستخدمها خطوة العميل في المعالج وخدمة الطلبات. */
export const customerContactSchema = z.object({
  customerName: customerNameSchema,
  phone: mobileSchema,
  nationalId: nationalIdSchema,
});

const amountsSchema = z
  .object({
    base: z.number().nonnegative(),
    vat: z.number().nonnegative(),
    total: z.number().nonnegative(),
  })
  .refine((a) => Math.abs(a.base + a.vat - a.total) < 0.01, {
    message: 'إجمالي الطلب لا يطابق المبلغ والضريبة',
  });

/** الحد الأدنى من مدخلات إنشاء الطلب كما تصل إلى RequestService.submit. */
export const submitRequestSchema = z.object({
  clientToken: z.string().min(8, { message: 'معرّف الإرسال مفقود' }),
  serviceName: z.string().min(1, { message: 'اسم الخدمة مفقود' }),
  price: amountsSchema,
  draft: customerContactSchema.extend({
    service: z.enum(SERVICE_CODES, { message: 'نوع الخدمة غير معروف' }),
    startDate: z
      .string()
      .refine((v) => v === '' || isValidDay(v), { message: 'تاريخ البداية غير صالح' }),
  }),
});

/** أول رسالة خطأ من نتيجة Zod (للعرض للمستخدم). */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'بيانات الطلب غير مكتملة';
}
