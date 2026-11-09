/** مسير رواتب العاملات وملف WPS (مرآة 0079 واختبار 99h). */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  approveWorkerRun,
  calculateWorkerRun,
  decideWorkerAdjustment,
  getWorkerRun,
  listWorkerAdjustments,
  payWorkerRun,
  postWorkerRun,
  proposeWorkerAbsences,
  submitWorkerAdjustment,
} from '@/features/hr/api/workerPayroll.api';
import {
  absenceAmount,
  branchSplit,
  buildWorkerWpsTable,
  computeWorkerSlip,
  eligibleDays,
  workerRunTotals,
} from '@/features/hr/lib/workerPayrollEngine';
import { assertBalanced } from '@/features/accounting/data/engine';
import {
  buildWorkerPaymentEntry,
  buildWorkerPayrollEntry,
} from '@/features/accounting/data/payroll';
import type { HouseWorker, WorkerAdjustment, WorkerPayslip } from '@/features/hr/types';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

function worker(p: Partial<HouseWorker> = {}): HouseWorker {
  return {
    id: 'x1',
    full_name: 'ماري جوي سانتوس',
    photo_url: null,
    nationality: 'الفلبين',
    profession: 'عاملة منزلية',
    age: 30,
    experience_years: 3,
    monthly_salary: 1500,
    languages: [],
    skills: [],
    status: 'available',
    branch: 'نجران',
    bio: '',
    passport_no: 'P1',
    iqama_no: '2433000001',
    border_no: '',
    birth_date: '',
    arrival_date: '2025-01-10',
    phone: '',
    dorm: '',
    barcode: '',
    bank_name: 'مصرف الراجحي',
    iban: 'SA0380000000608010167519',
    account_holder: '',
    payment_method: 'bank',
    ...p,
  };
}
const adj = (p: Partial<WorkerAdjustment>): WorkerAdjustment => ({
  id: Math.random().toString(36),
  worker_id: 'x1',
  worker_name: '',
  branch: 'نجران',
  type: 'bonus',
  amount: 0,
  reason: '',
  period: '2026-10',
  status: 'approved',
  source: 'manual',
  days: null,
  submitted_by: '',
  ...p,
});

describe('engine (same numbers as 99h)', () => {
  it('eligible days from the arrival date; proration', () => {
    expect(eligibleDays({ arrival_date: '2025-01-10' }, '2026-10')).toBe(30);
    expect(eligibleDays({ arrival_date: '2026-10-16' }, '2026-10')).toBe(16);
    expect(eligibleDays({ arrival_date: '2026-11-02' }, '2026-10')).toBe(0);
    expect(eligibleDays({ arrival_date: '', is_active: false }, '2026-10')).toBe(0);
    const b = computeWorkerSlip(
      worker({ monthly_salary: 1400, arrival_date: '2026-10-16' }),
      '2026-10',
      [],
    );
    expect(b).toMatchObject({ eligible_days: 16, base_pay: 746.67, net: 746.67 });
  });

  it('only approved adjustments count; absence proposal = daily wage × days', () => {
    expect(absenceAmount(1500, 2)).toBe(100);
    const s = computeWorkerSlip(worker(), '2026-10', [
      adj({ type: 'absence', amount: 100, days: 2 }),
      adj({ type: 'advance', amount: 300 }),
      adj({ type: 'bonus', amount: 999, status: 'pending' }),
      adj({ type: 'bonus', amount: 50, status: 'rejected' }),
    ])!;
    expect(s).toMatchObject({
      gross: 1500,
      absence_deduction: 100,
      absence_days: 2,
      advance_deductions: 300,
      net: 1100,
    });
    expect(() =>
      computeWorkerSlip(worker(), '2026-10', [adj({ type: 'advance', amount: 2000 })]),
    ).toThrow('تتجاوز');
  });

  it('totals, branch split and the WPS file (everyone included, cash flagged)', () => {
    const a = computeWorkerSlip(worker(), '2026-10', [
      adj({ type: 'absence', amount: 100, days: 2 }),
      adj({ type: 'advance', amount: 300 }),
    ])!;
    const d = computeWorkerSlip(
      worker({
        id: 'x4',
        full_name: 'روكسانا خاتون',
        payment_method: 'cash',
        iban: '',
        monthly_salary: 1300,
      }),
      '2026-10',
      [adj({ worker_id: 'x4', type: 'bonus', amount: 200 })],
    )!;
    const b = computeWorkerSlip(
      worker({ id: 'x2', branch: 'جازان', monthly_salary: 1400, arrival_date: '2026-10-16' }),
      '2026-10',
      [],
    )!;
    const slips: WorkerPayslip[] = [a, d, b];
    const t = workerRunTotals(slips);
    expect(t).toMatchObject({
      employee_count: 3,
      total_net: 3346.67,
      total_advances: 300,
      total_earnings: 3646.67,
    });
    expect(t.total_earnings - t.total_advances - t.total_penalties).toBe(t.total_net);
    expect(branchSplit(slips).find((x) => x.branch === 'نجران')).toMatchObject({
      earnings: 2900,
      net: 2600,
      advances: 300,
    });
    const wps = buildWorkerWpsTable(slips, '2026-10');
    expect(wps.table.rows).toHaveLength(3);
    expect(wps.flagged).toEqual(['روكسانا خاتون']);
    expect(wps.table.rows[1]!.at(-1)).toBe('صرف نقدي — بدون آيبان');
    expect(wps.table.footer!.at(-2)).toBe(3346.67);
    const entry = buildWorkerPayrollEntry(slips, '2026-10');
    expect(() => assertBalanced(entry.lines)).not.toThrow();
    const lines5120 = entry.lines.filter((l) => l.account_code === '5120');
    expect(lines5120.map((l) => [l.branch, l.debit])).toEqual([
      ['نجران', 2900],
      ['جازان', 746.67],
    ]);
    expect(() =>
      assertBalanced(buildWorkerPaymentEntry(slips, '2026-10', '2026-11-02', '1112').lines),
    ).not.toThrow();
  });
});

describe('demo: the whole cycle (mirror of the SQL rules)', () => {
  const period = new Date().toISOString().slice(0, 7);

  it('absence becomes a pending proposal; only approved items enter the run; four eyes; post and pay', async () => {
    loginAs('hr');
    const n = await proposeWorkerAbsences(period);
    expect(n).toBeGreaterThan(0);
    let adjs = await listWorkerAdjustments(period);
    expect(adjs.find((a) => a.source === 'housing_absence' && a.worker_id === 'w3')).toMatchObject({
      status: 'pending',
      type: 'absence',
      days: 2,
    });
    await proposeWorkerAbsences(period); // idempotent: the pending proposal is refreshed, not duplicated
    adjs = (await listWorkerAdjustments(period)).filter(
      (a) => a.source === 'housing_absence' && a.worker_id === 'w3',
    );
    expect(adjs).toHaveLength(1);
    const abs = adjs[0]!;

    await calculateWorkerRun(period);
    let run = (await getWorkerRun(period))!;
    const before = run.slips.find((s) => s.worker_id === 'w3')!;
    expect(before.absence_deduction).toBe(0); // pending → not counted

    loginAs('branch_manager');
    await expect(decideWorkerAdjustment(abs.id, true)).rejects.toThrow('مدير الموارد البشرية');
    await submitWorkerAdjustment({
      worker_id: 'w3',
      type: 'allowance',
      amount: 100,
      reason: 'بدل مواصلات',
      period,
    });
    await expect(
      submitWorkerAdjustment({ worker_id: 'w1', type: 'bonus', amount: 50, reason: 'x', period }),
    ).rejects.toThrow('نطاقك');

    loginAs('hr');
    await decideWorkerAdjustment(abs.id, true);
    await calculateWorkerRun(period);
    run = (await getWorkerRun(period))!;
    const after = run.slips.find((s) => s.worker_id === 'w3')!;
    expect(after.absence_deduction).toBe(abs.amount);
    expect(after.net).toBe(before.net - abs.amount);
    await expect(approveWorkerRun(period, run.run.id)).rejects.toThrow('الأربع أعين');

    loginAs('admin');
    await approveWorkerRun(period, run.run.id);
    await expect(calculateWorkerRun(period)).rejects.toThrow('معتمد');
    loginAs('hr');
    await expect(
      submitWorkerAdjustment({ worker_id: 'w3', type: 'bonus', amount: 10, reason: 'x', period }),
    ).rejects.toThrow('معتمد');

    loginAs('accountant');
    const posted: unknown[] = [];
    await expect(
      payWorkerRun(period, run.run.id, period + '-28', '1112', () => undefined),
    ).rejects.toThrow('رحّل');
    await postWorkerRun(period, run.run.id, (slips) =>
      posted.push(buildWorkerPayrollEntry(slips, period)),
    );
    await postWorkerRun(period, run.run.id, (slips) => posted.push(slips)); // idempotent
    expect(posted).toHaveLength(1);
    await payWorkerRun(period, run.run.id, period + '-28', '1112', () => undefined);
    loginAs('hr');
    expect((await getWorkerRun(period))!.run.status).toBe('paid');
  });
});
