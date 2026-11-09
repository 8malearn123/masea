/**
 * إدارة المساكن (0081): السعة، المشرفة من فرع السكن، التعطيل، والإشغال المحسوب —
 * نفس قواعد guard_housing_dorm / guard_worker_dorm.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import {
  listDorms,
  listHousingSupervisors,
  saveDorm,
  upsertResidentFromWorker,
  workerDormError,
} from '@/features/housing/api/housing.api';
import { dormAssignError, dormChangeError, dormInputOf } from '@/features/housing/lib/dormRules';
import type { Dorm } from '@/features/housing/types';

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

const dorm = (p: Partial<Dorm> = {}): Dorm => ({
  id: 'x',
  name: 'سكن س',
  branch: 'نجران',
  capacity: 2,
  occupied: 1,
  supervisor_id: null,
  supervisor: '',
  is_active: true,
  notes: null,
  ...p,
});

describe('قواعد السكن', () => {
  const supervisors = [{ id: 's1', full_name: 'هيفاء القحطاني', branch: 'نجران' }];
  const ctx = (current: Dorm | null) => ({
    current,
    others: [dorm({ id: 'y', name: 'سكن ص' })],
    supervisors,
  });

  it('الاسم والفرع مطلوبان والسعة موجبة', () => {
    const base = { ...dormInputOf(dorm()), id: null };
    expect(dormChangeError({ ...base, name: ' ' }, ctx(null))).toContain('اسم السكن');
    expect(dormChangeError({ ...base, branch: '' }, ctx(null))).toContain('الفرع');
    expect(dormChangeError({ ...base, capacity: 0 }, ctx(null))).toContain('أكبر من صفر');
    expect(dormChangeError({ ...base, name: 'سكن ص' }, ctx(null))).toContain('يوجد سكن');
    expect(dormChangeError(base, ctx(null))).toBeNull();
  });

  it('المشرفة من فرع السكن فقط', () => {
    const input = { ...dormInputOf(dorm()), supervisor_id: 's1' };
    expect(dormChangeError(input, ctx(null))).toBeNull();
    expect(dormChangeError({ ...input, branch: 'جازان' }, ctx(null))).toContain('مشرفة السكن');
  });

  it('لا تعطيل ولا تقليص سعة ولا نقل فرع وفيه عاملات', () => {
    const cur = dorm({ occupied: 2 });
    const input = dormInputOf(cur);
    expect(dormChangeError({ ...input, is_active: false }, ctx(cur))).toContain('انقل العاملات');
    expect(dormChangeError({ ...input, capacity: 1 }, ctx(cur))).toContain('أقل من عدد المقيمات');
    expect(dormChangeError({ ...input, branch: 'جازان' }, ctx(cur))).toContain('فرع آخر');
    expect(dormChangeError({ ...input, is_active: false }, ctx(dorm({ occupied: 0 })))).toBeNull();
  });

  it('التسكين: نشط، من فرع العاملة، وغير ممتلئ', () => {
    expect(dormAssignError(dorm(), 'نجران')).toBeNull();
    expect(dormAssignError(dorm({ occupied: 2 }), 'نجران')).toContain('ممتلئ');
    expect(dormAssignError(dorm({ capacity: null, occupied: 99 }), 'نجران')).toBeNull();
    expect(dormAssignError(dorm(), 'جازان')).toContain('فرع آخر');
    expect(dormAssignError(dorm({ is_active: false }), 'نجران')).toContain('معطّل');
  });
});

describe('إدارة المساكن في مخزن العرض', () => {
  it('مدير فرع جازان يضيف سكنًا لفرعه بمشرفة فرعه، ويُحسب الإشغال', async () => {
    const acc = signIn('branch_manager');
    const sups = await listHousingSupervisors();
    expect(sups.every((s) => s.branch === acc.branch)).toBe(true);
    await saveDorm({
      id: null,
      name: 'سكن جازان - ب',
      branch: acc.branch!,
      capacity: 1,
      supervisor_id: sups[0]!.id,
      notes: null,
      is_active: true,
    });
    const added = (await listDorms()).find((d) => d.name === 'سكن جازان - ب')!;
    expect(added).toMatchObject({ occupied: 0, supervisor: sups[0]!.full_name });

    upsertResidentFromWorker({
      full_name: 'ميرا سوسانتي',
      nationality: 'إندونيسيا',
      branch: acc.branch!,
      dorm: 'سكن جازان - ب',
      barcode: 'MAS-W-9901',
      iqama_no: '2499990001',
    });
    expect((await listDorms()).find((d) => d.id === added.id)!.occupied).toBe(1);
    // ممتلئ لعاملة جديدة، وبقاء المقيمة نفسها ليس تسكينًا جديدًا
    expect(workerDormError('سكن جازان - ب', acc.branch!, 'MAS-W-9999')).toContain('ممتلئ');
    expect(workerDormError('سكن جازان - ب', acc.branch!, 'MAS-W-9901')).toBeNull();
    await expect(saveDorm({ ...dormInputOf(added), is_active: false })).rejects.toThrow(
      'انقل العاملات',
    );
  });

  it('تغيير اسم السكن ينقل مقيماته للاسم الجديد', async () => {
    signIn('admin');
    const h4 = (await listDorms()).find((d) => d.name === 'سكن شرورة')!;
    const before = h4.occupied;
    await saveDorm({ ...dormInputOf(h4), name: 'سكن شرورة - الرئيسي' });
    const after = (await listDorms()).find((d) => d.id === h4.id)!;
    expect(after.name).toBe('سكن شرورة - الرئيسي');
    expect(after.occupied).toBe(before);
    await saveDorm({ ...dormInputOf(after), name: 'سكن شرورة' });
  });
});
