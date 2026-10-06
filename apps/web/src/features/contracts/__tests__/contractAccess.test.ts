/**
 * نطاق الاطلاع على العقود في الوضع التجريبي — مرآة لسياسة RLS contracts_read:
 * الأدوار غير العابرة للفروع ترى عقود فرعها فقط، والمكتب الخارجي ما أُسند إليه.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { getContract, listContracts } from '@/features/contracts/api/contracts.api';
import type { AppRole } from '@masiat/shared';

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

/** عقود بيانات العرض كما هي في contracts.api (لا يُضاف إليها شيء). */
const SEED_IDS = ['00001', '00002', '00003', '00004', '00007', '00008', '00009', '00005', '00006'];

function signInDemo(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo account for ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}

afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('نطاق الاطلاع على العقود (الوضع التجريبي)', () => {
  it('المدير العام يرى كل عقود العرض — دون أي عقود إضافية', async () => {
    signInDemo('admin');
    const ids = (await listContracts(ALL)).map((c) => c.id).sort();
    expect(ids).toEqual([...SEED_IDS].sort());
  });

  it('مدير الفرع يرى عقود فرعه فقط', async () => {
    const acc = signInDemo('branch_manager');
    const rows = await listContracts(ALL);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((c) => c.branch_id === acc.branch || c.branch_id === null)).toBe(true);
  });

  it('لا يفتح مدير الفرع عقدًا من فرع آخر عبر رابطه المباشر', async () => {
    const acc = signInDemo('branch_manager'); // جازان
    expect(acc.branch).toBe('جازان');
    expect(await getContract('00008')).not.toBeNull(); // جازان
    expect(await getContract('00009')).toBeNull(); // نجران
  });

  it('المكتب الخارجي يرى ما أُسند إليه فقط', async () => {
    signInDemo('external_office');
    const rows = await listContracts(ALL);
    expect(rows.every((c) => c.assigned_office_id === 'demo-external_office')).toBe(true);
  });
});
