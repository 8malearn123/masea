/**
 * مستهدفات السكن (0083): مستهدف شهري واحد لكل مشرفة، الإسناد ضمن نطاق الفرع،
 * التعطيل بدل الحذف، والمحقَّق محسوب من مساكن المشرفة.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import {
  listDorms,
  listHousingTargets,
  listMyHousingTargets,
  saveHousingTarget,
} from '@/features/housing/api/housing.api';
import { targetChangeError, targetInputOf } from '@/features/housing/lib/targetRules';

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const now = new Date();
const period = { year: now.getFullYear(), month: now.getMonth() + 1 };
const base = {
  id: null,
  supervisor_id: 's1',
  ...period,
  occupancy_target_pct: 80,
  attendance_target_pct: 90,
  notes: null,
  is_active: true,
};

describe('قواعد المستهدف', () => {
  it('النسب بين 0 و100 والمشرفة مطلوبة', () => {
    expect(targetChangeError({ ...base, supervisor_id: '' }, [])).toContain('المشرفة');
    expect(targetChangeError({ ...base, occupancy_target_pct: 120 }, [])).toContain('بين 0 و100');
    expect(targetChangeError({ ...base, attendance_target_pct: Number.NaN }, [])).not.toBeNull();
    expect(targetChangeError(base, [])).toBeNull();
  });

  it('مستهدف واحد لكل مشرفة في الشهر', () => {
    const other = { id: 't1', supervisor_id: 's1', ...period };
    expect(targetChangeError(base, [other])).toContain('عدّله');
    expect(targetChangeError({ ...base, id: 't1' }, [other])).toBeNull();
  });
});

describe('إسناد المستهدفات في مخزن العرض', () => {
  it('مدير فرع جازان يرى مستهدفات فرعه فقط ويعدّلها؛ ومشرفة فرع آخر مرفوضة', async () => {
    const acc = signIn('branch_manager');
    const rows = await listHousingTargets(period);
    expect(rows.length).toBe(1);
    expect(rows[0]!.branch).toBe(acc.branch);
    await saveHousingTarget({ ...targetInputOf(rows[0]!), attendance_target_pct: 97 });
    expect((await listHousingTargets(period))[0]!.attendance_target_pct).toBe(97);
    await expect(
      saveHousingTarget({
        ...base,
        supervisor_id: 'sup-njr',
        month: period.month === 12 ? 1 : period.month + 1,
      }),
    ).rejects.toThrow('خارج نطاق');
  });

  it('الإدارة تسند مستهدف الشهر القادم، والتعطيل يخفيه من «مستهدفاتي» دون حذفه', async () => {
    signIn('admin');
    const next =
      period.month === 12
        ? { year: period.year + 1, month: 1 }
        : { ...period, month: period.month + 1 };
    await saveHousingTarget({
      ...base,
      ...next,
      supervisor_id: 'sup-srr',
      notes: 'افتتاح سكن جديد',
    });
    const added = (await listHousingTargets(next)).find((t) => t.supervisor_id === 'sup-srr')!;
    expect(added).toMatchObject({ supervisor: 'نوف الدوسري', branch: 'شرورة', is_active: true });
    await expect(saveHousingTarget({ ...base, ...next, supervisor_id: 'sup-srr' })).rejects.toThrow(
      'عدّله',
    );
    await saveHousingTarget({ ...targetInputOf(added), is_active: false });
    expect((await listHousingTargets(next)).find((t) => t.id === added.id)!.is_active).toBe(false);
    expect((await listMyHousingTargets()).some((t) => t.id === added.id)).toBe(false);
  });

  it('المحقَّق من مساكن المشرفة نفسها', async () => {
    const acc = signIn('housing_supervisor');
    const [mine] = await listMyHousingTargets();
    const dorms = (await listDorms()).filter((d) => d.supervisor === acc.name && d.is_active);
    const cap = dorms.reduce((a, d) => a + (d.capacity ?? 0), 0);
    const occ = dorms.reduce((a, d) => a + d.occupied, 0);
    expect(mine!.occupancy_actual_pct).toBe(Math.round((occ / cap) * 100));
  });
});
