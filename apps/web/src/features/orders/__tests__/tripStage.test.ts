import { describe, expect, it } from 'vitest';
import { advanceTripStage } from '@/features/orders/api/orders.api';
import { nextStep, stageIndex, tripScanResult } from '@/features/orders/lib/trip';

describe('trip stage advancement from scans', () => {
  it('maps each scan to the right stage + order status', () => {
    expect(tripScanResult('warehouse_out')).toEqual({ stage: 'picked_up', status: 'in_progress' });
    expect(tripScanResult('customer_arrived')).toEqual({
      stage: 'delivered',
      status: 'in_progress',
    });
    expect(tripScanResult('service_end')).toEqual({
      stage: 'return_picked',
      status: 'in_progress',
    });
    expect(tripScanResult('warehouse_in')).toEqual({ stage: 'returned', status: 'completed' });
    expect(tripScanResult('nonsense')).toBeNull();
  });

  it('walks the two legs in order then completes', () => {
    expect(nextStep('none')?.scan).toBe('warehouse_out');
    expect(nextStep('picked_up')?.scan).toBe('customer_arrived');
    expect(nextStep('delivered')?.scan).toBe('service_end');
    expect(nextStep('return_picked')?.scan).toBe('warehouse_in');
    expect(nextStep('returned')).toBeNull();
    expect(stageIndex('returned')).toBe(3);
  });

  it('advancing a demo trip moves its stage + status (worker boarded → in_progress)', async () => {
    const r = await advanceTripStage('o7', 'warehouse_out');
    expect(r).toEqual({ stage: 'picked_up', status: 'in_progress' });
    const done = await advanceTripStage('o7', 'warehouse_in');
    expect(done.status).toBe('completed');
  });
});
