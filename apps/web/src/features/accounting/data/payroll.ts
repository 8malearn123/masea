import type { Payslip, PayrollRun } from '@/features/hr/types';
import { employerGosiFor } from '@/features/hr/api/hr.api';
import type { JournalEntry, JournalLine } from '@/features/accounting/types';

/**
 * Payroll → accounting bridge (link with HR module 05). Builds the accrual
 * journal entry from the HR payslips. Mirror of post_payroll_run (0030):
 *   DR 5100 مصروف الرواتب (gross − absence − late)
 *   DR 5200 حصة الشركة من التأمينات
 *   / CR 2140 تأمينات مستحقة (employee + employer GOSI)
 *   / CR 2130 رواتب مستحقة (earnings − employee GOSI)
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Employer GOSI share for one payslip — single source: HR's employerGosiFor
 *  (mirror of gosi_config in 0022_payroll.sql; base = basic + housing, capped). */
export function employerGosi(p: Payslip): number {
  return employerGosiFor(p.basic, p.housing_allowance, p.nationality === 'السعودية', p.gosi_system);
}

export interface PayrollTotals {
  count: number;
  /** expense 5100: gross − absence − late − leave deductions */
  earnings: number;
  employeeGosi: number;
  employerGosi: number;
  /** recovered advances → CR 1160 */
  advances: number;
  /** penalties → CR 2170 (for the workers' benefit, not company revenue) */
  penalties: number;
  /** salaries payable 2130 = the net actually paid */
  payable: number;
  netPay: number;
}

/** Totals from a frozen run — the only figures accounting posts from. */
export function totalsFromRun(run: PayrollRun): PayrollTotals {
  return {
    count: run.employee_count,
    earnings: run.total_earnings,
    employeeGosi: run.total_gosi_employee,
    employerGosi: run.total_gosi_employer,
    advances: run.total_advances,
    penalties: run.total_penalties,
    payable: round2(
      run.total_earnings - run.total_gosi_employee - run.total_advances - run.total_penalties,
    ),
    netPay: run.total_net,
  };
}

export function payrollTotals(slips: Payslip[]): PayrollTotals {
  const sum = (f: (p: Payslip) => number) => round2(slips.reduce((s, p) => s + f(p), 0));
  const earnings = sum(
    (p) => p.gross - p.absence_deduction - p.late_deduction - (p.leave_deduction ?? 0),
  );
  const employeeGosi = sum((p) => p.gosi_employee);
  const advances = sum((p) => p.advance_deductions ?? 0);
  const penalties = sum((p) => p.penalty_deductions ?? 0);
  return {
    count: slips.length,
    earnings,
    employeeGosi,
    employerGosi: sum((p) => employerGosi(p)),
    advances,
    penalties,
    payable: round2(earnings - employeeGosi - advances - penalties),
    netPay: sum((p) => p.net),
  };
}

const monthIndex = (period: string): number => Number(period.slice(5, 7)) || 0;
const monthEnd = (period: string): string => {
  const d = new Date(`${period}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

/**
 * Balanced accrual entry (mirror of post_payroll_run, 0071):
 *   DR 5100 earnings + DR 5200 employer GOSI
 *   / CR 2140 GOSI (both shares) + CR 1160 advances + CR 2170 penalties + CR 2130 net payable
 */
export function buildPayrollEntry(
  input: Payslip[] | PayrollTotals,
  period: string,
  branch: string | null,
): JournalEntry {
  const t = Array.isArray(input) ? payrollTotals(input) : input;
  const line = (account_code: string, debit: number, credit: number, description: string) => ({
    account_code,
    debit,
    credit,
    description,
  });
  const lines: JournalLine[] = [
    line('5100', t.earnings, 0, 'مصروف الرواتب'),
    ...(t.employerGosi > 0 ? [line('5200', t.employerGosi, 0, 'حصة الشركة من التأمينات')] : []),
    ...(t.employeeGosi + t.employerGosi > 0
      ? [line('2140', 0, round2(t.employeeGosi + t.employerGosi), 'تأمينات مستحقة (GOSI)')]
      : []),
    ...(t.advances > 0 ? [line('1160', 0, t.advances, 'استرداد سلف الموظفين')] : []),
    ...(t.penalties > 0 ? [line('2170', 0, t.penalties, 'جزاءات مقتطعة (لصالح العمال)')] : []),
    line('2130', 0, t.payable, 'رواتب مستحقة الدفع'),
  ];
  return {
    id: `je-payroll-${period}`,
    entry_no: 6000 + monthIndex(period),
    entry_date: monthEnd(period),
    branch,
    description: `قيد استحقاق رواتب ${period}`,
    reference: `PAYROLL-${period}`,
    source_type: 'payroll',
    status: 'posted',
    lines,
  };
}

/** Payment entry (mirror of pay_payroll_run): DR 2130 / CR bank — settles the payable. */
export function buildPayrollPaymentEntry(
  t: PayrollTotals,
  period: string,
  paidOn: string,
  bankCode: string,
): JournalEntry {
  return {
    id: `je-payroll-pay-${period}`,
    entry_no: 6100 + monthIndex(period),
    entry_date: paidOn,
    branch: null,
    description: `صرف رواتب ${period}`,
    reference: `PAYROLL-PAY-${period}`,
    source_type: 'payroll',
    status: 'posted',
    lines: [
      { account_code: '2130', debit: t.payable, credit: 0, description: 'إطفاء رواتب مستحقة' },
      {
        account_code: bankCode,
        debit: 0,
        credit: t.payable,
        description: 'تحويل الرواتب (حماية الأجور)',
      },
    ],
  };
}
