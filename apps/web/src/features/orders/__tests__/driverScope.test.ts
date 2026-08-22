import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { DEMO_DRIVER_ID, listOrders } from '@/features/orders/api/orders.api';
import type { UserProfile } from '@masiat/shared';

const ALL = { status: 'all', branch: 'all', search: '' } as const;

function loginAs(role: UserProfile['role'], id: string) {
  useAuth.setState({
    profile: { id, full_name: 'اختبار', role, branch_id: null, is_active: true, created_at: '' },
  });
}

afterEach(() => useAuth.setState({ profile: null }));

describe('driver order scoping', () => {
  it('a driver sees ONLY the trips assigned to him', async () => {
    loginAs('driver', DEMO_DRIVER_ID);
    const mine = await listOrders(ALL);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((o) => o.driver_id === DEMO_DRIVER_ID)).toBe(true);
  });

  it('a dispatcher (operations manager) sees the full order book', async () => {
    loginAs('operations_manager', 'demo-operations_manager');
    const all = await listOrders(ALL);
    loginAs('driver', DEMO_DRIVER_ID);
    const mine = await listOrders(ALL);
    expect(all.length).toBeGreaterThan(mine.length);
  });
});
