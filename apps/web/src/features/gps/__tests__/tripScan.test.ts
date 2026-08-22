import { describe, expect, it } from 'vitest';
import { listMyTripScans, logTripScan } from '@/features/gps/api/gps.api';

describe('driver trip barcode scans', () => {
  it('logs the four trip legs for a worker resolved by barcode', async () => {
    const before = (await listMyTripScans()).length;
    for (const t of ['warehouse_out', 'customer_arrived', 'service_end', 'warehouse_in']) {
      const r = await logTripScan('MAS-W-1001', t);
      expect(r.worker_name).toBe('ماريا سانتوس');
    }
    const after = await listMyTripScans();
    expect(after.length).toBe(before + 4);
    // newest first
    expect(after[0]?.scan_type).toBe('warehouse_in');
  });

  it('resolves a worker by iqama number too', async () => {
    const r = await logTripScan('2412345678', 'warehouse_out');
    expect(r.worker_name).toBe('ماريا سانتوس');
  });

  it('rejects an unknown barcode', async () => {
    await expect(logTripScan('NOPE', 'warehouse_out')).rejects.toThrow();
  });
});
