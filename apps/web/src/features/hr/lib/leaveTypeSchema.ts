import { z } from 'zod';
import type { LeaveTypeConfig } from '@/features/hr/types';

/** Validation of a leave type (same bounds as the 0070 CHECK constraints). */
const days = z.number({ message: 'أدخل رقمًا' }).int({ message: 'عدد صحيح' }).min(0).nullable();

export const leaveTypeSchema: z.ZodType<LeaveTypeConfig> = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,30}$/, { message: 'رمز إنجليزي صغير بدون مسافات (مثل exam)' }),
  name_ar: z.string().trim().min(2, { message: 'اسم الإجازة مطلوب' }),
  category: z.enum(['annual', 'sick', 'statutory', 'unpaid', 'other']),
  entitlement_days: days,
  entitlement_days_after: days,
  after_years: days,
  sick_partial_days: days,
  sick_partial_pay_pct: z.number().min(0).max(100).nullable(),
  sick_unpaid_days: days,
  paid: z.boolean(),
  deducts_from_annual: z.boolean(),
  gender: z.enum(['male', 'female']).nullable(),
  min_service_months: z.number().int().min(0),
  once_per_service: z.boolean(),
  requires_attachment: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
});
