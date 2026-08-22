import { useState } from 'react';
import {
  CheckCircle2,
  Eye,
  FileText,
  Plus,
  Receipt,
  ShoppingCart,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { useCustomerSearch } from '@/features/contracts/hooks/useCustomers';
import {
  useAddVendor,
  useBills,
  useCashExpenses,
  useChart,
  useConvertPO,
  useCreateBill,
  useCreateCashExpense,
  useCreateDebitNote,
  useCreatePurchaseOrder,
  useCreateVoucher,
  useDebitNotes,
  useInvoices,
  usePurchaseOrders,
  useSetPOStatus,
  useVendors,
  useVoidBill,
  useVouchers,
} from '@/features/accounting/hooks/useAccounting';
import {
  BILL_STATUS_LABEL,
  BILL_STATUS_TONE,
  INV_STATUS_LABEL,
  INV_STATUS_TONE,
  PO_STATUS_LABEL,
  PO_STATUS_TONE,
  VENDOR_TYPE_LABEL,
  type Account,
  type Bill,
  type Invoice,
  type PurchaseOrder,
  type VendorType,
} from '@/features/accounting/types';

function Stat({
  label,
  value,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="text-xs text-purple">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const branchOptions = [
  { value: 'head', label: 'المركز الرئيسي' },
  ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
];
const toBranch = (v: string): string | null => (v === 'head' ? null : v);

function useAccountOptions() {
  const { data: chart = [] } = useChart();
  const expenses = chart.filter(
    (a) => a.type === 'expense' && a.is_postable && a.is_active !== false,
  );
  const cash = chart.filter((a) => ['1111', '1112', '1113'].includes(a.code));
  const opt = (a: Account) => ({ value: a.code, label: `${a.code} — ${a.name_ar}` });
  return { expenseOptions: expenses.map(opt), cashOptions: cash.map(opt) };
}

const VENDOR_TYPES: VendorType[] = ['external_office', 'supplier', 'gosi', 'utility', 'other'];

/* ======================= فواتير مشتريات (bills) ========================= */
export function PurchaseInvoicesScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: bills = [], isLoading, isError, refetch } = useBills();
  const voidBill = useVoidBill();
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Bill | null>(null);

  const live = bills.filter((b) => b.status !== 'void');
  const payable = live
    .filter((b) => b.status !== 'paid')
    .reduce((s, b) => s + (b.total - b.amount_paid), 0);
  const inputVat = live.reduce((s, b) => s + b.vat_amount, 0);

  const columns: Column<Bill>[] = [
    {
      key: 'vendor_name',
      header: 'المورّد',
      cell: (b) => <span className="font-semibold text-navy">{b.vendor_name}</span>,
    },
    {
      key: 'vendor_type',
      header: 'النوع',
      cell: (b) => <Badge tone="navy">{VENDOR_TYPE_LABEL[b.vendor_type]}</Badge>,
    },
    { key: 'branch', header: 'الفرع', cell: (b) => b.branch ?? 'المركز' },
    {
      key: 'due_date',
      header: 'الاستحقاق',
      cell: (b) => <span className="num text-xs">{dateAr(b.due_date)}</span>,
    },
    {
      key: 'total',
      header: 'الإجمالي',
      cell: (b) => <span className="num font-bold text-navy">{sar(b.total)}</span>,
    },
    {
      key: 'amount_paid',
      header: 'المسدّد',
      cell: (b) => <span className="num text-green-600">{sar(b.amount_paid)}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (b) => <Badge tone={BILL_STATUS_TONE[b.status]}>{BILL_STATUS_LABEL[b.status]}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      cell: (b) =>
        editable && b.status !== 'void' ? (
          <div className="flex gap-1.5">
            {b.status !== 'paid' && (
              <button
                type="button"
                onClick={() => setPaying(b)}
                className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
              >
                <Wallet size={13} /> سداد
              </button>
            )}
            <button
              type="button"
              onClick={() => voidBill.mutate(b.id)}
              className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              إلغاء
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="عدد الفواتير" value={String(live.length)} />
        <Stat label="المستحق للدفع" value={sar(payable)} tone="text-red-600" />
        <Stat label="ضريبة مدخلات قابلة للخصم" value={sar(inputVat)} tone="text-teal" />
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> فاتورة مشتريات
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={bills}
        rowKey={(b) => b.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد فواتير مشتريات"
      />
      <p className="text-xs leading-relaxed text-purple">
        كل فاتورة تُرحّل آليًا: مدين المصروف + ضريبة المدخلات / دائن الذمم الدائنة (٢١١٠).
      </p>
      {adding && <BillModal onClose={() => setAdding(false)} />}
      {paying && <VoucherModal bill={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function BillModal({ onClose }: { onClose: () => void }) {
  const create = useCreateBill();
  const { data: vendors = [] } = useVendors();
  const { expenseOptions } = useAccountOptions();
  const [vendor, setVendor] = useState('');
  const [vendorType, setVendorType] = useState<VendorType>('supplier');
  const [branch, setBranch] = useState('نجران');
  const [issue, setIssue] = useState('2026-06-01');
  const [due, setDue] = useState('2026-07-01');
  const [subtotal, setSubtotal] = useState(0);
  const [taxable, setTaxable] = useState(true);
  const [expense, setExpense] = useState(expenseOptions[0]?.value ?? '5400');
  const vat = taxable ? round2(subtotal * 0.15) : 0;

  function submit() {
    create.mutate(
      {
        vendor_name: vendor,
        vendor_type: vendorType,
        branch: toBranch(branch),
        issue_date: issue,
        due_date: due,
        subtotal,
        vat_amount: vat,
        expense_code: expense,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="فاتورة مشتريات جديدة">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-navy">المورّد</label>
            <input
              list="vendors-list"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:border-navy focus:outline-none"
              placeholder="اسم المورّد"
            />
            <datalist id="vendors-list">
              {vendors.map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
          </div>
          <Select
            label="نوع المورّد"
            value={vendorType}
            onChange={(e) => setVendorType(e.target.value as VendorType)}
            options={VENDOR_TYPES.map((t) => ({ value: t, label: VENDOR_TYPE_LABEL[t] }))}
          />
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions}
          />
          <Select
            label="حساب المصروف"
            value={expense}
            onChange={(e) => setExpense(e.target.value)}
            options={expenseOptions}
          />
          <Input
            label="تاريخ الفاتورة"
            type="date"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
          />
          <Input
            label="تاريخ الاستحقاق"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <Input
            label="المبلغ قبل الضريبة"
            type="number"
            min={0}
            value={subtotal}
            onChange={(e) => setSubtotal(Number(e.target.value))}
          />
          <label className="flex items-center gap-2 pt-6 text-sm text-navy">
            <input
              type="checkbox"
              checked={taxable}
              onChange={(e) => setTaxable(e.target.checked)}
            />
            خاضع لضريبة ١٥٪
          </label>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-2.5 text-sm">
          <span className="text-purple">
            الضريبة <span className="num font-semibold text-navy">{sar(vat)}</span>
          </span>
          <span className="text-purple">
            الإجمالي <span className="num font-bold text-gold-600">{sar(subtotal + vat)} ر.س</span>
          </span>
        </div>
        <Button onClick={submit} disabled={subtotal <= 0} className="w-full">
          <FileText size={16} /> تسجيل الفاتورة وترحيلها
        </Button>
      </div>
    </Modal>
  );
}

/* ======================= سندات الموردين (vouchers) ====================== */
export function VouchersScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: vouchers = [], isLoading, isError, refetch } = useVouchers();
  const [adding, setAdding] = useState(false);
  const total = vouchers.reduce((s, v) => s + v.amount, 0);

  const columns: Column<(typeof vouchers)[number]>[] = [
    {
      key: 'voucher_no',
      header: 'السند',
      cell: (v) => <span className="num font-semibold text-navy">#{v.voucher_no}</span>,
    },
    { key: 'vendor_name', header: 'المورّد', cell: (v) => v.vendor_name },
    { key: 'branch', header: 'الفرع', cell: (v) => v.branch ?? 'المركز' },
    {
      key: 'voucher_date',
      header: 'التاريخ',
      cell: (v) => <span className="num text-xs">{dateAr(v.voucher_date)}</span>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      cell: (v) => <span className="num font-bold text-navy">{sar(v.amount)} ر.س</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="عدد السندات" value={String(vouchers.length)} />
        <Stat label="إجمالي المصروف للموردين" value={sar(total)} tone="text-red-600" />
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> سند صرف
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={vouchers}
        rowKey={(v) => v.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد سندات صرف"
      />
      <p className="text-xs leading-relaxed text-purple">
        السند يُرحّل: مدين الذمم الدائنة (٢١١٠) / دائن البنك أو النقدية — ويُحدّث رصيد الفاتورة
        المرتبطة.
      </p>
      {adding && <VoucherModal onClose={() => setAdding(false)} />}
    </div>
  );
}

export function VoucherModal({ bill, onClose }: { bill?: Bill; onClose: () => void }) {
  const create = useCreateVoucher();
  const { data: bills = [] } = useBills();
  const { cashOptions } = useAccountOptions();
  const openBills = bills.filter((b) => b.status === 'open' || b.status === 'partial');
  const [billId, setBillId] = useState<string>(bill?.id ?? '');
  const [vendor, setVendor] = useState(bill?.vendor_name ?? '');
  const [amount, setAmount] = useState(bill ? bill.total - bill.amount_paid : 0);
  const [pay, setPay] = useState(cashOptions[0]?.value ?? '1112');
  const [branch, setBranch] = useState(bill?.branch ?? 'نجران');
  const [date, setDate] = useState('2026-06-05');

  function submit() {
    const linked = billId ? bills.find((b) => b.id === billId) : undefined;
    create.mutate(
      {
        bill_id: billId || null,
        vendor_name: linked?.vendor_name ?? vendor,
        amount,
        pay_account_code: pay,
        branch: toBranch(branch ?? 'head'),
        voucher_date: date,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="سند صرف لمورد">
      <div className="space-y-3">
        <Select
          label="الفاتورة المرتبطة (اختياري)"
          value={billId}
          onChange={(e) => {
            setBillId(e.target.value);
            const b = bills.find((x) => x.id === e.target.value);
            if (b) {
              setVendor(b.vendor_name);
              setAmount(b.total - b.amount_paid);
              setBranch(b.branch ?? 'نجران');
            }
          }}
          options={[
            { value: '', label: 'بدون — صرف مباشر' },
            ...openBills.map((b) => ({
              value: b.id,
              label: `#${b.bill_no} ${b.vendor_name} — متبقٍ ${sar(b.total - b.amount_paid)}`,
            })),
          ]}
        />
        {!billId && (
          <Input label="المورّد" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="المبلغ"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <Select
            label="من حساب"
            value={pay}
            onChange={(e) => setPay(e.target.value)}
            options={cashOptions}
          />
          <Select
            label="مركز التكلفة"
            value={branch ?? 'head'}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions}
          />
          <Input
            label="التاريخ"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Button onClick={submit} disabled={amount <= 0} className="w-full">
          <Wallet size={16} /> صرف السند وترحيله
        </Button>
      </div>
    </Modal>
  );
}

/* ======================= مصروفات نقدية (cash) =========================== */
export function CashExpensesScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: rows = [], isLoading, isError, refetch } = useCashExpenses();
  const [adding, setAdding] = useState(false);
  const total = rows.reduce((s, e) => s + e.total, 0);

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'expense_no',
      header: 'الرقم',
      cell: (e) => <span className="num">#{e.expense_no}</span>,
    },
    {
      key: 'description',
      header: 'البيان',
      cell: (e) => <span className="font-semibold text-navy">{e.description}</span>,
    },
    { key: 'branch', header: 'الفرع', cell: (e) => e.branch ?? 'المركز' },
    {
      key: 'expense_date',
      header: 'التاريخ',
      cell: (e) => <span className="num text-xs">{dateAr(e.expense_date)}</span>,
    },
    {
      key: 'total',
      header: 'الإجمالي',
      cell: (e) => <span className="num font-bold text-navy">{sar(e.total)} ر.س</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="عدد المصروفات" value={String(rows.length)} />
        <Stat label="إجمالي المصروفات النقدية" value={sar(total)} tone="text-red-600" />
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> مصروف نقدي
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد مصروفات نقدية"
      />
      <p className="text-xs leading-relaxed text-purple">
        المصروف يُرحّل: مدين حساب المصروف + ضريبة المدخلات / دائن النقدية أو البنك.
      </p>
      {adding && <CashExpenseModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function CashExpenseModal({ onClose }: { onClose: () => void }) {
  const create = useCreateCashExpense();
  const { expenseOptions, cashOptions } = useAccountOptions();
  const [desc, setDesc] = useState('');
  const [expense, setExpense] = useState(expenseOptions[0]?.value ?? '5400');
  const [subtotal, setSubtotal] = useState(0);
  const [taxable, setTaxable] = useState(true);
  const [pay, setPay] = useState('1111');
  const [branch, setBranch] = useState('نجران');
  const [date, setDate] = useState('2026-06-05');
  const vat = taxable ? round2(subtotal * 0.15) : 0;

  function submit() {
    create.mutate(
      {
        description: desc,
        expense_code: expense,
        subtotal,
        vat_amount: vat,
        pay_account_code: pay,
        branch: toBranch(branch),
        expense_date: date,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="مصروف نقدي جديد">
      <div className="space-y-3">
        <Input label="البيان" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="حساب المصروف"
            value={expense}
            onChange={(e) => setExpense(e.target.value)}
            options={expenseOptions}
          />
          <Select
            label="من حساب"
            value={pay}
            onChange={(e) => setPay(e.target.value)}
            options={cashOptions}
          />
          <Input
            label="المبلغ قبل الضريبة"
            type="number"
            min={0}
            value={subtotal}
            onChange={(e) => setSubtotal(Number(e.target.value))}
          />
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions}
          />
          <Input
            label="التاريخ"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <label className="flex items-center gap-2 pt-6 text-sm text-navy">
            <input
              type="checkbox"
              checked={taxable}
              onChange={(e) => setTaxable(e.target.checked)}
            />
            خاضع لضريبة ١٥٪
          </label>
        </div>
        <div className="rounded-xl bg-navy-50 px-4 py-2.5 text-sm text-purple">
          الضريبة <span className="num font-semibold text-navy">{sar(vat)}</span> · الإجمالي{' '}
          <span className="num font-bold text-gold-600">{sar(subtotal + vat)} ر.س</span>
        </div>
        <Button onClick={submit} disabled={subtotal <= 0} className="w-full">
          <Receipt size={16} /> تسجيل المصروف وترحيله
        </Button>
      </div>
    </Modal>
  );
}

/* ======================= إشعارات مدينة (debit notes) ==================== */
export function DebitNotesScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: rows = [], isLoading, isError, refetch } = useDebitNotes();
  const [adding, setAdding] = useState(false);
  const total = rows.reduce((s, n) => s + n.total, 0);

  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'note_no', header: 'الإشعار', cell: (n) => <span className="num">#{n.note_no}</span> },
    {
      key: 'vendor_name',
      header: 'المورّد',
      cell: (n) => <span className="font-semibold text-navy">{n.vendor_name}</span>,
    },
    { key: 'reason', header: 'السبب', cell: (n) => n.reason || '—' },
    {
      key: 'note_date',
      header: 'التاريخ',
      cell: (n) => <span className="num text-xs">{dateAr(n.note_date)}</span>,
    },
    {
      key: 'total',
      header: 'القيمة',
      cell: (n) => <span className="num font-bold text-navy">{sar(n.total)} ر.س</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="عدد الإشعارات" value={String(rows.length)} />
        <Stat label="إجمالي تخفيض الذمم الدائنة" value={sar(total)} tone="text-teal" />
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> إشعار مدين
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={rows}
        rowKey={(n) => n.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد إشعارات مدينة"
      />
      <p className="text-xs leading-relaxed text-purple">
        الإشعار المدين (مرتجع مشتريات) يُرحّل: مدين الذمم الدائنة / دائن المصروف + عكس ضريبة
        المدخلات.
      </p>
      {adding && <DebitNoteModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function DebitNoteModal({ onClose }: { onClose: () => void }) {
  const create = useCreateDebitNote();
  const { data: bills = [] } = useBills();
  const { expenseOptions } = useAccountOptions();
  const [billId, setBillId] = useState('');
  const [vendor, setVendor] = useState('');
  const [expense, setExpense] = useState(expenseOptions[0]?.value ?? '5400');
  const [subtotal, setSubtotal] = useState(0);
  const [taxable, setTaxable] = useState(true);
  const [reason, setReason] = useState('');
  const [branch, setBranch] = useState('نجران');
  const [date, setDate] = useState('2026-06-06');
  const vat = taxable ? round2(subtotal * 0.15) : 0;

  function submit() {
    const linked = billId ? bills.find((b) => b.id === billId) : undefined;
    create.mutate(
      {
        bill_id: billId || null,
        vendor_name: linked?.vendor_name ?? vendor,
        expense_code: linked?.expense_code ?? expense,
        subtotal,
        vat_amount: vat,
        reason,
        branch: toBranch(branch),
        note_date: date,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="إشعار مدين (مرتجع مشتريات)">
      <div className="space-y-3">
        <Select
          label="فاتورة المشتريات (اختياري)"
          value={billId}
          onChange={(e) => {
            setBillId(e.target.value);
            const b = bills.find((x) => x.id === e.target.value);
            if (b) {
              setVendor(b.vendor_name);
              setExpense(b.expense_code);
              setBranch(b.branch ?? 'نجران');
            }
          }}
          options={[
            { value: '', label: 'بدون' },
            ...bills
              .filter((b) => b.status !== 'void')
              .map((b) => ({ value: b.id, label: `#${b.bill_no} ${b.vendor_name}` })),
          ]}
        />
        {!billId && (
          <Input label="المورّد" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="حساب المصروف"
            value={expense}
            onChange={(e) => setExpense(e.target.value)}
            options={expenseOptions}
          />
          <Input
            label="القيمة قبل الضريبة"
            type="number"
            min={0}
            value={subtotal}
            onChange={(e) => setSubtotal(Number(e.target.value))}
          />
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions}
          />
          <Input
            label="التاريخ"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Input label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />{' '}
          خاضع لضريبة ١٥٪
        </label>
        <Button onClick={submit} disabled={subtotal <= 0} className="w-full">
          تسجيل الإشعار وترحيله
        </Button>
      </div>
    </Modal>
  );
}

/* ======================= أوامر شراء (purchase orders) =================== */
export function PurchaseOrdersScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: orders = [], isLoading, isError, refetch } = usePurchaseOrders();
  const setStatus = useSetPOStatus();
  const convert = useConvertPO();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<PurchaseOrder | null>(null);

  const columns: Column<PurchaseOrder>[] = [
    {
      key: 'po_no',
      header: 'الأمر',
      cell: (p) => <span className="num font-semibold text-navy">#{p.po_no}</span>,
    },
    { key: 'vendor_name', header: 'المورّد', cell: (p) => p.vendor_name },
    { key: 'branch', header: 'الفرع', cell: (p) => p.branch ?? 'المركز' },
    {
      key: 'expected_date',
      header: 'التسليم المتوقع',
      cell: (p) => <span className="num text-xs">{dateAr(p.expected_date)}</span>,
    },
    {
      key: 'total',
      header: 'القيمة',
      cell: (p) => <span className="num font-bold text-navy">{sar(p.total)} ر.س</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (p) => <Badge tone={PO_STATUS_TONE[p.status]}>{PO_STATUS_LABEL[p.status]}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      cell: (p) => (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setView(p)}
            className="rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
          >
            <Eye size={13} />
          </button>
          {editable && p.status === 'draft' && (
            <button
              type="button"
              onClick={() => setStatus.mutate({ id: p.id, status: 'approved' })}
              className="rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium text-white hover:bg-navy-700"
            >
              اعتماد
            </button>
          )}
          {editable && p.status === 'approved' && (
            <button
              type="button"
              onClick={() => setStatus.mutate({ id: p.id, status: 'received' })}
              className="rounded-lg bg-teal-100 px-2.5 py-1.5 text-xs font-medium text-teal hover:opacity-80"
            >
              استلام
            </button>
          )}
          {editable && (p.status === 'received' || p.status === 'approved') && (
            <button
              type="button"
              onClick={() => convert.mutate(p.id)}
              className="bg-gold-50 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gold-600 hover:bg-amber-100"
            >
              <FileText size={13} /> تحويل لفاتورة
            </button>
          )}
          {editable && p.status !== 'closed' && p.status !== 'cancelled' && (
            <button
              type="button"
              onClick={() => setStatus.mutate({ id: p.id, status: 'cancelled' })}
              className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              إلغاء
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> أمر شراء
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={orders}
        rowKey={(p) => p.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد أوامر شراء"
      />
      <p className="text-xs leading-relaxed text-purple">
        أمر الشراء وثيقة التزام (لا يُرحّل محاسبيًا)؛ عند التحويل إلى فاتورة مشتريات يُنشأ القيد
        تلقائيًا.
      </p>
      {adding && <PurchaseOrderModal onClose={() => setAdding(false)} />}
      {view && (
        <Modal open onClose={() => setView(null)} title={`أمر شراء #${view.po_no}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-xs text-purple">
                <th className="py-2 text-right">الوصف</th>
                <th className="py-2 text-left">كمية</th>
                <th className="py-2 text-left">السعر</th>
                <th className="py-2 text-left">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l, i) => (
                <tr key={i} className="border-b border-navy-50">
                  <td className="py-2">{l.description}</td>
                  <td className="num py-2 text-left">{l.qty}</td>
                  <td className="num py-2 text-left">{sar(l.unit_price)}</td>
                  <td className="num py-2 text-left">{sar(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function PurchaseOrderModal({ onClose }: { onClose: () => void }) {
  const create = useCreatePurchaseOrder();
  const { data: vendors = [] } = useVendors();
  const [vendor, setVendor] = useState('');
  const [branch, setBranch] = useState('نجران');
  const [orderDate, setOrderDate] = useState('2026-06-05');
  const [expected, setExpected] = useState('2026-06-20');
  const [lines, setLines] = useState([{ description: '', qty: 1, unit_price: 0 }]);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function submit() {
    create.mutate(
      {
        vendor_name: vendor,
        branch: toBranch(branch),
        order_date: orderDate,
        expected_date: expected,
        lines,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="أمر شراء جديد">
      <div className="max-h-[74vh] space-y-3 overflow-y-auto pl-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-navy">المورّد</label>
            <input
              list="po-vendors"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
            <datalist id="po-vendors">
              {vendors.map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
          </div>
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions}
          />
          <Input
            label="تاريخ الأمر"
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
          />
          <Input
            label="التسليم المتوقع"
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-navy">البنود</p>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-6">
                <Input
                  {...(i === 0 ? { label: 'الوصف' } : {})}
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Input
                  {...(i === 0 ? { label: 'كمية' } : {})}
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-3">
                <Input
                  {...(i === 0 ? { label: 'السعر' } : {})}
                  type="number"
                  min={0}
                  value={l.unit_price}
                  onChange={(e) => setLine(i, { unit_price: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-1 pb-1">
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    className="text-purple hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { description: '', qty: 1, unit_price: 0 }])}
            className="inline-flex items-center gap-1 text-xs font-medium text-navy hover:text-navy-700"
          >
            <Plus size={14} /> إضافة بند
          </button>
        </div>
        <div className="rounded-xl bg-navy-50 px-4 py-2.5 text-sm text-purple">
          الإجمالي <span className="num font-bold text-gold-600">{sar(total)} ر.س</span>
        </div>
        <Button onClick={submit} disabled={total <= 0} className="w-full">
          <ShoppingCart size={16} /> إنشاء أمر الشراء
        </Button>
      </div>
    </Modal>
  );
}

/* ----------------------------- vendors (managed) ------------------------- */
export function VendorsScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: vendors = [], isLoading } = useVendors();
  const [adding, setAdding] = useState(false);
  if (isLoading) return <Card className="text-sm text-purple">جارٍ التحميل…</Card>;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <ShoppingCart size={16} /> الموردون
        </h2>
        {editable && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={15} /> مورّد
          </Button>
        )}
      </div>
      <ul className="space-y-1">
        {vendors.map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-navy-50"
          >
            <span className="font-semibold text-navy">{v.name}</span>
            <Badge tone="navy">{VENDOR_TYPE_LABEL[v.vendor_type]}</Badge>
          </li>
        ))}
      </ul>
      {adding && <VendorModal onClose={() => setAdding(false)} />}
    </Card>
  );
}

function VendorModal({ onClose }: { onClose: () => void }) {
  const add = useAddVendor();
  const [name, setName] = useState('');
  const [type, setType] = useState<VendorType>('supplier');
  const [vat, setVat] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <Modal open onClose={onClose} title="إضافة مورّد">
      <div className="space-y-3">
        <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          label="النوع"
          value={type}
          onChange={(e) => setType(e.target.value as VendorType)}
          options={VENDOR_TYPES.map((t) => ({ value: t, label: VENDOR_TYPE_LABEL[t] }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="الرقم الضريبي" value={vat} onChange={(e) => setVat(e.target.value)} />
          <Input label="الجوال" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <Button
          onClick={() =>
            add.mutate({ name, vendor_type: type, vat_number: vat, phone }, { onSuccess: onClose })
          }
          className="w-full"
        >
          <CheckCircle2 size={16} /> حفظ المورّد
        </Button>
      </div>
    </Modal>
  );
}

/* ===================== العملاء والموردون (linked to platform) ============ */
export function CustomersVendorsScreen() {
  const [tab, setTab] = useState<'customers' | 'vendors'>('customers');
  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl border border-navy-100 bg-white p-1">
        <button
          type="button"
          onClick={() => setTab('customers')}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'customers' ? 'bg-navy text-white' : 'text-purple hover:text-navy'}`}
        >
          <UserRound size={15} /> العملاء
        </button>
        <button
          type="button"
          onClick={() => setTab('vendors')}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'vendors' ? 'bg-navy text-white' : 'text-purple hover:text-navy'}`}
        >
          <ShoppingCart size={15} /> الموردون
        </button>
      </div>
      {tab === 'customers' ? <CustomersTab /> : <VendorsScreen />}
    </div>
  );
}

interface CustomerRow {
  name: string;
  phone: string | null;
  city: string | null;
  count: number;
  billed: number;
  outstanding: number;
}

function CustomersTab() {
  const [q, setQ] = useState('');
  const { data: customers = [], isLoading } = useCustomerSearch(q);
  const { data: invoices = [] } = useInvoices();
  const [open, setOpen] = useState<{ name: string; invoices: Invoice[] } | null>(null);

  const invByCustomer = (name: string) =>
    invoices.filter((i) => i.customer_name === name && i.status !== 'void');

  const rows: CustomerRow[] = customers.map((c) => {
    const list = invByCustomer(c.full_name);
    return {
      name: c.full_name,
      phone: c.phone,
      city: c.city,
      count: list.length,
      billed: list.reduce((s, i) => s + i.total, 0),
      outstanding: list.reduce((s, i) => s + (i.total - i.amount_paid), 0),
    };
  });

  const columns: Column<CustomerRow>[] = [
    {
      key: 'name',
      header: 'العميل',
      cell: (r) => <span className="font-semibold text-navy">{r.name}</span>,
    },
    {
      key: 'phone',
      header: 'الجوال',
      cell: (r) => <span className="num text-xs">{r.phone ?? '—'}</span>,
    },
    { key: 'city', header: 'المدينة', cell: (r) => r.city ?? '—' },
    { key: 'count', header: 'الفواتير', cell: (r) => <span className="num">{r.count}</span> },
    {
      key: 'billed',
      header: 'إجمالي الفوترة',
      cell: (r) => <span className="num font-semibold text-navy">{sar(r.billed)}</span>,
    },
    {
      key: 'outstanding',
      header: 'تحت التحصيل',
      cell: (r) => <span className="num font-semibold text-gold-600">{sar(r.outstanding)}</span>,
    },
    {
      key: 'actions',
      header: '',
      cell: (r) =>
        r.count > 0 ? (
          <button
            type="button"
            onClick={() => setOpen({ name: r.name, invoices: invByCustomer(r.name) })}
            className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
          >
            <Eye size={13} /> فواتيره
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="text-xs leading-relaxed text-purple">
        العملاء مرتبطون بقاعدة عملاء المنصة الفعلية، والفواتير المُصدَرة لهم (من المبيعات أو
        المدفوعات) تنعكس هنا مباشرةً عبر دفتر المبيعات المشترك.
      </Card>
      <div className="relative max-w-sm">
        <Input placeholder="بحث باسم العميل" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.name}
        isLoading={isLoading}
        emptyTitle="لا يوجد عملاء"
      />
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`فواتير ${open.name}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-xs text-purple">
                <th className="py-2 text-right">الفاتورة</th>
                <th className="py-2 text-right">التاريخ</th>
                <th className="py-2 text-left">الإجمالي</th>
                <th className="py-2 text-left">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {open.invoices.map((i) => (
                <tr key={i.id} className="border-b border-navy-50">
                  <td className="num py-2">#{i.invoice_no}</td>
                  <td className="num py-2 text-xs">{dateAr(i.issue_date)}</td>
                  <td className="num py-2 text-left font-semibold text-navy">{sar(i.total)}</td>
                  <td className="py-2 text-left">
                    <Badge tone={INV_STATUS_TONE[i.status]}>{INV_STATUS_LABEL[i.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
