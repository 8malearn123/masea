import type {
  CashExpense,
  DebitNote,
  JournalEntry,
  JournalLine,
  PaymentVoucher,
} from '@/features/accounting/types';

/**
 * Demo posting mirrors for the purchase documents — identical to the SQL
 * functions in 0029_purchases.sql so live and demo ledgers agree.
 */

/** سند مورد: DR ذمم دائنة (2110) / CR البنك/النقدية. */
export function postVoucher(v: PaymentVoucher): JournalEntry {
  const lines: JournalLine[] = [
    { account_code: '2110', debit: v.amount, credit: 0, description: 'سداد ذمة دائنة' },
    { account_code: v.pay_account_code, debit: 0, credit: v.amount, description: 'صرف نقدي/بنكي' },
  ];
  return {
    id: `je-pv-${v.voucher_no}`,
    entry_no: 3000 + v.voucher_no,
    entry_date: v.voucher_date,
    branch: v.branch,
    description: `سند صرف لمورد ${v.vendor_name}`,
    reference: `PV-${v.voucher_no}`,
    source_type: 'manual',
    status: 'posted',
    lines,
  };
}

/** مصروف نقدي: DR مصروف + DR ضريبة مدخلات / CR البنك/النقدية. */
export function postCashExpense(e: CashExpense): JournalEntry {
  const lines: JournalLine[] = [
    { account_code: e.expense_code, debit: e.subtotal, credit: 0, description: 'مصروف' },
    ...(e.vat_amount > 0
      ? [{ account_code: '1140', debit: e.vat_amount, credit: 0, description: 'ضريبة مدخلات' }]
      : []),
    { account_code: e.pay_account_code, debit: 0, credit: e.total, description: 'صرف نقدي/بنكي' },
  ];
  return {
    id: `je-ce-${e.expense_no}`,
    entry_no: 4000 + e.expense_no,
    entry_date: e.expense_date,
    branch: e.branch,
    description: `مصروف نقدي: ${e.description}`,
    reference: `CE-${e.expense_no}`,
    source_type: 'manual',
    status: 'posted',
    lines,
  };
}

/** إشعار مدين (مرتجع مشتريات): DR ذمم دائنة (2110) / CR مصروف + CR ضريبة مدخلات. */
export function postDebitNote(n: DebitNote): JournalEntry {
  const lines: JournalLine[] = [
    { account_code: '2110', debit: n.total, credit: 0, description: 'تخفيض ذمة دائنة' },
    { account_code: n.expense_code, debit: 0, credit: n.subtotal, description: 'تخفيض مصروف' },
    ...(n.vat_amount > 0
      ? [{ account_code: '1140', debit: 0, credit: n.vat_amount, description: 'عكس ضريبة مدخلات' }]
      : []),
  ];
  return {
    id: `je-dn-${n.note_no}`,
    entry_no: 5000 + n.note_no,
    entry_date: n.note_date,
    branch: n.branch,
    description: `إشعار مدين على مورد ${n.vendor_name}`,
    reference: `DN-${n.note_no}`,
    source_type: 'manual',
    status: 'posted',
    lines,
  };
}
