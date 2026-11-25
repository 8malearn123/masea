import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import {
  createDraft,
  getContract,
  signContract,
  transitionContract,
} from '@/features/contracts/api/contracts.api';
import {
  completeReplacement,
  demoPinReplacementPolicy,
  getReplacementQuota,
  listReplacements,
  listReturns,
  replacementStep,
  requestReplacement,
  resetContractOpsDemo,
  returnStep,
  scheduleReplacement,
} from '@/features/contracts/api/contractOps.api';

/** صورة توقيع بصيغة PNG (يتحقق منها التوقيع على الخادم — 0107). */
const SIG_PNG = `data:image/png;base64,${'A'.repeat(300)}`;

function as(role: AppRole): void {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = iso(new Date());

beforeEach(() => resetContractOpsDemo());
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

async function activeContract() {
  as('admin');
  const c = await createDraft({
    service_code: 'monthly_rental',
    customer_id: 'cust-2',
    customer_name: 'سارة القحطاني',
    worker_profile_id: 'wp-rp-1',
    worker_name: 'سيتي رحمة',
    branch: 'جازان',
    start_date: iso(new Date(Date.now() - 5 * 86_400_000)),
    end_date: iso(new Date(Date.now() + 80 * 86_400_000)),
    quantity: 1,
    nationality: 'إندونيسيا',
  });
  await transitionContract(c.id, 'pending_approval');
  await transitionContract(c.id, 'approved');
  await transitionContract(c.id, 'awaiting_signature');
  await signContract(c.id, {
    customer: SIG_PNG,
    company: SIG_PNG,
    customerName: 'سارة القحطاني',
    nationalId: '1012345670',
    ipAddress: '10.0.0.3',
  });
  await transitionContract(c.id, 'active');
  return c.id;
}

async function replaceOnce(id: string, reason: string, worker: string) {
  const r = await requestReplacement({
    contractId: id,
    reasonCode: reason,
    requestedAt: today,
    exceptionBasis: null,
  });
  await scheduleReplacement(r, {
    newWorkerId: worker,
    newWorkerName: worker,
    pickupDate: today,
    deliveryDate: today,
  });
  await completeReplacement(r, { oldReceived: today, newDelivered: today, condition: 'good' });
  return r;
}

describe('worker replacement (demo mirror of 0091)', () => {
  it('counts ordinary replacements, exempts البند الثاني/4 and blocks the third ordinary one', async () => {
    const id = await activeContract();
    demoPinReplacementPolicy(id, { active: true, max: 2 });

    await replaceOnce(id, 'performance', 'wp-rp-2');
    expect((await getContract(id))?.worker_profile_id).toBe('wp-rp-2');
    const [ret] = await listReturns(id);
    expect(ret?.status).toBe('received');
    expect(ret?.worker_profile_id).toBe('wp-rp-1');
    // the previous worker may be made available although the contract is live (replacement return)
    await returnStep(ret!, 'ready');

    await replaceOnce(id, 'worker_sick', 'wp-rp-3'); // contractual — outside the quota
    expect((await getReplacementQuota(id)).remaining).toBe(1);
    await replaceOnce(id, 'customer_preference', 'wp-rp-4');
    expect((await getReplacementQuota(id)).remaining).toBe(0);
    await expect(
      requestReplacement({
        contractId: id,
        reasonCode: 'compatibility',
        requestedAt: today,
        exceptionBasis: null,
      }),
    ).rejects.toThrow('استُنفد');

    // an exception needs another approver
    const ex = await requestReplacement({
      contractId: id,
      reasonCode: 'compatibility',
      requestedAt: today,
      exceptionBasis: 'management',
      exceptionNote: 'قرار الإدارة',
    });
    expect(ex.status).toBe('pending_exception');
    await expect(replacementStep(ex, 'approve_exception')).rejects.toThrow('أربع أعين');
    as('operations_manager');
    await replacementStep(ex, 'approve_exception');
    expect((await listReplacements(id))[0]?.status).toBe('eligible');
    expect((await listReplacements(id))[0]?.counts_toward_limit).toBe(false);
  });

  it('applies no limit to contracts signed without the policy (no retroactive effect)', async () => {
    const id = await activeContract();
    demoPinReplacementPolicy(id, { active: false, max: 2 });
    await replaceOnce(id, 'performance', 'wp-rp-2');
    await replaceOnce(id, 'performance', 'wp-rp-3');
    await replaceOnce(id, 'performance', 'wp-rp-4');
    const q = await getReplacementQuota(id);
    expect(q.active).toBe(false);
    expect(q.remaining).toBeNull();
    expect(q.total_done).toBe(3);
  });
});
