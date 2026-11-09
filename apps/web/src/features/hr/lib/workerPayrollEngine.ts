/**
 * Worker payroll engine (0079) — same rules as worker_eligible_days /
 * propose_worker_absences / calculate_worker_payroll_run, shared by the demo
 * store and the screens; and the WPS file for workers.
 */
import { BRAND } from '@masiat/shared';
import type { ExportTable } from '@/shared/lib/exportTable';
import { isValidSaudiIban } from '@/features/hr/lib/employeeValidation';
import type { HouseWorker, PayrollRun, WorkerAdjustment, WorkerPayslip } from '@/features/hr/types';

const r2 = (n: number) => Math.round(n * 100) / 100;

function monthBounds(period: string): { start: string; end: string; days: number } {
  const start = `${period}-01`;
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { start, end: d.toISOString().slice(0, 10), days: d.getUTCDate() };
}

/** Days paid this month: from the arrival date; inactive workers are not paid. */
export function eligibleDays(
  w: { arrival_date: string; is_active?: boolean },
  period: string,
  standardDays = 30,
): number {
  if (w.is_active === false) return 0;
  const { start, end } = monthBounds(period);
  if (!w.arrival_date || w.arrival_date <= start) return standardDays;
  if (w.arrival_date > end) return 0;
  return Math.round((Date.parse(end) - Date.parse(w.arrival_date)) / 86_400_000) + 1;
}

/** Proposed absence deduction: daily wage (salary ÷ standard days) × days. */
export function absenceAmount(monthlySalary: number, days: number, standardDays = 30): number {
  return r2(r2(monthlySalary / standardDays) * days);
}

/** One worker's payslip from her approved adjustments (null = not paid this month). */
export function computeWorkerSlip(
  w: HouseWorker & { is_active?: boolean },
  period: string,
  adjustments: WorkerAdjustment[],
  standardDays = 30,
): WorkerPayslip | null {
  const days = Math.min(eligibleDays(w, period, standardDays), standardDays);
  if (days <= 0) return null;
  const base = r2(w.monthly_salary * Math.min(days / standardDays, 1));
  const mine = adjustments.filter(
    (a) => a.worker_id === w.id && a.period === period && a.status === 'approved',
  );
  const sum = (types: string[]) =>
    r2(mine.filter((a) => types.includes(a.type)).reduce((s, a) => s + a.amount, 0));
  const additions = sum(['bonus', 'allowance', 'overtime']);
  const absence = sum(['absence']);
  const absenceDays = mine
    .filter((a) => a.type === 'absence')
    .reduce((s, a) => s + (a.days ?? 0), 0);
  const penalties = sum(['penalty']);
  const advances = sum(['advance']);
  const gross = r2(base + additions);
  const deductions = r2(absence + penalties + advances);
  if (deductions > gross)
    throw new Error(
      `خصومات «${w.full_name}» (${deductions}) تتجاوز مستحقها (${gross}) — راجع التعديلات المعتمدة`,
    );
  return {
    worker_id: w.id,
    worker_name: w.full_name,
    nationality: w.nationality,
    iqama_no: w.iqama_no,
    passport_no: w.passport_no,
    branch: w.branch,
    payment_method: w.payment_method,
    bank_name: w.bank_name,
    iban: w.iban,
    monthly_salary: w.monthly_salary,
    eligible_days: days,
    base_pay: base,
    additions,
    absence_days: absenceDays,
    absence_deduction: absence,
    penalty_deductions: penalties,
    advance_deductions: advances,
    gross,
    total_deductions: deductions,
    net: r2(gross - deductions),
  };
}

/** Run totals exactly as calculate_worker_payroll_run stores them. */
export function workerRunTotals(
  slips: WorkerPayslip[],
): Pick<
  PayrollRun,
  | 'employee_count'
  | 'total_gross'
  | 'total_deductions'
  | 'total_net'
  | 'total_earnings'
  | 'total_gosi_employee'
  | 'total_gosi_employer'
  | 'total_advances'
  | 'total_penalties'
> {
  const s = (f: (x: WorkerPayslip) => number) => r2(slips.reduce((t, x) => t + f(x), 0));
  return {
    employee_count: slips.length,
    total_gross: s((x) => x.gross),
    total_deductions: s((x) => x.total_deductions),
    total_net: s((x) => x.net),
    total_earnings: s((x) => x.gross - x.absence_deduction),
    total_gosi_employee: 0,
    total_gosi_employer: 0,
    total_advances: s((x) => x.advance_deductions),
    total_penalties: s((x) => x.penalty_deductions),
  };
}

/** Per-branch amounts for the branch-split ledger entries. */
export function branchSplit(slips: WorkerPayslip[]): {
  branch: string;
  earnings: number;
  advances: number;
  penalties: number;
  net: number;
}[] {
  const map = new Map<string, WorkerPayslip[]>();
  slips.forEach((x) => map.set(x.branch, [...(map.get(x.branch) ?? []), x]));
  return [...map.entries()].map(([branch, xs]) => {
    const s = (f: (x: WorkerPayslip) => number) => r2(xs.reduce((t, x) => t + f(x), 0));
    return {
      branch,
      earnings: s((x) => x.gross - x.absence_deduction),
      advances: s((x) => x.advance_deductions),
      penalties: s((x) => x.penalty_deductions),
      net: s((x) => x.net),
    };
  });
}

/**
 * WPS (حماية الأجور) file for the workers run — every worker is in the file;
 * those without a valid IBAN (cash) are flagged so the payer sees them.
 */
export function buildWorkerWpsTable(
  slips: WorkerPayslip[],
  period: string,
): { table: ExportTable; flagged: string[] } {
  const ibanOk = (x: WorkerPayslip) =>
    x.payment_method === 'bank' && !!x.iban && isValidSaudiIban(x.iban);
  const flagged = slips.filter((x) => !ibanOk(x)).map((x) => x.worker_name);
  const sum = (f: (x: WorkerPayslip) => number) => r2(slips.reduce((t, x) => t + f(x), 0));
  return {
    flagged,
    table: {
      title: `ملف حماية الأجور — العمالة المنزلية ${period}`,
      subtitle: `${BRAND.client.nameAr} · ${slips.length} عاملة · ${flagged.length} بلا تحويل بنكي`,
      headers: [
        'رقم الإقامة',
        'اسم العاملة',
        'الجنسية',
        'الفرع',
        'طريقة الصرف',
        'البنك',
        'الآيبان',
        'الراتب الأساسي',
        'الإضافات',
        'الاستقطاعات',
        'صافي الراتب',
        'ملاحظة',
      ],
      rows: slips.map((x) => [
        x.iqama_no || x.passport_no,
        x.worker_name,
        x.nationality,
        x.branch,
        x.payment_method === 'cash' ? 'نقدًا' : 'تحويل بنكي',
        x.bank_name,
        x.iban,
        x.base_pay,
        x.additions,
        x.total_deductions,
        x.net,
        ibanOk(x)
          ? ''
          : x.payment_method === 'cash'
            ? 'صرف نقدي — بدون آيبان'
            : 'آيبان غير صالح أو مفقود',
      ]),
      footer: [
        'الإجمالي',
        '',
        '',
        '',
        '',
        '',
        '',
        sum((x) => x.base_pay),
        sum((x) => x.additions),
        sum((x) => x.total_deductions),
        sum((x) => x.net),
        '',
      ],
    },
  };
}
