import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo } from '@/lib/demo';
import {
  createDraft,
  getContract,
  transitionContract,
} from '@/features/contracts/api/contracts.api';
import {
  isLiveStatus,
  periodsOverlap,
  workerConflict,
} from '@/features/contracts/lib/workerAllocation';

afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('worker allocation (0089 mirror)', () => {
  it('treats drafts, completed and cancelled contracts as not holding the worker', () => {
    expect(isLiveStatus('draft')).toBe(false);
    expect(isLiveStatus('pending_approval')).toBe(true);
    expect(isLiveStatus('active')).toBe(true);
    expect(isLiveStatus('completed')).toBe(false);
    expect(isLiveStatus('cancelled')).toBe(false);
  });

  it('detects inclusive and open-ended overlaps', () => {
    expect(periodsOverlap('2026-12-01', '2026-12-30', '2026-12-30', '2027-01-10')).toBe(true);
    expect(periodsOverlap('2026-12-01', '2026-12-30', '2026-12-31', '2027-01-10')).toBe(false);
    expect(periodsOverlap('2026-12-01', null, '2030-01-01', '2030-01-02')).toBe(true);
  });

  it('finds the live contract that holds the worker, ignoring the contract itself', () => {
    const rows = [
      {
        id: 'a',
        contract_no: 'MR-1',
        status: 'active' as const,
        start_date: '2026-12-01',
        end_date: '2026-12-30',
        worker_profile_id: 'w1',
      },
      {
        id: 'b',
        contract_no: 'MR-2',
        status: 'draft' as const,
        start_date: '2026-12-10',
        end_date: '2026-12-20',
        worker_profile_id: 'w1',
      },
    ];
    expect(workerConflict(rows, 'w1', '2026-12-15', '2026-12-16', 'b')?.id).toBe('a');
    expect(workerConflict(rows, 'w1', '2026-12-15', '2026-12-16', 'a')).toBeNull();
    expect(workerConflict(rows, 'w2', '2026-12-15', '2026-12-16')).toBeNull();
  });

  it('blocks a second overlapping contract for the same worker from going live (demo)', async () => {
    const base = {
      service_code: 'monthly_rental' as const,
      customer_id: 'cust-1',
      customer_name: 'محمد الأحمدي',
      worker_profile_id: 'wp-alloc-1',
      worker_name: 'سيتي نورحليزة',
      branch: 'نجران',
      quantity: 1,
      nationality: 'إندونيسيا',
    };
    const a = await createDraft({ ...base, start_date: '2027-03-01', end_date: '2027-03-31' });
    const b = await createDraft({ ...base, start_date: '2027-03-15', end_date: '2027-04-14' });
    const c = await createDraft({ ...base, start_date: '2027-05-01', end_date: '2027-05-31' });
    expect((await getContract(a.id))?.worker_profile_id).toBe('wp-alloc-1');

    await transitionContract(a.id, 'pending_approval');
    await expect(transitionContract(b.id, 'pending_approval')).rejects.toThrow('محجوزة');
    await transitionContract(c.id, 'pending_approval'); // no overlap
    // once A is cancelled the worker is free for B
    await transitionContract(a.id, 'cancelled');
    await transitionContract(b.id, 'pending_approval');
    expect((await getContract(b.id))?.status).toBe('pending_approval');
  });
});
