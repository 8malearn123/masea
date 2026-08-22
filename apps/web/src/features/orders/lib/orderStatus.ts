import type { BadgeTone } from '@/shared/ui/Badge';
import type {
  DriverStatus,
  OrderServiceCode,
  OrderStatus,
} from '@/features/orders/schemas/order.schema';

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
