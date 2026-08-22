/**
 * Shared customer-sales ledger — the single source of truth for customer
 * invoices across the platform. Both the Payments page (where invoices are
 * raised for customers) and the Accounting module read/write here, so an
 * invoice created anywhere reflects everywhere immediately.
 *
 * Seeded with the signed-contract invoices (Saudi-realistic). Demo store;
 * with Supabase connected this maps to the `invoices` table.
 */
export type SaleStatus = 'issued' | 'partial' | 'paid' | 'void';
export type SaleType = 'standard' | 'simplified';
export type SaleSource = 'contract' | 'manual';

export interface SaleLine {
  description: string;
  qty: number;
  unit_price: number;
}

export interface CustomerSale {
  id: string;
  invoice_no: number;
  customer_name: string;
  branch: string | null;
  type: SaleType;
  source: SaleSource;
  issue_date: string;
  due_date: string;
  subtotal: number; // pre-VAT
  vat: number;
  total: number;
  amount_paid: number;
  status: SaleStatus;
  revenue_code: string;
  lines: SaleLine[];
}

const saleType = (total: number): SaleType => (total >= 15000 ? 'standard' : 'simplified');
const saleStatus = (paid: number, total: number): SaleStatus =>
  paid >= total ? 'paid' : paid > 0 ? 'partial' : 'issued';

// Seed: the six signed-contract invoices (match the contracts + collections).
const SEED: Omit<CustomerSale, 'type' | 'status'>[] = [
  {
    id: 'inv-1',
    invoice_no: 1,
    customer_name: 'محمد الأحمدي',
    branch: 'نجران',
    source: 'contract',
    issue_date: '2026-04-03',
    due_date: '2026-05-03',
    subtotal: 16000,
    vat: 2400,
    total: 18400,
    amount_paid: 18400,
    revenue_code: '4100',
    lines: [{ description: 'خدمة استقدام', qty: 1, unit_price: 16000 }],
  },
  {
    id: 'inv-2',
    invoice_no: 2,
    customer_name: 'سارة القحطاني',
    branch: 'جازان',
    source: 'contract',
    issue_date: '2026-04-08',
    due_date: '2026-05-08',
    subtotal: 7500,
    vat: 1125,
    total: 8625,
    amount_paid: 8625,
    revenue_code: '4200',
    lines: [{ description: 'تأجير عمالة شهري', qty: 1, unit_price: 7500 }],
  },
  {
    id: 'inv-3',
    invoice_no: 3,
    customer_name: 'فهد العنزي',
    branch: 'شرورة',
    source: 'contract',
    issue_date: '2026-04-15',
    due_date: '2026-05-15',
    subtotal: 1800,
    vat: 270,
    total: 2070,
    amount_paid: 2070,
    revenue_code: '4300',
    lines: [{ description: 'تأجير عمالة يومي', qty: 1, unit_price: 1800 }],
  },
  {
    id: 'inv-4',
    invoice_no: 4,
    customer_name: 'نورة الشهري',
    branch: 'نجران',
    source: 'contract',
    issue_date: '2026-05-02',
    due_date: '2026-06-01',
    subtotal: 6000,
    vat: 900,
    total: 6900,
    amount_paid: 3450,
    revenue_code: '4400',
    lines: [{ description: 'نقل كفالة', qty: 1, unit_price: 6000 }],
  },
  {
    id: 'inv-5',
    invoice_no: 5,
    customer_name: 'عبدالله الدوسري',
    branch: 'حبونا',
    source: 'contract',
    issue_date: '2026-05-11',
    due_date: '2026-06-10',
    subtotal: 7000,
    vat: 1050,
    total: 8050,
    amount_paid: 0,
    revenue_code: '4200',
    lines: [{ description: 'تأجير عمالة شهري', qty: 1, unit_price: 7000 }],
  },
  {
    id: 'inv-6',
    invoice_no: 6,
    customer_name: 'هند اليامي',
    branch: 'جازان',
    source: 'contract',
    issue_date: '2026-05-20',
    due_date: '2026-06-19',
    subtotal: 15000,
    vat: 2250,
    total: 17250,
    amount_paid: 17250,
    revenue_code: '4100',
    lines: [{ description: 'خدمة استقدام', qty: 1, unit_price: 15000 }],
  },
];

const SALES: CustomerSale[] = SEED.map((s) => ({
  ...s,
  type: saleType(s.total),
  status: saleStatus(s.amount_paid, s.total),
}));

let nextNo = 1000;

export function listCustomerSales(): CustomerSale[] {
  return SALES.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l })) }));
}

export interface NewCustomerSale {
  customer_name: string;
  branch: string | null;
  type: SaleType;
  issue_date: string;
  revenue_code: string;
  lines: SaleLine[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Raise a customer invoice (from accounting, payments, or anywhere). */
export function addCustomerSale(input: NewCustomerSale): CustomerSale {
  const subtotal = round2(
    input.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0),
  );
  const vat = round2(subtotal * 0.15);
  const total = round2(subtotal + vat);
  nextNo += 1;
  const due = new Date(input.issue_date);
  due.setDate(due.getDate() + 30);
  const sale: CustomerSale = {
    id: `sinv-${nextNo}`,
    invoice_no: nextNo,
    customer_name: input.customer_name.trim() || 'عميل نقدي',
    branch: input.branch,
    type: input.type,
    source: 'manual',
    issue_date: input.issue_date,
    due_date: due.toISOString().slice(0, 10),
    subtotal,
    vat,
    total,
    amount_paid: 0,
    status: 'issued',
    revenue_code: input.revenue_code,
    lines: input.lines,
  };
  SALES.unshift(sale);
  return sale;
}

export function voidCustomerSale(id: string): void {
  const s = SALES.find((x) => x.id === id);
  if (s) s.status = 'void';
}

/** Record a collection against a customer invoice (keeps statuses in sync). */
export function settleCustomerSale(id: string, amount: number): void {
  const s = SALES.find((x) => x.id === id);
  if (!s) return;
  s.amount_paid = Math.min(s.total, s.amount_paid + amount);
  s.status = saleStatus(s.amount_paid, s.total);
}
