/**
 * تجديد العقد في الوضع التجريبي + قواعد التجديد الصرفة.
 * (مسار قاعدة البيانات الفعلية في contractSave.backend.test.tsx، ودالة الخادم
 * renew_contract اختُبرت على Postgres منفصلًا.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  createDraft,
  demoMutateContract,
  getClauses,
  getContract,
  getContractLineage,
  getHistory,
  getSignatures,
  listContracts,
  renewContract,
} from '@/features/contracts/api/contracts.api';
import {
  defaultRenewalStart,
  nextVersion,
  renewalBlocker,
  renewalTerm,
} from '@/features/contracts/lib/contractRenewal';
import { contractEndDate, inferTermCount } from '@/features/contracts/lib/contractTerm';
import type { ContractListItem } from '@/features/contracts/types';
import type { AppRole } from '@masiat/shared';

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

function signInDemo(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo account for ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}

async function load(id: string): Promise<ContractListItem> {
  const c = await getContract(id);
  if (!c) throw new Error(`missing ${id}`);
  return c;
}

/** يجدّد بالتواريخ المقترحة (اليوم التالي للنهاية + نفس المدة). */
async function renewDefault(id: string) {
  const parent = await load(id);
  const plan = renewalTerm(parent, defaultRenewalStart(parent));
  if (plan.error !== null) throw new Error(plan.error);
  return renewContract(id, plan.term.start_date, plan.term.end_date);
}

/** عقد ساري جديد بمدة ٣ أشهر وبنود تحمل تاريخ بدايته. */
async function activeContract(start: string) {
  const end = contractEndDate('monthly_rental', start, 3);
  const c = await createDraft({
    service_code: 'monthly_rental',
    customer_id: 'cust-2',
    customer_name: 'سارة القحطاني',
    branch_id: 'نجران',
    start_date: start,
    end_date: end,
    quantity: 3,
    clauses: [`مدة العقد 3 أشهر تبدأ من ${start}.`, 'بند ثابت'],
  });
  demoMutateContract(c.id, { status: 'active', signed_at: `${start}T10:00:00Z` });
  return load(c.id);
}

afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('تجديد العقد (الوضع التجريبي)', () => {
  it('١ ينشئ نسخة جديدة مسودة مرتبطة بالأصل برقم عقد جديد', async () => {
    signInDemo('admin');
    const parent = await load('00009');
    const renewal = await renewDefault('00009');
    expect(renewal.parent_contract_id).toBe('00009');
    expect(renewal.version).toBe(parent.version + 1);
    expect(renewal.status).toBe('draft');
    expect(renewal.contract_no).not.toBe(parent.contract_no);
    expect(renewal.id).not.toBe(parent.id);
    expect((await listContracts(ALL)).some((c) => c.id === renewal.id)).toBe(true);
  });

  it('٣ لا يغيّر العقد الأصلي', async () => {
    signInDemo('admin');
    const before = await load('00008');
    await renewDefault('00008');
    expect(await load('00008')).toEqual(before);
  });

  it('٤ تواريخ النسخة: تبدأ بعد نهاية الأصل وبنفس مدته', async () => {
    signInDemo('admin');
    const parent = await activeContract('2026-01-31');
    const r = await renewDefault(parent.id);
    expect(r.start_date).toBe('2026-05-01'); // الأصل: ٣١ يناير ← ٣٠ أبريل
    expect(r.end_date).toBe('2026-07-31');
    expect(inferTermCount(r.service_code, r.start_date, r.end_date)).toBe(
      inferTermCount(parent.service_code, parent.start_date, parent.end_date),
    );
    await expect(renewContract(parent.id, '2026-04-30', '2026-07-29')).rejects.toThrow();
  });

  it('٤ يرفض بداية متداخلة مع الأصل أو نهاية لا تطابق المدة', async () => {
    signInDemo('admin');
    const parent = await activeContract('2026-02-01');
    await expect(renewContract(parent.id, '2026-04-30', '2026-07-29')).rejects.toThrow(
      'بعد نهاية العقد الأصلي',
    );
    await expect(renewContract(parent.id, '2026-05-01', '2026-06-30')).rejects.toThrow(
      'لا يطابق مدة العقد الأصلي',
    );
  });

  it('٥ ينسخ البيانات التجارية والبنود (بتاريخ البداية الجديد) دون التوقيعات والسجل', async () => {
    signInDemo('admin');
    const parent = await activeContract('2026-03-01');
    const r = await renewDefault(parent.id);
    expect(r).toMatchObject({
      customer_id: parent.customer_id,
      customer_name: parent.customer_name,
      branch_id: parent.branch_id,
      service_code: parent.service_code,
      base_amount: parent.base_amount,
      total_amount: parent.total_amount,
      amount_paid: 0,
      signed_at: null,
      musaned_contract_no: null,
    });
    const bodies = (await getClauses(r.id)).map((c) => c.body);
    expect(bodies).toEqual([`مدة العقد 3 أشهر تبدأ من ${r.start_date}.`, 'بند ثابت']);
    expect((await getClauses(parent.id))[0]?.body).toContain('2026-03-01'); // الأصل كما هو
    expect(await getSignatures(r.id)).toEqual([]);
    expect((await getHistory(r.id)).map((h) => h.to_status)).toEqual(['draft']);
  });

  it('٨ يمنع نسخة ثانية للعقد نفسه عند تكرار الطلب', async () => {
    signInDemo('admin');
    const parent = await activeContract('2026-04-01');
    const first = renewDefault(parent.id);
    const second = renewDefault(parent.id);
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(String((rejected as PromiseRejectedResult).reason)).toContain('يوجد تجديد قائم');
    const children = (await listContracts(ALL)).filter((c) => c.parent_contract_id === parent.id);
    expect(children).toHaveLength(1);
  });

  it('٢ يزيد الإصدار بعد إلغاء تجديد وعبر سلسلة التجديدات دون تكرار', async () => {
    signInDemo('admin');
    const v1 = await activeContract('2026-05-01');
    const v2 = await renewDefault(v1.id);
    expect(v2.version).toBe(2);
    demoMutateContract(v2.id, { status: 'cancelled' });
    const v3 = await renewDefault(v1.id);
    expect(v3.version).toBe(3); // ليس 2 مرة أخرى
    demoMutateContract(v3.id, { status: 'active' });
    const v4 = await renewDefault(v3.id);
    expect(v4).toMatchObject({ version: 4, parent_contract_id: v3.id });
    // سجل النسخ من أي إصدار يشمل العائلة كلها، ومنها التجديد الملغى
    for (const id of [v1.id, v3.id, v4.id]) {
      expect((await getContractLineage(id)).map((c) => c.version)).toEqual([1, 2, 3, 4]);
    }
  });

  it('٦ يرفض بلا صلاحية إنشاء العقود أو خارج نطاق الفرع', async () => {
    signInDemo('call_center'); // عرض فقط
    await expect(renewContract('00009', '2027-01-01', '2027-03-31')).rejects.toThrow(
      'لا تملك صلاحية',
    );
    signInDemo('branch_manager'); // جازان — 00009 في نجران
    await expect(renewDefault('00009')).rejects.toThrow();
    await expect(renewContract('00009', '2027-01-01', '2027-03-31')).rejects.toThrow(
      'العقد غير موجود',
    );
    signInDemo('external_office');
    await expect(renewContract('00004', '2027-01-01', '2027-03-31')).rejects.toThrow(
      'لا تملك صلاحية',
    );
  });

  it('يرفض تجديد غير الساري ونقل الكفالة', async () => {
    signInDemo('admin');
    await expect(renewContract('00006', '2027-01-01', '2027-03-31')).rejects.toThrow('السارية فقط'); // ملغى
    demoMutateContract('00005', { status: 'active' });
    await expect(renewContract('00005', '2027-01-01', '2027-03-31')).rejects.toThrow('بلا مدة');
  });
});

describe('قواعد زر التجديد', () => {
  const base = (over: Partial<ContractListItem>): ContractListItem =>
    ({
      id: 'x',
      contract_no: 'MAS-2026-00100',
      service_code: 'monthly_rental',
      status: 'active',
      start_date: '2026-07-01',
      end_date: '2026-09-30',
      version: 1,
      parent_contract_id: null,
      created_at: '2026-07-01T09:00:00Z',
      total_amount: 0,
      amount_paid: 0,
      ...over,
    }) as ContractListItem;
  const NOW = new Date('2026-09-20T09:00:00Z');

  it('يظهر داخل المهلة أو بعد الانتهاء فقط', () => {
    expect(renewalBlocker(base({}), [], 30, NOW)).toBeNull(); // ينتهي بعد ١٠ أيام
    expect(
      renewalBlocker(base({ end_date: '2026-09-10', start_date: '2026-06-11' }), [], 30, NOW),
    ).toBeNull();
    expect(renewalBlocker(base({}), [], 5, NOW)).toBe('لم يدخل العقد مهلة التجديد بعد');
  });

  it('لا يظهر للملغى أو بلا تاريخ نهاية أو مع تجديد قائم', () => {
    expect(renewalBlocker(base({ status: 'cancelled' }), [], 30, NOW)).not.toBeNull();
    expect(renewalBlocker(base({ end_date: null }), [], 30, NOW)).not.toBeNull();
    const child = base({ id: 'y', parent_contract_id: 'x', status: 'draft' });
    expect(renewalBlocker(base({}), [child], 30, NOW)).toContain('يوجد تجديد قائم');
  });

  it('الإصدار التالي يتجاوز كل الإصدارات السابقة ومنها الملغاة', () => {
    const p = base({ version: 2 });
    expect(nextVersion(p, [])).toBe(3);
    expect(nextVersion(p, [base({ version: 3, status: 'cancelled' })])).toBe(4);
  });
});
