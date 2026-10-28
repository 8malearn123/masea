import { useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  Building,
  Building2,
  Calculator,
  ChevronDown,
  Eye,
  FileText,
  Landmark,
  LayoutDashboard,
  ListTree,
  LockKeyhole,
  LockOpen,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { useCustomerSearch } from '@/features/contracts/hooks/useCustomers';
import { defaultCfClass, defaultFsClass } from '@/features/accounting/data/ledger';
import {
  CashExpensesScreen,
  CustomersVendorsScreen,
  DebitNotesScreen,
  PurchaseInvoicesScreen,
  PurchaseOrdersScreen,
  VouchersScreen,
} from '@/features/accounting/components/PurchasesScreens';
import { PayrollScreen } from '@/features/accounting/components/PayrollScreen';
import { BanksScreen } from '@/features/accounting/components/BanksScreen';
import { VatScreen } from '@/features/accounting/components/VatScreen';
import { AssetsScreen } from '@/features/accounting/components/AssetsScreen';
import { ProductsScreen } from '@/features/accounting/components/ProductsScreen';
import { FinanceDashboard } from '@/features/accounting/components/FinanceDashboard';
import {
  GeneralLedgerScreen,
  TrialBalanceProScreen,
} from '@/features/accounting/components/LedgerScreens';
import { JournalProScreen } from '@/features/accounting/components/JournalProScreen';
import { StatementsScreen } from '@/features/accounting/components/StatementsScreen';
import { ReceivablesScreen } from '@/features/accounting/components/ReceivablesScreen';
import { BankRecScreen } from '@/features/accounting/components/BankRecScreen';
import {
  BudgetsScreen,
  CostCentersProScreen,
} from '@/features/accounting/components/CostBudgetScreens';
import {
  CreditNotesScreen,
  EInvoiceScreen,
  VatFormScreen,
} from '@/features/accounting/components/TaxScreens';
import { ClosingScreen } from '@/features/accounting/components/ClosingScreen';
import { AssistantScreen } from '@/features/accounting/components/AssistantScreens';
import {
  AccessScreen,
  AlertsScreen,
  AuditScreen,
} from '@/features/accounting/components/ControlScreens';
import {
  useCatalog,
  useChart,
  useCreateInvoice,
  useInvoices,
  useSaveAccount,
  useToggleAccount,
  useVoidInvoice,
} from '@/features/accounting/hooks/useAccounting';
import type { AccountInput, NewInvoiceLine } from '@/features/accounting/api/accounting.api';
import {
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPE_TONE,
  CF_CLASS_LABEL,
  FS_CLASS_LABEL,
  INV_STATUS_LABEL,
  INV_STATUS_TONE,
  INVOICE_TYPE_LABEL,
  type Account,
  type AccountType,
  type CfClass,
  type FsClass,
  type Invoice,
  type InvoiceType,
} from '@/features/accounting/types';

/* ----------------------------- navigation model -------------------------- */
// 13 logical groups (dashboard → settings). Every key maps to exactly one screen;
// screens owned by other modules (customers, payroll) are linked, not duplicated.
type Leaf = { key: string; label: string };
type Group = { key: string; label: string; icon: LucideIcon; children: Leaf[] };

const NAV: Group[] = [
  {
    key: 'g-dash',
    label: 'لوحة البيانات المالية',
    icon: LayoutDashboard,
    children: [
      { key: 'dashboard', label: 'لوحة البيانات' },
      { key: 'alerts', label: 'مركز التنبيهات' },
    ],
  },
  {
    key: 'g-sales',
    label: 'المبيعات والتحصيل',
    icon: FileText,
    children: [
      { key: 'sales', label: 'المبيعات والفواتير' },
      { key: 'credit_notes', label: 'الإشعارات الدائنة' },
      { key: 'products', label: 'منتجات وخدمات' },
    ],
  },
  {
    key: 'g-purch',
    label: 'المشتريات والمدفوعات',
    icon: ShoppingCart,
    children: [
      { key: 'p_inv', label: 'فواتير مشتريات' },
      { key: 'p_vou', label: 'سندات الموردين' },
      { key: 'p_cash', label: 'مصروفات نقدية' },
      { key: 'p_dn', label: 'إشعارات مدينة' },
      { key: 'p_po', label: 'أوامر شراء' },
      { key: 'partners', label: 'العملاء والموردون' },
    ],
  },
  {
    key: 'g-gl',
    label: 'المحاسبة العامة',
    icon: ListTree,
    children: [
      { key: 'chart', label: 'دليل الحسابات' },
      { key: 'journal', label: 'القيود اليومية' },
      { key: 'gl', label: 'الأستاذ العام' },
      { key: 'trial', label: 'ميزان المراجعة' },
      { key: 'payroll', label: 'ترحيل الرواتب' },
    ],
  },
  {
    key: 'g-bank',
    label: 'البنوك والصناديق',
    icon: Landmark,
    children: [
      { key: 'banks', label: 'الحسابات والتحويلات' },
      { key: 'bank_rec', label: 'التسوية البنكية' },
    ],
  },
  {
    key: 'g-ar',
    label: 'الذمم المالية',
    icon: Wallet,
    children: [
      { key: 'receivables', label: 'ذمم العملاء' },
      { key: 'payables', label: 'ذمم الموردين' },
    ],
  },
  {
    key: 'g-assets',
    label: 'الأصول الثابتة',
    icon: Building,
    children: [{ key: 'assets', label: 'سجل الأصول والإهلاك' }],
  },
  {
    key: 'g-cc',
    label: 'مراكز التكلفة والموازنات',
    icon: Building2,
    children: [
      { key: 'cost_centers', label: 'مراكز التكلفة والمشاريع' },
      { key: 'budgets', label: 'الموازنات' },
      { key: 'branches', label: 'الفروع' },
    ],
  },
  {
    key: 'g-tax',
    label: 'الضرائب والفوترة الإلكترونية',
    icon: Receipt,
    children: [
      { key: 'vat', label: 'ضريبة القيمة المضافة' },
      { key: 'vat_form', label: 'نموذج الإقرار' },
      { key: 'einvoice', label: 'الفوترة الإلكترونية' },
    ],
  },
  {
    key: 'g-rep',
    label: 'التقارير المالية',
    icon: BarChart3,
    children: [{ key: 'statements', label: 'القوائم المالية' }],
  },
  {
    key: 'g-close',
    label: 'الإقفال المالي',
    icon: LockKeyhole,
    children: [{ key: 'closing', label: 'السنوات والفترات' }],
  },
  {
    key: 'g-ai',
    label: 'المساعد المحاسبي',
    icon: Bot,
    children: [{ key: 'assistant', label: 'اسأل المساعد' }],
  },
  {
    key: 'g-set',
    label: 'الإعدادات والصلاحيات',
    icon: ShieldCheck,
    children: [
      { key: 'access', label: 'المهام والصلاحيات' },
      { key: 'audit', label: 'سجل التدقيق' },
    ],
  },
];
const ALL_LEAVES = NAV.flatMap((g) => g.children.map((c) => ({ ...c, group: g.key })));
const STORE_KEY = 'acc.nav.open';

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

export default function AccountingBoard() {
  const [active, setActive] = useState('dashboard');
  const [glAccount, setGlAccount] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      /* storage unavailable */
    }
    return { 'g-dash': true, 'g-gl': true };
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(open));
    } catch {
      /* storage unavailable */
    }
  }, [open]);

  const go = (key: string) => {
    if (!ALL_LEAVES.some((l) => l.key === key)) return;
    setActive(key);
    const g = ALL_LEAVES.find((l) => l.key === key)?.group;
    if (g) setOpen((o) => ({ ...o, [g]: true }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openAccount = (code: string) => {
    setGlAccount(code);
    go('gl');
  };
  const current = ALL_LEAVES.find((l) => l.key === active);

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Calculator size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">النظام المحاسبي</h1>
          <p className="text-sm text-purple">
            قيد مزدوج متوازن بدورة اعتماد، أستاذ عام وقوائم مالية، ذمم وبنوك وأصول وموازنات وضريبة —
            كل رقم من القيود المرحّلة.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[270px_1fr]">
        {/* mobile / tablet: compact jump menu */}
        <div className="lg:hidden">
          <Select
            aria-label="أقسام المحاسبة"
            value={active}
            onChange={(e) => go(e.target.value)}
            options={NAV.flatMap((g) =>
              g.children.map((c) => ({ value: c.key, label: `${g.label} — ${c.label}` })),
            )}
          />
        </div>
        {/* desktop sub-navigation (collapsible groups) */}
        <nav
          className="hidden max-h-[calc(100vh-140px)] space-y-0.5 self-start overflow-y-auto rounded-2xl border border-navy-100 bg-white p-3 lg:sticky lg:top-4 lg:block"
          aria-label="أقسام المحاسبة"
        >
          {NAV.map((g) => {
            const single = g.children.length === 1 ? g.children[0] : undefined;
            const isOpen = open[g.key] ?? false;
            const hasActive = g.children.some((c) => c.key === active);
            if (single)
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => go(single.key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${active === single.key ? 'bg-navy font-semibold text-white' : 'text-navy-900 hover:bg-navy-50'}`}
                >
                  <g.icon size={16} /> {g.label}
                </button>
              );
            return (
              <div key={g.key}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition hover:bg-navy-50 ${hasActive ? 'font-semibold text-navy' : 'text-navy-900'}`}
                >
                  <span className="flex items-center gap-2">
                    <g.icon size={16} /> {g.label}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`text-purple transition ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="mb-1 space-y-0.5">
                    {g.children.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => go(c.key)}
                        className={`flex w-full items-center rounded-lg py-1.5 pl-3 pr-9 text-sm transition ${active === c.key ? 'bg-navy font-semibold text-white' : 'text-navy-900 hover:bg-navy-50'}`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* content */}
        <div className="min-w-0">
          {current && (
            <p className="mb-3 text-xs text-purple">
              {NAV.find((g) => g.key === current.group)?.label} ‹{' '}
              <span className="font-semibold text-navy">{current.label}</span>
            </p>
          )}
          {active === 'dashboard' && <FinanceDashboard onNavigate={go} />}
          {active === 'alerts' && <AlertsScreen onNavigate={go} />}
          {active === 'sales' && <SalesScreen />}
          {active === 'credit_notes' && <CreditNotesScreen />}
          {active === 'products' && <ProductsScreen />}
          {active === 'p_inv' && <PurchaseInvoicesScreen />}
          {active === 'p_vou' && <VouchersScreen />}
          {active === 'p_cash' && <CashExpensesScreen />}
          {active === 'p_dn' && <DebitNotesScreen />}
          {active === 'p_po' && <PurchaseOrdersScreen />}
          {active === 'partners' && <CustomersVendorsScreen />}
          {active === 'chart' && <ChartScreen />}
          {active === 'journal' && <JournalProScreen />}
          {active === 'gl' && (
            <GeneralLedgerScreen key={glAccount ?? 'gl'} initialAccount={glAccount} />
          )}
          {active === 'trial' && <TrialBalanceProScreen onOpenAccount={openAccount} />}
          {active === 'payroll' && <PayrollScreen />}
          {active === 'banks' && <BanksScreen />}
          {active === 'bank_rec' && <BankRecScreen />}
          {active === 'receivables' && <ReceivablesScreen key="ar" side="ar" />}
          {active === 'payables' && <ReceivablesScreen key="ap" side="ap" />}
          {active === 'assets' && <AssetsScreen />}
          {active === 'cost_centers' && <CostCentersProScreen />}
          {active === 'budgets' && <BudgetsScreen />}
          {active === 'branches' && <BranchesScreen />}
          {active === 'vat' && <VatScreen />}
          {active === 'vat_form' && <VatFormScreen />}
          {active === 'einvoice' && <EInvoiceScreen />}
          {active === 'statements' && <StatementsScreen onOpenAccount={openAccount} />}
          {active === 'closing' && <ClosingScreen />}
          {active === 'assistant' && <AssistantScreen />}
          {active === 'access' && <AccessScreen />}
          {active === 'audit' && <AuditScreen />}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- chart of accounts (CRUD) -------------------- */
function ChartScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: chart = [], isLoading, isError, refetch } = useChart();
  const toggle = useToggleAccount();
  const [edit, setEdit] = useState<Account | null>(null);
  const [adding, setAdding] = useState(false);

  const depth = (code: string): number => (code.endsWith('000') ? 0 : code.endsWith('00') ? 1 : 2);

  if (isLoading) return <Card className="text-sm text-purple">جارٍ التحميل…</Card>;
  if (isError)
    return (
      <Card className="text-sm text-red-600">
        تعذّر التحميل.{' '}
        <button type="button" className="underline" onClick={() => void refetch()}>
          إعادة المحاولة
        </button>
      </Card>
    );

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <ListTree size={16} /> دليل الحسابات (سعودي — شركة استقدام)
        </h2>
        {editable && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={15} /> إضافة حساب
          </Button>
        )}
      </div>
      <ul className="space-y-0.5">
        {chart.map((a) => {
          const disabled = a.is_active === false;
          return (
            <li
              key={a.code}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                a.is_postable ? 'hover:bg-navy-50' : 'bg-navy-50/60 font-semibold text-navy'
              } ${disabled ? 'opacity-50' : ''}`}
              style={{ marginRight: `${depth(a.code) * 18}px` }}
            >
              <span className="flex items-center gap-2">
                <span className="num text-navy-300 text-xs">{a.code}</span>
                <span className={disabled ? 'text-navy-300 line-through' : 'text-navy-900'}>
                  {a.name_ar}
                </span>
                {!a.is_postable && <span className="text-[10px] text-purple">(رئيسي)</span>}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={ACCOUNT_TYPE_TONE[a.type]}>{ACCOUNT_TYPE_LABEL[a.type]}</Badge>
                {editable && a.is_postable && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEdit(a)}
                      className="text-purple hover:text-navy"
                      title="تعديل"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle.mutate({ code: a.code, active: disabled })}
                      className="text-purple hover:text-red-600"
                      title={disabled ? 'تفعيل' : 'تعطيل'}
                    >
                      {disabled ? <LockOpen size={14} /> : <Trash2 size={14} />}
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {(adding || edit) && (
        <AccountModal
          account={edit}
          chart={chart}
          onClose={() => {
            setAdding(false);
            setEdit(null);
          }}
        />
      )}
    </Card>
  );
}

const ACCOUNT_TYPE_OPTIONS: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

function AccountModal({
  account,
  chart,
  onClose,
}: {
  account: Account | null;
  chart: Account[];
  onClose: () => void;
}) {
  const save = useSaveAccount();
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name_ar ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'expense');
  const [normal, setNormal] = useState<'debit' | 'credit'>(account?.normal_balance ?? 'debit');
  const [parent, setParent] = useState(account?.parent_code ?? '');
  const [fsClass, setFsClass] = useState<FsClass | ''>(account?.fs_class ?? '');
  const [cfClass, setCfClass] = useState<CfClass | ''>(account?.cf_class ?? '');
  const [error, setError] = useState<string | null>(null);
  const draft = { code: code.trim() || '0', type, parent_code: parent || null };

  const headers = chart.filter((a) => !a.is_postable);

  function submit() {
    const input: AccountInput = {
      code: code.trim(),
      name_ar: name.trim(),
      type,
      normal_balance: normal,
      parent_code: parent || null,
      ...(fsClass ? { fs_class: fsClass } : {}),
      ...(cfClass ? { cf_class: cfClass } : {}),
    };
    save.mutate(
      { ...(account ? { code: account.code } : {}), input },
      { onSuccess: onClose, onError: (e) => setError(e.message) },
    );
  }

  return (
    <Modal open onClose={onClose} title={account ? `تعديل حساب — ${account.code}` : 'إضافة حساب'}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="رمز الحساب"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={!!account}
          />
          <Input label="اسم الحساب" value={name} onChange={(e) => setName(e.target.value)} />
          <Select
            label="النوع"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
            options={ACCOUNT_TYPE_OPTIONS.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))}
          />
          <Select
            label="طبيعة الرصيد"
            value={normal}
            onChange={(e) => setNormal(e.target.value as 'debit' | 'credit')}
            options={[
              { value: 'debit', label: 'مدين' },
              { value: 'credit', label: 'دائن' },
            ]}
          />
          <div className="sm:col-span-2">
            <Select
              label="الحساب الأب"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              options={[
                { value: '', label: 'بدون (حساب رئيسي)' },
                ...headers.map((h) => ({ value: h.code, label: `${h.code} — ${h.name_ar}` })),
              ]}
            />
          </div>
          <Select
            label="التصنيف في القوائم المالية"
            value={fsClass}
            onChange={(e) => setFsClass(e.target.value as FsClass | '')}
            options={[
              { value: '', label: `تلقائي (${FS_CLASS_LABEL[defaultFsClass(draft)]})` },
              ...(Object.keys(FS_CLASS_LABEL) as FsClass[]).map((k) => ({
                value: k,
                label: FS_CLASS_LABEL[k],
              })),
            ]}
          />
          <Select
            label="التصنيف في التدفقات النقدية"
            value={cfClass}
            onChange={(e) => setCfClass(e.target.value as CfClass | '')}
            options={[
              { value: '', label: `تلقائي (${CF_CLASS_LABEL[defaultCfClass(draft)]})` },
              ...(Object.keys(CF_CLASS_LABEL) as CfClass[]).map((k) => ({
                value: k,
                label: CF_CLASS_LABEL[k],
              })),
            ]}
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button onClick={submit} className="w-full">
          {account ? 'حفظ التعديلات' : 'إضافة الحساب'}
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------- sales & invoices ---------------------------- */
function SalesScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: invoices = [], isLoading, isError, refetch } = useInvoices();
  const voidInv = useVoidInvoice();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<Invoice | null>(null);

  const live = invoices.filter((i) => i.status !== 'void');
  const totalSales = live.reduce((s, i) => s + i.subtotal, 0);
  const vatOut = live.reduce((s, i) => s + i.vat_amount, 0);
  const outstanding = live.reduce((s, i) => s + (i.total - i.amount_paid), 0);

  const columns: Column<Invoice>[] = [
    {
      key: 'invoice_no',
      header: 'الفاتورة',
      cell: (i) => <span className="num font-semibold text-navy">#{i.invoice_no}</span>,
    },
    {
      key: 'type',
      header: 'النوع',
      cell: (i) => <Badge tone="teal">{INVOICE_TYPE_LABEL[i.type]}</Badge>,
    },
    { key: 'customer_name', header: 'العميل', cell: (i) => i.customer_name },
    { key: 'branch', header: 'الفرع', cell: (i) => i.branch ?? 'المركز' },
    {
      key: 'issue_date',
      header: 'التاريخ',
      cell: (i) => <span className="num text-xs">{dateAr(i.issue_date)}</span>,
    },
    {
      key: 'vat',
      header: 'الضريبة',
      cell: (i) => <span className="num text-purple">{sar(i.vat_amount)}</span>,
    },
    {
      key: 'total',
      header: 'الإجمالي',
      cell: (i) => <span className="num font-bold text-navy">{sar(i.total)} ر.س</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (i) => <Badge tone={INV_STATUS_TONE[i.status]}>{INV_STATUS_LABEL[i.status]}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      cell: (i) => (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setView(i)}
            className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
          >
            <Eye size={13} /> عرض
          </button>
          {editable && i.manual && i.status !== 'void' && (
            <button
              type="button"
              onClick={() => voidInv.mutate(i.id)}
              className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <XCircle size={13} /> إلغاء
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="عدد الفواتير" value={String(live.length)} />
        <Stat label="المبيعات (قبل الضريبة)" value={sar(totalSales)} tone="text-green-600" />
        <Stat label="ضريبة المخرجات" value={sar(vatOut)} tone="text-gold-600" />
        <Stat label="غير محصّل" value={sar(outstanding)} tone="text-red-600" />
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> فاتورة مبيعات جديدة
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={invoices}
        rowKey={(i) => i.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد فواتير"
      />
      <p className="text-xs leading-relaxed text-purple">
        الفواتير المُنشأة هنا تُرحَّل آليًا: مدين ذمم العملاء / دائن الإيراد (قبل الضريبة) + ضريبة
        المخرجات. فواتير العقود تُعرض كوثيقة ضريبية (إيرادها مُثبت عند توقيع العقد).
      </p>
      {adding && <CreateInvoiceModal onClose={() => setAdding(false)} />}
      {view && <InvoiceViewModal invoice={view} onClose={() => setView(null)} />}
    </div>
  );
}

function CreateInvoiceModal({ onClose }: { onClose: () => void }) {
  const create = useCreateInvoice();
  const { data: chart = [] } = useChart();
  const { data: catalog = [] } = useCatalog();
  const { data: customers = [] } = useCustomerSearch('');
  const revenueAccounts = chart.filter(
    (a) => a.type === 'revenue' && a.is_postable && a.is_active !== false,
  );
  const [customer, setCustomer] = useState('');
  const [branch, setBranch] = useState<string>('نجران');
  const [type, setType] = useState<InvoiceType>('simplified');
  const [issueDate, setIssueDate] = useState('2026-06-01');
  const [revenue, setRevenue] = useState(revenueAccounts[0]?.code ?? '4100');
  const [lines, setLines] = useState<NewInvoiceLine[]>([
    { description: '', qty: 1, unit_price: 0 },
  ]);

  const subtotal = lines.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0),
    0,
  );
  const vat = Math.round(subtotal * 0.15 * 100) / 100;

  const setLine = (i: number, patch: Partial<NewInvoiceLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function submit() {
    create.mutate(
      {
        customer_name: customer,
        branch: branch === 'head' ? null : branch,
        type,
        issue_date: issueDate,
        revenue_code: revenue,
        lines,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="فاتورة مبيعات جديدة">
      <div className="max-h-[74vh] space-y-3 overflow-y-auto pl-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-navy">العميل</label>
            <input
              list="acc-customers"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:border-navy focus:outline-none"
              placeholder="اختر عميلاً من قاعدة المنصة"
            />
            <datalist id="acc-customers">
              {customers.map((c) => (
                <option key={c.id} value={c.full_name} />
              ))}
            </datalist>
          </div>
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={[
              { value: 'head', label: 'المركز الرئيسي' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
          />
          <Select
            label="نوع الفاتورة"
            value={type}
            onChange={(e) => setType(e.target.value as InvoiceType)}
            options={[
              { value: 'simplified', label: INVOICE_TYPE_LABEL.simplified },
              { value: 'standard', label: INVOICE_TYPE_LABEL.standard },
            ]}
          />
          <Input
            label="التاريخ"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
          <div className="sm:col-span-2">
            <Select
              label="حساب الإيراد"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              options={revenueAccounts.map((a) => ({
                value: a.code,
                label: `${a.code} — ${a.name_ar}`,
              }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-navy">بنود الفاتورة</p>
            <Select
              value=""
              onChange={(e) => {
                const item = catalog.find((c) => c.id === e.target.value);
                if (!item) return;
                setRevenue(item.revenue_code);
                setLines((ls) => {
                  const next = [...ls];
                  const idx = next.findIndex((l) => !l.description.trim());
                  const line = {
                    description: item.name_ar,
                    qty: 1,
                    unit_price: item.default_price,
                  };
                  if (idx >= 0) next[idx] = line;
                  else next.push(line);
                  return next;
                });
              }}
              options={[
                { value: '', label: 'إضافة من الكتالوج…' },
                ...catalog
                  .filter((c) => c.is_active)
                  .map((c) => ({ value: c.id, label: `${c.name_ar} — ${sar(c.default_price)}` })),
              ]}
            />
          </div>
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
                  {...(i === 0 ? { label: 'سعر الوحدة' } : {})}
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

        <div className="space-y-1 rounded-xl bg-navy-50 px-4 py-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-purple">الإجمالي قبل الضريبة</span>
            <span className="num font-semibold text-navy">{sar(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-purple">ضريبة القيمة المضافة (15٪)</span>
            <span className="num font-semibold text-purple">{sar(vat)}</span>
          </div>
          <div className="flex justify-between border-t border-navy-100 pt-1 font-bold text-navy">
            <span>الإجمالي شامل الضريبة</span>
            <span className="num text-gold-600">{sar(subtotal + vat)} ر.س</span>
          </div>
        </div>
        <Button onClick={submit} disabled={subtotal <= 0} className="w-full">
          <FileText size={16} /> إصدار الفاتورة
        </Button>
      </div>
    </Modal>
  );
}

function InvoiceViewModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`فاتورة ضريبية #${invoice.invoice_no}`}>
      <div className="max-h-[74vh] space-y-4 overflow-y-auto pl-1">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-50 px-4 py-3 text-sm">
          <span className="text-purple">
            العميل: <span className="font-semibold text-navy">{invoice.customer_name}</span>
          </span>
          <Badge tone="teal">{INVOICE_TYPE_LABEL[invoice.type]}</Badge>
          <span className="num text-xs text-purple">{dateAr(invoice.issue_date)}</span>
        </div>
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
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-navy-50">
                <td className="py-2">{l.description}</td>
                <td className="num py-2 text-left">{l.qty}</td>
                <td className="num py-2 text-left">{sar(l.unit_price)}</td>
                <td className="num py-2 text-left">{sar(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1 rounded-xl border border-navy-100 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-purple">قبل الضريبة</span>
            <span className="num font-semibold">{sar(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-purple">ضريبة (15٪)</span>
            <span className="num font-semibold text-purple">{sar(invoice.vat_amount)}</span>
          </div>
          <div className="flex justify-between border-t border-navy-100 pt-1 font-bold text-navy">
            <span>الإجمالي</span>
            <span className="num text-gold-600">{sar(invoice.total)} ر.س</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------- branches ------------------------------- */
function BranchesScreen() {
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <MapPin size={16} /> الفروع
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {BRANCHES_AR.map((b) => (
          <div key={b} className="rounded-xl border border-navy-100 px-4 py-5 text-center">
            <Building2 size={22} className="mx-auto text-navy" />
            <p className="mt-2 font-semibold text-navy">{b}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-purple">
        تُدار بيانات الفروع من وحدة العمليات؛ هنا تُستخدم كمراكز تكلفة محاسبية.
      </p>
    </Card>
  );
}
