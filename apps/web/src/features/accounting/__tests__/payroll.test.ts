import { describe, expect, it } from 'vitest';
import { assertBalanced } from '@/features/accounting/data/engine';
import { buildPayrollEntry, employerGosi, payrollTotals } from '@/features/accounting/data/payroll';
import type { Payslip } from '@/features/hr/types';

function slip(over: Partial<Payslip>): Payslip {
  return {
    employee_id: 'e1',
    employee_name: 'موظف',
    nationality: 'السعودية',
    basic: 12000,
    housing_allowance: 2000,
    transport_allowance: 0,
    other_allowance: 0,
    present_days: 30,
    absent_days: 0,
    late_count: 0,
    late_minutes: 0,
    overtime_hours: 0,
    overtime_amount: 0,
    additions: 0,
    absence_deduction: 0,
    late_deduction: 0,
    gosi_system: 'new',
    gosi_employee: 1400,
    manual_deductions: 0,
    gross: 14000,
    total_deductions: 1400,
    net: 12600,
    ...over,
  };
}

describe('payroll → accounting bridge (HR module 05 link)', () => {
  it('computes employer GOSI by nationality/system', () => {
    expect(employerGosi(slip({}))).toBe(1680); // 14000 × 12% (saudi new)
    expect(employerGosi(slip({ gosi_system: 'old' }))).toBe(1645); // 14000 × 11.75%
    expect(
      employerGosi(
        slip({ nationality: 'الهند', basic: 5000, housing_allowance: 800, gosi_employee: 0 }),
      ),
    ).toBe(116); // 5800 × 2%
  });

  it('aggregates totals from HR payslips', () => {
    const slips = [
      slip({}),
      slip({
        employee_id: 'e2',
        nationality: 'الهند',
        basic: 5000,
        housing_allowance: 800,
        gosi_employee: 0,
        gross: 5800,
        total_deductions: 0,
        net: 5800,
      }),
    ];
    const t = payrollTotals(slips);
    expect(t.earnings).toBe(19800); // 14000 + 5800
    expect(t.employeeGosi).toBe(1400);
    expect(t.employerGosi).toBe(1796); // 1680 + 116
    expect(t.payable).toBe(18400); // 19800 − 1400
  });

  it('builds a BALANCED accrual entry: DR 5100+5200 / CR 2140+2130', () => {
    const slips = [
      slip({}),
      slip({
        employee_id: 'e2',
        nationality: 'الهند',
        basic: 5000,
        housing_allowance: 800,
        gosi_employee: 0,
        gross: 5800,
        total_deductions: 0,
        net: 5800,
      }),
    ];
    const e = buildPayrollEntry(slips, '2026-06', null);
    expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(e.lines.find((l) => l.account_code === '5100')?.debit).toBe(19800);
    expect(e.lines.find((l) => l.account_code === '5200')?.debit).toBe(1796);
    expect(e.lines.find((l) => l.account_code === '2140')?.credit).toBe(3196);
    expect(e.lines.find((l) => l.account_code === '2130')?.credit).toBe(18400);
    expect(e.source_type).toBe('payroll');
  });
});
