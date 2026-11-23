import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import { createDraft, transitionContract } from '@/features/contracts/api/contracts.api';
import { resetContractOpsDemo } from '@/features/contracts/api/contractOps.api';
import {
  createDriverTask,
  driverAvailability,
  driverTaskStep,
  listDriverTasks,
  listWorkerCandidates,
  resetDriverTasksDemo,
  workerHistory,
} from '@/features/contracts/api/workersDrivers.api';
import { listDrivers } from '@/features/orders/api/orders.api';

beforeEach(() => {
  resetContractOpsDemo();
  resetDriverTasksDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const worker = FALLBACK_WORKERS[0]!;
async function liveContract(start: string, end: string) {
  const c = await createDraft({
    service_code: 'monthly_rental',
    customer_id: 'cust-1',
    customer_name: 'محمد الأحمدي',
    worker_profile_id: worker.id,
    worker_name: worker.full_name,
    branch: 'نجران',
    start_date: start,
    end_date: end,
    quantity: 1,
    nationality: worker.nationality,
  });
  await transitionContract(c.id, 'pending_approval');
  return c;
}

describe('workers inside the contract (0095 mirror)', () => {
  it('shows a booked worker as unavailable for an overlapping period, available later', async () => {
    const c = await liveContract('2027-05-01', '2027-05-31');
    const during = (await listWorkerCandidates('monthly_rental', '2027-05-10', '2027-05-20')).find(
      (w) => w.id === worker.id,
    );
    expect(during?.available).toBe(false);
    expect(during?.reason).toContain(c.contract_no ?? '');
    const later = (await listWorkerCandidates('monthly_rental', '2027-07-01', '2027-07-31')).find(
      (w) => w.id === worker.id,
    );
    expect(later?.available).toBe(true);
    expect(
      (await workerHistory(worker.id)).some((h) => h.kind === 'contract' && h.contract_id === c.id),
    ).toBe(true);
  });
});

describe('driver tasks (0095 mirror)', () => {
  it('never books one driver on two overlapping tasks and records the execution', async () => {
    const c = await liveContract('2027-06-01', '2027-06-30');
    const [d1, d2] = (await listDrivers()).filter((d) => d.is_active);
    const at = (h: string) => `2027-06-01T${h}:00:00.000Z`;
    await createDriverTask({
      contractId: c.id,
      kind: 'delivery',
      startsAt: at('06'),
      endsAt: at('07'),
      driverId: d1!.id,
    });
    await expect(
      createDriverTask({
        contractId: c.id,
        kind: 'pickup',
        startsAt: at('06'),
        endsAt: at('08'),
        driverId: d1!.id,
      }),
    ).rejects.toThrow('مشغول');
    const slots = await driverAvailability(at('06'), at('07'));
    expect(slots.find((s) => s.id === d1!.id)?.busy).toBe(true);
    expect(slots.find((s) => s.id === d2!.id)?.busy).toBe(false);

    await createDriverTask({
      contractId: c.id,
      kind: 'pickup',
      startsAt: at('08'),
      endsAt: at('09'),
      driverId: null,
    });
    const [delivery, pickup] = await listDriverTasks(c.id);
    expect(pickup?.status).toBe('pending');
    await expect(driverTaskStep(pickup!, 'assign', d1!.id)).resolves.toBeUndefined();
    await driverTaskStep(delivery!, 'start');
    await driverTaskStep(delivery!, 'done', null, 'سُلّمت');
    const after = (await listDriverTasks(c.id)).find((t) => t.id === delivery!.id);
    expect(after?.status).toBe('done');
    expect(after?.done_at).not.toBeNull();
  });
});
