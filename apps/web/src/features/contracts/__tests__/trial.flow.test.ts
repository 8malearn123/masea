import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { getContract } from '@/features/contracts/api/contracts.api';
import { resetContractOpsDemo } from '@/features/contracts/api/contractOps.api';
import {
  acceptTrial,
  approveTrialTerms,
  createTrial,
  issueTrialLink,
  listTrials,
  listTrialTerms,
  resetTrialsDemo,
  saveTrialTermsDraft,
  setTrialRequirement,
  trialStep,
  viewTrialByToken,
} from '@/features/contracts/api/trials.api';

const today = new Date().toISOString().slice(0, 10);
const input = {
  customerId: 'cust-trial-1',
  customerName: 'ظافر آل منصور',
  customerNationalId: '1098765432',
  customerPhone: '0551237788',
  workerId: 'wp-trial-1',
  workerName: 'جوي ماي ريس',
  branch: 'نجران',
  price: 1500,
  days: 10,
  receiptDate: today,
};

beforeEach(() => {
  resetContractOpsDemo();
  resetTrialsDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

async function approvedTerms() {
  await saveTrialTermsDraft({ title: 'شروط التجربة', clauses: ['البند الأول كما تعتمده الشركة.'] });
  const [v] = await listTrialTerms();
  await approveTrialTerms(v!.id);
}

describe('transfer trial (demo mirror of 0092)', () => {
  it('the official trial contract is the approved terms (0106) and the 90-day limit holds', async () => {
    const official = (await listTrialTerms()).find((x) => x.status === 'approved');
    expect(official?.doc?.layout).toBe('trial_contract_black_v1');
    expect(official?.clauses).toHaveLength(10);
    await approvedTerms();
    await expect(createTrial({ ...input, days: 91 })).rejects.toThrow('المادة التاسعة');
  });

  it('link → view (no acceptance) → identity check → acceptance → checklist gate → transfer', async () => {
    await approvedTerms();
    const t = await createTrial(input);
    expect(t.end_date).toBe(new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10));
    const { token } = await issueTrialLink(t);

    const v = await viewTrialByToken(token);
    expect(v.price).toBe(1500);
    expect(v.trial_days).toBe(10);
    expect(v.receipt_date).toBe(today);
    expect((await listTrials())[0]?.status).toBe('awaiting_acceptance'); // opening ≠ accepting

    const bad = await acceptTrial({ token, idLast4: '0000', phoneLast4: '7788' });
    expect(bad.ok).toBe(false);
    expect(bad.attempts_left).toBe(4);
    const ok = await acceptTrial({ token, idLast4: '5432', phoneLast4: '7788' });
    expect(ok.ok).toBe(true);
    expect(ok.reference).toHaveLength(12);
    await expect(acceptTrial({ token, idLast4: '5432', phoneLast4: '7788' })).rejects.toThrow(
      'سبق قبول',
    );
    expect((await getContract(t.contract_id))?.status).toBe('signed');

    await expect(trialStep(t, 'start')).rejects.toThrow('المتطلبات النظامية');
    for (const code of ['iqama_valid', 'not_absent', 'worker_consent', 'employer_eligible']) {
      await setTrialRequirement(t, code, true);
    }
    await trialStep(t, 'start');
    expect((await getContract(t.contract_id))?.status).toBe('active');

    await trialStep(t, 'transfer', 'العميل يرغب في نقل الخدمات');
    const [after] = await listTrials();
    expect(after?.status).toBe('wants_transfer');
    const transfer = await getContract(after!.transfer_contract_id!);
    expect(transfer?.service_code).toBe('sponsorship_transfer');
    expect(transfer?.status).toBe('draft'); // the actual transfer happens on Musaned
  });

  it('a re-issued link revokes the previous one', async () => {
    await approvedTerms();
    const t = await createTrial(input);
    const first = await issueTrialLink(t);
    await issueTrialLink(t);
    expect((await viewTrialByToken(first.token)).link_state).toBe('revoked');
  });
});
