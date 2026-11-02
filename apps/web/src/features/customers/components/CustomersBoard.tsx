import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, List, Plus, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  Skeleton,
  StatTile,
  Table,
  paginate,
} from '@/shared/ui';
import type { Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { BRANCHES_AR } from '@/lib/funnel';
import { usePermissions } from '@/hooks/usePermissions';
import { useCrmThresholds, useCustomerInsights } from '@/features/customers/hooks/useCrmCustomers';
import { crmKpis, customerSegments } from '@/features/customers/lib/classify';
import { CustomerFormModal } from '@/features/customers/components/CustomerFormModal';
import {
  SEGMENT_LABEL,
  SEGMENT_TONE,
  type CustomerInsight,
  type CustomerSegment,
} from '@/features/customers/types';

const PAGE_SIZE = 15;
const CHIP_SEGMENTS: CustomerSegment[] = [
  'active',
  'inactive',
  'new',
  'repeat',
  'with_worker',
  'without_worker',
  'served_before',
];
const ago = (days: number | null) =>
  days === null ? '—' : days === 0 ? 'اليوم' : days === 1 ? 'منذ يوم' : `منذ ${days} يومًا`;

/** إدارة العملاء (CRM): قائمة مصنّفة + لوحة تحليل السلوك، كلها من العمليات الفعلية. */
export default function CustomersBoard() {
  const { can } = usePermissions();
  const [tab, setTab] = useState<'list' | 'insights'>('list');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { data: rows = [], isLoading, isError, refetch } = useCustomerInsights();

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <Users size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">العملاء</h1>
            <p className="text-sm text-purple">
              تصنيف وسلوك العملاء محسوب من العقود والمدفوعات والتواصل الفعلي.
            </p>
          </div>
        </div>
        {can('customers', 'create') && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> عميل جديد
          </Button>
        )}
      </div>

      <div className="mb-5 flex gap-2 border-b border-navy-100" role="tablist">
        {(
          [
            ['list', 'قائمة العملاء', List],
            ['insights', 'تحليل السلوك ومؤشرات الأداء', BarChart3],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key
                ? 'border-navy text-navy'
                : 'border-transparent text-purple hover:text-navy'
            }`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : tab === 'list' ? (
        <CustomerList rows={rows} isLoading={isLoading} />
      ) : (
        <Insights rows={rows} isLoading={isLoading} />
      )}

      <CustomerFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(c) => navigate(`/customers/${c.id}`)}
      />
    </div>
  );
}

function CustomerList({ rows, isLoading }: { rows: CustomerInsight[]; isLoading: boolean }) {
  const { meta } = usePermissions();
  const t = useCrmThresholds();
  const [segment, setSegment] = useState<CustomerSegment | 'all'>('all');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [showDisabled, setShowDisabled] = useState(false);
  const [page, setPage] = useState(1);

  const withSegs = useMemo(() => rows.map((r) => ({ r, s: customerSegments(r, t) })), [rows, t]);
  const visible = withSegs.filter(({ r, s }) => {
    if (!showDisabled && !r.is_active) return false;
    if (segment !== 'all' && !s.has(segment)) return false;
    if (branch !== 'all' && r.branch !== branch) return false;
    const q = search.trim();
    return !q || `${r.full_name} ${r.phone ?? ''}`.includes(q);
  });
  const segOf = new Map(withSegs.map((x) => [x.r.id, x.s]));

  const columns: Column<CustomerInsight>[] = [
    {
      key: 'name',
      header: 'العميل',
      cell: (r) => (
        <div>
          <Link to={`/customers/${r.id}`} className="font-medium text-navy hover:underline">
            {r.full_name}
          </Link>
          <div className="num text-xs text-purple">{r.phone ?? '—'}</div>
          {!r.is_active && <Badge tone="danger">معطّل</Badge>}
        </div>
      ),
      sortValue: (r) => r.full_name,
    },
    { key: 'branch', header: 'الفرع', cell: (r) => r.branch ?? '—' },
    {
      key: 'purchases',
      header: 'مرات الشراء',
      cell: (r) => <span className="num">{r.purchases}</span>,
      sortValue: (r) => r.purchases,
    },
    {
      key: 'paid',
      header: 'إجمالي المدفوع',
      cell: (r) => <span className="num">{sar(r.total_paid)}</span>,
      sortValue: (r) => r.total_paid,
    },
    {
      key: 'last',
      header: 'آخر شراء',
      cell: (r) => (
        <span className="text-xs">
          {r.last_purchase_at ? dateAr(r.last_purchase_at) : '—'}
          <span className="block text-purple">
            {r.last_purchase_at ? ago(r.days_since_purchase) : ''}
          </span>
        </span>
      ),
      sortValue: (r) => r.last_purchase_at ?? '',
    },
    {
      key: 'contact',
      header: 'آخر تواصل',
      cell: (r) => <span className="text-xs">{ago(r.days_since_contact)}</span>,
      sortValue: (r) => r.last_contact_at ?? '',
    },
    {
      key: 'segments',
      header: 'التصنيف',
      cell: (r) => (
        <div className="flex max-w-[16rem] flex-wrap gap-1">
          {[...(segOf.get(r.id) ?? [])]
            .filter((s) => s !== 'without_worker' && s !== 'served_before')
            .slice(0, 3)
            .map((s) => (
              <Badge key={s} tone={SEGMENT_TONE[s]}>
                {SEGMENT_LABEL[s]}
              </Badge>
            ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setSegment('all');
            setPage(1);
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium ${segment === 'all' ? 'bg-navy text-white' : 'bg-white text-navy shadow-card'}`}
        >
          الكل <span className="num">({withSegs.filter((x) => x.r.is_active).length})</span>
        </button>
        {CHIP_SEGMENTS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSegment(s);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${segment === s ? 'bg-navy text-white' : 'bg-white text-navy shadow-card'}`}
          >
            {SEGMENT_LABEL[s]}{' '}
            <span className="num">
              ({withSegs.filter((x) => x.r.is_active && x.s.has(s)).length})
            </span>
          </button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 rounded-2xl bg-white p-4 shadow-card sm:grid-cols-3">
        <Input
          label="بحث"
          placeholder="الاسم أو الجوال"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        {meta?.crossBranch && (
          <Select
            label="الفرع"
            options={[
              { value: 'all', label: 'كل الفروع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
              setPage(1);
            }}
          />
        )}
        <label className="flex items-end gap-2 pb-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
          />
          إظهار العملاء المعطّلين
        </label>
      </div>
      <Table
        columns={columns}
        rows={paginate(
          visible.map((x) => x.r),
          page,
          PAGE_SIZE,
        )}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        emptyTitle="لا يوجد عملاء مطابقون"
      />
      <Pagination page={page} size={PAGE_SIZE} total={visible.length} onChange={setPage} />
    </>
  );
}

function Insights({ rows, isLoading }: { rows: CustomerInsight[]; isLoading: boolean }) {
  const t = useCrmThresholds();
  const k = useMemo(() => crmKpis(rows, t), [rows, t]);
  const live = useMemo(
    () => rows.filter((r) => r.is_active).map((r) => ({ r, s: customerSegments(r, t) })),
    [rows, t],
  );
  if (isLoading)
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  const of = (seg: CustomerSegment) => live.filter((x) => x.s.has(seg)).map((x) => x.r);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="إجمالي العملاء" value={k.total} />
        <StatTile label="العملاء النشطون" value={k.active} tone="success" />
        <StatTile label="العملاء الخاملون" value={k.inactive} tone="warning" />
        <StatTile label="العملاء الجدد" value={k.newCount} hint={`خلال ${t.newDays} يومًا`} />
        <StatTile label="العملاء المتكررون" value={k.repeat} />
        <StatTile
          label="نسبة الاحتفاظ"
          value={`${k.retentionPct}٪`}
          hint="من العملاء المشترين ما زالوا نشطين"
        />
        <StatTile
          label="معدل تكرار الشراء"
          value={`${k.repeatRatePct}٪`}
          hint="من المشترين اشتروا أكثر من مرة"
        />
        <StatTile
          label="متوسط قيمة العميل"
          value={`${sar(k.avgCustomerValue)} ر.س`}
          hint="صافي قبل الضريبة"
        />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-bold text-navy">عملاء بلا شراء ولا عقد ساري منذ</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="30 يومًا أو أكثر" value={k.noPurchaseSince.d30} />
          <StatTile label="60 يومًا أو أكثر" value={k.noPurchaseSince.d60} tone="warning" />
          <StatTile label="90 يومًا أو أكثر" value={k.noPurchaseSince.d90} tone="danger" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="توقفوا عن الشراء (خاملون)"
          rows={of('inactive')}
          detail={(r) => `آخر شراء ${ago(r.days_since_purchase)}`}
        />
        <Panel
          title="يشترون بشكل متكرر"
          rows={of('repeat')}
          detail={(r) => `${r.purchases} عمليات · ${sar(r.sales_value)} ر.س`}
        />
        <Panel
          title="متوقع عودتهم للشراء"
          rows={of('expected_return')}
          detail={(r) =>
            r.next_end_date
              ? `ينتهي عقده ${dateAr(r.next_end_date)}`
              : `آخر شراء ${ago(r.days_since_purchase)}`
          }
        />
        <Panel
          title="لديهم عاملة حاليًا"
          rows={of('with_worker')}
          detail={(r) => `${r.active_contracts} عقد ساري`}
        />
        <Panel
          title="انتهت خدمتهم ولا توجد لديهم عاملة"
          rows={of('ended_no_worker')}
          detail={(r) =>
            r.last_end_date
              ? `انتهى آخر عقد ${dateAr(r.last_end_date)}`
              : `آخر شراء ${ago(r.days_since_purchase)}`
          }
        />
        <Panel
          title="يحتاجون متابعة تسويقية"
          rows={of('needs_followup')}
          detail={(r) => `آخر تواصل ${ago(r.days_since_contact)}`}
          tone="danger"
        />
      </div>
    </div>
  );
}

function Panel({
  title,
  rows,
  detail,
  tone = 'navy',
}: {
  title: string;
  rows: CustomerInsight[];
  detail: (r: CustomerInsight) => string;
  tone?: 'navy' | 'danger';
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className={`text-sm font-bold ${tone === 'danger' ? 'text-red-700' : 'text-navy'}`}>
          {title}
        </h3>
        <span className="num rounded-full bg-navy-50 px-2 text-xs text-navy">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="لا يوجد عملاء في هذه الفئة" />
      ) : (
        <ul className="divide-y divide-navy-50">
          {rows.slice(0, 8).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link to={`/customers/${r.id}`} className="font-medium text-navy hover:underline">
                {r.full_name}
                <span className="ms-2 text-xs font-normal text-purple">{r.branch}</span>
              </Link>
              <span className="text-xs text-purple">{detail(r)}</span>
            </li>
          ))}
          {rows.length > 8 && (
            <li className="pt-2 text-xs text-purple">و{rows.length - 8} آخرون…</li>
          )}
        </ul>
      )}
    </Card>
  );
}
