import { describe, expect, it } from 'vitest';
import {
  DRIVER_STATUS_LABEL,
  nextOrderStatuses,
  ORDER_STATUS_LABEL,
} from '@/features/orders/lib/orderStatus';

describe('order status transitions', () => {
  it('offers assign/cancel for new & paid orders', () => {
    expect(nextOrderStatuses('new')).toContain('assigned');
    expect(nextOrderStatuses('paid')).toContain('assigned');
  });

  it('moves assigned → in_progress → completed', () => {
    expect(nextOrderStatuses('assigned')).toContain('in_progress');
    expect(nextOrderStatuses('in_progress')).toContain('completed');
  });

  it('has no transitions out of terminal states', () => {
    expect(nextOrderStatuses('completed')).toEqual([]);
    expect(nextOrderStatuses('cancelled')).toEqual([]);
  });

  it('labels every status in Arabic', () => {
    expect(ORDER_STATUS_LABEL.assigned).toBe('مُسند');
    expect(DRIVER_STATUS_LABEL.on_route).toBe('في مهمة');
  });
});
