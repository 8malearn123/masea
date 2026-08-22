import type { Payslip } from '@/features/hr/types';
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

// Employer GOSI rates (mirror of gosi_config in 0022_payroll.sql).
const GOSI = {
  ceiling: 45000,
  saudiOldCompany: 0.1175,
  saudiNewCompany: 0.12,
  nonSaudiCompany: 0.02,
} as const;

/** Employer GOSI share for one payslip (base = basic + housing, capped). */
export function employerGosi(p: Payslip): number {
  const base = Math.min(p.basic + p.housing_allowance, GOSI.ceiling);
  const rate =
    p.nationality === 'السعودية'
      ? p.gosi_system === 'old'
        ? GOSI.saudiOldCompany
        : GOSI.saudiNewCompany
      : GOSI.nonSaudiCompany;
  return round2(base * rate);
}

export interface PayrollTotals {
  count: number;
  earnings: number; // gross − absence − late
  employeeGosi: number;
  employerGosi: number;
  payable: number; // earnings − employee GOSI
  netPay: number; // sum of payslip net (cash to employees)
}

export function payrollTotals(slips: Payslip[]): PayrollTotals {
  const earnings = round2(
    slips.reduce((s, p) => s + (p.gross - p.absence_deduction - p.late_deduction), 0),
  );
  const employeeGosi = round2(slips.reduce((s, p) => s + p.gosi_employee, 0));
  const employerGosi = round2(slips.reduce((s, p) => s + employerGosi_(p), 0));
  return {
    count: slips.length,
    earnings,
    employeeGosi,
    employerGosi,
    payable: round2(earnings - employeeGosi),
    netPay: round2(slips.reduce((s, p) => s + p.net, 0)),
  };
}
// local alias to avoid shadowing the exported name inside reduce
const employerGosi_ = employerGosi;

const monthIndex = (period: string): number => Number(period.slice(5, 7)) || 0;

/** Build the balanced payroll journal entry for a period from HR payslips. */
export function buildPayrollEntry(
  slips: Payslip[],
  period: string,
  branch: string | null,
): JournalEntry {
  const t = payrollTotals(slips);
  const lines: JournalLine[] = [
    { account_code: '5100', debit: t.earnings, credit: 0, description: 'مصروف الرواتب' },
    ...(t.employerGosi > 0
      ? [
          {
            account_code: '5200',
            debit: t.employerGosi,
            credit: 0,
            description: 'حصة الشركة من التأمينات',
          },
        ]
      : []),
    ...(t.employeeGosi + t.employerGosi > 0
      ? [
          {
            account_code: '2140',
            debit: 0,
            credit: round2(t.employeeGosi + t.employerGosi),
            description: 'تأمينات مستحقة (GOSI)',
          },
        ]
      : []),
    { account_code: '2130', debit: 0, credit: t.payable, description: 'رواتب مستحقة الدفع' },
  ];
  return {
    id: `je-payroll-${period}`,
    entry_no: 6000 + monthIndex(period),
    entry_date: `${period}-28`,
    branch,
    description: `قيد رواتب ${period}`,
    reference: `PAYROLL-${period}`,
    source_type: 'payroll',
    status: 'posted',
    lines,
  };
}
