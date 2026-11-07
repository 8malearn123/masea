/** المرحلة ط — الأداء (مرآة 0076 واختبار 99e). */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  autoScores,
  listReviews,
  listTargets,
  saveCriterion,
  saveReview,
  saveTarget,
  setReviewActive,
  targetBoard,
} from '@/features/hr/api/performance.api';
import {
  applicableCriteria,
  attendanceScore,
  bandFor,
  computeReview,
  DEFAULT_BANDS,
  DEFAULT_CRITERIA,
  monthsInRange,
  ratioScore,
} from '@/features/hr/lib/performanceEngine';
import { achievementPct } from '@/features/targets/types';
import type { PerfAuto } from '@/features/hr/types';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const month = new Date().toISOString().slice(0, 7);
const from = `${month}-01`;
const to = new Date().toISOString().slice(0, 10);
const defsFor = (role: string) =>
  applicableCriteria(DEFAULT_CRITERIA, role).map((c) => ({
    code: c.code,
    name: c.name_ar,
    source: c.source,
    weight: c.weight,
  }));

describe('engine (same numbers as 99e)', () => {
  it('ratio and attendance scores', () => {
    expect(ratioScore(6, 8)).toBe(75);
    expect(ratioScore(12, 8)).toBe(100); // capped
    expect(ratioScore(3, 0)).toBeNull(); // no target → not counted
    expect(attendanceScore(18, 2, 2, 0.5)).toBe(86.36);
    expect(attendanceScore(0, 0, 0, 0.5)).toBeNull();
  });

  it('criteria by role and the weighted total', () => {
    expect(defsFor('sales')).toHaveLength(6);
    expect(defsFor('driver')).toHaveLength(4);
    const auto: PerfAuto = {
      sales_count: { achieved: 6, target: 8, score: 75 },
      sales_amount: { achieved: 24000, target: 30000, score: 80 },
      attendance: { present: 18, late: 2, absent: 2, score: 86.36 },
    };
    expect(
      computeReview(defsFor('sales'), { quality: 90, teamwork: 80, customers: 70 }, auto).score,
    ).toBe(81.52);
    const noData: PerfAuto = {
      ...auto,
      attendance: { present: 0, late: 0, absent: 0, score: null },
    };
    const r = computeReview(
      defsFor('driver'),
      { quality: 70, teamwork: 90, customers: 80 },
      noData,
    );
    expect(r.score).toBe(Math.round(((70 * 25 + 90 * 15 + 80 * 15) / 55) * 100) / 100);
    expect(r.criteria.find((c) => c.code === 'discipline')!.score).toBeNull();
    expect(() => computeReview(defsFor('driver'), { quality: 70, teamwork: 90 }, noData)).toThrow(
      'أدخل درجة',
    );
    expect(() =>
      computeReview(defsFor('driver'), { quality: 170, teamwork: 90, customers: 1 }, noData),
    ).toThrow('بين 0 و100');
  });

  it('bands, months, achievement', () => {
    expect(bandFor(81.52, DEFAULT_BANDS)!.name_ar).toBe('جيد جدًا');
    expect(bandFor(90, DEFAULT_BANDS)!.name_ar).toBe('ممتاز');
    expect(bandFor(10, DEFAULT_BANDS)!.name_ar).toBe('يحتاج تحسين');
    expect(monthsInRange('2026-10-15', '2026-12-02')).toEqual(['2026-10', '2026-11', '2026-12']);
    const row = {
      contracts_target: 10,
      contracts_achieved: 5,
      sales_target: 0,
      sales_achieved: 9000,
    };
    expect(achievementPct(row as never)).toBe(50); // no sales target → contracts only
  });
});

describe('demo store (mirror of save_performance_review + targets RLS)', () => {
  it('achievement comes from real (demo) sales against the HR target', async () => {
    loginAs('hr');
    const a = await autoScores('e3', from, to); // نورة العتيبي — sales, شرورة
    expect(a.sales_count.target).toBe(12);
    expect(a.sales_amount.target).toBe(60000);
    expect(a.sales_count.score).toBe(ratioScore(a.sales_count.achieved, 12));
  });

  it('HR reviews a seller: role criteria, weighted, editable, archivable', async () => {
    loginAs('hr');
    const id = await saveReview({
      id: null,
      employee_id: 'e3',
      period: 'الشهر الحالي',
      period_from: from,
      period_to: to,
      manual: { quality: 90, teamwork: 85, customers: 95 },
      notes: 'ممتازة في المتابعة',
    });
    let r = (await listReviews()).find((x) => x.id === id)!;
    expect(r.criteria).toHaveLength(6);
    expect(r.score).toBeGreaterThan(0);

    // criteria change later; an edit keeps the review's own weights
    await saveCriterion({ ...DEFAULT_CRITERIA[0]!, weight: 60 }, false);
    await saveReview({
      id,
      employee_id: 'e3',
      period: 'الشهر الحالي',
      period_from: from,
      period_to: to,
      manual: { quality: 100, teamwork: 85, customers: 95 },
      notes: '',
    });
    r = (await listReviews()).find((x) => x.id === id)!;
    expect(r.criteria.find((c) => c.code === 'quality')!.weight).toBe(25);
    await saveCriterion({ ...DEFAULT_CRITERIA[0]! }, false);

    await setReviewActive(id, false);
    await expect(
      saveReview({
        id,
        employee_id: 'e3',
        period: 'x',
        period_from: from,
        period_to: to,
        manual: {},
        notes: '',
      }),
    ).rejects.toThrow('مؤرشف');
    await setReviewActive(id, true);
  });

  it('guards: self-review, period, scope', async () => {
    loginAs('hr'); // خالد الدوسري = e6
    await expect(
      saveReview({
        id: null,
        employee_id: 'e6',
        period: 'x',
        period_from: from,
        period_to: to,
        manual: {},
        notes: '',
      }),
    ).rejects.toThrow('نفسه');
    await expect(
      saveReview({
        id: null,
        employee_id: 'e3',
        period: 'x',
        period_from: to,
        period_to: '2020-01-01',
        manual: {},
        notes: '',
      }),
    ).rejects.toThrow('غير صحيحة');
    loginAs('branch_manager'); // جازان
    await expect(
      saveReview({
        id: null,
        employee_id: 'e3',
        period: 'x',
        period_from: from,
        period_to: to,
        manual: { quality: 1, teamwork: 1, customers: 1 },
        notes: '',
      }),
    ).rejects.toThrow('صلاحية');
  });

  it('targets: HR sets (upsert per month); the seller reads only her own and cannot set', async () => {
    loginAs('hr');
    await saveTarget({
      employee_id: 'e3',
      period: month,
      contracts_target: 15,
      sales_amount_target: 70000,
      notes: '',
    });
    expect(
      (await listTargets()).filter((t) => t.employee_id === 'e3' && t.period === month),
    ).toHaveLength(1);
    await expect(
      saveTarget({
        employee_id: 'e3',
        period: month,
        contracts_target: -1,
        sales_amount_target: 0,
        notes: '',
      }),
    ).rejects.toThrow('سالب');
    const board = await targetBoard(month);
    expect(board.find((r) => r.employee_id === 'e3')!.contracts_target).toBe(15);

    loginAs('sales'); // نورة العتيبي
    const mine = await listTargets();
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t) => t.employee_name === 'نورة العتيبي')).toBe(true);
    await expect(
      saveTarget({
        employee_id: 'e3',
        period: month,
        contracts_target: 1,
        sales_amount_target: 1,
        notes: '',
      }),
    ).rejects.toThrow('الموارد البشرية');
  });
});
