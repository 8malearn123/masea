/** المرحلة و — دورة المسير (مرآة 0071): احتساب جزئي، أربع أعين، تجميد، ترحيل، صرف، WPS. */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  addAdjustment,
  approvePayrollRun,
  calculatePayrollRun,
  calculatePayslip,
  employmentFactor,
  getPayrollRun,
  payPayrollRun,
  postPayrollRun,
} from '@/features/hr/api/hr.api';
import { assertBalanced } from '@/features/accounting/data/engine';
import {
  buildPayrollEntry,
  buildPayrollPaymentEntry,
  totalsFromRun,
} from '@/features/accounting/data/payroll';
import { buildPayslipHtml, buildWpsTable, maskIban } from '@/features/hr/lib/payrollDocs';
import type { Employee, PayrollAdjustment, Payslip } from '@/features/hr/types';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const base: Employee = {
  id: 'x1',
  full_name: 'فيصل العنزي',
  job_title: 'محاسب',
  department: 'المالية',
  branch: 'نجران',
  nationality: 'السعودية',
  base_salary: 10000,
  allowances: 3500,
  housing_allowance: 2500,
  transport_allowance: 1000,
  other_allowance: 0,
  status: 'active',
  role: 'accountant',
  join_date: '2024-01-01',
  phone: '',
  email: '',
  absence_days: 0,
  late_count: 0,
  gosi_system: 'new',
};
const adj = (type: PayrollAdjustment['type'], amount: number): PayrollAdjustment => ({
  id: `a-${type}`,
  employee_id: 'x1',
  employee_name: base.full_name,
  type,
  amount,
  reason: '',
  period: '2026-11',
  submitted_by: '',
  status: 'approved',
});

describe('payslip (same numbers as SQL test 98)', () => {
  it('splits advance and penalty and computes the employer share', () => {
    const s = calculatePayslip(base, '2026-11', [adj('advance', 1000), adj('penalty', 200)]);
    expect(s.net).toBe(11050); // 13500 − 1250 − 1000 − 200
    expect(s.advance_deductions).toBe(1000);
    expect(s.penalty_deductions).toBe(200);
    expect(s.gosi_employer).toBe(1500); // 12500 × 12%
  });

  it('prorates a mid-month hire and a mid-month termination', () => {
    expect(employmentFactor({ ...base, join_date: '2026-11-16' }, '2026-11', 30)).toEqual({
      eligible: 15,
      factor: 0.5,
    });
    const s = calculatePayslip(
      {
        ...base,
        nationality: 'الهند',
        base_salary: 6000,
        allowances: 600,
        housing_allowance: 600,
        transport_allowance: 0,
        join_date: '2026-11-16',
      },
      '2026-11',
      [],
    );
    expect(s.basic).toBe(3000);
    expect(s.eligible_days).toBe(15);
    const left = employmentFactor({ ...base, termination_date: '2026-11-10' }, '2026-11', 30);
    expect(left.eligible).toBe(10);
    expect(employmentFactor(base, '2026-02', 30).factor).toBe(1); // full short month = full salary
  });
});

describe('run lifecycle (demo mirror of 0071)', () => {
  it('HR prepares, cannot approve own run; GM approves; then frozen', async () => {
    loginAs('hr');
    await calculatePayrollRun('2026-10');
    const r1 = (await getPayrollRun('2026-10'))!;
    expect(r1.run.status).toBe('calculated');
    expect(r1.slips.length).toBe(r1.run.employee_count);
    expect(r1.run.total_net).toBeCloseTo(
      r1.slips.reduce((s, p) => s + p.net, 0),
      2,
    );
    await expect(approvePayrollRun('2026-10', r1.run.id)).rejects.toThrow('الأربع أعين');

    loginAs('admin');
    await approvePayrollRun('2026-10', r1.run.id);
    expect((await getPayrollRun('2026-10'))!.run.status).toBe('approved');
    await expect(calculatePayrollRun('2026-10')).rejects.toThrow('معتمد');
    expect(() =>
      addAdjustment({ ...adj('bonus', 500), employee_id: 'e1', period: '2026-10' }),
    ).toThrow('الشهر التالي');
    expect(() =>
      addAdjustment({ ...adj('bonus', 500), employee_id: 'e1', period: '2026-11' }),
    ).not.toThrow();
  });

  it('accounting sees totals only; branch manager sees no company run', async () => {
    loginAs('accountant');
    const r = (await getPayrollRun('2026-10'))!;
    expect(r.run.employee_count).toBeGreaterThan(0);
    expect(r.slips).toEqual([]);
    loginAs('branch_manager');
    expect(await getPayrollRun('2026-10')).toBeNull();
  });

  it('posts a balanced accrual entry, then a payment that settles the payable', async () => {
    loginAs('accountant');
    const { run } = (await getPayrollRun('2026-10'))!;
    await expect(payPayrollRun('2026-10', run.id, '2026-10-27', '1112', () => {})).rejects.toThrow(
      'رحّل',
    );
    let posted = 0;
    await postPayrollRun('2026-10', run.id, (_s, r) => {
      const e = buildPayrollEntry(totalsFromRun(r), '2026-10', null);
      expect(() => assertBalanced(e.lines)).not.toThrow();
      expect(e.lines.find((l) => l.account_code === '2130')?.credit).toBeCloseTo(r.total_net, 2);
      posted++;
    });
    await postPayrollRun('2026-10', run.id, () => posted++); // idempotent
    expect(posted).toBe(1);
    await payPayrollRun('2026-10', run.id, '2026-10-27', '1112', (r) => {
      const p = buildPayrollPaymentEntry(totalsFromRun(r), '2026-10', '2026-10-27', '1112');
      expect(() => assertBalanced(p.lines)).not.toThrow();
    });
    expect((await getPayrollRun('2026-10'))!.run.status).toBe('paid');
  });
});

describe('accounting entry splits advances and penalties', () => {
  it('CR 1160 advances, CR 2170 penalties, CR 2130 = net', () => {
    const s = calculatePayslip(base, '2026-11', [adj('advance', 1000), adj('penalty', 200)]);
    const e = buildPayrollEntry([s], '2026-11', null);
    expect(() => assertBalanced(e.lines)).not.toThrow();
    const cr = (c: string) => e.lines.find((l) => l.account_code === c)?.credit;
    expect(cr('1160')).toBe(1000);
    expect(cr('2170')).toBe(200);
    expect(cr('2130')).toBe(11050);
    expect(e.lines.some((l) => l.account_code === '4500')).toBe(false); // penalties are not revenue
  });
});

describe('WPS file and printed payslip', () => {
  const slip = (over: Partial<Payslip>): Payslip =>
    ({ ...calculatePayslip(base, '2026-11', []), ...over }) as Payslip;
  it('includes only valid IBANs and reports the rest', () => {
    const { table, missing } = buildWpsTable(
      [
        slip({ employee_name: 'فيصل', iban: 'SA0380000000608010167519', bank_name: 'الراجحي' }),
        slip({ employee_id: 'x2', employee_name: 'أنيل' }),
        slip({ employee_id: 'x3', employee_name: 'تركي', iban: 'SA0480000000608010167519' }),
      ],
      '2026-11',
    );
    expect(table.rows).toHaveLength(1);
    expect(missing).toEqual(['أنيل', 'تركي']);
    expect(table.headers).toContain('الآيبان');
    expect(table.footer?.at(-1)).toBe(table.rows[0]?.at(-1));
  });
  it('watermarks a draft slip, masks the IBAN and escapes text', () => {
    const s = slip({ employee_name: 'أحمد <script>', iban: 'SA0380000000608010167519' });
    const draft = buildPayslipHtml(s, '2026-11', 'calculated', false);
    expect(draft).toContain('مسودة');
    expect(draft).not.toContain('<script>');
    expect(draft).not.toContain('SA0380000000608010167519');
    expect(draft).toContain(maskIban(s.iban));
    expect(buildPayslipHtml(s, '2026-11', 'approved', false)).not.toContain('class="wm"');
  });
});
