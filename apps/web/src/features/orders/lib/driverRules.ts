import { z } from 'zod';
import type { Driver } from '@/features/orders/types';

/**
 * قواعد السائق — مرآة guard_driver (0084). «في مهمة» آلية من الطلبات؛ يدويًا
 * «متاح» أو «خارج الدوام» فقط، ولا تغيير للحالة أو الفرع أو التعطيل وله طلب نشط.
 */
export const driverInputSchema = z.object({
  id: z.string().nullable(),
  full_name: z.string().trim().min(1, 'اسم السائق مطلوب'),
  phone: z
    .string()
    .trim()
    .regex(/^05\d{8}$/, 'الجوال بصيغة 05xxxxxxxx')
    .nullable(),
  branch: z.string().min(1, 'اختر الفرع'),
  vehicle_no: z.string().nullable(),
  /** الحالة اليدوية فقط */
  status: z.enum(['available', 'off_duty', 'on_route']),
  user_id: z.string().nullable(),
  is_active: z.boolean(),
});
export type DriverInput = z.infer<typeof driverInputSchema>;

/** حساب دخول بدور «سائق» ومن يرتبط به حاليًا. */
export interface DriverAccount {
  id: string;
  full_name: string;
  branch: string | null;
  driver_id: string | null;
}

export function driverInputOf(d: Driver): DriverInput {
  return {
    id: d.id,
    full_name: d.full_name,
    phone: d.phone,
    branch: d.branch ?? '',
    vehicle_no: d.vehicle_no,
    status: d.status,
    user_id: d.user_id,
    is_active: d.is_active,
  };
}

/** أول خطأ في حفظ السائق، أو `null`. `busy` = عدد طلباته النشطة. */
export function driverChangeError(
  input: DriverInput,
  ctx: { current: Driver | null; busy: number; accounts: DriverAccount[] },
): string | null {
  const parsed = driverInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'بيانات غير صالحة';
  const cur = ctx.current;
  const becameOnRoute = input.status === 'on_route' && cur?.status !== 'on_route';
  if (becameOnRoute) return 'حالة «في مهمة» تُضبط آليًا عند إسناد طلب';
  if (input.user_id && input.user_id !== cur?.user_id) {
    const acc = ctx.accounts.find((a) => a.id === input.user_id);
    if (!acc || (acc.branch && acc.branch !== input.branch)) {
      return 'الحساب المربوط يجب أن يكون مستخدمًا نشطًا بدور «سائق» من فرع السائق';
    }
    if (acc.driver_id && acc.driver_id !== input.id) return 'هذا الحساب مربوط بسائق آخر';
  }
  if (cur && ctx.busy > 0) {
    const statusOut =
      cur.status === 'on_route' && (input.status !== 'on_route' || !input.is_active);
    if (statusOut) return `السائق في مهمة (${ctx.busy} طلب نشط): تتغيّر حالته عند انتهاء طلباته`;
    if (input.branch !== (cur.branch ?? '')) return 'لا يُنقل السائق لفرع آخر وله طلبات نشطة';
  }
  return null;
}
