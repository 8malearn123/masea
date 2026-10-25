import { z } from 'zod';
import { buildPeriod, isValidDay, periodLabel, today } from '@/features/requests/lib/period';
import { DURATION_UNITS } from '@/lib/orderTypes';
import type { PeriodUnit } from '@/features/requests/types';
import { configValue, type ConfigItem } from '@/features/settings/api/settings.api';
import {
  COMMERCIAL_CODE,
  FACILITY_CODE,
  HOME_CODE,
  OCCASION_BENEFICIARY_CODE,
  OTHER_OCCASION_CODE,
} from '@/features/requests/types';

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

/** حقول خطوة «المستفيد» — بقية المسارات تخص خطوة «مكان الخدمة». */
export const BENEFICIARY_FIELDS = ['beneficiaryType', 'occasionType', 'customOccasionType'];

/**
 * نوع المستفيد وتفاصيل مكان الخدمة: قواعد شرطية بحسب النوع المختار — لا يُطلب
 * إلا ما يظهر للمستخدم. الحدود العليا تمنع القيم غير المنطقية.
 */
export const placeDetailsSchema = z
  .object({
    beneficiaryType: z.string(),
    occasionType: z.string().nullable(),
    customOccasionType: z.string(),
    floors: z.number(),
    rooms: z.number(),
    hasChildren: z.boolean().nullable(),
    children: z.number(),
    hasElderly: z.boolean().nullable(),
    elderlyCareNeeded: z.boolean().nullable(),
    facilityType: z.string(),
    sections: z.number(),
    businessType: z.string(),
    branchesCount: z.number(),
    eventDate: z.string(),
    guests: z.number(),
  })
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const count = (path: keyof typeof p, min: number, max: number, message: string) => {
      const v = p[path];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) issue(path, message);
    };

    if (!p.beneficiaryType) {
      issue('beneficiaryType', 'اختر نوع المستفيد من الخدمة.');
      return;
    }
    switch (p.beneficiaryType) {
      case HOME_CODE:
        count('floors', 1, 8, 'عدد الأدوار رقم موجب بين ١ و٨.');
        count('rooms', 1, 30, 'عدد الغرف رقم موجب بين ١ و٣٠.');
        if (p.hasChildren === null) issue('hasChildren', 'حدّد هل يوجد أطفال.');
        if (p.hasChildren) count('children', 1, 12, 'أدخل عدد الأطفال (١ على الأقل).');
        if (p.hasElderly === null) issue('hasElderly', 'حدّد هل يوجد كبار سن.');
        if (p.hasElderly && p.elderlyCareNeeded === null)
          issue('elderlyCareNeeded', 'حدّد هل يحتاج كبار السن إلى رعاية.');
        break;
      case FACILITY_CODE:
        if (p.facilityType.trim().length < 2) issue('facilityType', 'اكتب نوع المنشأة.');
        count('sections', 1, 50, 'عدد الأقسام رقم موجب بين ١ و٥٠.');
        count('guests', 1, 1000, 'أدخل عدد المستفيدين أو الموظفين (١ على الأقل).');
        break;
      case COMMERCIAL_CODE:
        if (p.businessType.trim().length < 2) issue('businessType', 'اكتب نوع النشاط.');
        count('branchesCount', 1, 50, 'عدد الفروع رقم موجب بين ١ و٥٠.');
        count('guests', 1, 1000, 'أدخل عدد الأشخاص المطلوب خدمتهم (١ على الأقل).');
        break;
      case OCCASION_BENEFICIARY_CODE:
        if (!p.occasionType) issue('occasionType', 'اختر نوع المناسبة.');
        else if (p.occasionType === OTHER_OCCASION_CODE && p.customOccasionType.trim().length < 2)
          issue('customOccasionType', 'اكتب نوع المناسبة.');
        if (p.eventDate && !isValidDay(p.eventDate)) issue('eventDate', 'تاريخ المناسبة غير صالح.');
        else if (p.eventDate && p.eventDate < today())
          issue('eventDate', 'تاريخ المناسبة لا يكون في الماضي.');
        count('guests', 1, 2000, 'أدخل عدد الحضور التقريبي (١ على الأقل).');
        break;
      default:
        break; // نوع يضيفه الإداري بلا حقول خاصة
    }
  });

/** أول رسالة لخطوة في المعالج: «beneficiary» أو «place». */
export function placeStepIssue(place: unknown, step: 'beneficiary' | 'place'): string | null {
  const res = placeDetailsSchema.safeParse(place);
  if (res.success) return null;
  const found = res.error.issues.find((i) => {
    const inBeneficiary = BENEFICIARY_FIELDS.includes(String(i.path[0]));
    return step === 'beneficiary' ? inBeneficiary : !inBeneficiary;
  });
  return found?.message ?? null;
}

/**
 * حدود مدة الطلب — من إعدادات النظام (`request_max_days`، `request_max_months`)،
 * وهذه القيم احتياطية فقط عند تعذّر قراءة الإعدادات.
 */
export interface DurationLimits {
  maxDays: number;
  maxMonths: number;
}
export const DURATION_LIMITS_FALLBACK: DurationLimits = { maxDays: 30, maxMonths: 24 };

/** الحدود من قيم الإعدادات (المفتاحان قابلان للتعديل من شاشة الإعدادات). */
export function durationLimitsFrom(config: ConfigItem[]): DurationLimits {
  const read = (key: string, fallback: number) => {
    const v = configValue(config, key, fallback);
    return Number.isInteger(v) && v >= 1 ? v : fallback;
  };
  return {
    maxDays: read('request_max_days', DURATION_LIMITS_FALLBACK.maxDays),
    maxMonths: read('request_max_months', DURATION_LIMITS_FALLBACK.maxMonths),
  };
}

/**
 * عند الإرسال لا يُعاد فحص الحد الأعلى: خدمة الطلبات التجريبية لا تقرأ الإعدادات
 * (معزولة عن أي مصدر بيانات)، والحد المضبوط يُفرض في المعالج. الباقي يُفحص كاملًا.
 */
const SUBMIT_LIMITS: DurationLimits = { maxDays: Infinity, maxMonths: Infinity };

/** أقصى عدد لوحدة المدة: الأسابيع مشتقة من أقصى عدد أيام. */
export function maxDurationCount(unit: PeriodUnit, limits: DurationLimits): number {
  if (unit === 'day') return limits.maxDays;
  if (unit === 'week') return Math.max(1, Math.floor(limits.maxDays / 7));
  return limits.maxMonths;
}

/**
 * مدة الطلب: تاريخ البداية + وحدة + عدد. تاريخ النهاية لا يُدخل — يُحسب دائمًا
 * من `computeEndDate` (period.ts)، والتحقق هنا يضمن أنه منطقي.
 */
export function durationSchema(limits: DurationLimits, todayIso: string = today()) {
  return z
    .object({
      service: z.enum(SERVICE_CODES),
      startDate: z.string(),
      durationUnit: z.string(),
      // unknown: NaN/نص تُرفض برسالة عربية في التحقق أدناه لا برسالة Zod العامة
      count: z.unknown(),
    })
    .superRefine((d, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (!d.startDate) issue('startDate', 'حدّد تاريخ بداية الخدمة.');
      else if (!isValidDay(d.startDate)) issue('startDate', 'تاريخ بداية الخدمة غير صالح.');
      else if (d.startDate < todayIso) issue('startDate', 'تاريخ بداية الخدمة لا يكون في الماضي.');

      const allowed: string[] = DURATION_UNITS[d.service];
      if (!allowed.includes(d.durationUnit)) {
        issue('durationUnit', 'اختر وحدة مدة متاحة لهذه الخدمة.');
        return;
      }
      const unit = d.durationUnit as PeriodUnit;
      const max = maxDurationCount(unit, limits);
      const count = typeof d.count === 'number' ? d.count : Number.NaN;
      if (!Number.isInteger(count) || count < 1) {
        issue('count', 'مدة الخدمة رقم صحيح موجب (١ على الأقل).');
      } else if (count > max) {
        const label = periodLabel(buildPeriod('', unit, max));
        issue('count', `أقصى مدة لهذه الخدمة ${label}.`);
      } else if (isValidDay(d.startDate)) {
        const { endDate } = buildPeriod(d.startDate, unit, count);
        if (!isValidDay(endDate) || endDate < d.startDate) {
          issue('count', 'تاريخ نهاية الخدمة لا يسبق تاريخ البداية.');
        }
      }
    });
}

/** خدمات تُطلب بمدة من المعالج (الاستقدام مدته مدة العقد في خطوة الباقة). */
const DURATION_SERVICES = new Set(['daily_rental', 'monthly_rental']);

/** مدخلات المدة من مسودة الطلب (العدد الخام قبل أي تصحيح، ليُكشف الصفر والسالب). */
export function draftDuration(d: {
  service: string;
  startDate: string;
  durationUnit?: string | undefined;
  days?: unknown;
  months?: unknown;
}) {
  return {
    service: d.service,
    startDate: d.startDate,
    durationUnit: d.durationUnit ?? '',
    count: (d.service === 'daily_rental' ? d.days : d.months) ?? 0,
  };
}

/** أول رسالة في مدة الطلب، أو null إذا كانت صالحة. */
export function durationIssue(
  draft: Parameters<typeof draftDuration>[0],
  limits: DurationLimits,
  todayIso?: string,
): string | null {
  const res = durationSchema(limits, todayIso).safeParse(draftDuration(draft));
  return res.success ? null : firstIssue(res.error);
}

/** الحد الأدنى من مدخلات إنشاء الطلب كما تصل إلى RequestService.submit. */
export const submitRequestSchema = z.object({
  clientToken: z.string().min(8, { message: 'معرّف الإرسال مفقود' }),
  serviceName: z.string().min(1, { message: 'اسم الخدمة مفقود' }),
  price: amountsSchema,
  draft: customerContactSchema
    .extend({
      service: z.enum(SERVICE_CODES, { message: 'نوع الخدمة غير معروف' }),
      startDate: z
        .string()
        .refine((v) => v === '' || isValidDay(v), { message: 'تاريخ البداية غير صالح' }),
      durationUnit: z.string().optional(),
      days: z.unknown().optional(),
      months: z.unknown().optional(),
      // يُتحقق من المكان متى اختير نوع المستفيد (مسودات مركز الاتصال بلا مكان)
      place: z.unknown().superRefine((place, ctx) => {
        const p = place as { beneficiaryType?: unknown } | null;
        if (!p || !p.beneficiaryType) return;
        const res = placeDetailsSchema.safeParse(place);
        if (!res.success) {
          for (const i of res.error.issues) {
            ctx.addIssue({ code: 'custom', message: i.message, path: [...i.path] });
          }
        }
      }),
    })
    // المدة تُتحقق متى حُدّد تاريخ البداية (مركز الاتصال قد يبيع قبل تحديد الموعد)
    .superRefine((draft, ctx) => {
      if (!DURATION_SERVICES.has(draft.service) || !draft.startDate) return;
      const res = durationSchema(SUBMIT_LIMITS).safeParse(draftDuration(draft));
      if (!res.success) {
        for (const i of res.error.issues) {
          ctx.addIssue({ code: 'custom', message: i.message, path: [...i.path] });
        }
      }
    }),
});

/** أول رسالة خطأ من نتيجة Zod (للعرض للمستخدم). */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'بيانات الطلب غير مكتملة';
}
