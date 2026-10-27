import { useState, type ReactNode } from 'react';
import { FileSpreadsheet, FileText, Filter, RefreshCw, type LucideIcon } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Input, Modal, Select, Skeleton } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { BRANCHES_AR } from '@/lib/funnel';
import { exportExcel, exportPdf, type ExportTable } from '@/shared/lib/exportTable';
import type { CostCenter } from '@/features/accounting/data/budgets';

/**
 * Shared building blocks for the accounting screens — composed from shared/ui
 * (no parallel component library). Chart colours: the validated brand trio
 * navy / gold-600 / teal (dataviz validator: all checks pass on white).
 */
export const CHART_COLORS = {
  primary: '#1f58a8',
  secondary: '#9a6212',
  tertiary: '#2e9e5b',
} as const;
export const GRID = '#e3e9f2';
export const AXIS = '#65738c';

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export interface RangeFilter {
  from: string;
  to: string;
  branch: string; // 'all' | 'head' | branch
  costCenter: string; // 'all' | code
}

export function defaultRange(): RangeFilter {
  const t = todayIso();
  return { from: `${t.slice(0, 4)}-01-01`, to: t, branch: 'all', costCenter: 'all' };
}

const QUICK: { key: string; label: string; make: (t: string) => { from: string; to: string } }[] = [
  { key: 'month', label: 'هذا الشهر', make: (t) => ({ from: `${t.slice(0, 7)}-01`, to: t }) },
  {
    key: 'quarter',
    label: 'هذا الربع',
    make: (t) => {
      const m = Number(t.slice(5, 7));
      const qs = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${t.slice(0, 4)}-${String(qs).padStart(2, '0')}-01`, to: t };
    },
  },
  {
    key: 'ytd',
    label: 'منذ بداية السنة',
    make: (t) => ({ from: `${t.slice(0, 4)}-01-01`, to: t }),
  },
  {
    key: 'last',
    label: 'السنة الماضية',
    make: (t) => {
      const y = Number(t.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

export const branchOptions = (withAll = true, allLabel = 'كل الفروع') => [
  ...(withAll ? [{ value: 'all', label: allLabel }] : []),
  { value: 'head', label: 'المركز الرئيسي' },
  ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
];

/** One row of filters above the content: quick ranges + dates + branch + cost center. */
export function FilterBar({
  value,
  onChange,
  costCenters,
  showBranch = true,
  showRange = true,
  extra,
}: {
  value: RangeFilter;
  onChange: (v: RangeFilter) => void;
  costCenters?: CostCenter[];
  showBranch?: boolean;
  showRange?: boolean;
  extra?: ReactNode;
}) {
  const t = todayIso();
  return (
    <Card className="flex flex-wrap items-end gap-2 py-3">
      <Filter size={16} className="mb-2.5 text-purple" aria-hidden />
      {showRange && (
        <>
          <div className="flex flex-wrap gap-1">
            {QUICK.map((q) => {
              const r = q.make(t);
              const on = r.from === value.from && r.to === value.to;
              return (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => onChange({ ...value, ...r })}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    on ? 'bg-navy text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'
                  }`}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
          <div className="w-36">
            <Input
              label="من"
              type="date"
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            />
          </div>
          <div className="w-36">
            <Input
              label="إلى"
              type="date"
              value={value.to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
            />
          </div>
        </>
      )}
      {showBranch && (
        <div className="w-40">
          <Select
            label="الفرع"
            value={value.branch}
            onChange={(e) => onChange({ ...value, branch: e.target.value })}
            options={branchOptions()}
          />
        </div>
      )}
      {costCenters && (
        <div className="w-48">
          <Select
            label="مركز التكلفة"
            value={value.costCenter}
            onChange={(e) => onChange({ ...value, costCenter: e.target.value })}
            options={[
              { value: 'all', label: 'كل المراكز' },
              ...costCenters
                .filter((c) => c.kind !== 'branch' && c.is_active)
                .map((c) => ({ value: c.code, label: c.name })),
            ]}
          />
        </div>
      )}
      {extra}
    </Card>
  );
}

/** Ledger filter (passes 'all' as undefined). */
export function toLedger(f: RangeFilter) {
  return {
    from: f.from,
    to: f.to,
    branch: f.branch === 'all' ? undefined : f.branch,
    costCenter: f.costCenter === 'all' ? undefined : f.costCenter,
  };
}

export function rangeLabel(f: RangeFilter): string {
  const b = f.branch === 'all' ? 'كل الفروع' : f.branch === 'head' ? 'المركز الرئيسي' : f.branch;
  return `الفترة ${f.from} → ${f.to} · ${b}${f.costCenter !== 'all' ? ` · ${f.costCenter}` : ''}`;
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'text-navy',
  hint,
  onClick,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  tone?: string;
  hint?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-purple">{label}</p>
        {Icon && <Icon size={16} className="text-navy-200" aria-hidden />}
      </div>
      <p className={`num mt-1 text-xl font-bold sm:text-2xl ${tone}`}>{value}</p>
      {hint && <div className="mt-1 text-[11px] text-purple">{hint}</div>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl bg-white p-4 text-right shadow-card transition hover:ring-2 hover:ring-navy-100"
    >
      {body}
    </button>
  ) : (
    <Card className="py-4">{body}</Card>
  );
}

/** Signed % with arrow word (never colour alone). */
export function Delta({
  value,
  goodWhenUp = true,
}: {
  value: number | null;
  goodWhenUp?: boolean;
}) {
  if (value === null) return <span className="text-purple">لا مقارنة (أساس صفري)</span>;
  const up = value > 0;
  const good = value === 0 ? null : up === goodWhenUp;
  return (
    <span className={good === null ? 'text-purple' : good ? 'text-green-700' : 'text-red-600'}>
      {up ? 'ارتفاع' : value < 0 ? 'انخفاض' : 'ثابت'}{' '}
      <span className="num">{Math.abs(value)}٪</span> عن الفترة السابقة
    </span>
  );
}

export const Money = ({ v, className = '' }: { v: number; className?: string }) => (
  <span className={`num ${v < 0 ? 'text-red-600' : ''} ${className}`}>{sar(v)}</span>
);

export function SectionCard({
  title,
  icon: Icon,
  actions,
  children,
  className = '',
}: {
  title: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          {Icon && <Icon size={16} aria-hidden />} {title}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function ExportButtons({
  build,
  disabled,
}: {
  build: () => ExportTable;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => exportExcel(build())}>
        <FileSpreadsheet size={14} /> Excel
      </Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => exportPdf(build())}>
        <FileText size={14} /> PDF
      </Button>
    </div>
  );
}

/** Loading / error / empty / content — the four states in one place. */
export function DataState({
  isLoading,
  isError,
  onRetry,
  empty,
  emptyTitle = 'لا توجد بيانات',
  emptyHint,
  children,
}: {
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  children: ReactNode;
}) {
  if (isLoading)
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (isError) return <ErrorState onRetry={onRetry} />;
  if (empty)
    return <EmptyState title={emptyTitle} {...(emptyHint ? { description: emptyHint } : {})} />;
  return <>{children}</>;
}

export function LastUpdated({ at, onRefresh }: { at: number; onRefresh?: () => void }) {
  const d = at ? new Date(at) : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-purple">
      آخر تحديث:{' '}
      <span className="num">
        {d
          ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '—'}
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="text-navy hover:text-navy-700"
          aria-label="تحديث"
        >
          <RefreshCw size={12} />
        </button>
      )}
    </span>
  );
}

/** Confirmation for sensitive operations (post, reverse, close, reopen…). */
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  requireReason,
  onConfirm,
  onClose,
  busy,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireReason?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-3 text-sm">
        <div className="leading-relaxed text-purple">{message}</div>
        {requireReason && (
          <Input
            label="السبب (يُسجّل في سجل التدقيق)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <div className="flex gap-2">
          <Button
            variant={danger ? 'danger' : 'primary'}
            className="flex-1"
            disabled={busy || (requireReason && reason.trim().length < 5)}
            onClick={() => onConfirm(reason)}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; icon?: LucideIcon }[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
            active === t.key ? 'bg-navy text-white' : 'text-purple hover:bg-navy-50'
          }`}
        >
          {t.icon && <t.icon size={15} />} {t.label}
        </button>
      ))}
    </div>
  );
}

/** Search box used above tables. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'بحث…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:border-navy focus:outline-none sm:w-64"
    />
  );
}

/** Recharts tooltip formatter for SAR values. */
export const sarTip = (v: unknown) => `${sar(Number(v))} ر.س`;
