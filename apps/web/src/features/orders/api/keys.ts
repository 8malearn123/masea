import type { OrderFilters } from '@/features/orders/types';

export const orderKeys = {
  all: ['orders'] as const,
  list: (filters: OrderFilters) => ['orders', 'list', filters] as const,
  drivers: () => ['orders', 'drivers'] as const,
};
