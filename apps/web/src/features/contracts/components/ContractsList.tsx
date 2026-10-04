import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { Badge, Card, Input, Select, Table, type Column } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useContracts } from '@/features/contracts/hooks/useContracts';
import { useRecruitmentStages } from '@/features/contracts/hooks/useRecruitment';
import { StatusBadge } from '@/features/contracts/components/StatusBadge';
import { ExpiryAlerts } from '@/features/contracts/components/ExpiryAlerts';
import { CONTRACT_STATUS_LABEL } from '@/features/contracts/lib/contractState';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import {
  contractInsight,
  contractKpis,
  RENEWAL_WINDOW_DAYS,
  contractStageLabel,
  matchesTab,
  sortContracts,
  type ContractSort,
  type ContractTab,
} from '@/features/contracts/lib/contractInsights';
import {
  SERVICE_LABEL,
  type ContractFilters,
  type ContractListItem,
  type ContractStatus,
} from '@/features/contracts/types';

const PAGE_SIZE = 8;

const STATUS_OPTIONS = [
  { value: 'all', label: 'كل الحالات' },
  ...Object.entries(CONTRACT_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l })),
];
const SERVICE_OPTIONS = [
  { value: 'all', label: 'كل الخدمات' },
  ...Object.entries(SERVICE_LABEL).map(([v, l]) => ({ value: v, label: l })),
];
const BRANCH_OPTIONS = [
  { value: 'all', label: 'كل الفروع' },
  ...['نجران', 'جازان', 'شرورة', 'حبونا'].map((b) => ({ value: b, label: b })),
];
const SORT_OPTIONS: { value: ContractSort; label: string }[] = [
  { value: 'recent', label: 'الأحدث تاريخاً' },
  { value: 'value', label: 'الأعلى قيمة' },
  { value: 'due', label: 'الأقرب استحقاقاً' },
];

const TABS: { value: ContractTab; label: string }[] = [
  { value: 'all', label: 'كل العقود' },
  { value: 'action', label: 'تحتاج إجراء' },
  { value: 'live', label: 'سارية' },
  { value: 'renewals', label: 'تجديدات' },
  { value: 'cancelled', label: 'ملغاة' },
];

const ACTION_LABEL: Record<ContractStatus, string> = {
  draft: 'إرسال',
  musaned_created: 'توقيع مساند',
  musaned_signed: 'تفعيل',
  pending_approval: 'اعتماد',
  approved: 'طلب توقيع',
  awaiting_signature: 'توقيع',
  signed: 'تفعيل',
  active: 'متابعة',
  completed: 'تجديد',
  cancelled: 'عرض',
};

/** Lifecycle progress 0–100 for the stage mini-bar. */
const STAGE_PROGRESS: Record<ContractStatus, number> = {
  draft: 12,
  musaned_created: 40,
  musaned_signed: 70,
  pending_approval: 28,
  approved: 45,
  awaiting_signature: 62,
  signed: 78,
  active: 92,
  completed: 100,
  cancelled: 0,
};

export default function ContractsList() {
  const { role } = usePermissions();
  return role === 'external_office' ? <OfficeContractsList /> : <EnhancedContractsList />;
}

/* ======================================================================== */
/*  Enhanced list (internal roles) — KPIs · tabs · rich table · summary     */
/* ======================================================================== */
function EnhancedContractsList() {
  const [filters, setFilters] = useState<ContractFilters>({
    status: 'all',
    service: 'all',
    branch: 'all',
    search: '',
  });
  const [tab, setTab] = useState<ContractTab>('all');
  const [sort, setSort] = useState<ContractSort>('recent');
  const [page, setPage] = useState(0);
  const { can } = usePermissions();
  const { data = [], isLoading, isError, refetch } = useContracts(filters);
  const { data: stages = [] } = useRecruitmentStages();
  const stageName = (code: string | null) => stages.find((s) => s.code === code)?.name_ar ?? null;

  const now = useMemo(() => new Date(), []);
  // مهلة التنبيه/التجديد قيمة إدارية من إعدادات النظام — مصدر واحد للتنبيهات
  // ولتبويب التجديدات ومؤشّره، فتغييرها من الواجهة ينعكس على الشاشة كلها.
  const { data: config = [] } = useConfig();
  const renewalWindow = configValue(config, 'contract_expiry_alert_days', RENEWAL_WINDOW_DAYS);
  const kpis = useMemo(() => contractKpis(data, now, renewalWindow), [data, now, renewalWindow]);

  // rows enriched with derived insight, then tab-filtered + sorted
  const enriched = useMemo(
    () => data.map((c) => ({ c, ins: contractInsight(c, now, renewalWindow) })),
    [data, now, renewalWindow],
  );
  const tabCounts = useMemo(() => {
    const counts: Record<ContractTab, number> = {
      all: 0,
      action: 0,
      live: 0,
      renewals: 0,
      cancelled: 0,
    };
    for (const { c, ins } of enriched)
      for (const t of TABS) if (matchesTab(c, ins, t.value)) counts[t.value] += 1;
    return counts;
  }, [enriched]);

  const visible = useMemo(() => {
    const rows = enriched.filter(({ c, ins }) => matchesTab(c, ins, tab)).map(({ c }) => c);
    return sortContracts(rows, sort, now);
  }, [enriched, tab, sort, now]);

  const paged = useMemo(
    () => visible.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [visible, page],
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));

  const sumValue = useMemo(() => visible.reduce((s, c) => s + (c.total_amount ?? 0), 0), [visible]);
  const sumDue = useMemo(
    () => visible.reduce((s, c) => s + contractInsight(c, now).remaining, 0),
    [visible, now],
  );

  function patch(p: Partial<ContractFilters>) {
    setFilters((f) => ({ ...f, ...p }));
    setPage(0);
  }
  function pickTab(t: ContractTab) {
    setTab(t);
    setPage(0);
  }
  function clearFilters() {
    setFilters({ status: 'all', service: 'all', branch: 'all', search: '' });
    setTab('all');
    setSort('recent');
    setPage(0);
  }
  const hasFilters =
    filters.status !== 'all' ||
    filters.service !== 'all' ||
    filters.branch !== 'all' ||
    filters.search.trim() !== '' ||
    tab !== 'all';

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <FileText size={20} />
          </span>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-navy">
              العقود <span className="num text-sm font-medium text-purple">{data.length} عقد</span>
            </h1>
            <p className="text-sm text-purple">
              متابعة دورة حياة العقود من التسعير حتى الاعتماد والتحصيل والتجديد.
            </p>
          </div>
        </div>
        {can('contracts', 'create') && (
          <Link to="/contracts/new" className="btn-primary">
            <Plus size={16} /> عقد جديد
          </Link>
        )}
      </div>

      {/* تنبيهات انتهاء العقود */}
      <ExpiryAlerts contracts={data} />

      {/* KPI row */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <Kpi
          icon={<Wallet size={18} />}
          tone="danger"
          label="متأخرات التحصيل"
          value={`${sar(kpis.overdueTotal)}`}
          hint="ريال · مستحق للتحصيل"
        />
        <Kpi
          icon={<FileText size={18} />}
          tone="navy"
          label="قيمة المحفظة"
          value={`${sar(kpis.portfolioValue)}`}
          hint="ريال · إجمالي العقود"
        />
        <Kpi
          icon={<RefreshCw size={18} />}
          tone="gold"
          label={`تجديدات خلال ${renewalWindow} يوم`}
          value={String(kpis.renewals)}
          hint="فرصة دخل متكرر"
        />
        <Kpi
          icon={<AlertCircle size={18} />}
          tone="gold"
          label="بانتظار الاعتماد"
          value={String(kpis.pendingApproval)}
          hint="تنتظر قرار المدير"
        />
        <Kpi
          icon={<CalendarClock size={18} />}
          tone="success"
          label="عقود سارية"
          value={String(kpis.activeCount)}
          hint="قيد التشغيل الآن"
        />
      </div>

      {/* tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => pickTab(t.value)}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              tab === t.value
                ? 'bg-navy text-white'
                : 'bg-white text-purple ring-1 ring-navy-100 hover:bg-navy-50'
            }`}
          >
            {t.label}
            <span
              className={`num rounded-full px-1.5 text-xs ${
                tab === t.value ? 'bg-white/20 text-white' : 'bg-navy-50 text-navy'
              }`}
            >
              {tabCounts[t.value]}
            </span>
          </button>
        ))}
      </div>

      {/* filter bar */}
      <Card className="mb-4">
        <div className="grid gap-3 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
              <Search size={16} />
            </span>
            <Input
              placeholder="ابحث برقم العقد أو اسم العميل…"
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
              className="pr-9"
            />
          </div>
          <Select
            value={filters.status}
            onChange={(e) => patch({ status: e.target.value as ContractFilters['status'] })}
            options={STATUS_OPTIONS}
          />
          <Select
            value={filters.service}
            onChange={(e) => patch({ service: e.target.value as ContractFilters['service'] })}
            options={SERVICE_OPTIONS}
          />
          <Select
            value={filters.branch}
            onChange={(e) => patch({ branch: e.target.value })}
            options={BRANCH_OPTIONS}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="w-full max-w-[220px]">
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as ContractSort)}
              options={SORT_OPTIONS}
            />
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm text-purple hover:text-navy hover:underline"
            >
              مسح الفلاتر
            </button>
          )}
        </div>
      </Card>

      {/* rich table */}
      <ContractTable
        rows={paged}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        stageName={stageName}
        now={now}
      />

      {/* summary footer */}
      {!isLoading && !isError && visible.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-navy-50 px-4 py-3 text-sm">
          <span className="text-purple">
            عرض <span className="num font-semibold text-navy">{paged.length}</span> من{' '}
            <span className="num font-semibold text-navy">{visible.length}</span> عقد
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-purple">
              إجمالي قيمة النتائج:{' '}
              <span className="num font-bold text-navy">{sar(sumValue)} ر.س</span>
            </span>
            <span className="text-purple">
              متأخرات: <span className="num font-bold text-red-600">{sar(sumDue)} ر.س</span>
            </span>
          </div>
        </div>
      )}

      {/* pagination */}
      {visible.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn-ghost disabled:opacity-40"
          >
            السابق
          </button>
          <span className="num text-purple">
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1}
            className="btn-ghost disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- KPI card -------------------------------- */
const KPI_TONE: Record<string, string> = {
  danger: 'bg-red-50 text-red-600',
  navy: 'bg-navy-50 text-navy',
  gold: 'bg-gold-100 text-gold-600',
  success: 'bg-green-50 text-green-700',
};
function Kpi({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  tone: keyof typeof KPI_TONE;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="flex items-start gap-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${KPI_TONE[tone]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-purple">{label}</p>
        <p className="num text-xl font-bold text-navy">{value}</p>
        <p className="truncate text-[11px] text-purple/70">{hint}</p>
      </div>
    </Card>
  );
}

/* ----------------------------- rich table -------------------------------- */
function ContractTable({
  rows,
  isLoading,
  isError,
  onRetry,
  stageName,
  now,
}: {
  rows: ContractListItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  stageName: (code: string | null) => string | null;
  now: Date;
}) {
  const columns: Column<ContractListItem>[] = [
    {
      key: 'contract_no',
      header: 'رقم العقد',
      cell: (r) => (
        <Link to={`/contracts/${r.id}`} className="block hover:underline">
          <span className="num font-semibold text-navy">{r.contract_no ?? '—'}</span>
          <span className="num block text-[11px] text-purple">{dateAr(r.created_at)}</span>
        </Link>
      ),
    },
    {
      key: 'customer_name',
      header: 'العميل',
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy-50 text-xs font-bold text-navy">
            {(r.customer_name ?? '؟').trim().charAt(0)}
          </span>
          <span className="truncate text-sm font-medium text-navy-900">
            {r.customer_name ?? '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'service_code',
      header: 'الخدمة',
      cell: (r) => (r.service_code ? SERVICE_LABEL[r.service_code] : '—'),
    },
    {
      key: 'branch_id',
      header: 'العمالة / الفرع',
      cell: (r) => (
        <div>
          <span className="block text-sm text-navy-900">{r.worker_name ?? '—'}</span>
          <span className="block text-[11px] text-purple">{r.branch_id ?? '—'}</span>
        </div>
      ),
    },
    {
      key: 'total_amount',
      header: 'القيمة والسداد',
      cell: (r) => {
        const ins = contractInsight(r, now);
        return (
          <div className="min-w-[130px]">
            <span className="num text-sm font-bold text-navy">{sar(r.total_amount)} ر.س</span>
            <div className="my-1 h-1.5 w-full overflow-hidden rounded-full bg-navy-50">
              <div
                className={`h-full rounded-full ${ins.remaining === 0 ? 'bg-green-500' : ins.isOverdue ? 'bg-red-500' : 'bg-gold-500'}`}
                style={{ width: `${ins.paidPct}%` }}
              />
            </div>
            <span
              className={`num text-[11px] font-medium ${
                ins.payTone === 'success'
                  ? 'text-green-600'
                  : ins.payTone === 'danger'
                    ? 'text-red-600'
                    : 'text-gold-600'
              }`}
            >
              {ins.payLabel}
            </span>
          </div>
        );
      },
    },
    {
      key: 'stage',
      header: 'مرحلة العقد',
      cell: (r) => {
        const ins = contractInsight(r, now);
        return (
          <div className="min-w-[120px]">
            <span className="block text-xs text-navy-900">
              {contractStageLabel(r, ins, stageName(r.recruitment_stage))}
            </span>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-navy-50">
              <div
                className="h-full rounded-full bg-navy/60"
                style={{ width: `${STAGE_PROGRESS[r.status]}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => {
        const ins = contractInsight(r, now);
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={r.status} />
            {ins.nearExpiry && <Badge tone="gold">قارب الانتهاء</Badge>}
          </div>
        );
      },
    },
    {
      key: 'action',
      header: 'إجراء',
      cell: (r) => (
        <Link
          to={`/contracts/${r.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy/90"
        >
          <ClipboardList size={14} /> {ACTION_LABEL[r.status]} <ArrowLeft size={13} />
        </Link>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      emptyTitle="لا توجد عقود مطابقة"
    />
  );
}

/* ======================================================================== */
/*  External-office list — unchanged: recruitment stage + follow-up button  */
/* ======================================================================== */
function OfficeContractsList() {
  const [filters, setFilters] = useState<ContractFilters>({
    status: 'all',
    service: 'all',
    branch: 'all',
    search: '',
  });
  const [page, setPage] = useState(0);
  const { data = [], isLoading, isError, refetch } = useContracts(filters);
  const { data: stages = [] } = useRecruitmentStages();
  const stageName = (code: string | null) =>
    stages.find((s) => s.code === code)?.name_ar ?? 'بانتظار البدء';

  const paged = useMemo(
    () => data.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [data, page],
  );
  const pages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));

  function patch(p: Partial<ContractFilters>) {
    setFilters((f) => ({ ...f, ...p }));
    setPage(0);
  }

  const columns: Column<ContractListItem>[] = [
    {
      key: 'contract_no',
      header: 'رقم العقد',
      cell: (r) => (
        <Link to={`/contracts/${r.id}`} className="num font-semibold text-navy hover:underline">
          {r.contract_no ?? '—'}
        </Link>
      ),
    },
    { key: 'customer_name', header: 'العميل', cell: (r) => r.customer_name ?? '—' },
    {
      key: 'service_code',
      header: 'الخدمة',
      cell: (r) => (r.service_code ? SERVICE_LABEL[r.service_code] : '—'),
    },
    { key: 'branch_id', header: 'الفرع', cell: (r) => r.branch_id ?? '—' },
    {
      key: 'recruitment_stage',
      header: 'مرحلة الاستقدام',
      cell: (r) => (
        <Badge tone={r.recruitment_stage === 'handover' ? 'success' : 'teal'}>
          {stageName(r.recruitment_stage)}
        </Badge>
      ),
    },
    {
      key: 'follow',
      header: 'المتابعة',
      cell: (r) => (
        <Link
          to={`/contracts/${r.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy/90"
        >
          <ClipboardList size={14} /> متابعة <ArrowLeft size={13} />
        </Link>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <FileText size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">طلبات الاستقدام المُسندة</h1>
            <p className="text-sm text-purple">
              اضغط «متابعة» لفتح الطلب وتحديث مرحلته وإرفاق مستنداته.
            </p>
          </div>
        </div>
      </div>

      <Card className="mb-4">
        <div className="relative">
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
            <Search size={16} />
          </span>
          <Input
            placeholder="بحث برقم العقد أو العميل"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
            className="pr-9"
          />
        </div>
      </Card>

      <Table
        columns={columns}
        rows={paged}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد عقود مطابقة"
      />

      {data.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn-ghost disabled:opacity-40"
          >
            السابق
          </button>
          <span className="num text-purple">
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1}
            className="btn-ghost disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  );
}
