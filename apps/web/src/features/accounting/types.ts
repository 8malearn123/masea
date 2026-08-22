import type { BadgeTone } from '@/shared/ui/Badge';

/* ----------------------------- chart of accounts ----------------------------- */
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalBalance = 'debit' | 'credit';

export interface Account {
  code: string;
  name_ar: string;
  type: AccountType;
  parent_code: string | null;
  is_postable: boolean;
  normal_balance: NormalBalance;
  is_active?: boolean; // soft-delete / disable (default active)
}

/* ---------------------------- accounting periods --------------------------- */
export type PeriodStatus = 'open' | 'closed';

export interface Period {
  id: string;
  year: number;
  month: number; // 1..12
  status: PeriodStatus;
}

export const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = {
  open: 'مفتوحة',
  closed: 'مقفلة',
};
export const PERIOD_STATUS_TONE: Record<PeriodStatus, BadgeTone> = {
  open: 'success',
  closed: 'neutral',
};
export const MONTH_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};
export const ACCOUNT_TYPE_TONE: Record<AccountType, BadgeTone> = {
  asset: 'navy',
  liability: 'gold',
  equity: 'teal',
  revenue: 'success',
  expense: 'danger',
};

/* ------------------------------- journal -------------------------------- */
export type JournalSource =
  | 'manual'
  | 'contract'
  | 'payment'
  | 'payroll'
  | 'loyalty'
  | 'penalty'
  | 'adjustment';

export const SOURCE_LABEL: Record<JournalSource, string> = {
  manual: 'قيد يدوي',
  contract: 'عقد',
  payment: 'تحصيل',
  payroll: 'رواتب',
  loyalty: 'ولاء',
  penalty: 'غرامة',
  adjustment: 'تسوية',
};

export interface JournalLine {
  account_code: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface JournalEntry {
  id: string;
  entry_no: number;
  entry_date: string; // YYYY-MM-DD
  branch: string | null; // cost center
  description: string;
  reference: string | null;
  source_type: JournalSource;
  source_id?: string;
  status: 'posted' | 'void';
  lines: JournalLine[];
}

/* ----------------------- operational events (sources) ---------------------- */
/** Mirrors the DB service_type enum used by contracts. */
export type ServiceCode =
  | 'direct'
  | 'kafala'
  | 'monthly'
  | 'daily'
  | 'hourly_8'
  | 'hourly_5'
  | 'cleaning';

export type PayMethod = 'cash' | 'mada' | 'apple_pay' | 'tamara' | 'transfer';

export interface ContractEvent {
  id: string;
  contract_no: number;
  customer_name: string;
  branch: string;
  service: ServiceCode;
  base: number; // pre-VAT
  start_date: string;
}

export interface PaymentEvent {
  id: string;
  contract_id: string;
  amount: number;
  method: PayMethod;
  reference_no: string;
  paid_at: string;
}

/* ------------------------------- reporting ------------------------------- */
export interface TrialBalanceRow {
  code: string;
  name_ar: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number; // signed by normal balance
}

/* ------------------------- invoicing (AR) — Phase B ------------------------ */
export type InvoiceType = 'standard' | 'simplified'; // B2B معيارية / B2C مبسطة
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'partial' | 'void';

export const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  standard: 'ضريبية معيارية (B2B)',
  simplified: 'ضريبية مبسطة (B2C)',
};
export const INV_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'مسودة',
  issued: 'صادرة',
  paid: 'مدفوعة',
  partial: 'مدفوعة جزئيًا',
  void: 'ملغاة',
};
export const INV_STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  draft: 'neutral',
  issued: 'navy',
  paid: 'success',
  partial: 'gold',
  void: 'danger',
};

export interface InvoiceLine {
  description: string;
  qty: number;
  unit_price: number;
  vat_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
}

export interface Invoice {
  id: string;
  invoice_no: number;
  type: InvoiceType;
  contract_no: number | null;
  customer_name: string;
  branch: string | null;
  issue_date: string;
  due_date: string;
  subtotal: number; // pre-VAT
  vat_amount: number;
  total: number;
  amount_paid: number;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  manual?: boolean; // ad-hoc (not generated from a contract)
  revenue_code?: string; // revenue account credited for ad-hoc invoices
}

/* --------------------------- payables (AP) — Phase B ----------------------- */
export type VendorType = 'external_office' | 'supplier' | 'gosi' | 'utility' | 'other';

export const VENDOR_TYPE_LABEL: Record<VendorType, string> = {
  external_office: 'مكتب استقدام خارجي',
  supplier: 'مورّد',
  gosi: 'التأمينات (GOSI)',
  utility: 'خدمات ومرافق',
  other: 'أخرى',
};

export interface Bill {
  id: string;
  bill_no: number;
  vendor_name: string;
  vendor_type: VendorType;
  branch: string | null;
  issue_date: string;
  due_date: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  amount_paid: number;
  expense_code: string;
  status: 'open' | 'paid' | 'partial' | 'void';
}

export const BILL_STATUS_LABEL: Record<Bill['status'], string> = {
  open: 'مستحقة',
  paid: 'مدفوعة',
  partial: 'مدفوعة جزئيًا',
  void: 'ملغاة',
};
export const BILL_STATUS_TONE: Record<Bill['status'], BadgeTone> = {
  open: 'gold',
  paid: 'success',
  partial: 'navy',
  void: 'danger',
};

/* ============================ purchases — Phase 4 ========================= */
export interface Vendor {
  id: string;
  name: string;
  vendor_type: VendorType;
  vat_number?: string;
  phone?: string;
  is_active: boolean;
}

/** سند صرف لمورد */
export interface PaymentVoucher {
  id: string;
  voucher_no: number;
  bill_id: string | null;
  vendor_name: string;
  amount: number;
  pay_account_code: string; // 1111/1112/1113
  branch: string | null;
  voucher_date: string;
}

/** مصروف نقدي */
export interface CashExpense {
  id: string;
  expense_no: number;
  description: string;
  expense_code: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  pay_account_code: string;
  branch: string | null;
  expense_date: string;
}

/** إشعار مدين (مرتجع مشتريات) */
export interface DebitNote {
  id: string;
  note_no: number;
  bill_id: string | null;
  vendor_name: string;
  expense_code: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  reason: string;
  branch: string | null;
  note_date: string;
}

/** أمر شراء (غير مالي حتى التحويل لفاتورة) */
export type POStatus = 'draft' | 'approved' | 'received' | 'closed' | 'cancelled';
export interface POLine {
  description: string;
  qty: number;
  unit_price: number;
  line_total: number;
}
export interface PurchaseOrder {
  id: string;
  po_no: number;
  vendor_name: string;
  branch: string | null;
  status: POStatus;
  order_date: string;
  expected_date: string;
  total: number;
  lines: POLine[];
}

export const PO_STATUS_LABEL: Record<POStatus, string> = {
  draft: 'مسودة',
  approved: 'معتمد',
  received: 'مستلم',
  closed: 'مغلق',
  cancelled: 'ملغى',
};
export const PO_STATUS_TONE: Record<POStatus, BadgeTone> = {
  draft: 'neutral',
  approved: 'navy',
  received: 'teal',
  closed: 'success',
  cancelled: 'danger',
};

/* ============================ VAT — Phase 6 ============================== */
export interface VatReturn {
  period: string;
  sales_base: number; // المبيعات الخاضعة (وعاء المخرجات)
  output_vat: number; // ضريبة المخرجات
  purchases_base: number; // المشتريات/المصروفات الخاضعة (وعاء المدخلات)
  input_vat: number; // ضريبة المدخلات
  net_vat: number; // المستحق للهيئة (+) أو المسترد (−)
}

/* ===================== products & services catalog ====================== */
export type CatalogKind = 'service' | 'product';
export type CatalogUnit = 'fixed' | 'month' | 'day' | 'hour' | 'unit';

export const CATALOG_KIND_LABEL: Record<CatalogKind, string> = {
  service: 'خدمة',
  product: 'منتج',
};
export const CATALOG_UNIT_LABEL: Record<CatalogUnit, string> = {
  fixed: 'مقطوع',
  month: 'شهر',
  day: 'يوم',
  hour: 'ساعة',
  unit: 'وحدة',
};

export interface CatalogItem {
  id: string;
  name_ar: string;
  kind: CatalogKind;
  service_code: string | null;
  revenue_code: string;
  unit: CatalogUnit;
  default_price: number;
  taxable: boolean;
  is_active: boolean;
}

/* ========================= fixed assets — Phase 8 ======================= */
export type AssetCategory = 'furniture' | 'devices' | 'vehicles';

export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  furniture: 'أثاث ومفروشات',
  devices: 'أجهزة ومعدات',
  vehicles: 'سيارات',
};
/** category → fixed-asset chart leaf. */
export const ASSET_CATEGORY_CODE: Record<AssetCategory, string> = {
  furniture: '1210',
  devices: '1220',
  vehicles: '1230',
};

export interface FixedAsset {
  id: string;
  name: string;
  category: AssetCategory;
  asset_code: string;
  cost: number;
  salvage_value: number;
  useful_life_years: number;
  acquisition_date: string;
  branch: string | null;
  accumulated_dep: number;
  status: 'active' | 'disposed';
}

/* ============================ banks — Phase 5 ============================ */
export interface BankAccount {
  id: string;
  name: string;
  account_code: string; // chart leaf (111x)
  bank: string;
  iban: string | null;
  is_active: boolean;
}

/* ------------------------------ aging (AR/AP) ----------------------------- */
export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export const AGING_LABEL: Record<AgingBucketKey, string> = {
  current: 'غير مستحقة بعد',
  d1_30: '١–٣٠ يوم',
  d31_60: '٣١–٦٠ يوم',
  d61_90: '٦١–٩٠ يوم',
  d90_plus: 'أكثر من ٩٠ يوم',
};

export type AgingReport = Record<AgingBucketKey, number> & { total: number };
