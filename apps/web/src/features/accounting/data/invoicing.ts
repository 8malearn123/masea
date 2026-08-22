import { VAT_RATE } from '@masiat/shared';
import type {
  AgingBucketKey,
  AgingReport,
  Bill,
  ContractEvent,
  Invoice,
  InvoiceLine,
  JournalEntry,
  JournalLine,
} from '@/features/accounting/types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Service label for the invoice line (Saudi services). */
const SERVICE_LABEL: Record<ContractEvent['service'], string> = {
  direct: 'خدمة استقدام',
  kafala: 'نقل كفالة',
  monthly: 'تأجير عمالة شهري',
  daily: 'تأجير عمالة يومي',
  hourly_8: 'تأجير عمالة (٨ ساعات)',
  hourly_5: 'تأجير عمالة (٥ ساعات)',
  cleaning: 'خدمة نظافة',
};

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a tax invoice for a signed contract. Revenue was already booked when
 * the contract was signed (engine.postContract); this is the tax document.
 * Standard (B2B) when total is large, else simplified (B2C) — demo heuristic.
 */
export function buildInvoiceForContract(c: ContractEvent, opts: { amount_paid: number }): Invoice {
  const subtotal = c.base;
  const vat = round2(subtotal * VAT_RATE);
  const total = round2(subtotal + vat);
  const type = total >= 15000 ? 'standard' : 'simplified';
  const issue_date = c.start_date;

  const lines: InvoiceLine[] = [
    {
      description: SERVICE_LABEL[c.service],
      qty: 1,
      unit_price: subtotal,
      vat_rate: VAT_RATE,
      line_subtotal: subtotal,
      line_vat: vat,
      line_total: total,
    },
  ];

  const status: Invoice['status'] =
    opts.amount_paid >= total ? 'paid' : opts.amount_paid > 0 ? 'partial' : 'issued';

  return {
    id: `inv-${c.contract_no}`,
    invoice_no: c.contract_no,
    type,
    contract_no: c.contract_no,
    customer_name: c.customer_name,
    branch: c.branch,
    issue_date,
    due_date: addDays(issue_date, 30),
    subtotal,
    vat_amount: vat,
    total,
    amount_paid: opts.amount_paid,
    status,
    lines,
  };
}

/** Build a VAT-computed invoice line from qty × unit price. */
export function lineFrom(description: string, qty: number, unit_price: number): InvoiceLine {
  const subtotal = round2(qty * unit_price);
  const vat = round2(subtotal * VAT_RATE);
  return {
    description,
    qty,
    unit_price,
    vat_rate: VAT_RATE,
    line_subtotal: subtotal,
    line_vat: vat,
    line_total: round2(subtotal + vat),
  };
}

/**
 * Ad-hoc sales invoice → DR ذمم العملاء (total) / CR إيراد (pre-VAT) + CR ضريبة مخرجات.
 * Mirror of post_invoice_issued (0027). Contract invoices are NOT posted here.
 */
export function postSalesInvoice(inv: Invoice, revenueCode: string): JournalEntry {
  const lines: JournalLine[] = [
    { account_code: '1120', debit: inv.total, credit: 0, description: 'ذمة العميل' },
    {
      account_code: revenueCode,
      debit: 0,
      credit: inv.subtotal,
      description: 'إيراد (قبل الضريبة)',
    },
    ...(inv.vat_amount > 0
      ? [{ account_code: '2120', debit: 0, credit: inv.vat_amount, description: 'ضريبة مخرجات' }]
      : []),
  ];
  return {
    id: `je-sinv-${inv.invoice_no}`,
    entry_no: 2000 + inv.invoice_no,
    entry_date: inv.issue_date,
    branch: inv.branch,
    description: `فاتورة مبيعات #${inv.invoice_no}`,
    reference: `SINV-${inv.invoice_no}`,
    source_type: 'manual',
    status: 'posted',
    lines,
  };
}

/** AP bill → DR expense + DR input-VAT / CR payables (mirror of post_bill_received). */
export function postBill(b: Bill): JournalEntry {
  const lines: JournalLine[] = [
    { account_code: b.expense_code, debit: b.subtotal, credit: 0, description: 'مصروف' },
    // input VAT only when the bill carries deductible VAT (skip zero-VAT bills)
    ...(b.vat_amount > 0
      ? [{ account_code: '1140', debit: b.vat_amount, credit: 0, description: 'ضريبة مدخلات' }]
      : []),
    {
      account_code: '2110',
      debit: 0,
      credit: b.total,
      description: `ذمة دائنة - ${b.vendor_name}`,
    },
  ];
  return {
    id: `je-bill-${b.bill_no}`,
    entry_no: 1000 + b.bill_no,
    entry_date: b.issue_date,
    branch: b.branch,
    description: `فاتورة واردة من ${b.vendor_name}`,
    reference: `BILL-${b.bill_no}`,
    source_type: 'manual',
    status: 'posted',
    lines,
  };
}

/** AR/AP aging — bucket the OUTSTANDING balance by days since due date. */
export function aging(
  items: { due_date: string; outstanding: number }[],
  asOf = new Date(),
): AgingReport {
  const report: AgingReport = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    total: 0,
  };
  for (const it of items) {
    if (it.outstanding <= 0) continue;
    const days = Math.floor((asOf.getTime() - new Date(it.due_date).getTime()) / 86400000);
    let key: AgingBucketKey;
    if (days <= 0) key = 'current';
    else if (days <= 30) key = 'd1_30';
    else if (days <= 60) key = 'd31_60';
    else if (days <= 90) key = 'd61_90';
    else key = 'd90_plus';
    report[key] = round2(report[key] + it.outstanding);
    report.total = round2(report.total + it.outstanding);
  }
  return report;
}
