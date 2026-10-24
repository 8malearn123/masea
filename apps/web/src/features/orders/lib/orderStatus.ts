import type { BadgeTone } from '@/shared/ui/Badge';
import type {
  DriverStatus,
  Order,
  OrderServiceCode,
  OrderStatus,
} from '@/features/orders/schemas/order.schema';
import { TRIP_STEPS, nextStep, stageIndex, tripScanResult } from '@/features/orders/lib/trip';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'جديد',
  paid: 'مدفوع',
  assigned: 'مُسند',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتمل',
  cancelled: 'ملغى',
};

export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  new: 'neutral',
  paid: 'gold',
  assigned: 'teal',
  in_progress: 'navy',
  completed: 'success',
  cancelled: 'danger',
};

/** Allowed manual status transitions for an order. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['assigned', 'cancelled'],
  paid: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function nextOrderStatuses(status: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[status];
}

/** حالة نهائية: لا انتقال منها (لا إعادة فتح للمكتمل ولا للملغى). */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/** رحلة بدأت ولم تنتهِ بعد (العاملة لم ترجع للسكن). */
export function isTripUnfinished(stage: Order['trip_stage']): boolean {
  return stageIndex(stage) >= 0 && nextStep(stage) !== null;
}

/**
 * مصدر واحد لقواعد تغيير حالة الطلب (يطبّقه `orders.api.ts` على كل مسار كتابة).
 * يُرجع رسالة الرفض بالعربية، أو null إذا كان الانتقال صالحًا:
 *   - المكتمل والملغى نهائيان.
 *   - التغيير اليدوي يتبع `ORDER_TRANSITIONS` حرفيًا.
 *   - «مُسند» يدويًا يتطلب سائقًا مُسندًا فعلًا (الإسناد نفسه عبر «إسناد»).
 *   - لا إكمال يدوي لرحلة بدأت ولم تنتهِ: الإكمال هنا يأتي من مسح الإرجاع للسكن.
 *   - المسح (`via: 'scan'`) يبقي الطلب «قيد التنفيذ» أثناء الرحلة، وما عدا ذلك
 *     يتبع الجدول نفسه (مثلًا: لا «مدفوع» → «مكتمل» بمسح واحد).
 */
export function orderTransitionError(
  order: Pick<Order, 'status' | 'trip_stage' | 'driver_id'>,
  next: OrderStatus,
  via: 'manual' | 'scan' = 'manual',
): string | null {
  if (order.status === 'completed') return 'الطلب مكتمل ولا يمكن إعادة فتحه أو تغيير حالته.';
  if (order.status === 'cancelled') return 'الطلب ملغى ولا يمكن تغيير حالته.';
  const stillInTrip = via === 'scan' && order.status === 'in_progress' && next === 'in_progress';
  if (!stillInTrip && !ORDER_TRANSITIONS[order.status].includes(next)) {
    return `لا يمكن نقل الطلب من «${ORDER_STATUS_LABEL[order.status]}» إلى «${ORDER_STATUS_LABEL[next]}».`;
  }
  if (via === 'manual' && next === 'assigned' && !order.driver_id) {
    return 'لا يمكن جعل الطلب «مُسند» دون سائق: استخدم «إسناد» لاختيار السائق.';
  }
  if (via === 'manual' && next === 'completed' && isTripUnfinished(order.trip_stage)) {
    return 'لا يمكن إكمال الطلب والرحلة لم تنتهِ: يكتمل بمسح إرجاع العاملة للسكن.';
  }
  return null;
}

export const DRIVER_STATUS_LABEL: Record<DriverStatus, string> = {
  available: 'متاح',
  on_route: 'في مهمة',
  off_duty: 'خارج الدوام',
};

export const DRIVER_STATUS_TONE: Record<DriverStatus, BadgeTone> = {
  available: 'success',
  on_route: 'gold',
  off_duty: 'neutral',
};

export const ORDER_SERVICE_LABEL: Record<OrderServiceCode, string> = {
  recruitment: 'استقدام',
  monthly_rental: 'تأجير شهري',
  daily_rental: 'تأجير يومي',
  sponsorship_transfer: 'نقل كفالة',
};

/**
 * مسح الرحلة: قواعد الحالة أعلاه ثم تسلسل `TRIP_STEPS` حرفيًا — الخطوة التالية
 * فقط (`nextStep`)، لا تخطٍّ ولا تكرار ولا رجوع، ولا مسح بعد الإرجاع للسكن.
 * مسح الإرجاع للسكن هو الوحيد الذي يكمل الرحلة (`tripScanResult`).
 */
export function tripScanError(
  order: Pick<Order, 'status' | 'trip_stage' | 'driver_id'>,
  scan: string,
): string | null {
  const result = tripScanResult(scan);
  if (!result) return 'نوع مسح غير صحيح';
  const invalid = orderTransitionError(order, result.status, 'scan');
  if (invalid) return invalid;
  const expected = nextStep(order.trip_stage);
  if (!expected) return 'الرحلة منتهية: لا مسح بعد الإرجاع للسكن.';
  if (scan === expected.scan) return null;
  const done = TRIP_STEPS.slice(0, stageIndex(order.trip_stage) + 1);
  const step = TRIP_STEPS.find((t) => t.scan === scan)!;
  return done.includes(step)
    ? `تم مسح «${step.short}» مسبقًا. الخطوة التالية: «${expected.short}».`
    : `لا يمكن تخطّي خطوات الرحلة. الخطوة التالية: «${expected.short}».`;
}
