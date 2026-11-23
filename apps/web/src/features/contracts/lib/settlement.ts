/**
 * حساب «تسوية وإلغاء عقد» — مرآة `compute_contract_settlement` (0090).
 * المرجع في الوضع الحي هو الخادم؛ هذه الدالة للمعاينة والوضع التجريبي فقط.
 * لا رقم عمل هنا: الخصم اليومي ومهلة الاسترداد تأتي من شروط القالب المعتمد
 * (contract_settlement_terms) و«احتساب يوم الإرجاع» من قيم النظام.
 */
import type { ContractStatus } from '@/features/contracts/schemas/contract.schema';

export type SettlementKind = 'cancel_before_start' | 'cancel_after_start' | 'return' | 'trial_end';
export type DueBasis = 'none' | 'contract_term' | 'prorata' | 'manual';

export interface SettlementFee {
  label: string;
  amount: number;
  clause_ref: string;
}

export interface ContractTerm {
  value: number;
  clause_ref: string;
}

export interface SettlementTerms {
  cancelDailyDeduction?: ContractTerm | null;
  refundWithinDays?: ContractTerm | null;
}

export interface SettlementInput {
  contract: {
    status: ContractStatus;
    start_date: string | null;
    end_date: string | null;
    total_amount: number;
    amount_paid: number;
  };
  /** هل سُلِّمت العاملة (العقد نشط أو مرّ بحالة «نشط»). */
  delivered: boolean;
  effectiveDate: string;
  fees?: SettlementFee[];
  terms?: SettlementTerms;
  /** قيمة النظام `settlement_count_return_day` (1 = يوم الإرجاع يُحتسب). */
  countReturnDay?: boolean;
}

export interface SettlementPreview {
  kind: SettlementKind;
  delivered: boolean;
  days_total: number | null;
  days_used: number;
  days_remaining: number | null;
  contract_value: number;
  amount_paid: number;
  service_due: number;
  due_basis: DueBasis;
  due_basis_ref: string | null;
  fees_total: number;
  /** + يُرد للعميل · − مستحق على العميل */
  balance: number;
  refund_within_days: number | null;
  refund_within_ref: string | null;
}

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
}

export function feeError(f: SettlementFee): string | null {
  if (!(f.amount > 0)) return 'مبلغ الرسم يجب أن يكون أكبر من صفر';
  if (!f.label.trim()) return 'اكتب وصف الرسم';
  if (!f.clause_ref.trim()) return 'كل رسم يجب أن يستند إلى بند في العقد المعتمد أو سياسة معتمدة';
  return null;
}

export function computeSettlement(input: SettlementInput): SettlementPreview {
  const { contract: c, delivered, effectiveDate, fees = [], terms = {} } = input;
  const incl = input.countReturnDay === false ? 0 : 1;
  const total = c.start_date && c.end_date ? dayDiff(c.end_date, c.start_date) + 1 : null;

  let used = 0;
  if (delivered && c.start_date) {
    const until = c.end_date && c.end_date < effectiveDate ? c.end_date : effectiveDate;
    used = Math.max(0, dayDiff(until, c.start_date) + incl);
    if (total !== null) used = Math.min(used, total);
  }

  let due = 0;
  let basis: DueBasis = 'none';
  let basisRef: string | null = null;
  if (used > 0) {
    const rate = terms.cancelDailyDeduction;
    if (rate) {
      due = Math.min(round2(used * rate.value), c.total_amount);
      basis = 'contract_term';
      basisRef = rate.clause_ref;
    } else if (total && total > 0) {
      due = round2((c.total_amount * used) / total);
      basis = 'prorata';
      basisRef = 'تناسبي حسب المدة المستهلكة (لا ينص العقد على خصم يومي)';
    } else {
      basis = 'manual';
      basisRef = 'عقد مفتوح المدة — تُحدَّد القيمة المستحقة يدوياً برقم البند';
    }
  }

  for (const f of fees) {
    const err = feeError(f);
    if (err) throw new Error(err);
  }
  const feesTotal = round2(fees.reduce((s, f) => s + f.amount, 0));

  return {
    kind: delivered ? 'cancel_after_start' : 'cancel_before_start',
    delivered,
    days_total: total,
    days_used: used,
    days_remaining: total === null ? null : Math.max(total - used, 0),
    contract_value: c.total_amount,
    amount_paid: c.amount_paid,
    service_due: due,
    due_basis: basis,
    due_basis_ref: basisRef,
    fees_total: feesTotal,
    balance: round2(c.amount_paid - due - feesTotal),
    refund_within_days: terms.refundWithinDays?.value ?? null,
    refund_within_ref: terms.refundWithinDays?.clause_ref ?? null,
  };
}

/** قيمة الإشعار الدائن: قيمة العقد − (المستحق + الرسوم). سالبة = رسوم إضافية على العميل. */
export function creditNoteAmount(
  p: Pick<SettlementPreview, 'contract_value' | 'service_due' | 'fees_total'>,
): number {
  return round2(p.contract_value - p.service_due - p.fees_total);
}

export const SETTLEMENT_KIND_LABEL: Record<SettlementKind, string> = {
  cancel_before_start: 'إلغاء قبل بداية الخدمة',
  cancel_after_start: 'إلغاء بعد بداية الخدمة',
  return: 'إرجاع العاملة وتسوية العقد',
  trial_end: 'إنهاء تجربة نقل الخدمات',
};

export const DUE_BASIS_LABEL: Record<DueBasis, string> = {
  none: 'لا مستحق — لم تبدأ الخدمة',
  contract_term: 'وفق بند العقد المعتمد',
  prorata: 'تناسبي حسب المدة',
  manual: 'محدّد يدوياً برقم البند',
};
