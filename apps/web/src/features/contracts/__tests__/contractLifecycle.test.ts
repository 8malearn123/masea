import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  createDraft,
  getClauses,
  getContract,
  getHistory,
  getSignatures,
  listContracts,
  renewContract,
  signContract,
  transitionContract,
  updateDraft,
} from '@/features/contracts/api/contracts.api';
import { defaultRenewalStart, renewalTerm } from '@/features/contracts/lib/contractRenewal';
import { today } from '@/features/requests/lib/period';

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

/** Full rental lifecycle in demo mode — every step must survive a refetch. */
describe('contract lifecycle (create → approve → sign → activate → complete → renew)', () => {
  it('persists a new draft with its clauses and history so the list and detail agree', async () => {
    const c = await createDraft({
      service_code: 'monthly_rental',
      customer_id: 'cust-2',
      customer_name: 'سارة القحطاني',
      branch: 'جازان',
      start_date: '2026-11-01',
      end_date: '2027-01-31',
      quantity: 3,
      nationality: 'الفلبين',
      clauses: ['بند أول', 'بند ثانٍ'],
    });
    expect(c.status).toBe('draft');
    expect(c.base_amount).toBe(7500);
    expect(c.total_amount).toBe(8625);

    const list = await listContracts(ALL);
    expect(list.some((r) => r.id === c.id)).toBe(true);
    expect((await getContract(c.id))?.customer_name).toBe('سارة القحطاني');
    expect((await getClauses(c.id)).map((x) => x.body)).toEqual(['بند أول', 'بند ثانٍ']);
    expect((await getHistory(c.id)).map((h) => h.to_status)).toEqual(['draft']);
  });

  it('applies only an eligible predefined discount and rejects an ineligible one', async () => {
    const ok = await createDraft({
      service_code: 'monthly_rental',
      customer_id: 'cust-2',
      branch: 'نجران',
      start_date: '2026-11-01',
      quantity: 6,
      nationality: 'الفلبين',
      promotion_id: 'pm-3', // 500 SAR on monthly rental ≥ 12,000
    });
    expect(ok.gross_amount).toBe(15000);
    expect(ok.discount_amount).toBe(500);
    expect(ok.base_amount).toBe(14500);
    expect(ok.promotion_id).toBe('pm-3');

    await expect(
      createDraft({
        service_code: 'monthly_rental',
        customer_id: 'cust-2',
        branch: 'نجران',
        start_date: '2026-11-01',
        quantity: 1, // 2,500 < 12,000 minimum
        nationality: 'الفلبين',
        promotion_id: 'pm-3',
      }),
    ).rejects.toThrow();
  });

  it('edits a draft and keeps the status changes after refetch, through to renewal', async () => {
    const c = await createDraft({
      service_code: 'daily_rental',
      customer_id: 'cust-3',
      branch: 'شرورة',
      start_date: '2026-11-05',
      quantity: 3,
      profession: 'طبخ',
    });
    await updateDraft(c.id, { start_date: '2026-11-07', end_date: '2026-11-09', branch: 'نجران' });
    let fresh = await getContract(c.id);
    expect(fresh?.start_date).toBe('2026-11-07');
    expect(fresh?.branch_id).toBe('نجران');

    await transitionContract(c.id, 'pending_approval');
    await transitionContract(c.id, 'approved');
    await transitionContract(c.id, 'awaiting_signature');
    // illegal jumps and signing without signatures are rejected
    await expect(transitionContract(c.id, 'completed')).rejects.toThrow();
    await expect(transitionContract(c.id, 'signed')).rejects.toThrow('توقيع الطرفين');
    // editing is locked once the draft moved forward
    await expect(
      updateDraft(c.id, { start_date: '2026-11-08', end_date: null, branch: 'نجران' }),
    ).rejects.toThrow();

    await signContract(c.id, {
      customer: 'data:,',
      company: 'data:,',
      customerName: 'فهد العنزي',
      nationalId: '1012345678',
      ipAddress: '10.0.0.1',
    });
    fresh = await getContract(c.id);
    expect(fresh?.status).toBe('signed');
    expect(fresh?.signed_at).not.toBeNull();
    expect((await getSignatures(c.id)).map((s) => s.signer_type)).toEqual(['customer', 'company']);

    await transitionContract(c.id, 'active');

    // renewal = a new draft version of the ACTIVE contract (same term, starts after it ends)
    const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
    if (!admin) throw new Error('no demo admin');
    saveDemo(admin);
    useAuth.setState({ profile: demoProfile(admin) });
    const active = await getContract(c.id);
    if (!active) throw new Error('missing contract');
    const plan = renewalTerm(active, defaultRenewalStart(active));
    if (plan.error !== null) throw new Error(plan.error);
    const renewal = await renewContract(c.id, plan.term.start_date, plan.term.end_date);
    expect(renewal.status).toBe('draft');
    expect(renewal.version).toBe(2);
    expect(renewal.parent_contract_id).toBe(c.id);
    expect(renewal.start_date).toBe('2026-11-10');
    // only one open renewal per contract
    await expect(renewContract(c.id, plan.term.start_date, plan.term.end_date)).rejects.toThrow(
      'يوجد تجديد قائم',
    );

    await transitionContract(c.id, 'completed');
    expect((await listContracts(ALL)).find((r) => r.id === c.id)?.status).toBe('completed');
    expect((await getHistory(c.id)).map((h) => h.to_status)).toEqual([
      'draft',
      'pending_approval',
      'approved',
      'awaiting_signature',
      'signed',
      'active',
      'completed',
    ]);
  });

  it('renews a cancelled contract as a new draft starting today', async () => {
    const admin = DEMO_ACCOUNTS.find((x) => x.role === 'admin');
    if (!admin) throw new Error('no admin demo account');
    saveDemo(admin);
    useAuth.setState({ profile: demoProfile(admin) });
    const c = await createDraft({
      service_code: 'monthly_rental',
      customer_id: 'cust-4',
      customer_name: 'نورة الشهري',
      branch: 'نجران',
      start_date: '2026-12-01',
      end_date: '2027-02-28',
      quantity: 3,
      nationality: 'كينيا',
    });
    await transitionContract(c.id, 'cancelled');
    const cancelled = (await getContract(c.id))!;
    // the suggested start is today (not after the original end), same 3-month term
    const start = defaultRenewalStart(cancelled);
    expect(start).toBe(today());
    const plan = renewalTerm(cancelled, start);
    expect(plan.error).toBeNull();
    const renewal = await renewContract(c.id, plan.term!.start_date, plan.term!.end_date);
    expect(renewal.status).toBe('draft');
    expect(renewal.parent_contract_id).toBe(c.id);
    expect(renewal.version).toBe(2);
    expect(renewal.start_date).toBe(today());
    expect((await getContract(c.id))?.status).toBe('cancelled'); // original untouched
  });

  it('applies a coupon only with its code', async () => {
    const base = {
      service_code: 'recruitment' as const,
      customer_id: 'cust-1',
      branch: 'نجران',
      start_date: '2026-11-01',
      nationality: 'الفلبين',
    };
    const ok = await createDraft({ ...base, promotion_code: 'njr-vip' });
    expect(ok.discount_amount).toBe(1000); // 8% of 16,000 = 1,280 → floor 15,000 caps it at 1,000
    expect(ok.promotion_id).toBe('pm-5');
    await expect(createDraft({ ...base, promotion_code: 'WRONG' })).rejects.toThrow(
      'رمز الكوبون غير صحيح',
    );
    // picking the coupon by id without its code is refused
    await expect(createDraft({ ...base, promotion_id: 'pm-5' })).rejects.toThrow('رمز كوبون');
  });
});
