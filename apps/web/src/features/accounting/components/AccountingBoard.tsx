import { useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpenText,
  Building,
  Building2,
  Calculator,
  CalendarRange,
  CheckCircle2,
  Eye,
  FileText,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  ListTree,
  Lock,
  LockOpen,
  MapPin,
  Package,
  Pencil,
  Plus,
  Receipt,
  Scale,
  ShoppingCart,
  Sparkles,
  Star,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Table,
  useToast,
  type Column,
} from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { useCustomerSearch } from '@/features/contracts/hooks/useCustomers';
import { accountName } from '@/features/accounting/data/chart';
import { financialSnapshot, trialBalance } from '@/features/accounting/data/engine';
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
import { ReportsScreen } from '@/features/accounting/components/ReportsScreen';
import { AssetsScreen } from '@/features/accounting/components/AssetsScreen';
import { ProductsScreen } from '@/features/accounting/components/ProductsScreen';
import {
  useAddManualEntry,
  useCatalog,
  useChart,
  useCreateInvoice,
  useInvoices,
  useJournal,
  usePeriods,
  useSaveAccount,
  useSetPeriodStatus,
  useToggleAccount,
  useVoidInvoice,
} from '@/features/accounting/hooks/useAccounting';
import type { AccountInput, NewInvoiceLine } from '@/features/accounting/api/accounting.api';
import {
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPE_TONE,
  INV_STATUS_LABEL,
  INV_STATUS_TONE,
  INVOICE_TYPE_LABEL,
  MONTH_AR,
  PERIOD_STATUS_LABEL,
  PERIOD_STATUS_TONE,
  SOURCE_LABEL,
  type Account,
  type AccountType,
  type Invoice,
  type InvoiceType,
  type JournalEntry,
  type JournalLine,
} from '@/features/accounting/types';

/* ----------------------------- navigation model -------------------------- */
type ContentKey =
  | 'dashboard'
  | 'sales'
  | 'partners'
  | 'payroll'
  | 'products'
  | 'p_inv'
  | 'p_vou'
  | 'p_cash'
  | 'p_dn'
  | 'p_po'
  | 'chart'
  | 'journal'
  | 'trial'
  | 'periods'
  | 'cost_centers'
  | 'assets'
  | 'banks'
  | 'vat'
  | 'reports'
  | 'branches';

type Leaf = { key: string; label: string; active: boolean; phase?: string };
type NavItem =
  | { kind: 'leaf'; icon: LucideIcon; leaf: Leaf }
  | { kind: 'group'; icon: LucideIcon; label: string; star?: boolean; children: Leaf[] };

const soon = (key: string, label: string, phase?: string): Leaf =>
  phase ? { key, label, active: false, phase } : { key, label, active: false };
const live = (key: string, label: string): Leaf => ({ key, label, active: true });

const NAV: NavItem[] = [
  { kind: 'leaf', icon: LayoutDashboard, leaf: live('dashboard', 'لوحة البيانات المالية') },
  { kind: 'leaf', icon: FileText, leaf: live('sales', 'المبيعات والفواتير') },
  {
    kind: 'group',
    icon: ShoppingCart,
    label: 'المشتريات',
    children: [
      live('p_inv', 'فواتير مشتريات'),
      live('p_vou', 'سندات الموردين'),
      live('p_cash', 'مصروفات نقدية'),
      live('p_dn', 'إشعارات مدينة'),
      live('p_po', 'أوامر شراء'),
    ],
  },
  { kind: 'leaf', icon: Users, leaf: live('partners', 'العملاء والموردون') },
  { kind: 'leaf', icon: Wallet, leaf: live('payroll', 'الرواتب والموظفون') },
  { kind: 'leaf', icon: Package, leaf: live('products', 'منتجات وخدمات') },
  {
    kind: 'group',
    icon: Star,
    label: 'للمحاسب',
    star: true,
    children: [
      live('chart', 'دليل الحسابات'),
      live('journal', 'القيود اليومية'),
      live('trial', 'ميزان المراجعة'),
      live('periods', 'الفترات المحاسبية'),
    ],
  },
  { kind: 'leaf', icon: Landmark, leaf: live('banks', 'الحسابات البنكية') },
  { kind: 'leaf', icon: Building, leaf: live('assets', 'الأصول الثابتة') },
  { kind: 'leaf', icon: Building2, leaf: live('cost_centers', 'مراكز التكلفة') },
  { kind: 'leaf', icon: FolderKanban, leaf: soon('projects', 'المشاريع') },
  { kind: 'leaf', icon: MapPin, leaf: live('branches', 'الفروع') },
  { kind: 'leaf', icon: Receipt, leaf: live('vat', 'ضريبة القيمة المضافة') },
  { kind: 'leaf', icon: BarChart3, leaf: live('reports', 'التقارير المالية') },
];

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
  const [active, setActive] = useState<ContentKey>('dashboard');
  const [soonLabel, setSoonLabel] = useState<{ label: string; phase?: string } | null>(null);

  function pick(leaf: Leaf) {
    if (leaf.active) {
      setActive(leaf.key as ContentKey);
      setSoonLabel(null);
    } else {
      setSoonLabel(leaf.phase ? { label: leaf.label, phase: leaf.phase } : { label: leaf.label });
    }
  }

  const leafCls = (leaf: Leaf, isActive: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition ${
      isActive
        ? 'bg-navy text-white font-semibold'
        : leaf.active
          ? 'text-navy-900 hover:bg-navy-50'
          : 'cursor-not-allowed text-navy-300'
    }`;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Calculator size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">النظام المحاسبي</h1>
          <p className="text-sm text-purple">
            قيد مزدوج متوازن، مراكز تكلفة على الفروع. القسم «للمحاسب» فعّال (المرحلة ١).
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        {/* accounting sub-navigation */}
        <nav className="space-y-1 self-start rounded-2xl border border-navy-100 bg-white p-3">
          {NAV.map((item, i) =>
            item.kind === 'leaf' ? (
              <button
                key={item.leaf.key}
                type="button"
                onClick={() => pick(item.leaf)}
                className={leafCls(item.leaf, active === item.leaf.key && item.leaf.active)}
              >
                <span className="flex items-center gap-2">
                  <item.icon size={16} /> {item.leaf.label}
                </span>
                {!item.leaf.active && <SoonChip phase={item.leaf.phase} />}
              </button>
            ) : (
              <div key={`g-${i}`} className="pt-1">
                <p
                  className={`flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide ${
                    item.star ? 'text-gold-600' : 'text-purple'
                  }`}
                >
                  {item.star ? <Sparkles size={13} /> : <item.icon size={13} />} {item.label}
                </p>
                {item.children.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => pick(c)}
                    className={`${leafCls(c, active === c.key && c.active)} pr-6`}
                  >
                    <span>{c.label}</span>
                    {!c.active && <SoonChip phase={c.phase} />}
                  </button>
                ))}
              </div>
            ),
          )}
        </nav>

        {/* content */}
        <div>
          {soonLabel ? (
            <SoonPanel label={soonLabel.label} phase={soonLabel.phase} />
          ) : (
            <>
              {active === 'dashboard' && <DashboardScreen />}
              {active === 'sales' && <SalesScreen />}
              {active === 'partners' && <CustomersVendorsScreen />}
              {active === 'payroll' && <PayrollScreen />}
              {active === 'products' && <ProductsScreen />}
              {active === 'p_inv' && <PurchaseInvoicesScreen />}
              {active === 'p_vou' && <VouchersScreen />}
              {active === 'p_cash' && <CashExpensesScreen />}
              {active === 'p_dn' && <DebitNotesScreen />}
              {active === 'p_po' && <PurchaseOrdersScreen />}
              {active === 'chart' && <ChartScreen />}
              {active === 'journal' && <JournalScreen />}
              {active === 'trial' && <TrialBalanceScreen />}
              {active === 'periods' && <PeriodsScreen />}
              {active === 'banks' && <BanksScreen />}
              {active === 'vat' && <VatScreen />}
              {active === 'reports' && <ReportsScreen />}
              {active === 'assets' && <AssetsScreen />}
              {active === 'cost_centers' && <CostCentersScreen />}
              {active === 'branches' && <BranchesScreen />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SoonChip({ phase }: { phase?: string | undefined }) {
  return (
    <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[10px] font-medium text-purple">
      {phase ? phase : 'قريباً'}
    </span>
  );
}

function SoonPanel({ label, phase }: { label: string; phase?: string | undefined }) {
  return (
    <Card className="grid min-h-[50vh] place-items-center text-center">
      <div>
        <Sparkles size={32} className="mx-auto text-navy-200" />
        <p className="mt-3 text-lg font-bold text-navy">{label}</p>
        <p className="mt-1 text-sm text-purple">
          هذا القسم قيد التطوير{phase ? ` — ${phase}` : ''}.
        </p>
        <span className="bg-gold-50 mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold text-gold-600">
          قريباً
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------ dashboard -------------------------------- */
function DashboardScreen() {
  const { data: entries = [], isLoading } = useJournal();
  const snap = useMemo(() => financialSnapshot(entries), [entries]);
  if (isLoading) return <Card className="text-sm text-purple">جارٍ تحميل المؤشرات…</Card>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="الإيراد (قبل الضريبة)" value={sar(snap.revenue)} tone="text-green-600" />
        <Stat label="المصروفات" value={sar(snap.expenses)} tone="text-red-600" />
        <Stat label="صافي الربح" value={sar(snap.netProfit)} tone="text-gold-600" />
        <Stat label="الرصيد النقدي والبنوك" value={sar(snap.cash)} tone="text-navy" />
        <Stat label="ذمم العملاء" value={sar(snap.receivables)} tone="text-teal" />
        <Stat label="ضريبة مستحقة (VAT)" value={sar(snap.vatPayable)} tone="text-gold-600" />
      </div>
      <Card>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
          <Scale size={16} /> سلامة الدفتر
        </h2>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-purple">
            مدين: <span className="num font-semibold text-navy">{sar(snap.totalDebit)}</span>
          </span>
          <span className="text-purple">
            دائن: <span className="num font-semibold text-navy">{sar(snap.totalCredit)}</span>
          </span>
          {snap.balanced ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
              <CheckCircle2 size={14} /> الدفتر متوازن
            </span>
          ) : (
            <Badge tone="danger">غير متوازن!</Badge>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-purple">
          لوحة مبدئية تكتمل مؤشراتها مع وحدة التقارير المالية (مرحلة ٧). الإيراد قبل الضريبة وVAT
          التزام مستقل.
        </p>
      </Card>
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
  const [error, setError] = useState<string | null>(null);

  const headers = chart.filter((a) => !a.is_postable);

  function submit() {
    const input: AccountInput = {
      code: code.trim(),
      name_ar: name.trim(),
      type,
      normal_balance: normal,
      parent_code: parent || null,
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
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button onClick={submit} className="w-full">
          {account ? 'حفظ التعديلات' : 'إضافة الحساب'}
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------- journal --------------------------------- */
function JournalScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: entries = [], isLoading, isError, refetch } = useJournal();
  const [addOpen, setAddOpen] = useState(false);
  const [open, setOpen] = useState<JournalEntry | null>(null);

  const columns: Column<JournalEntry>[] = [
    { key: 'entry_no', header: 'القيد', cell: (e) => <span className="num">#{e.entry_no}</span> },
    {
      key: 'entry_date',
      header: 'التاريخ',
      cell: (e) => <span className="num text-xs">{dateAr(e.entry_date)}</span>,
    },
    {
      key: 'description',
      header: 'البيان',
      cell: (e) => <span className="font-semibold text-navy">{e.description}</span>,
    },
    {
      key: 'source_type',
      header: 'المصدر',
      cell: (e) => <Badge tone="teal">{SOURCE_LABEL[e.source_type]}</Badge>,
    },
    { key: 'branch', header: 'مركز التكلفة', cell: (e) => e.branch ?? 'المركز' },
    {
      key: 'amount',
      header: 'المبلغ',
      cell: (e) => (
        <span className="num font-bold text-navy">
          {sar(e.lines.reduce((s, l) => s + l.debit, 0))} ر.س
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (e) => (
        <button
          type="button"
          onClick={() => setOpen(e)}
          className="rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
        >
          الأطراف
        </button>
      ),
    },
  ];

  return (
    <div>
      {editable && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} /> قيد يدوي
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد قيود بعد"
      />
      {open && <EntryLinesModal entry={open} onClose={() => setOpen(null)} />}
      {addOpen && <ManualEntryModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function EntryLinesModal({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const debit = entry.lines.reduce((s, l) => s + l.debit, 0);
  const credit = entry.lines.reduce((s, l) => s + l.credit, 0);
  return (
    <Modal open onClose={onClose} title={`قيد #${entry.entry_no} — ${entry.description}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy-100 text-xs text-purple">
            <th className="py-2 text-right">الحساب</th>
            <th className="py-2 text-left">مدين</th>
            <th className="py-2 text-left">دائن</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l, i) => (
            <tr key={i} className="border-b border-navy-50">
              <td className="py-2">
                <span className="num text-navy-300 text-xs">{l.account_code}</span>{' '}
                {accountName(l.account_code)}
              </td>
              <td className="num py-2 text-left text-green-600">
                {l.debit > 0 ? sar(l.debit) : '—'}
              </td>
              <td className="num py-2 text-left text-red-600">
                {l.credit > 0 ? sar(l.credit) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold text-navy">
            <td className="py-2">الإجمالي</td>
            <td className="num py-2 text-left">{sar(debit)}</td>
            <td className="num py-2 text-left">{sar(credit)}</td>
          </tr>
        </tfoot>
      </table>
    </Modal>
  );
}

interface DraftLine {
  account_code: string;
  debit: number;
  credit: number;
}

function ManualEntryModal({ onClose }: { onClose: () => void }) {
  const { data: chart = [] } = useChart();
  const add = useAddManualEntry();
  const toast = useToast();
  const postable = chart.filter((a) => a.is_postable && a.is_active !== false);
  const [date, setDate] = useState('2026-06-01');
  const [branch, setBranch] = useState<string>('نجران');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { account_code: postable[0]?.code ?? '5400', debit: 0, credit: 0 },
    { account_code: postable[1]?.code ?? '1111', debit: 0, credit: 0 },
  ]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function submit() {
    if (!description.trim()) {
      toast.error('أدخل بيان القيد');
      return;
    }
    const clean: JournalLine[] = lines
      .map((l) => ({
        account_code: l.account_code,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }))
      .filter((l) => l.debit > 0 || l.credit > 0);
    add.mutate(
      { entry_date: date, branch: branch === 'head' ? null : branch, description, lines: clean },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="ترحيل قيد يدوي">
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pl-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="التاريخ"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={[
              { value: 'head', label: 'المركز الرئيسي' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
          />
          <Input
            label="البيان"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-6">
                <Select
                  {...(i === 0 ? { label: 'الحساب' } : {})}
                  value={l.account_code}
                  onChange={(e) => setLine(i, { account_code: e.target.value })}
                  options={postable.map((a) => ({
                    value: a.code,
                    label: `${a.code} — ${a.name_ar}`,
                  }))}
                />
              </div>
              <div className="col-span-3">
                <Input
                  {...(i === 0 ? { label: 'مدين' } : {})}
                  type="number"
                  min={0}
                  value={l.debit}
                  onChange={(e) => setLine(i, { debit: Number(e.target.value), credit: 0 })}
                />
              </div>
              <div className="col-span-2">
                <Input
                  {...(i === 0 ? { label: 'دائن' } : {})}
                  type="number"
                  min={0}
                  value={l.credit}
                  onChange={(e) => setLine(i, { credit: Number(e.target.value), debit: 0 })}
                />
              </div>
              <div className="col-span-1 pb-1">
                {lines.length > 2 && (
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
            onClick={() =>
              setLines((ls) => [
                ...ls,
                { account_code: postable[0]?.code ?? '1111', debit: 0, credit: 0 },
              ])
            }
            className="inline-flex items-center gap-1 text-xs font-medium text-navy hover:text-navy-700"
          >
            <Plus size={14} /> إضافة سطر
          </button>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-2.5 text-sm">
          <span className="text-purple">
            مدين <span className="num font-semibold text-navy">{sar(totalDebit)}</span> · دائن{' '}
            <span className="num font-semibold text-navy">{sar(totalCredit)}</span>
          </span>
          {balanced ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
              <CheckCircle2 size={14} /> متوازن
            </span>
          ) : (
            <span className="text-xs font-semibold text-red-600">غير متوازن — لن يُرحّل</span>
          )}
        </div>
        <Button onClick={submit} disabled={!balanced} className="w-full">
          <BookOpenText size={16} /> ترحيل القيد
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------- trial balance (filtered) -------------------- */
function TrialBalanceScreen() {
  const { data: entries = [], isLoading } = useJournal();
  const { data: periods = [] } = usePeriods();
  const [period, setPeriod] = useState('all');
  const [branch, setBranch] = useState('all');

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (period === 'all' || e.entry_date.startsWith(period)) &&
          (branch === 'all' || e.branch === branch),
      ),
    [entries, period, branch],
  );
  const rows = useMemo(() => trialBalance(filtered), [filtered]);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  if (isLoading) return <Card className="text-sm text-purple">جارٍ التحميل…</Card>;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Scale size={16} /> ميزان المراجعة
        </h2>
        <div className="flex gap-2">
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={[
              { value: 'all', label: 'كل الفترات' },
              ...periods.map((p) => ({ value: p.id, label: `${MONTH_AR[p.month - 1]} ${p.year}` })),
            ]}
          />
          <Select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={[
              { value: 'all', label: 'كل مراكز التكلفة' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
          />
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy-100 text-xs text-purple">
            <th className="py-2 text-right">الحساب</th>
            <th className="py-2 text-right">النوع</th>
            <th className="py-2 text-left">مدين</th>
            <th className="py-2 text-left">دائن</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-navy-50">
              <td className="py-2">
                <span className="num text-navy-300 text-xs">{r.code}</span> {r.name_ar}
              </td>
              <td className="py-2">
                <Badge tone={ACCOUNT_TYPE_TONE[r.type]}>{ACCOUNT_TYPE_LABEL[r.type]}</Badge>
              </td>
              <td className="num py-2 text-left text-green-600">
                {r.debit > 0 ? sar(r.debit) : '—'}
              </td>
              <td className="num py-2 text-left text-red-600">
                {r.credit > 0 ? sar(r.credit) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold text-navy">
            <td className="py-2" colSpan={2}>
              الإجمالي
            </td>
            <td className="num py-2 text-left">{sar(totalDebit)}</td>
            <td className="num py-2 text-left">{sar(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-xs text-purple">
        {Math.round(totalDebit * 100) === Math.round(totalCredit * 100)
          ? 'الميزان متوازن.'
          : 'تحذير: الميزان غير متوازن.'}
      </p>
    </Card>
  );
}

/* --------------------------- accounting periods -------------------------- */
function PeriodsScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: periods = [], isLoading } = usePeriods();
  const setStatus = useSetPeriodStatus();
  if (isLoading) return <Card className="text-sm text-purple">جارٍ التحميل…</Card>;

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
        <CalendarRange size={16} /> الفترات المحاسبية — 2026
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-purple">
        الفترة المقفلة ترفض أي ترحيل؛ التصحيح يكون بقيد عكسي أو بإعادة الفتح بصلاحية.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {periods.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-xl border border-navy-100 px-3 py-2.5"
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-navy">{MONTH_AR[p.month - 1]}</span>
              <span className="num text-xs text-purple">{p.year}</span>
              <Badge tone={PERIOD_STATUS_TONE[p.status]}>{PERIOD_STATUS_LABEL[p.status]}</Badge>
            </span>
            {editable && (
              <button
                type="button"
                onClick={() =>
                  setStatus.mutate({ id: p.id, status: p.status === 'open' ? 'closed' : 'open' })
                }
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  p.status === 'open'
                    ? 'bg-navy-50 text-navy hover:bg-navy-100'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                {p.status === 'open' ? (
                  <>
                    <Lock size={13} /> إقفال
                  </>
                ) : (
                  <>
                    <LockOpen size={13} /> إعادة فتح
                  </>
                )}
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------- cost centers ------------------------------ */
function CostCentersScreen() {
  const { data: entries = [] } = useJournal();
  const centers = useMemo(
    () =>
      BRANCHES_AR.map((b) => {
        const rows = entries.filter((e) => e.branch === b);
        const debit = rows.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit, 0), 0);
        return { branch: b, entries: rows.length, movement: debit };
      }),
    [entries],
  );

  return (
    <div className="space-y-4">
      <Card className="text-xs leading-relaxed text-purple">
        مراكز التكلفة هي فروع ماسية الشرق الأربعة. كل قيد موسوم بفرعه، ويُصفّى به ميزان المراجعة.
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {centers.map((c) => (
          <Card key={c.branch}>
            <p className="flex items-center gap-2 text-sm font-bold text-navy">
              <Building2 size={15} /> {c.branch}
            </p>
            <p className="mt-2 text-xs text-purple">عدد القيود</p>
            <p className="num text-xl font-bold text-navy">{c.entries}</p>
            <p className="mt-1 text-xs text-purple">حركة المركز</p>
            <p className="num text-lg font-bold text-gold-600">{sar(c.movement)} ر.س</p>
          </Card>
        ))}
      </div>
    </div>
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
