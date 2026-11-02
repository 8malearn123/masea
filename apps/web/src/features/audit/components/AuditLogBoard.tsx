import { useMemo, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, FileText, History } from 'lucide-react';
import { Badge, Button, Drawer, Input, Pagination, Select, Table, paginate } from '@/shared/ui';
import type { BadgeTone, Column } from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import { exportExcel, exportPdf, type ExportTable } from '@/shared/lib/exportTable';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuditLog } from '@/features/audit/hooks/useAuditLog';
import { auditValueLabel } from '@/features/audit/lib/values';
import { EMPTY_AUDIT_FILTERS, type AuditFilters } from '@/features/audit/api/audit.api';
import {
  AUDIT_ACTION_LABEL,
  AUDIT_ENTITY_LABEL,
  auditActionLabel,
  auditChanges,
  auditEntityLabel,
  auditFieldLabel,
  type AuditEntry,
} from '@/shared/lib/auditTrail';

const PAGE_SIZE = 20;

const actionTone = (a: string): BadgeTone =>
  a === 'insert' ? 'success' : a === 'delete' ? 'danger' : a === 'update' ? 'gold' : 'navy';

/** ملخّص سطر واحد للتغيير (أول حقلين) — التفاصيل الكاملة في اللوحة الجانبية. */
function changeSummary(e: AuditEntry): string {
  const changes = auditChanges(e);
  if (e.action === 'insert' || e.action === 'delete') return `${changes.length} حقل`;
  const shown = changes
    .slice(0, 2)
    .map(
      (c) =>
        `${auditFieldLabel(c.field)}: ${auditValueLabel(e.entity, c.field, c.before)} ← ${auditValueLabel(e.entity, c.field, c.after)}`,
    );
  return changes.length > 2 ? `${shown.join(' · ')} …` : shown.join(' · ');
}

export default function AuditLogBoard() {
  const { can, meta, branchLabel } = usePermissions();
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const { data: rows = [], isLoading, isError, refetch } = useAuditLog(filters);

  const set = (patch: Partial<AuditFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const entityOpts = useMemo(
    () => [
      { value: 'all', label: 'كل الكيانات' },
      ...Object.entries(AUDIT_ENTITY_LABEL).map(([value, label]) => ({ value, label })),
    ],
    [],
  );
  const actionOpts = useMemo(
    () => [
      { value: 'all', label: 'كل العمليات' },
      ...Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label })),
    ],
    [],
  );

  const columns: Column<AuditEntry>[] = [
    {
      key: 'created_at',
      header: 'الوقت',
      cell: (r) => (
        <span className="num whitespace-nowrap text-xs">{dateTimeAr(r.created_at)}</span>
      ),
      sortValue: (r) => r.created_at,
    },
    {
      key: 'actor',
      header: 'المستخدم',
      cell: (r) => r.actor_name ?? <span className="text-purple">النظام</span>,
      sortValue: (r) => r.actor_name ?? '',
    },
    {
      key: 'action',
      header: 'العملية',
      cell: (r) => <Badge tone={actionTone(r.action)}>{auditActionLabel(r.action)}</Badge>,
    },
    {
      key: 'entity',
      header: 'الكيان',
      cell: (r) => (
        <div>
          <div className="text-sm font-medium text-navy">{auditEntityLabel(r.entity)}</div>
          {r.record_ref && <div className="num text-xs text-purple">{r.record_ref}</div>}
        </div>
      ),
      sortValue: (r) => auditEntityLabel(r.entity),
    },
    {
      key: 'changes',
      header: 'التغيير',
      className: 'max-w-xs',
      cell: (r) => <span className="line-clamp-2 text-xs text-navy/80">{changeSummary(r)}</span>,
    },
    { key: 'branch', header: 'الفرع', cell: (r) => r.branch ?? 'الإدارة العامة' },
    {
      key: 'open',
      header: '',
      cell: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setSelected(r)} aria-label="عرض التفاصيل">
          التفاصيل
        </Button>
      ),
    },
  ];

  const exportData = (): ExportTable => ({
    title: 'سجل التدقيق',
    subtitle: [
      filters.from && `من ${filters.from}`,
      filters.to && `إلى ${filters.to}`,
      filters.entity !== 'all' && auditEntityLabel(filters.entity),
    ]
      .filter(Boolean)
      .join(' · '),
    headers: ['الوقت', 'المستخدم', 'العملية', 'الكيان', 'المرجع', 'التغيير', 'الفرع'],
    rows: rows.map((r) => [
      dateTimeAr(r.created_at),
      r.actor_name ?? 'النظام',
      auditActionLabel(r.action),
      auditEntityLabel(r.entity),
      r.record_ref ?? '',
      changeSummary(r),
      r.branch ?? 'الإدارة العامة',
    ]),
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <History size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">سجل التدقيق</h1>
            <p className="text-sm text-purple">
              كل إنشاء وتعديل وحذف على العقود والعروض والخصومات والصلاحيات — لا يُعدَّل ولا يُحذف.
              {!meta?.crossBranch && branchLabel && ` (فرع ${branchLabel} فقط)`}
            </p>
          </div>
        </div>
        {can('audit', 'export') && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => exportExcel(exportData())}
            >
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => exportPdf(exportData())}
            >
              <FileText size={16} /> PDF
            </Button>
          </div>
        )}
      </div>

      <div className="mb-4 grid gap-3 rounded-2xl bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-5">
        <Input
          label="بحث"
          placeholder="المستخدم أو المرجع"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
        <Select
          label="الكيان"
          options={entityOpts}
          value={filters.entity}
          onChange={(e) => set({ entity: e.target.value })}
        />
        <Select
          label="العملية"
          options={actionOpts}
          value={filters.action}
          onChange={(e) => set({ action: e.target.value })}
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
      </div>

      <Table
        columns={columns}
        rows={paginate(rows, page, PAGE_SIZE)}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد عمليات مطابقة"
      />
      <Pagination page={page} size={PAGE_SIZE} total={rows.length} onChange={setPage} />

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected
            ? `${auditActionLabel(selected.action)} — ${auditEntityLabel(selected.entity)}`
            : ''
        }
        subtitle={
          selected && (
            <span className="num text-xs">
              {selected.record_ref ?? ''} · {dateTimeAr(selected.created_at)}
            </span>
          )
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-purple">المستخدم</dt>
                <dd className="font-medium text-navy">{selected.actor_name ?? 'النظام'}</dd>
              </div>
              <div>
                <dt className="text-xs text-purple">الفرع</dt>
                <dd className="font-medium text-navy">{selected.branch ?? 'الإدارة العامة'}</dd>
              </div>
            </dl>
            <div className="overflow-hidden rounded-xl border border-navy-100">
              <table className="w-full text-xs">
                <thead className="bg-navy-50 text-navy">
                  <tr>
                    <th className="p-2 text-start">الحقل</th>
                    {selected.action !== 'insert' && <th className="p-2 text-start">قبل</th>}
                    {selected.action !== 'delete' && <th className="p-2 text-start">بعد</th>}
                  </tr>
                </thead>
                <tbody>
                  {auditChanges(selected).map((c) => (
                    <tr key={c.field} className="border-t border-navy-50 align-top">
                      <td className="p-2 font-medium text-navy">{auditFieldLabel(c.field)}</td>
                      {selected.action !== 'insert' && (
                        <td className="num break-all p-2 text-red-700">
                          {auditValueLabel(selected.entity, c.field, c.before)}
                        </td>
                      )}
                      {selected.action !== 'delete' && (
                        <td className="num break-all p-2 text-green-700">
                          {selected.action === 'update' && (
                            <ArrowLeft size={12} className="me-1 inline text-purple" />
                          )}
                          {auditValueLabel(selected.entity, c.field, c.after)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
