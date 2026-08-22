import { describe, expect, it } from 'vitest';
import {
  listHousingScans,
  listMyHousingTargets,
  logHousingScan,
  markAttendance,
  resolveWorkerByBarcode,
} from '@/features/housing/api/housing.api';

describe('housing supervisor: attendance, scan & targets', () => {
  it('resolves a worker by barcode or iqama number', () => {
    expect(resolveWorkerByBarcode('MAS-W-1001')?.full_name).toBe('ماريا سانتوس');
    expect(resolveWorkerByBarcode('2412345678')?.full_name).toBe('ماريا سانتوس'); // iqama
    expect(resolveWorkerByBarcode('UNKNOWN')).toBeNull();
  });

  it('takes attendance and updates the worker status', async () => {
    await markAttendance('r7', 'present');
    // re-resolving reflects the optimistic demo update
    expect(resolveWorkerByBarcode('MAS-W-1007')?.status).toBe('present');
  });

  it('logs a dorm entry scan and appends it to the worker log', async () => {
    const before = (await listHousingScans('r3')).length;
    const worker = await logHousingScan('MAS-W-1003', 'in', 'رجعت من الإجازة');
    expect(worker.full_name).toBe('غريس وانجيرو');
    const after = await listHousingScans('r3');
    expect(after.length).toBe(before + 1);
    expect(after[0]?.direction).toBe('in'); // newest first
  });

  it('rejects scanning an unknown barcode', async () => {
    await expect(logHousingScan('NOPE', 'in', null)).rejects.toThrow();
  });

  it('exposes the housing targets assigned to the supervisor', async () => {
    const targets = await listMyHousingTargets();
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]?.occupancy_target_pct).toBeGreaterThan(0);
    expect(targets[0]?.attendance_target_pct).toBeGreaterThan(0);
  });
});
