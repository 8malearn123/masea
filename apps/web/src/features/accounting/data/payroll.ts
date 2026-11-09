import {
  type DocCostRow,
  type EosSettlement,
  type Payslip,
  type PayrollRun,
} from '@/features/hr/types';
import { employerGosiFor } from '@/features/hr/api/hr.api';
import { branchSplit } from '@/features/hr/lib/workerPayrollEngine';
import type { WorkerPayslip } from '@/features/hr/types';
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

/* ------------------------- end of service (0073) -------------------------- */
const eosRef = (id: string) => id.replace(/[^a-z0-9]/gi, '').slice(-8);

/** Settlement entry (mirror of post_eos_settlement): award from the provision. */
export function buildEosSettlementEntry(s: EosSettlement): JournalEntry {
  const l = (account_code: string, debit: number, credit: number, description: string) => ({
    account_code,
    debit,
    credit,
    description,
  });
  const lines: JournalLine[] = [
    ...(s.award > 0 ? [l('2210', s.award, 0, 'مكافأة نهاية الخدمة (من المخصص)')] : []),
    ...(s.leave_amount > 0 ? [l('5100', s.leave_amount, 0, 'بدل رصيد الإجازات')] : []),
    ...(s.art77_amount + s.other_additions > 0
      ? [l('5150', round2(s.art77_amount + s.other_additions), 0, 'تعويضات ومستحقات أخرى')]
      : []),
    ...(s.other_deductions > 0
      ? [l('1160', 0, s.other_deductions, 'مبالغ مستحقة على الموظف')]
      : []),
    l('2130', 0, s.net, 'مستحقات نهاية الخدمة'),
  ];
  return {
    id: `je-eos-${s.id}`,
    entry_no: 6500 + (Number.parseInt(eosRef(s.id).slice(-3), 36) % 400),
    entry_date: s.end_date,
    branch: null,
    description: `تسوية نهاية خدمة — ${s.employee_name}`,
    reference: `EOS-${eosRef(s.id)}`,
    source_type: 'payroll',
    status: 'posted',
    lines,
  };
}

export function buildEosPaymentEntry(
  s: EosSettlement,
  paidOn: string,
  bankCode: string,
): JournalEntry {
  return {
    id: `je-eos-pay-${s.id}`,
    entry_no: 6900 + (Number.parseInt(eosRef(s.id).slice(-3), 36) % 90),
    entry_date: paidOn,
    branch: null,
    description: `صرف تسوية نهاية خدمة — ${s.employee_name}`,
    reference: `EOS-PAY-${eosRef(s.id)}`,
    source_type: 'payroll',
    status: 'posted',
    lines: [
      { account_code: '2130', debit: s.net, credit: 0, description: 'إطفاء مستحقات نهاية الخدمة' },
      { account_code: bankCode, debit: 0, credit: s.net, description: 'صرف تسوية نهاية الخدمة' },
    ],
  };
}

/** Monthly true-up: DR 5150 / CR 2210 (reversed when the liability fell). */
export function buildEosProvisionEntry(delta: number, period: string): JournalEntry {
  const d = round2(Math.abs(delta));
  const up = delta > 0;
  return {
    id: `je-eos-prov-${period}`,
    entry_no: 6200 + (Number(period.slice(5, 7)) || 0),
    entry_date: monthEnd(period),
    branch: null,
    description: `مخصص مكافأة نهاية الخدمة ${period}`,
    reference: `EOS-PROV-${period}`,
    source_type: 'payroll',
    status: 'posted',
    lines: [
      {
        account_code: '5150',
        debit: up ? d : 0,
        credit: up ? 0 : d,
        description: 'مصروف مكافأة نهاية الخدمة',
      },
      {
        account_code: '2210',
        debit: up ? 0 : d,
        credit: up ? d : 0,
        description: 'مخصص مكافأة نهاية الخدمة',
      },
    ],
  };
}

/** Government fee of a renewed document (0074): DR 5160 / CR bank — post_document_cost. */
export function buildDocCostEntry(
  row: DocCostRow,
  paidOn: string,
  bankCode: string,
  typeLabel = 'وثيقة',
): JournalEntry {
  const ref = row.id.replace(/[^a-z0-9]/gi, '').slice(-8);
  const label = typeLabel;
  return {
    id: `je-doc-${row.id}`,
    entry_no: 6400 + (Number.parseInt(ref.slice(-3), 36) % 90 || 0),
    entry_date: paidOn,
    branch: row.branch || null,
    description: `رسوم حكومية (${label}) — ${row.owner_name}`,
    reference: `DOC-${ref}`,
    source_type: 'payroll',
    status: 'posted',
    lines: [
      {
        account_code: '5160',
        debit: row.renewal_cost,
        credit: 0,
        description: `رسوم حكومية — ${row.owner_name}`,
      },
      {
        account_code: bankCode,
        debit: 0,
        credit: row.renewal_cost,
        description: 'سداد رسوم حكومية',
      },
    ],
  };
}

/**
 * Workers run accrual (mirror of post_worker_payroll, 0079) — every amount is
 * charged to the worker's branch: DR 5120 / CR 1160 advances / CR 2170
 * penalties / CR 2130 net payable, one set of lines per branch.
 */
export function buildWorkerPayrollEntry(slips: WorkerPayslip[], period: string): JournalEntry {
  const lines: JournalLine[] = [];
  branchSplit(slips).forEach((b) => {
    lines.push({
      account_code: '5120',
      debit: b.earnings,
      credit: 0,
      branch: b.branch || null,
      description: 'رواتب العمالة المنزلية',
    });
    if (b.advances > 0)
      lines.push({
        account_code: '1160',
        debit: 0,
        credit: b.advances,
        branch: b.branch || null,
        description: 'استرداد سلف العاملات',
      });
    if (b.penalties > 0)
      lines.push({
        account_code: '2170',
        debit: 0,
        credit: b.penalties,
        branch: b.branch || null,
        description: 'جزاءات مقتطعة (لصالح العمال)',
      });
    lines.push({
      account_code: '2130',
      debit: 0,
      credit: b.net,
      branch: b.branch || null,
      description: 'رواتب عاملات مستحقة الدفع',
    });
  });
  return {
    id: `je-wpayroll-${period}`,
    entry_no: 6100 + monthIndex(period),
    entry_date: monthEnd(period),
    branch: null,
    description: `قيد استحقاق رواتب العاملات ${period}`,
    reference: `PAYROLL-W-${period}`,
    source_type: 'payroll',
    status: 'posted',
    lines,
  };
}

/** Workers run payment (mirror of pay_worker_payroll): DR 2130 / CR bank per branch. */
export function buildWorkerPaymentEntry(
  slips: WorkerPayslip[],
  period: string,
  paidOn: string,
  bankCode: string,
): JournalEntry {
  const lines: JournalLine[] = [];
  branchSplit(slips).forEach((b) => {
    lines.push({
      account_code: '2130',
      debit: b.net,
      credit: 0,
      branch: b.branch || null,
      description: 'إطفاء رواتب العاملات المستحقة',
    });
    lines.push({
      account_code: bankCode,
      debit: 0,
      credit: b.net,
      branch: b.branch || null,
      description: 'تحويل رواتب العاملات (حماية الأجور)',
    });
  });
  return {
    id: `je-wpayroll-pay-${period}`,
    entry_no: 6150 + monthIndex(period),
    entry_date: paidOn,
    branch: null,
    description: `صرف رواتب العاملات ${period}`,
    reference: `PAYROLL-W-PAY-${period}`,
    source_type: 'payroll',
    status: 'posted',
    lines,
  };
}
