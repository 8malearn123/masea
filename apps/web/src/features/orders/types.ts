export type {
  Order,
  OrderStatus,
  OrderServiceCode,
  Driver,
  DriverStatus,
  TripStage,
} from '@/features/orders/schemas/order.schema';

import type { OrderStatus } from '@/features/orders/schemas/order.schema';

export interface OrderFilters {
  status: OrderStatus | 'all';
  branch: string | 'all';
  search: string;
}
