import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, FileText, RotateCcw, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  Input,
  Pagination,
  Select,
  Skeleton,
  StatTile,
  Table,
  paginate,
} from '@/shared/ui';
import type { Column } from '@/shared/ui';
import { dateAr, dateTimeAr, sar } from '@/shared/lib/format';
import { exportExcel, exportPdf, type ExportTable } from '@/shared/lib/exportTable';
import { BRANCHES_AR } from '@/lib/funnel';
import { usePermissions } from '@/hooks/usePermissions';
import { useServices } from '@/hooks/useServices';
import { PRICING_SERVICE_LABEL } from '@/features/pricing/types';
import { useAddSaleNote, useSaleNotes, useSales } from '@/features/sales/hooks/useSales';
import { applySalesFilters, salesTotals } from '@/features/sales/api/sales.api';
import {
  EMPTY_SALES_FILTERS,
  SALE_STATUS_LABEL,
  SALE_STATUS_TONE,
  type Sale,
  type SaleStatus,
  type SalesFilters,
} from '@/features/sales/types';

const PAGE_SIZE = 15;

/**
 * قسم المبيعات: كل عملية بيعت فعلاً — مسحوبة تلقائيًا من العقود المعتمدة، عملية
 * واحدة لكل عقد، مع الخصم والصافي والموظف المسؤول والملاحظات والفلاتر والإجماليات.
 */
export default function SalesBoard() {
  const { can, meta, branchLabel, role } = usePermissions();
  const { data: all = [], isLoading, isError, refetch } = useSales();
  const { data: services = [] } = useServices();
  const [filters, setFilters] = useState<SalesFilters>(EMPTY_SALES_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Sale | null>(null);

  const serviceLabel = (code: string | null) =>
    code
      ? (services.find((s) => s.code === code)?.name_ar ?? PRICING_SERVICE_LABEL[code] ?? code)
      : '—';
  const set = (patch: Partial<SalesFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const rows = useMemo(() => applySalesFilters(all, filters), [all, filters]);
  const totals = useMemo(() => salesTotals(rows), [rows]);
  const employees = useMemo(
    () => [...new Set(all.map((s) => s.sold_by_name).filter((n): n is string => !!n))].sort(),
    [all],
  );

  const columns: Column<Sale>[] = [
    {
      key: 'sale_no',
      header: 'رقم العملية',
      cell: (s) => <span className="num font-medium text-navy">SL-{s.sale_no}</span>,
      sortValue: (s) => s.sale_no,
    },
    {
      key: 'customer',
      header: 'العميل',
      cell: (s) => (
        <div>
          <div className="font-medium text-navy">{s.customer_name ?? '—'}</div>
          <div className="num text-xs text-purple">{s.contract_no}</div>
        </div>
      ),
      sortValue: (s) => s.customer_name ?? '',
    },
    { key: 'branch', header: 'الفرع', cell: (s) => s.branch ?? '—' },
    {
      key: 'service',
      header: 'الخدمة',
      cell: (s) => (
        <div>
          <div>{serviceLabel(s.service_code)}</div>
          {s.worker_name && <div className="text-xs text-purple">{s.worker_name}</div>}
          {s.is_renewal && <Badge tone="teal">تجديد</Badge>}
        </div>
      ),
    },
    {
      key: 'gross',
      header: 'قيمة العقد',
      cell: (s) => <span className="num">{sar(s.gross_amount)}</span>,
      sortValue: (s) => s.gross_amount,
    },
    {
      key: 'discount',
      header: 'الخصم',
      cell: (s) =>
        s.discount_amount > 0 ? (
          <span className="num text-red-600">
            {sar(s.discount_amount)}
            {s.coupon_code && <span className="block text-xs">{s.coupon_code}</span>}
          </span>
        ) : (
          <span className="text-purple">—</span>
        ),
      sortValue: (s) => s.discount_amount,
    },
    {
      key: 'net',
      header: 'صافي البيع',
      cell: (s) => <span className="num font-semibold text-navy">{sar(s.net_amount)}</span>,
      sortValue: (s) => s.net_amount,
    },
    {
      key: 'sold_at',
      header: 'تاريخ البيع',
      cell: (s) => <span className="whitespace-nowrap text-xs">{dateAr(s.sold_at)}</span>,
      sortValue: (s) => s.sold_at,
    },
    { key: 'seller', header: 'الموظف المسؤول', cell: (s) => s.sold_by_name ?? '—' },
    {
      key: 'status',
      header: 'الحالة',
      cell: (s) => <Badge tone={SALE_STATUS_TONE[s.status]}>{SALE_STATUS_LABEL[s.status]}</Badge>,
    },
    {
      key: 'open',
      header: '',
      cell: (s) => (
        <Button size="sm" variant="ghost" onClick={() => setSelected(s)}>
          التفاصيل
        </Button>
      ),
    },
  ];

  const exportData = (): ExportTable => ({
    title: 'المبيعات',
    subtitle: [
      filters.from && `من ${filters.from}`,
      filters.to && `إلى ${filters.to}`,
      filters.branch !== 'all' && filters.branch,
    ]
      .filter(Boolean)
      .join(' · '),
    headers: [
      'رقم العملية',
      'رقم العقد',
      'العميل',
      'الفرع',
      'الخدمة',
      'العاملة',
      'قيمة العقد',
      'الخصم',
      'صافي البيع',
      'الضريبة',
      'الإجمالي',
      'تاريخ البيع',
      'الموظف',
      'الحالة',
    ],
    rows: rows.map((s) => [
      `SL-${s.sale_no}`,
      s.contract_no ?? '',
      s.customer_name ?? '',
      s.branch ?? '',
      serviceLabel(s.service_code),
      s.worker_name ?? '',
      s.gross_amount,
      s.discount_amount,
      s.net_amount,
      s.vat_amount,
      s.total_amount,
      s.sold_at.slice(0, 10),
      s.sold_by_name ?? '',
      SALE_STATUS_LABEL[s.status],
    ]),
    footer: [
      'الإجمالي (بدون الملغاة)',
      '',
      '',
      '',
      '',
      '',
      totals.gross,
      totals.discounts,
      totals.net,
      '',
      totals.total,
      '',
      '',
      '',
    ],
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <Wallet size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">المبيعات</h1>
            <p className="text-sm text-purple">
              العمليات المباعة فعلاً — تُسحب تلقائيًا من العقود الموقّعة، عملية واحدة لكل عقد.
              {role === 'sales'
                ? ' (مبيعاتك فقط)'
                : !meta?.crossBranch && branchLabel
                  ? ` (فرع ${branchLabel})`
                  : ''}
            </p>
          </div>
        </div>
        {can('sales_ops', 'export') && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() => exportExcel(exportData())}
            >
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() => exportPdf(exportData())}
            >
              <FileText size={16} /> PDF
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile
            label="عدد العمليات"
            value={totals.count}
            {...(totals.cancelled ? { hint: `${totals.cancelled} ملغاة غير محتسبة` } : {})}
          />
          <StatTile label="إجمالي المبيعات (قيمة العقود)" value={`${sar(totals.gross)} ر.س`} />
          <StatTile label="الخصومات" value={`${sar(totals.discounts)} ر.س`} tone="danger" />
          <StatTile
            label="صافي الإيرادات (قبل الضريبة)"
            value={`${sar(totals.net)} ر.س`}
            tone="success"
          />
          <StatTile
            label="المحصّل"
            value={`${sar(totals.collected)} ر.س`}
            hint={`من ${sar(totals.total)} شامل الضريبة`}
          />
        </div>
      )}

      <div className="mb-4 grid gap-3 rounded-2xl bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-7">
        <Input
          label="بحث"
          placeholder="رقم العملية أو العقد أو العميل"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
        <Input
          label="من تاريخ"
          type="date"
          value={filters.from}
          onChange={(e) => set({ from: e.target.value })}
        />
        <Input
          label="إلى تاريخ"
          type="date"
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
        />
        {meta?.crossBranch && (
          <Select
            label="الفرع"
            options={[
              { value: 'all', label: 'كل الفروع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
            value={filters.branch}
            onChange={(e) => set({ branch: e.target.value })}
          />
        )}
        {role !== 'sales' && (
          <Select
            label="الموظف"
            options={[
              { value: 'all', label: 'كل الموظفين' },
              ...employees.map((n) => ({ value: n, label: n })),
            ]}
            value={filters.employee}
            onChange={(e) => set({ employee: e.target.value })}
          />
        )}
        <Select
          label="الخدمة"
          options={[
            { value: 'all', label: 'كل الخدمات' },
            ...services.map((s) => ({ value: s.code, label: s.name_ar })),
          ]}
          value={filters.service}
          onChange={(e) => set({ service: e.target.value })}
        />
        <Select
          label="الحالة"
          options={[
            { value: 'all', label: 'كل الحالات' },
            ...(Object.entries(SALE_STATUS_LABEL) as [SaleStatus, string][]).map(
              ([value, label]) => ({ value, label }),
            ),
          ]}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value as SalesFilters['status'] })}
        />
      </div>
      {JSON.stringify(filters) !== JSON.stringify(EMPTY_SALES_FILTERS) && (
        <button
          type="button"
          className="mb-3 inline-flex items-center gap-1 text-xs text-purple hover:text-navy"
          onClick={() => set(EMPTY_SALES_FILTERS)}
        >
          <RotateCcw size={12} /> مسح الفلاتر
        </button>
      )}

      <Table
        columns={columns}
        rows={paginate(rows, page, PAGE_SIZE)}
        rowKey={(s) => s.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle={
          all.length
            ? 'لا توجد مبيعات مطابقة للفلاتر'
            : 'لا توجد مبيعات بعد — تظهر هنا تلقائيًا عند توقيع العقود'
        }
      />
      <Pagination page={page} size={PAGE_SIZE} total={rows.length} onChange={setPage} />

      <SaleDrawer sale={selected} serviceLabel={serviceLabel} onClose={() => setSelected(null)} />
    </div>
  );
}

function SaleDrawer({
  sale,
  serviceLabel,
  onClose,
}: {
  sale: Sale | null;
  serviceLabel: (code: string | null) => string;
  onClose: () => void;
}) {
  const { can, fullName } = usePermissions();
  const { data: notes = [], isLoading } = useSaleNotes(sale?.id ?? null);
  const add = useAddSaleNote();
  const [note, setNote] = useState('');
  // the seller may note their own sale; managers with sales_ops.edit any sale in scope
  const canNote = !!sale && (can('sales_ops', 'edit') || sale.sold_by_name === fullName);

  return (
    <Drawer
      open={sale !== null}
      onClose={onClose}
      title={sale ? `عملية البيع SL-${sale.sale_no}` : ''}
      subtitle={
        sale && <Badge tone={SALE_STATUS_TONE[sale.status]}>{SALE_STATUS_LABEL[sale.status]}</Badge>
      }
      width="lg"
    >
      {sale && (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            {(
              [
                ['العميل', sale.customer_name ?? '—'],
                ['الفرع', sale.branch ?? '—'],
                ['الخدمة', serviceLabel(sale.service_code)],
                ['العاملة', sale.worker_name ?? '—'],
                ['تاريخ البيع', dateTimeAr(sale.sold_at)],
                ['الموظف المسؤول', sale.sold_by_name ?? '—'],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-purple">{k}</dt>
                <dd className="font-medium text-navy">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="rounded-xl border border-navy-100">
            {(
              [
                ['قيمة العقد قبل الخصم', sale.gross_amount, ''],
                [
                  `الخصم${sale.coupon_code ? ` (كوبون ${sale.coupon_code})` : ''}`,
                  -sale.discount_amount,
                  'text-red-600',
                ],
                ['صافي البيع قبل الضريبة', sale.net_amount, 'font-semibold'],
                ['ضريبة القيمة المضافة', sale.vat_amount, ''],
                ['الإجمالي شامل الضريبة', sale.total_amount, 'font-bold text-navy'],
                ['المحصّل', sale.collected, 'text-green-700'],
              ] as const
            ).map(([k, v, cls]) => (
              <div
                key={k}
                className="flex justify-between border-b border-navy-50 px-3 py-2 last:border-0"
              >
                <span>{k}</span>
                <span className={`num ${cls}`}>
                  {v === 0 && cls === 'text-red-600' ? '—' : sar(v)}
                </span>
              </div>
            ))}
          </div>

          <Link
            to={`/contracts/${sale.contract_id}`}
            className="inline-flex text-sm font-medium text-navy underline"
          >
            فتح العقد {sale.contract_no}
          </Link>

          <section>
            <h3 className="mb-2 font-bold text-navy">الملاحظات</h3>
            {isLoading ? (
              <Skeleton className="h-16" />
            ) : notes.length === 0 ? (
              <EmptyState title="لا توجد ملاحظات على هذه العملية" />
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-xl bg-navy-50/60 p-3">
                    <p className="text-navy">{n.note}</p>
                    <p className="mt-1 text-xs text-purple">
                      {n.created_by_name ?? '—'} · {dateTimeAr(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canNote && (
              <div className="mt-3 flex items-end gap-2">
                <Input
                  className="flex-1"
                  label="ملاحظة جديدة"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  disabled={note.trim().length < 2}
                  loading={add.isPending}
                  onClick={() => add.mutate({ sale, note }, { onSuccess: () => setNote('') })}
                >
                  إضافة
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
