/** المرحلة ي — تقارير الموارد البشرية (مرآة 0077 واختبار 99f). */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { reportRows, saveNitaqat, listNitaqat } from '@/features/hr/api/hrReports.api';
import {
  absenceRate,
  DEFAULT_NITAQAT,
  groupBy,
  nitaqatBand,
  presetRange,
  saudiWeight,
  saudisNeeded,
  saudization,
  turnover,
} from '@/features/hr/lib/hrReports';
import type { HrReportRow } from '@/features/hr/types';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

function row(p: Partial<HrReportRow>): HrReportRow {
  return {
    employee_id: Math.random().toString(36).slice(2),
    full_name: 'موظف',
    branch: 'نجران',
    department: 'العمليات',
    job_title: '',
    nationality: 'الهند',
    is_saudi: false,
    counts_saudization: false,
    nitaqat_wage: 3000,
    status: 'active',
    hire_date: '2024-01-01',
    termination_date: null,
    termination_reason: null,
    cost: 1000,
    cost_estimated: false,
    present_days: 20,
    late_days: 0,
    absent_days: 0,
    late_minutes: 0,
    leave_days: 0,
    ...p,
  };
}
const rule = { fullWage: 4000, halfWeight: 0.5 };
const saudi = (wage: number, extra: Partial<HrReportRow> = {}) =>
  row({
    nationality: 'السعودية',
    is_saudi: true,
    counts_saudization: true,
    nitaqat_wage: wage,
    ...extra,
  });

describe('report maths', () => {
  it('saudization: full / reduced weight, leavers out, band and gap', () => {
    expect(saudiWeight(saudi(5000), rule)).toBe(1);
    expect(saudiWeight(saudi(3000), rule)).toBe(0.5);
    expect(saudiWeight(row({}), rule)).toBe(0);
    const rows = [
      saudi(5000),
      saudi(3000),
      row({}),
      row({}),
      row({}),
      saudi(9000, { status: 'terminated' }),
    ];
    const s = saudization(rows, rule);
    expect(s).toEqual({ saudis: 1.5, total: 5, pct: 30 });
    expect(nitaqatBand(s.pct, DEFAULT_NITAQAT)!.name_ar).toBe('أخضر مرتفع');
    expect(nitaqatBand(5, DEFAULT_NITAQAT)!.name_ar).toBe('أحمر');
    // to 40%: (1.5 + x) / (5 + x) >= 0.4 → x >= 0.833 → 1
    expect(saudisNeeded(s, 40)).toBe(1);
    expect(saudisNeeded(s, 20)).toBe(0);
  });

  it('groups: cost, headcount, absence; cost hidden when any row is hidden', () => {
    const rows = [
      row({ branch: 'نجران', cost: 9000, absent_days: 2, present_days: 18 }),
      row({ branch: 'نجران', cost: 6000, status: 'terminated' }),
      row({ branch: 'جازان', cost: 4000 }),
    ];
    const g = groupBy(rows, 'branch');
    expect(g[0]).toMatchObject({ key: 'نجران', headcount: 1, cost: 15000, leavers: 1, absent: 2 });
    expect(g[0]!.absenceRate).toBe(absenceRate(38, 0, 2));
    expect(groupBy([row({ cost: null })], 'branch')[0]!.cost).toBeNull();
  });

  it('turnover = leavers ÷ average headcount', () => {
    const rows = [
      row({}),
      row({}),
      row({}),
      row({
        termination_date: '2026-02-10',
        termination_reason: 'resignation',
        status: 'terminated',
      }),
      row({ hire_date: '2026-02-01' }),
    ];
    const t = turnover(rows, '2026-01-01', '2026-03-31');
    expect(t).toMatchObject({ leavers: 1, startHeadcount: 4, endHeadcount: 4, rate: 25 });
    expect(t.byReason).toEqual([{ reason: 'resignation', count: 1 }]);
  });

  it('presets', () => {
    const now = new Date(Date.UTC(2026, 10, 7));
    expect(presetRange('month', now)).toEqual({ from: '2026-11-01', to: '2026-11-07' });
    expect(presetRange('quarter', now)).toEqual({ from: '2026-10-01', to: '2026-11-07' });
    expect(presetRange('quarter', new Date(Date.UTC(2027, 0, 5))).from).toBe('2027-01-01');
    expect(presetRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-11-07' });
  });
});

describe('demo report rows (mirror of hr_report_rows)', () => {
  const { from, to } = presetRange('month');

  it('HR: every branch, with cost', async () => {
    loginAs('hr');
    const rows = await reportRows(from, to);
    expect(new Set(rows.map((r) => r.branch)).size).toBeGreaterThan(1);
    expect(rows.every((r) => r.cost !== null && r.cost > 0)).toBe(true);
    expect(rows.some((r) => r.is_saudi)).toBe(true);
  });

  it('branch manager: own branch, no salaries; sales: no access', async () => {
    loginAs('branch_manager');
    const rows = await reportRows(from, to);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.branch === 'جازان' && r.cost === null)).toBe(true);
    loginAs('sales');
    await expect(reportRows(from, to)).rejects.toThrow('صلاحية');
    await expect(reportRows(to, from)).rejects.toThrow('غير صحيحة');
  });

  it('nitaqat bands are managed by HR only', async () => {
    loginAs('hr');
    const b = (await listNitaqat()).find((x) => x.code === 'green_mid')!;
    await saveNitaqat({ ...b, min_pct: 25 }, false);
    expect((await listNitaqat()).find((x) => x.code === 'green_mid')!.min_pct).toBe(25);
    loginAs('branch_manager');
    await expect(saveNitaqat({ ...b, min_pct: 1 }, false)).rejects.toThrow('الموارد البشرية');
  });
});
