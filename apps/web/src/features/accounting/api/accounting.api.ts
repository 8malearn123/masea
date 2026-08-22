import { z } from 'zod';
import { BRANCHES_AR } from '@/lib/funnel';
import { CHART } from '@/features/accounting/data/chart';
import {
  buildManualEntry,
  postContract,
  postPayment,
  resetEntryCounter,
} from '@/features/accounting/data/engine';
import { lineFrom, postBill, postSalesInvoice } from '@/features/accounting/data/invoicing';
import {
  addCustomerSale,
  listCustomerSales,
  voidCustomerSale,
  type CustomerSale,
} from '@/shared/lib/salesLedger';
import { postCashExpense, postDebitNote, postVoucher } from '@/features/accounting/data/purchases';
import {
  buildAcquisitionEntry,
  buildDepreciationEntry,
  periodDepreciation,
} from '@/features/accounting/data/assets';
import { ASSET_CATEGORY_CODE } from '@/features/accounting/types';
import type {
  Account,
  AccountType,
  AssetCategory,
  BankAccount,
  Bill,
  CatalogItem,
  FixedAsset,
  CashExpense,
  ContractEvent,
  DebitNote,
  Invoice,
  JournalEntry,
  JournalLine,
  NormalBalance,
  PaymentEvent,
  PaymentVoucher,
  Period,
  POLine,
  POStatus,
  PurchaseOrder,
  Vendor,
  VendorType,
} from '@/features/accounting/types';

/**
 * DEMO MODE: journals are GENERATED from operational events (contracts signed +
 * payments received) through the same engine the DB uses (0023_accounting.sql).
 * When Supabase is connected, post_contract_signed/post_payment_received produce
 * the identical entries server-side.
 */

// Saudi-realistic signed contracts across the four branches and real services.
const CONTRACTS: ContractEvent[] = [
  {
    id: 'c-1',
    contract_no: 1,
    customer_name: 'محمد الأحمدي',
    branch: 'نجران',
    service: 'direct',
    base: 16000,
    start_date: '2026-04-03',
  },
  {
    id: 'c-2',
    contract_no: 2,
    customer_name: 'سارة القحطاني',
    branch: 'جازان',
    service: 'monthly',
    base: 7500,
    start_date: '2026-04-08',
  },
  {
    id: 'c-3',
    contract_no: 3,
    customer_name: 'فهد العنزي',
    branch: 'شرورة',
    service: 'daily',
    base: 1800,
    start_date: '2026-04-15',
  },
  {
    id: 'c-4',
    contract_no: 4,
    customer_name: 'نورة الشهري',
    branch: 'نجران',
    service: 'kafala',
    base: 6000,
    start_date: '2026-05-02',
  },
  {
    id: 'c-5',
    contract_no: 5,
    customer_name: 'عبدالله الدوسري',
    branch: 'حبونا',
    service: 'monthly',
    base: 7000,
    start_date: '2026-05-11',
  },
  {
    id: 'c-6',
    contract_no: 6,
    customer_name: 'هند اليامي',
    branch: 'جازان',
    service: 'direct',
    base: 15000,
    start_date: '2026-05-20',
  },
];

// Collected payments (some full, some partial, one contract still unpaid).
const PAYMENTS: PaymentEvent[] = [
  {
    id: 'p-1',
    contract_id: 'c-1',
    amount: 18400,
    method: 'mada',
    reference_no: 'PMT-AA11BB22',
    paid_at: '2026-04-05',
  },
  {
    id: 'p-2',
    contract_id: 'c-2',
    amount: 8625,
    method: 'transfer',
    reference_no: 'PMT-CC33DD44',
    paid_at: '2026-04-10',
  },
  {
    id: 'p-3',
    contract_id: 'c-3',
    amount: 2070,
    method: 'cash',
    reference_no: 'PMT-EE55FF66',
    paid_at: '2026-04-15',
  },
  {
    id: 'p-4',
    contract_id: 'c-4',
    amount: 3450,
    method: 'tamara',
    reference_no: 'PMT-GG77HH88',
    paid_at: '2026-05-04',
  }, // partial
  {
    id: 'p-5',
    contract_id: 'c-6',
    amount: 17250,
    method: 'mada',
    reference_no: 'PMT-II99JJ00',
    paid_at: '2026-05-22',
  },
];

const branchOf = (contractId: string): string | null =>
  CONTRACTS.find((c) => c.id === contractId)?.branch ?? null;

// AP: vendor bills (مكاتب خارجية، موردون، GOSI) — Saudi-realistic.
const BILLS: Bill[] = [
  {
    id: 'bill-1',
    bill_no: 1,
    vendor_name: 'مكتب الاستقدام - الهند',
    vendor_type: 'external_office',
    branch: 'نجران',
    issue_date: '2026-04-06',
    due_date: '2026-05-06',
    subtotal: 9000,
    vat_amount: 0, // خدمة خارج المملكة — بلا ضريبة مدخلات
    total: 9000,
    amount_paid: 9000,
    expense_code: '5400',
    status: 'paid',
  },
  {
    id: 'bill-2',
    bill_no: 2,
    vendor_name: 'التأمينات الاجتماعية (GOSI)',
    vendor_type: 'gosi',
    branch: null,
    issue_date: '2026-05-01',
    due_date: '2026-05-15',
    subtotal: 3200,
    vat_amount: 0,
    total: 3200,
    amount_paid: 0,
    expense_code: '5200',
    status: 'open',
  },
  {
    id: 'bill-3',
    bill_no: 3,
    vendor_name: 'شركة الاتصالات السعودية',
    vendor_type: 'utility',
    branch: 'جازان',
    issue_date: '2026-05-03',
    due_date: '2026-05-18',
    subtotal: 1200,
    vat_amount: 180,
    total: 1380,
    amount_paid: 0,
    expense_code: '5400',
    status: 'open',
  },
  {
    id: 'bill-4',
    bill_no: 4,
    vendor_name: 'وكالة تسويق رقمي',
    vendor_type: 'supplier',
    branch: 'نجران',
    issue_date: '2026-03-20',
    due_date: '2026-04-19',
    subtotal: 5000,
    vat_amount: 750,
    total: 5750,
    amount_paid: 0,
    expense_code: '5300',
    status: 'open',
  },
];

// Manual entries added in-session (demo). Real backend persists via journal tables.
const MANUAL: JournalEntry[] = [];

// Posted payroll entries (built from HR payslips). One per period.
const PAYROLL_ENTRIES: JournalEntry[] = [];
export function postPayrollEntry(entry: JournalEntry): void {
  if (!PAYROLL_ENTRIES.some((e) => e.reference === entry.reference)) {
    PAYROLL_ENTRIES.unshift(entry);
  }
}
export async function listPostedPayroll(): Promise<string[]> {
  return PAYROLL_ENTRIES.map((e) => e.reference ?? '');
}

// Prebuilt balanced entries (bank transfers, bank-account openings) — bypass the
// engine's static chart check since they may reference newly-added accounts.
const EXTRA_ENTRIES: JournalEntry[] = [];
let extraSeq = 7000;

/** Post a period closing entry (zero revenue/expense → retained earnings). */
export function postClosingEntry(entry: JournalEntry): void {
  if (!EXTRA_ENTRIES.some((e) => e.reference === entry.reference)) EXTRA_ENTRIES.unshift(entry);
}
export async function listClosedPeriods(): Promise<string[]> {
  return EXTRA_ENTRIES.filter((e) => (e.reference ?? '').startsWith('CLOSE-')).map((e) =>
    (e.reference ?? '').slice(6),
  );
}

// Opening balance per branch (cost center): DR bank / CR capital — balanced.
const OPENING_AMOUNT = 50000;

/** Rebuild the full journal deterministically from events + bills + manual entries. */
function buildJournal(): JournalEntry[] {
  resetEntryCounter();
  const entries: JournalEntry[] = [];
  for (const branch of BRANCHES_AR) {
    entries.push(
      buildManualEntry({
        entry_date: '2026-01-01',
        branch,
        description: `رصيد افتتاحي - ${branch}`,
        lines: [
          {
            account_code: '1112',
            debit: OPENING_AMOUNT,
            credit: 0,
            description: 'رصيد بنكي افتتاحي',
          },
          { account_code: '3100', debit: 0, credit: OPENING_AMOUNT, description: 'رأس المال' },
        ],
      }),
    );
  }
  for (const c of CONTRACTS) entries.push(postContract(c));
  for (const p of PAYMENTS) entries.push(postPayment(p, branchOf(p.contract_id)));
  for (const b of BILLS) if (b.status !== 'void') entries.push(postBill(b));
  // manual customer invoices (from the shared sales ledger) post revenue;
  // contract-origin invoices are already booked via postContract above.
  for (const s of listCustomerSales()) {
    if (s.source === 'manual' && s.status !== 'void') {
      entries.push(postSalesInvoice(saleToInvoice(s), s.revenue_code));
    }
  }
  for (const v of VOUCHERS) entries.push(postVoucher(v));
  for (const e of CASH_EXPENSES) entries.push(postCashExpense(e));
  for (const n of DEBIT_NOTES) entries.push(postDebitNote(n));
  for (const pe of PAYROLL_ENTRIES) entries.push(pe);
  for (const xe of EXTRA_ENTRIES) entries.push(xe);
  for (const m of MANUAL) {
    entries.push(
      buildManualEntry({
        entry_date: m.entry_date,
        branch: m.branch,
        description: m.description,
        lines: m.lines,
      }),
    );
  }
  return entries;
}

/** Map a shared-ledger customer sale → the accounting Invoice view shape. */
function saleToInvoice(s: CustomerSale): Invoice {
  return {
    id: s.id,
    invoice_no: s.invoice_no,
    type: s.type,
    contract_no: s.source === 'contract' ? s.invoice_no : null,
    customer_name: s.customer_name,
    branch: s.branch,
    issue_date: s.issue_date,
    due_date: s.due_date,
    subtotal: s.subtotal,
    vat_amount: s.vat,
    total: s.total,
    amount_paid: s.amount_paid,
    status: s.status,
    lines: s.lines.map((l) => lineFrom(l.description, l.qty, l.unit_price)),
    manual: s.source === 'manual',
    revenue_code: s.revenue_code,
  };
}

// Customer invoices come from the SHARED sales ledger — invoices raised on the
// platform (payments/customers) and in accounting are one and the same set.
export async function listInvoices(): Promise<Invoice[]> {
  return listCustomerSales().map(saleToInvoice);
}

export type NewInvoiceLine = { description: string; qty: number; unit_price: number };
export type NewInvoiceInput = {
  customer_name: string;
  branch: string | null;
  type: 'standard' | 'simplified';
  issue_date: string;
  revenue_code: string;
  lines: NewInvoiceLine[];
};

/** Create + issue a customer invoice into the shared ledger; posts to the journal. */
export function createInvoice(input: NewInvoiceInput): Invoice {
  const clean = input.lines.filter((l) => l.description.trim() && l.unit_price > 0 && l.qty > 0);
  if (clean.length === 0) throw new Error('أضف بنداً واحداً على الأقل بسعر صحيح');
  const sale = addCustomerSale({
    customer_name: input.customer_name,
    branch: input.branch,
    type: input.type,
    issue_date: input.issue_date,
    revenue_code: input.revenue_code,
    lines: clean.map((l) => ({
      description: l.description.trim(),
      qty: l.qty,
      unit_price: l.unit_price,
    })),
  });
  return saleToInvoice(sale);
}

/** Void a customer invoice (its posting drops out of the ledger). */
export function voidInvoice(id: string): void {
  voidCustomerSale(id);
}

export async function listBills(): Promise<Bill[]> {
  return BILLS.map((b) => ({ ...b }));
}

/* --------------------------- chart of accounts (CRUD) --------------------- */
// Editable working copy (demo). Real backend persists to chart_of_accounts.
const chartState: Account[] = CHART.map((a) => ({ ...a, is_active: a.is_active ?? true }));

export async function listChart(): Promise<Account[]> {
  return chartState.map((a) => ({ ...a }));
}

const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
export const accountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/, 'الرمز أرقام (٣–٦ خانات)'),
  name_ar: z.string().trim().min(2, 'الاسم مطلوب'),
  type: z.enum(ACCOUNT_TYPES as [AccountType, ...AccountType[]]),
  parent_code: z.string().nullable(),
  normal_balance: z.enum(['debit', 'credit']),
});
export type AccountInput = z.infer<typeof accountSchema>;

export function addAccount(input: AccountInput): Account {
  const data = accountSchema.parse(input);
  if (chartState.some((a) => a.code === data.code)) {
    throw new Error('الرمز مستخدم بالفعل');
  }
  const acc: Account = { ...data, is_postable: true, is_active: true };
  chartState.push(acc);
  return acc;
}

export function updateAccount(code: string, patch: Partial<AccountInput>): Account {
  const i = chartState.findIndex((a) => a.code === code);
  if (i < 0) throw new Error('الحساب غير موجود');
  const current = chartState[i] as Account;
  const merged: Account = {
    ...current,
    name_ar: patch.name_ar?.trim() || current.name_ar,
    type: (patch.type ?? current.type) as AccountType,
    normal_balance: (patch.normal_balance ?? current.normal_balance) as NormalBalance,
    parent_code: patch.parent_code === undefined ? current.parent_code : patch.parent_code,
  };
  chartState[i] = merged;
  return merged;
}

/** Soft delete — disable an account (kept for historical links). */
export function toggleAccountActive(code: string, active: boolean): void {
  const acc = chartState.find((a) => a.code === code);
  if (acc) acc.is_active = active;
}

export async function listJournal(): Promise<JournalEntry[]> {
  return buildJournal();
}

export async function listContracts(): Promise<ContractEvent[]> {
  return CONTRACTS.map((c) => ({ ...c }));
}

export type NewManualEntry = {
  entry_date: string;
  branch: string | null;
  description: string;
  lines: JournalLine[];
};

/** Validate (balance + postable enforced by the engine) and store a manual entry. */
export function addManualEntry(input: NewManualEntry): JournalEntry {
  const entry = buildManualEntry(input); // throws on unbalanced / non-postable
  MANUAL.push(entry);
  return entry;
}

/* ----------------------------- accounting periods ------------------------- */
// Current-year periods (mirror of the 0026 seed). Editable: open/close.
const PERIODS: Period[] = Array.from({ length: 12 }, (_, i) => ({
  id: `2026-${String(i + 1).padStart(2, '0')}`,
  year: 2026,
  month: i + 1,
  status: 'open' as const,
}));

export async function listPeriods(): Promise<Period[]> {
  return PERIODS.map((p) => ({ ...p }));
}

/** Open/close a period. Closed periods reject posting (correction = reversing entry). */
export function setPeriodStatus(id: string, status: Period['status']): Period {
  const p = PERIODS.find((x) => x.id === id);
  if (!p) throw new Error('الفترة غير موجودة');
  p.status = status;
  return { ...p };
}

/* ============================ purchases — Phase 4 ========================= */
// Managed vendors (Saudi-realistic recruitment suppliers / external offices).
const VENDORS: Vendor[] = [
  {
    id: 'v1',
    name: 'مكتب الاستقدام - الهند',
    vendor_type: 'external_office',
    vat_number: '—',
    phone: '0112000001',
    is_active: true,
  },
  {
    id: 'v2',
    name: 'مكتب الاستقدام - الفلبين',
    vendor_type: 'external_office',
    vat_number: '—',
    phone: '0112000002',
    is_active: true,
  },
  {
    id: 'v3',
    name: 'شركة الاتصالات السعودية',
    vendor_type: 'utility',
    vat_number: '300000000000003',
    phone: '8001000000',
    is_active: true,
  },
  {
    id: 'v4',
    name: 'وكالة تسويق رقمي',
    vendor_type: 'supplier',
    vat_number: '301111111100003',
    phone: '0551111111',
    is_active: true,
  },
  { id: 'v5', name: 'التأمينات الاجتماعية (GOSI)', vendor_type: 'gosi', is_active: true },
];

export async function listVendors(): Promise<Vendor[]> {
  return VENDORS.map((v) => ({ ...v }));
}
export type NewVendorInput = Omit<Vendor, 'id' | 'is_active'>;
export function addVendor(input: NewVendorInput): Vendor {
  if (!input.name.trim()) throw new Error('اسم المورّد مطلوب');
  const v: Vendor = { ...input, id: `v-${Date.now()}`, is_active: true };
  VENDORS.unshift(v);
  return v;
}
export function setVendorActive(id: string, active: boolean): void {
  const v = VENDORS.find((x) => x.id === id);
  if (v) v.is_active = active;
}

/* -------- فواتير مشتريات (bills) — create / void over the 0025 store -------- */
let billSeq = 100;
export type NewBillInput = {
  vendor_name: string;
  vendor_type: VendorType;
  branch: string | null;
  issue_date: string;
  due_date: string;
  subtotal: number;
  vat_amount: number;
  expense_code: string;
};
export function createBill(input: NewBillInput): Bill {
  if (input.subtotal <= 0) throw new Error('أدخل مبلغاً صحيحاً');
  billSeq += 1;
  const bill: Bill = {
    id: `bill-${billSeq}`,
    bill_no: billSeq,
    vendor_name: input.vendor_name.trim() || 'مورّد',
    vendor_type: input.vendor_type,
    branch: input.branch,
    issue_date: input.issue_date,
    due_date: input.due_date,
    subtotal: input.subtotal,
    vat_amount: input.vat_amount,
    total: Math.round((input.subtotal + input.vat_amount) * 100) / 100,
    amount_paid: 0,
    expense_code: input.expense_code,
    status: 'open',
  };
  BILLS.unshift(bill);
  return bill;
}
export function voidBill(id: string): void {
  const b = BILLS.find((x) => x.id === id);
  if (b) b.status = 'void';
}

/* -------- سندات الموردين (payment vouchers) -------- */
const VOUCHERS: PaymentVoucher[] = [];
let voucherSeq = 0;
export async function listVouchers(): Promise<PaymentVoucher[]> {
  return VOUCHERS.map((v) => ({ ...v }));
}
export type NewVoucherInput = {
  bill_id: string | null;
  vendor_name: string;
  amount: number;
  pay_account_code: string;
  branch: string | null;
  voucher_date: string;
};
export function createVoucher(input: NewVoucherInput): PaymentVoucher {
  if (input.amount <= 0) throw new Error('أدخل مبلغاً صحيحاً');
  voucherSeq += 1;
  const v: PaymentVoucher = { ...input, id: `pv-${voucherSeq}`, voucher_no: voucherSeq };
  VOUCHERS.unshift(v);
  // settle the linked bill
  if (input.bill_id) {
    const bill = BILLS.find((b) => b.id === input.bill_id);
    if (bill) {
      bill.amount_paid = Math.min(bill.total, bill.amount_paid + input.amount);
      bill.status = bill.amount_paid >= bill.total ? 'paid' : 'partial';
    }
  }
  return v;
}

/* -------- مصروفات نقدية (cash expenses) -------- */
const CASH_EXPENSES: CashExpense[] = [];
let cashSeq = 0;
export async function listCashExpenses(): Promise<CashExpense[]> {
  return CASH_EXPENSES.map((e) => ({ ...e }));
}
export type NewCashExpenseInput = {
  description: string;
  expense_code: string;
  subtotal: number;
  vat_amount: number;
  pay_account_code: string;
  branch: string | null;
  expense_date: string;
};
export function createCashExpense(input: NewCashExpenseInput): CashExpense {
  if (input.subtotal <= 0) throw new Error('أدخل مبلغاً صحيحاً');
  cashSeq += 1;
  const e: CashExpense = {
    ...input,
    id: `ce-${cashSeq}`,
    expense_no: cashSeq,
    description: input.description.trim() || 'مصروف',
    total: Math.round((input.subtotal + input.vat_amount) * 100) / 100,
  };
  CASH_EXPENSES.unshift(e);
  return e;
}

/* -------- إشعارات مدينة (debit notes) -------- */
const DEBIT_NOTES: DebitNote[] = [];
let noteSeq = 0;
export async function listDebitNotes(): Promise<DebitNote[]> {
  return DEBIT_NOTES.map((n) => ({ ...n }));
}
export type NewDebitNoteInput = {
  bill_id: string | null;
  vendor_name: string;
  expense_code: string;
  subtotal: number;
  vat_amount: number;
  reason: string;
  branch: string | null;
  note_date: string;
};
export function createDebitNote(input: NewDebitNoteInput): DebitNote {
  if (input.subtotal <= 0) throw new Error('أدخل مبلغاً صحيحاً');
  noteSeq += 1;
  const n: DebitNote = {
    ...input,
    id: `dn-${noteSeq}`,
    note_no: noteSeq,
    total: Math.round((input.subtotal + input.vat_amount) * 100) / 100,
  };
  DEBIT_NOTES.unshift(n);
  return n;
}

/* -------- أوامر شراء (purchase orders — non-financial) -------- */
const PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 'po-1',
    po_no: 1,
    vendor_name: 'وكالة تسويق رقمي',
    branch: 'نجران',
    status: 'approved',
    order_date: '2026-05-02',
    expected_date: '2026-05-20',
    total: 8000,
    lines: [{ description: 'حملة إعلانية', qty: 1, unit_price: 8000, line_total: 8000 }],
  },
];
let poSeq = 1;
export async function listPurchaseOrders(): Promise<PurchaseOrder[]> {
  return PURCHASE_ORDERS.map((p) => ({ ...p, lines: p.lines.map((l) => ({ ...l })) }));
}
export type NewPOInput = {
  vendor_name: string;
  branch: string | null;
  order_date: string;
  expected_date: string;
  lines: { description: string; qty: number; unit_price: number }[];
};
export function createPurchaseOrder(input: NewPOInput): PurchaseOrder {
  const clean = input.lines.filter((l) => l.description.trim() && l.qty > 0 && l.unit_price > 0);
  if (clean.length === 0) throw new Error('أضف بنداً واحداً على الأقل');
  const lines: POLine[] = clean.map((l) => ({
    description: l.description.trim(),
    qty: l.qty,
    unit_price: l.unit_price,
    line_total: Math.round(l.qty * l.unit_price * 100) / 100,
  }));
  poSeq += 1;
  const po: PurchaseOrder = {
    id: `po-${poSeq}`,
    po_no: poSeq,
    vendor_name: input.vendor_name.trim() || 'مورّد',
    branch: input.branch,
    status: 'draft',
    order_date: input.order_date,
    expected_date: input.expected_date,
    total: lines.reduce((s, l) => s + l.line_total, 0),
    lines,
  };
  PURCHASE_ORDERS.unshift(po);
  return po;
}
export function setPurchaseOrderStatus(id: string, status: POStatus): void {
  const po = PURCHASE_ORDERS.find((p) => p.id === id);
  if (po) po.status = status;
}
/** Convert an approved/received PO into a vendor bill (15% VAT) and close it. */
export function convertPoToBill(id: string): Bill {
  const po = PURCHASE_ORDERS.find((p) => p.id === id);
  if (!po) throw new Error('أمر الشراء غير موجود');
  const vat = Math.round(po.total * 0.15 * 100) / 100;
  const bill = createBill({
    vendor_name: po.vendor_name,
    vendor_type: 'supplier',
    branch: po.branch,
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    subtotal: po.total,
    vat_amount: vat,
    expense_code: '5400',
  });
  po.status = 'closed';
  return bill;
}

/* ============================== banks — Phase 5 ========================== */
const BANK_ACCOUNTS: BankAccount[] = [
  {
    id: 'bank-1',
    name: 'الصندوق (نقدية)',
    account_code: '1111',
    bank: 'نقدية',
    iban: null,
    is_active: true,
  },
  {
    id: 'bank-2',
    name: 'الحساب الجاري - الراجحي',
    account_code: '1112',
    bank: 'مصرف الراجحي',
    iban: 'SA0380000000608010167519',
    is_active: true,
  },
  {
    id: 'bank-3',
    name: 'الحساب الجاري - الأهلي',
    account_code: '1113',
    bank: 'البنك الأهلي',
    iban: 'SA4420000001234567891234',
    is_active: true,
  },
];
let bankCodeSeq = 1113;

export async function listBankAccounts(): Promise<BankAccount[]> {
  return BANK_ACCOUNTS.map((b) => ({ ...b }));
}

export type NewBankAccountInput = {
  name: string;
  bank: string;
  iban: string;
  opening_balance: number;
  branch: string | null;
};

/** Add a bank account → new chart leaf under النقدية والبنوك (1110) + optional opening balance. */
export function addBankAccount(input: NewBankAccountInput): BankAccount {
  if (!input.name.trim()) throw new Error('اسم الحساب مطلوب');
  bankCodeSeq += 1;
  const code = String(bankCodeSeq);
  addAccount({
    code,
    name_ar: input.name.trim(),
    type: 'asset',
    parent_code: '1110',
    normal_balance: 'debit',
  });
  const acc: BankAccount = {
    id: `bank-${code}`,
    name: input.name.trim(),
    account_code: code,
    bank: input.bank.trim(),
    iban: input.iban.trim() || null,
    is_active: true,
  };
  BANK_ACCOUNTS.push(acc);
  if (input.opening_balance > 0) {
    extraSeq += 1;
    EXTRA_ENTRIES.unshift({
      id: `je-bankopen-${code}`,
      entry_no: extraSeq,
      entry_date: '2026-01-01',
      branch: input.branch,
      description: `رصيد افتتاحي - ${input.name.trim()}`,
      reference: `BANKOPEN-${code}`,
      source_type: 'manual',
      status: 'posted',
      lines: [
        {
          account_code: code,
          debit: input.opening_balance,
          credit: 0,
          description: 'رصيد افتتاحي',
        },
        { account_code: '3100', debit: 0, credit: input.opening_balance, description: 'رأس المال' },
      ],
    });
  }
  return acc;
}

/** Transfer between two cash/bank accounts (DR to / CR from) — mirror of post_bank_transfer. */
export function postBankTransfer(input: {
  from_code: string;
  to_code: string;
  amount: number;
  date: string;
  branch: string | null;
  note: string;
}): void {
  if (input.amount <= 0) throw new Error('مبلغ غير صحيح');
  if (input.from_code === input.to_code) throw new Error('لا يمكن التحويل لنفس الحساب');
  extraSeq += 1;
  EXTRA_ENTRIES.unshift({
    id: `je-trf-${extraSeq}`,
    entry_no: extraSeq,
    entry_date: input.date,
    branch: input.branch,
    description: input.note.trim() || 'تحويل بنكي',
    reference: `TRF-${extraSeq}`,
    source_type: 'manual',
    status: 'posted',
    lines: [
      { account_code: input.to_code, debit: input.amount, credit: 0, description: 'تحويل وارد' },
      { account_code: input.from_code, debit: 0, credit: input.amount, description: 'تحويل صادر' },
    ],
  });
}

/* =============================== VAT — Phase 6 =========================== */
export interface VatConfig {
  rate: number;
  tax_number: string;
  frequency: 'monthly' | 'quarterly';
}
const VAT_CONFIG: VatConfig = { rate: 0.15, tax_number: '300000000000003', frequency: 'monthly' };

export async function getVatConfig(): Promise<VatConfig> {
  return { ...VAT_CONFIG };
}
export function updateVatConfig(patch: Partial<VatConfig>): VatConfig {
  if (patch.rate !== undefined) {
    if (patch.rate < 0 || patch.rate > 1) throw new Error('النسبة بين 0 و 1');
    VAT_CONFIG.rate = patch.rate;
  }
  if (patch.tax_number !== undefined) VAT_CONFIG.tax_number = patch.tax_number.trim();
  if (patch.frequency !== undefined) VAT_CONFIG.frequency = patch.frequency;
  return { ...VAT_CONFIG };
}

export interface VatReturnRecord {
  period: string;
  output_vat: number;
  input_vat: number;
  net_vat: number;
  status: 'filed' | 'paid';
  filed_at: string;
}
const VAT_RETURNS: VatReturnRecord[] = [];

export async function listVatReturns(): Promise<VatReturnRecord[]> {
  return VAT_RETURNS.map((r) => ({ ...r }));
}
export function fileVatReturn(input: {
  period: string;
  output_vat: number;
  input_vat: number;
  net_vat: number;
}): VatReturnRecord {
  const existing = VAT_RETURNS.find((r) => r.period === input.period);
  if (existing) throw new Error('الإقرار لهذه الفترة مُقدَّم بالفعل');
  const rec: VatReturnRecord = { ...input, status: 'filed', filed_at: new Date().toISOString() };
  VAT_RETURNS.unshift(rec);
  return rec;
}
export function markVatPaid(period: string): void {
  const r = VAT_RETURNS.find((x) => x.period === period);
  if (r) r.status = 'paid';
}

/* ========================= fixed assets — Phase 8 ======================= */
const FIXED_ASSETS: FixedAsset[] = [
  {
    id: 'fa-1',
    name: 'سيارة نقل عمالة',
    category: 'vehicles',
    asset_code: '1230',
    cost: 90000,
    salvage_value: 9000,
    useful_life_years: 5,
    acquisition_date: '2026-01-10',
    branch: 'نجران',
    accumulated_dep: 0,
    status: 'active',
  },
  {
    id: 'fa-2',
    name: 'أثاث مكتب الفرع',
    category: 'furniture',
    asset_code: '1210',
    cost: 24000,
    salvage_value: 0,
    useful_life_years: 8,
    acquisition_date: '2026-01-15',
    branch: 'جازان',
    accumulated_dep: 0,
    status: 'active',
  },
  {
    id: 'fa-3',
    name: 'أجهزة حاسب وطابعات',
    category: 'devices',
    asset_code: '1220',
    cost: 18000,
    salvage_value: 0,
    useful_life_years: 4,
    acquisition_date: '2026-02-01',
    branch: 'نجران',
    accumulated_dep: 0,
    status: 'active',
  },
];
const POSTED_DEPRECIATION = new Set<string>();

export async function listFixedAssets(): Promise<FixedAsset[]> {
  return FIXED_ASSETS.map((a) => ({ ...a }));
}

export type NewAssetInput = {
  name: string;
  category: AssetCategory;
  cost: number;
  salvage_value: number;
  useful_life_years: number;
  acquisition_date: string;
  branch: string | null;
  pay_code: string;
};

/** Add an asset and post its acquisition entry (DR asset / CR bank). */
export function addFixedAsset(input: NewAssetInput): FixedAsset {
  if (input.cost <= 0) throw new Error('تكلفة الأصل مطلوبة');
  const asset: FixedAsset = {
    id: `fa-${Date.now()}`,
    name: input.name.trim() || 'أصل ثابت',
    category: input.category,
    asset_code: ASSET_CATEGORY_CODE[input.category],
    cost: input.cost,
    salvage_value: input.salvage_value,
    useful_life_years: input.useful_life_years,
    acquisition_date: input.acquisition_date,
    branch: input.branch,
    accumulated_dep: 0,
    status: 'active',
  };
  FIXED_ASSETS.unshift(asset);
  EXTRA_ENTRIES.unshift(buildAcquisitionEntry(asset, input.pay_code, ++extraSeq));
  return asset;
}

export async function listPostedDepreciation(): Promise<string[]> {
  return [...POSTED_DEPRECIATION];
}

/** Post the period depreciation (DR 5900 / CR 1290) and accrue per asset. */
export function postDepreciation(period: string): void {
  if (POSTED_DEPRECIATION.has(period)) throw new Error('إهلاك هذه الفترة مُرحَّل بالفعل');
  const total = FIXED_ASSETS.reduce((s, a) => s + periodDepreciation(a), 0);
  if (total <= 0) throw new Error('لا يوجد إهلاك مستحق لهذه الفترة');
  EXTRA_ENTRIES.unshift(buildDepreciationEntry(FIXED_ASSETS, period));
  for (const a of FIXED_ASSETS) {
    if (a.status === 'active')
      a.accumulated_dep = Math.round((a.accumulated_dep + periodDepreciation(a)) * 100) / 100;
  }
  POSTED_DEPRECIATION.add(period);
}

/* ===================== products & services catalog ====================== */
const CATALOG: CatalogItem[] = [
  {
    id: 'ps-1',
    name_ar: 'استقدام عمالة منزلية',
    kind: 'service',
    service_code: 'recruitment',
    revenue_code: '4100',
    unit: 'fixed',
    default_price: 16000,
    taxable: true,
    is_active: true,
  },
  {
    id: 'ps-2',
    name_ar: 'تأجير عمالة شهري',
    kind: 'service',
    service_code: 'monthly_rental',
    revenue_code: '4200',
    unit: 'month',
    default_price: 7500,
    taxable: true,
    is_active: true,
  },
  {
    id: 'ps-3',
    name_ar: 'تأجير عمالة يومي',
    kind: 'service',
    service_code: 'daily_rental',
    revenue_code: '4300',
    unit: 'day',
    default_price: 1800,
    taxable: true,
    is_active: true,
  },
  {
    id: 'ps-4',
    name_ar: 'تأجير عمالة بالساعة',
    kind: 'service',
    service_code: null,
    revenue_code: '4300',
    unit: 'hour',
    default_price: 250,
    taxable: true,
    is_active: true,
  },
  {
    id: 'ps-5',
    name_ar: 'نقل كفالة',
    kind: 'service',
    service_code: 'sponsorship_transfer',
    revenue_code: '4400',
    unit: 'fixed',
    default_price: 6000,
    taxable: true,
    is_active: true,
  },
  {
    id: 'ps-6',
    name_ar: 'خدمة نظافة منزلية',
    kind: 'service',
    service_code: null,
    revenue_code: '4300',
    unit: 'day',
    default_price: 400,
    taxable: true,
    is_active: true,
  },
  {
    id: 'ps-7',
    name_ar: 'رسوم إصدار تأشيرة',
    kind: 'product',
    service_code: null,
    revenue_code: '4500',
    unit: 'unit',
    default_price: 2000,
    taxable: true,
    is_active: true,
  },
];

export async function listCatalog(): Promise<CatalogItem[]> {
  return CATALOG.map((c) => ({ ...c }));
}

export type NewCatalogInput = Omit<CatalogItem, 'id' | 'is_active'>;
export function addCatalogItem(input: NewCatalogInput): CatalogItem {
  if (!input.name_ar.trim()) throw new Error('الاسم مطلوب');
  const item: CatalogItem = { ...input, id: `ps-${Date.now()}`, is_active: true };
  CATALOG.unshift(item);
  return item;
}
export function updateCatalogItem(id: string, patch: Partial<NewCatalogInput>): CatalogItem {
  const i = CATALOG.findIndex((c) => c.id === id);
  if (i < 0) throw new Error('الصنف غير موجود');
  const cur = CATALOG[i] as CatalogItem;
  const merged: CatalogItem = {
    ...cur,
    name_ar: patch.name_ar?.trim() || cur.name_ar,
    kind: patch.kind ?? cur.kind,
    service_code: patch.service_code === undefined ? cur.service_code : patch.service_code,
    revenue_code: patch.revenue_code ?? cur.revenue_code,
    unit: patch.unit ?? cur.unit,
    default_price: patch.default_price ?? cur.default_price,
    taxable: patch.taxable ?? cur.taxable,
  };
  CATALOG[i] = merged;
  return merged;
}
export function toggleCatalogItem(id: string, active: boolean): void {
  const c = CATALOG.find((x) => x.id === id);
  if (c) c.is_active = active;
}
