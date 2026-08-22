import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  addAccount,
  addBankAccount,
  addCatalogItem,
  addFixedAsset,
  addManualEntry,
  addVendor,
  convertPoToBill,
  listCatalog,
  toggleCatalogItem,
  updateCatalogItem,
  type NewCatalogInput,
  fileVatReturn,
  getVatConfig,
  listBankAccounts,
  listClosedPeriods,
  listFixedAssets,
  listPostedDepreciation,
  listVatReturns,
  postBankTransfer,
  postClosingEntry,
  postDepreciation,
  updateVatConfig,
  type NewAssetInput,
  type NewBankAccountInput,
  type VatConfig,
  type VatReturnRecord,
  createBill,
  createCashExpense,
  createDebitNote,
  createInvoice,
  createPurchaseOrder,
  createVoucher,
  listBills,
  listCashExpenses,
  listChart,
  listDebitNotes,
  listInvoices,
  listJournal,
  listPeriods,
  listPostedPayroll,
  listPurchaseOrders,
  listVendors,
  listVouchers,
  postPayrollEntry,
  setPeriodStatus,
  setPurchaseOrderStatus,
  setVendorActive,
  toggleAccountActive,
  updateAccount,
  voidBill,
  voidInvoice,
  type AccountInput,
  type NewBillInput,
  type NewCashExpenseInput,
  type NewDebitNoteInput,
  type NewInvoiceInput,
  type NewManualEntry,
  type NewPOInput,
  type NewVendorInput,
  type NewVoucherInput,
} from '@/features/accounting/api/accounting.api';
import type {
  Account,
  BankAccount,
  Bill,
  CatalogItem,
  FixedAsset,
  CashExpense,
  DebitNote,
  Invoice,
  JournalEntry,
  PaymentVoucher,
  Period,
  POStatus,
  PurchaseOrder,
  Vendor,
} from '@/features/accounting/types';

const PURCH_KEYS = {
  vendors: ['accounting', 'vendors'] as const,
  bills: ['accounting', 'bills'] as const,
  vouchers: ['accounting', 'vouchers'] as const,
  cash: ['accounting', 'cash-expenses'] as const,
  notes: ['accounting', 'debit-notes'] as const,
  pos: ['accounting', 'purchase-orders'] as const,
};

const INVOICES_KEY = ['accounting', 'invoices'] as const;

const JOURNAL_KEY = ['accounting', 'journal'] as const;
const CHART_KEY = ['accounting', 'chart'] as const;
const PERIODS_KEY = ['accounting', 'periods'] as const;

export function useChart() {
  return useQuery({ queryKey: CHART_KEY, queryFn: listChart, staleTime: QUERY_DEFAULTS.staleTime });
}

export function useJournal() {
  return useQuery({
    queryKey: JOURNAL_KEY,
    queryFn: listJournal,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: INVOICES_KEY,
    queryFn: listInvoices,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Invoice, Error, NewInvoiceInput>({
    mutationFn: async (input) => createInvoice(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: INVOICES_KEY });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم إصدار الفاتورة وترحيلها');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إصدار الفاتورة'),
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => voidInvoice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: INVOICES_KEY });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم إلغاء الفاتورة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الإلغاء'),
  });
}

export function useBills() {
  return useQuery({
    queryKey: ['accounting', 'bills'],
    queryFn: listBills,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function usePeriods() {
  return useQuery({
    queryKey: PERIODS_KEY,
    queryFn: listPeriods,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useAddManualEntry() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<JournalEntry, Error, NewManualEntry>({
    mutationFn: async (input) => addManualEntry(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم ترحيل القيد');
    },
    onError: (e) => toast.error(e.message || 'تعذّر ترحيل القيد'),
  });
}

export function useSaveAccount() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Account, Error, { code?: string; input: AccountInput }>({
    mutationFn: async ({ code, input }) => (code ? updateAccount(code, input) : addAccount(input)),
    onSuccess: (_a, { code }) => {
      void qc.invalidateQueries({ queryKey: CHART_KEY });
      toast.success(code ? 'تم تحديث الحساب' : 'تمت إضافة الحساب');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حفظ الحساب'),
  });
}

export function useToggleAccount() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { code: string; active: boolean }>({
    mutationFn: async ({ code, active }) => toggleAccountActive(code, active),
    onSuccess: (_v, { active }) => {
      void qc.invalidateQueries({ queryKey: CHART_KEY });
      toast.success(active ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تحديث الحالة'),
  });
}

export function useSetPeriodStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Period, Error, { id: string; status: Period['status'] }>({
    mutationFn: async ({ id, status }) => setPeriodStatus(id, status),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: PERIODS_KEY });
      toast.success(p.status === 'closed' ? 'تم إقفال الفترة' : 'تم فتح الفترة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تغيير حالة الفترة'),
  });
}

/* ============================ purchases — Phase 4 ========================= */
function useList<T>(key: readonly unknown[], fn: () => Promise<T>) {
  return useQuery({ queryKey: key, queryFn: fn, staleTime: QUERY_DEFAULTS.staleTime });
}

export const useVendors = () => useList<Vendor[]>(PURCH_KEYS.vendors, listVendors);
export const useVouchers = () => useList<PaymentVoucher[]>(PURCH_KEYS.vouchers, listVouchers);
export const useCashExpenses = () => useList<CashExpense[]>(PURCH_KEYS.cash, listCashExpenses);
export const useDebitNotes = () => useList<DebitNote[]>(PURCH_KEYS.notes, listDebitNotes);
export const usePurchaseOrders = () => useList<PurchaseOrder[]>(PURCH_KEYS.pos, listPurchaseOrders);

export function useAddVendor() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Vendor, Error, NewVendorInput>({
    mutationFn: async (i) => addVendor(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.vendors });
      toast.success('تمت إضافة المورّد');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}
export function useToggleVendor() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; active: boolean }>({
    mutationFn: async ({ id, active }) => setVendorActive(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PURCH_KEYS.vendors }),
  });
}

export function useCreateBill() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Bill, Error, NewBillInput>({
    mutationFn: async (i) => createBill(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.bills });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم تسجيل فاتورة المشتريات وترحيلها');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}
export function useVoidBill() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => voidBill(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.bills });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم إلغاء الفاتورة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الإلغاء'),
  });
}

export function useCreateVoucher() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<PaymentVoucher, Error, NewVoucherInput>({
    mutationFn: async (i) => createVoucher(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.vouchers });
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.bills });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم صرف السند وترحيله');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الصرف'),
  });
}

export function useCreateCashExpense() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<CashExpense, Error, NewCashExpenseInput>({
    mutationFn: async (i) => createCashExpense(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.cash });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم تسجيل المصروف النقدي وترحيله');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}

export function useCreateDebitNote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<DebitNote, Error, NewDebitNoteInput>({
    mutationFn: async (i) => createDebitNote(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.notes });
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.bills });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم تسجيل الإشعار المدين وترحيله');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<PurchaseOrder, Error, NewPOInput>({
    mutationFn: async (i) => createPurchaseOrder(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.pos });
      toast.success('تم إنشاء أمر الشراء');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الإنشاء'),
  });
}
export function useSetPOStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; status: POStatus }>({
    mutationFn: async ({ id, status }) => setPurchaseOrderStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.pos });
      toast.success('تم تحديث حالة أمر الشراء');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}
export function useConvertPO() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Bill, Error, string>({
    mutationFn: async (id) => convertPoToBill(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.pos });
      void qc.invalidateQueries({ queryKey: PURCH_KEYS.bills });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم تحويل أمر الشراء إلى فاتورة مشتريات');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحويل'),
  });
}

/* ===================== payroll posting (link with HR 05) ================== */
export function usePostedPayroll() {
  return useQuery({
    queryKey: ['accounting', 'payroll-posted'],
    queryFn: listPostedPayroll,
    staleTime: 0,
  });
}

export function usePostPayroll() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, JournalEntry>({
    mutationFn: async (entry) => {
      postPayrollEntry(entry);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      void qc.invalidateQueries({ queryKey: ['accounting', 'payroll-posted'] });
      toast.success('تم ترحيل قيد الرواتب إلى دفتر اليومية');
    },
    onError: (e) => toast.error(e.message || 'تعذّر ترحيل قيد الرواتب'),
  });
}

/* ============================== banks — Phase 5 ========================== */
const BANKS_KEY = ['accounting', 'banks'] as const;

export function useBankAccounts() {
  return useQuery({
    queryKey: BANKS_KEY,
    queryFn: listBankAccounts,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useAddBankAccount() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<BankAccount, Error, NewBankAccountInput>({
    mutationFn: async (i) => addBankAccount(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: BANKS_KEY });
      void qc.invalidateQueries({ queryKey: CHART_KEY });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تمت إضافة الحساب البنكي');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الإضافة'),
  });
}

export function useBankTransfer() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    {
      from_code: string;
      to_code: string;
      amount: number;
      date: string;
      branch: string | null;
      note: string;
    }
  >({
    mutationFn: async (i) => postBankTransfer(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم ترحيل التحويل البنكي');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحويل'),
  });
}

/* =============================== VAT — Phase 6 =========================== */
const VAT_CFG_KEY = ['accounting', 'vat-config'] as const;
const VAT_RET_KEY = ['accounting', 'vat-returns'] as const;

export function useVatConfig() {
  return useQuery({
    queryKey: VAT_CFG_KEY,
    queryFn: getVatConfig,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function useUpdateVatConfig() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<VatConfig, Error, Partial<VatConfig>>({
    mutationFn: async (p) => updateVatConfig(p),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: VAT_CFG_KEY });
      toast.success('تم تحديث إعدادات الضريبة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}
export function useVatReturns() {
  return useQuery({ queryKey: VAT_RET_KEY, queryFn: listVatReturns, staleTime: 0 });
}
export function useFileVatReturn() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    VatReturnRecord,
    Error,
    { period: string; output_vat: number; input_vat: number; net_vat: number }
  >({
    mutationFn: async (i) => fileVatReturn(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: VAT_RET_KEY });
      toast.success('تم تقديم الإقرار الضريبي');
    },
    onError: (e) => toast.error(e.message || 'تعذّر تقديم الإقرار'),
  });
}

/* ====================== reports / period close — Phase 7 ================= */
export function useClosedPeriods() {
  return useQuery({
    queryKey: ['accounting', 'closed-periods'],
    queryFn: listClosedPeriods,
    staleTime: 0,
  });
}
export function usePostClosing() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, JournalEntry>({
    mutationFn: async (entry) => postClosingEntry(entry),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      void qc.invalidateQueries({ queryKey: ['accounting', 'closed-periods'] });
      toast.success('تم ترحيل قيد الإقفال');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الإقفال'),
  });
}

/* ========================= fixed assets — Phase 8 ======================= */
const ASSETS_KEY = ['accounting', 'fixed-assets'] as const;
const DEP_KEY = ['accounting', 'depreciation-posted'] as const;

export function useFixedAssets() {
  return useQuery({
    queryKey: ASSETS_KEY,
    queryFn: listFixedAssets,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function usePostedDepreciation() {
  return useQuery({ queryKey: DEP_KEY, queryFn: listPostedDepreciation, staleTime: 0 });
}
export function useAddFixedAsset() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<FixedAsset, Error, NewAssetInput>({
    mutationFn: async (i) => addFixedAsset(i),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ASSETS_KEY });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تمت إضافة الأصل وترحيل قيد الشراء');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الإضافة'),
  });
}
export function usePostDepreciation() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (period) => postDepreciation(period),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ASSETS_KEY });
      void qc.invalidateQueries({ queryKey: DEP_KEY });
      void qc.invalidateQueries({ queryKey: JOURNAL_KEY });
      toast.success('تم ترحيل قيد الإهلاك');
    },
    onError: (e) => toast.error(e.message || 'تعذّر ترحيل الإهلاك'),
  });
}

/* ===================== products & services catalog ====================== */
const CATALOG_KEY = ['accounting', 'catalog'] as const;

export function useCatalog() {
  return useQuery({
    queryKey: CATALOG_KEY,
    queryFn: listCatalog,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}
export function useSaveCatalogItem() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<CatalogItem, Error, { id?: string; input: NewCatalogInput }>({
    mutationFn: async ({ id, input }) =>
      id ? updateCatalogItem(id, input) : addCatalogItem(input),
    onSuccess: (_c, { id }) => {
      void qc.invalidateQueries({ queryKey: CATALOG_KEY });
      toast.success(id ? 'تم تحديث الصنف' : 'تمت إضافة الصنف');
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
  });
}
export function useToggleCatalogItem() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; active: boolean }>({
    mutationFn: async ({ id, active }) => toggleCatalogItem(id, active),
    onSuccess: (_v, { active }) => {
      void qc.invalidateQueries({ queryKey: CATALOG_KEY });
      toast.success(active ? 'تم تفعيل الصنف' : 'تم تعطيل الصنف');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}
