import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, CreditCard, FileText, ReceiptText, Search, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Card, Input, Table, type Column } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useInvoices } from '@/features/payments/hooks/usePayments';
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  METHOD_LABEL,
  PAYMENT_METHODS,
  type Invoice,
  type InvoiceStatus,
} from '@/features/payments/types';

const METHOD_ICON: Record<string, LucideIcon> = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.key, m.icon]));

const STATUS_PILLS: { value: InvoiceStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  ...(Object.entries(INVOICE_STATUS_LABEL).map(([v, l]) => ({ value: v as InvoiceStatus, label: l }))),
];

function Kpi({ icon: Icon, label, value, tone, bg }: { icon: LucideIcon; label: string; value: string; tone: string; bg: string }) {
  return (
    <Card className="flex items-center gap-3 py-4">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${bg}`}><Icon size={20} /></span>
      <div className="min-w-0">
        <p className={`num truncate text-xl font-bold leading-none ${tone}`}>{value}</p>
        <p className="mt-1 text-xs text-purple">{label}</p>
      </div>
    </Card>
  );
}

export default function PaymentsBoard() {
  const { can } = usePermissions();
  const editable = can('payments', 'edit');
  const { data: invoices = [], isLoading, isError, refetch } = useInvoices();
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const collected = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const outstanding = invoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.total, 0);

  const rows = useMemo(
    () =>
      invoices.filter(
        (i) =>
          (status === 'all' || i.status === status) &&
          (!search.trim() || `${i.contract_no} ${i.customer_name}`.includes(search.trim())),
      ),
    [invoices, status, search],
  );

  const columns: Column<Invoice>[] = [
    { key: 'contract_no', header: 'العقد', cell: (i) => <span className="num font-semibold text-navy">{i.contract_no}</span> },
    { key: 'customer_name', header: 'العميل', cell: (i) => <span className="text-navy-900">{i.customer_name}</span> },
    { key: 'total', header: 'الإجمالي', cell: (i) => <span className="num font-semibold">{sar(i.total)} ر.س</span> },
    {
      key: 'method',
      header: 'الوسيلة',
      cell: (i) => {
        if (!i.method) return <span className="text-purple/50">—</span>;
        const Icon = METHOD_ICON[i.method] ?? CreditCard;
        return <span className="inline-flex items-center gap-1.5 text-sm"><Icon size={14} className="text-navy" /> {METHOD_LABEL[i.method] ?? i.method}</span>;
      },
    },
    { key: 'status', header: 'الحالة', cell: (i) => <Badge tone={INVOICE_STATUS_TONE[i.status]}>{INVOICE_STATUS_LABEL[i.status]}</Badge> },
    { key: 'created_at', header: 'التاريخ', cell: (i) => <span className="num text-xs">{dateAr(i.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      cell: (i) =>
        editable && i.status !== 'paid' ? (
          <Link to={`/payments/pay/${i.id}`} className="inline-flex items-center gap-1 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-gold-600">
            <CreditCard size={13} /> دفع
          </Link>
        ) : i.reference_no ? (
          <span className="num text-[11px] text-green-600">{i.reference_no}</span>
        ) : (
          <span className="text-xs text-purple/40">—</span>
        ),
    },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy"><Wallet size={20} /></span>
        <div>
          <h1 className="text-xl font-bold text-navy">المدفوعات</h1>
          <p className="text-sm text-purple">الفواتير والتحصيل المالي.</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi icon={Wallet} label="المبلغ المحصّل" value={`${sar(collected)} ر.س`} tone="text-green-600" bg="bg-green-100 text-green-600" />
        <Kpi icon={Clock} label="المبلغ المستحق" value={`${sar(outstanding)} ر.س`} tone="text-gold-600" bg="bg-gold-100 text-gold-600" />
        <Kpi icon={ReceiptText} label="عدد الفواتير" value={String(invoices.length)} tone="text-navy" bg="bg-navy-50 text-navy" />
      </div>

      <Card className="mb-4">
        <div className="relative mb-3">
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple"><Search size={16} /></span>
          <Input placeholder="بحث برقم العقد أو العميل" value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_PILLS.map((p) => (
            <button key={p.value} type="button" onClick={() => setStatus(p.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${status === p.value ? 'bg-navy text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(i) => i.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد فواتير مطابقة"
      />

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-purple">
        <FileText size={12} /> اضغط «دفع» على فاتورة غير مدفوعة لإتمام الدفع وإصدار الإيصال.
      </p>
    </div>
  );
}
