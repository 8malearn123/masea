/** المرحلة ب — القوائم المرجعية (مرآة 0075 واختبار 99d). */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { listEmployees, listHouseWorkers } from '@/features/hr/api/hr.api';
import { listHrLookups, lookupUsage, saveHrLookup } from '@/features/hr/api/lookups.api';
import {
  assertLookupChange,
  codeOptions,
  DEFAULT_LOOKUPS,
  lookupLabel,
  lookupNames,
} from '@/features/hr/lib/lookups';
import type { HrLookup } from '@/features/hr/types';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const find = (items: HrLookup[], kind: HrLookup['kind'], name: string) =>
  items.find((i) => i.kind === kind && i.name_ar === name)!;

describe('list rules', () => {
  it('pickers: active items, scoped nationalities, current value kept', () => {
    const items = DEFAULT_LOOKUPS.map((l) =>
      l.kind === 'department' && l.name_ar === 'السكن' ? { ...l, is_active: false } : l,
    );
    const depts = lookupNames(items, 'department');
    expect(depts).not.toContain('السكن');
    expect(lookupNames(items, 'department', { keep: 'السكن' })).toContain('السكن');
    const staff = lookupNames(items, 'nationality', { scope: 'staff' });
    const workers = lookupNames(items, 'nationality', { scope: 'worker' });
    expect(staff).toContain('السعودية');
    expect(staff).not.toContain('كينيا');
    expect(workers).toContain('كينيا');
    expect(workers).not.toContain('السعودية');
    expect(workers).toContain('الفلبين'); // «both»
  });

  it('doc types are stored by code and shown by name', () => {
    expect(lookupLabel(DEFAULT_LOOKUPS, 'doc_type', 'iqama')).toBe('الإقامة');
    expect(lookupLabel(DEFAULT_LOOKUPS, 'doc_type', 'legacy_x')).toBe('legacy_x');
    expect(codeOptions(DEFAULT_LOOKUPS, 'doc_type').some((o) => o.value === 'work_permit')).toBe(
      true,
    );
    expect(codeOptions(DEFAULT_LOOKUPS, 'doc_type', 'legacy_x').at(-1)).toEqual({
      value: 'legacy_x',
      label: 'legacy_x',
    });
  });

  it('guards mirror guard_hr_lookup', () => {
    const items = DEFAULT_LOOKUPS;
    const iqama = items.find((i) => i.code === 'iqama')!;
    const saudi = items.find((i) => i.code === 'SA')!;
    const ops = items.find((i) => i.code === 'ops')!;
    expect(() => assertLookupChange(items, { ...iqama, is_active: false }, iqama)).toThrow(
      'لا يُعطَّل',
    );
    expect(() =>
      assertLookupChange(items, { ...iqama, name_ar: 'هوية مقيم' }, iqama),
    ).not.toThrow();
    expect(() => assertLookupChange(items, { ...saudi, name_ar: 'سعودي' }, saudi)).toThrow('ثابت');
    expect(() => assertLookupChange(items, { ...ops, name_ar: 'المالية' }, ops)).toThrow('موجود');
    expect(() => assertLookupChange(items, { ...ops, name_ar: '  ' }, ops)).toThrow('أدخل الاسم');
    expect(() =>
      assertLookupChange(
        items,
        { ...ops, code: 'new1', name_ar: 'التدريب', is_system: true },
        null,
      ),
    ).toThrow('نظامية');
  });
});

describe('demo store (mirror of RLS + cascade_hr_lookup_rename)', () => {
  it('only hr.manage edits the lists', async () => {
    loginAs('branch_manager');
    const ops = find(await listHrLookups(), 'department', 'العمليات');
    await expect(saveHrLookup({ ...ops, name_ar: 'التشغيل' }, false)).rejects.toThrow(
      'الموارد البشرية',
    );
  });

  it('HR adds, disables, and renames — the rename flows into records', async () => {
    loginAs('hr');
    await saveHrLookup(
      {
        kind: 'department',
        code: 'mkt01',
        name_ar: ' التسويق ',
        scope: 'both',
        is_active: true,
        is_system: false,
        sort_order: 8,
      },
      true,
    );
    let all = await listHrLookups();
    const mkt = find(all, 'department', 'التسويق');
    expect(mkt).toBeTruthy();
    await saveHrLookup({ ...mkt, is_active: false }, false);
    all = await listHrLookups();
    expect(find(all, 'department', 'التسويق').is_active).toBe(false);

    const usedBefore = (await lookupUsage('job_title')).get('محاسب') ?? 0;
    expect(usedBefore).toBeGreaterThan(0);
    await saveHrLookup({ ...find(all, 'job_title', 'محاسب'), name_ar: 'محاسب أول' }, false);
    const emps = await listEmployees();
    expect(emps.some((e) => e.job_title === 'محاسب')).toBe(false);
    expect(emps.filter((e) => e.job_title === 'محاسب أول')).toHaveLength(usedBefore);

    const workersBefore = (await listHouseWorkers()).filter(
      (w) => w.nationality === 'الفلبين',
    ).length;
    await saveHrLookup(
      { ...find(all, 'nationality', 'الفلبين'), name_ar: 'جمهورية الفلبين' },
      false,
    );
    const workers = await listHouseWorkers();
    expect(workers.filter((w) => w.nationality === 'جمهورية الفلبين')).toHaveLength(workersBefore);

    await saveHrLookup({ ...find(all, 'skill', 'الكي'), name_ar: 'الكي والترتيب' }, false);
    expect((await listHouseWorkers()).some((w) => w.skills.includes('الكي'))).toBe(false);
    expect((await lookupUsage('skill')).get('الكي والترتيب')).toBeGreaterThan(0);
  });

  it('system items and the Saudi name are protected', async () => {
    loginAs('hr');
    const all = await listHrLookups();
    await expect(
      saveHrLookup({ ...all.find((i) => i.code === 'visa')!, is_active: false }, false),
    ).rejects.toThrow('لا يُعطَّل');
    await expect(
      saveHrLookup({ ...all.find((i) => i.code === 'SA')!, name_ar: 'سعودي' }, false),
    ).rejects.toThrow('ثابت');
  });
});
