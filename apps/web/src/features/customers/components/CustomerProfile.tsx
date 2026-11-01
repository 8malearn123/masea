import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, MessageCircle, Pencil, Phone, Power } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
  StatTile,
  Table,
} from '@/shared/ui';
import type { Column } from '@/shared/ui';
import { dateAr, dateTimeAr, sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusBadge } from '@/features/contracts/components/StatusBadge';
import { SERVICE_LABEL } from '@/features/contracts/types';
import type { ContractListItem } from '@/features/contracts/types';
import { toWaNumber } from '@/features/pricing/lib/quoteHtml';
import {
  useAddInteraction,
  useCrmThresholds,
  useCustomer,
  useCustomerContracts,
  useCustomerInsights,
  useInteractions,
  useSetCustomerActive,
} from '@/features/customers/hooks/useCrmCustomers';
import { customerSegments } from '@/features/customers/lib/classify';
import { CustomerFormModal } from '@/features/customers/components/CustomerFormModal';
import { ACTIVITY_LABEL } from '@/features/crm/types';
import {
  SEGMENT_LABEL,
  SEGMENT_TONE,
  type CustomerRecord,
  type InteractionKind,
} from '@/features/customers/types';

const KIND_OPTS = (Object.entries(ACTIVITY_LABEL) as [InteractionKind, string][]).map(
  ([value, label]) => ({
    value,
    label,
  }),
);
const RUNNING = new Set(['signed', 'active', 'musaned_signed']);

/** ملف العميل 360°: بياناته، عقوده، مشترياته، مدفوعاته، عاملاته، وسجل التواصل. */
export default function CustomerProfile() {
  const { id } = useParams<{ id: string }>();
  const { data: customer, isLoading, isError, refetch } = useCustomer(id);
  if (isLoading)
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!customer)
    return (
      <EmptyState
        title="العميل غير موجود أو خارج نطاق فرعك"
        action={
          <Link to="/customers" className="text-sm font-medium text-navy underline">
            العودة إلى العملاء
          </Link>
        }
      />
    );
  return <Body customer={customer} />;
}

function Body({ customer }: { customer: CustomerRecord }) {
  const { can } = usePermissions();
  const t = useCrmThresholds();
  const { data: insights = [] } = useCustomerInsights();
  const { data: contracts = [], isLoading: contractsLoading } = useCustomerContracts(customer.id);
  const toggle = useSetCustomerActive();
  const [editing, setEditing] = useState(false);
  const insight = insights.find((i) => i.id === customer.id);
  const segments = useMemo(() => (insight ? [...customerSegments(insight, t)] : []), [insight, t]);
  const today = new Date().toISOString().slice(0, 10);
  const workers = contracts.filter((c) => c.worker_name);

  const columns: Column<ContractListItem>[] = [
    {
      key: 'no',
      header: 'رقم العقد',
      cell: (c) => (
        <Link to={`/contracts/${c.id}`} className="num font-medium text-navy hover:underline">
          {c.contract_no ?? '—'}
        </Link>
      ),
    },
    {
      key: 'service',
      header: 'الخدمة',
      cell: (c) => (c.service_code ? SERVICE_LABEL[c.service_code] : '—'),
    },
    { key: 'status', header: 'الحالة', cell: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'period',
      header: 'المدة',
      cell: (c) => (
        <span className="text-xs">
          {dateAr(c.start_date)}
          {c.end_date && ` ← ${dateAr(c.end_date)}`}
        </span>
      ),
    },
    { key: 'worker', header: 'العاملة', cell: (c) => c.worker_name ?? '—' },
    {
      key: 'total',
      header: 'الإجمالي',
      cell: (c) => <span className="num">{sar(c.total_amount)}</span>,
    },
    {
      key: 'paid',
      header: 'المدفوع',
      cell: (c) => <span className="num">{sar(c.amount_paid)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <Link
        to="/customers"
        className="inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
      >
        <ArrowRight size={16} /> العملاء
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-navy">{customer.full_name}</h1>
              {!customer.is_active && <Badge tone="danger">معطّل</Badge>}
              {segments
                .filter((s) => s !== 'without_worker')
                .map((s) => (
                  <Badge key={s} tone={SEGMENT_TONE[s]}>
                    {SEGMENT_LABEL[s]}
                  </Badge>
                ))}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              {(
                [
                  [
                    'الجوال',
                    <span key="p" className="num">
                      {customer.phone || '—'}
                    </span>,
                  ],
                  ['الفرع', customer.branch ?? '—'],
                  ['المدينة', customer.city ?? '—'],
                  ['تاريخ التسجيل', dateAr(customer.created_at)],
                  [
                    'رقم الهوية',
                    <span key="n" className="num">
                      {customer.national_id ?? '—'}
                    </span>,
                  ],
                  [
                    'الرقم الضريبي',
                    <span key="v" className="num">
                      {customer.vat_number ?? '—'}
                    </span>,
                  ],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-purple">{k}</dt>
                  <dd className="font-medium text-navy">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            {customer.phone && (
              <>
                <a
                  href={`tel:${customer.phone}`}
                  className="inline-flex items-center gap-1 rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy"
                >
                  <Phone size={16} /> اتصال
                </a>
                <a
                  href={`https://wa.me/${toWaNumber(customer.phone)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-xl border border-navy-100 px-3 py-2 text-sm text-green-700"
                >
                  <MessageCircle size={16} /> واتساب
                </a>
              </>
            )}
            {can('customers', 'edit') && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil size={16} /> تعديل
              </Button>
            )}
            {can('customers', 'delete') && (
              <Button
                variant={customer.is_active ? 'danger' : 'success'}
                loading={toggle.isPending}
                onClick={() => toggle.mutate({ id: customer.id, active: !customer.is_active })}
              >
                <Power size={16} /> {customer.is_active ? 'تعطيل' : 'تفعيل'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="إجمالي المدفوع"
          value={`${sar(insight?.total_paid ?? 0)} ر.س`}
          tone="success"
        />
        <StatTile label="عدد مرات الشراء" value={insight?.purchases ?? 0} />
        <StatTile
          label="آخر عملية شراء"
          value={insight?.last_purchase_at ? dateAr(insight.last_purchase_at) : '—'}
          {...(insight?.days_since_purchase != null
            ? { hint: `منذ ${insight.days_since_purchase} يومًا` }
            : {})}
        />
        <StatTile
          label="آخر تواصل"
          value={insight?.last_contact_at ? dateAr(insight.last_contact_at) : '—'}
          {...(insight?.days_since_contact != null
            ? { hint: `منذ ${insight.days_since_contact} يومًا` }
            : {})}
        />
        <StatTile label="عاملات لديه حاليًا" value={insight?.active_contracts ?? 0} />
      </div>

      <section>
        <h2 className="mb-3 text-base font-bold text-navy">العقود والمشتريات</h2>
        <Table
          columns={columns}
          rows={contracts}
          rowKey={(c) => c.id}
          isLoading={contractsLoading}
          emptyTitle="لا توجد عقود لهذا العميل بعد"
        />
      </section>

      {workers.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-bold text-navy">العاملات المرتبطات بالعميل</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {workers.map((c) => {
              const running = RUNNING.has(c.status) && (!c.end_date || c.end_date >= today);
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-xl bg-white p-3 shadow-card"
                >
                  <span className="font-medium text-navy">{c.worker_name}</span>
                  <Badge tone={running ? 'success' : 'neutral'}>
                    {running ? 'لديه حاليًا' : 'انتهت الخدمة'}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Interactions customerId={customer.id} />

      <CustomerFormModal open={editing} onClose={() => setEditing(false)} customer={customer} />
    </div>
  );
}

function Interactions({ customerId }: { customerId: string }) {
  const { can } = usePermissions();
  const { data: rows = [], isLoading } = useInteractions(customerId);
  const add = useAddInteraction();
  const [kind, setKind] = useState<InteractionKind>('call');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');

  return (
    <section>
      <h2 className="mb-3 text-base font-bold text-navy">سجل التواصل والملاحظات الداخلية</h2>
      {can('customers', 'edit') && (
        <Card className="mb-3 grid gap-3 p-4 sm:grid-cols-4">
          <Select
            label="النوع"
            options={KIND_OPTS}
            value={kind}
            onChange={(e) => setKind(e.target.value as InteractionKind)}
          />
          <Input label="الملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
          <Input
            label="موعد متابعة"
            type="datetime-local"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
          />
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={!note.trim() && !followUp}
              loading={add.isPending}
              onClick={() =>
                add.mutate(
                  {
                    customer_id: customerId,
                    kind,
                    note: note.trim() || null,
                    follow_up_at: followUp ? new Date(followUp).toISOString() : null,
                  },
                  {
                    onSuccess: () => {
                      setNote('');
                      setFollowUp('');
                    },
                  },
                )
              }
            >
              تسجيل
            </Button>
          </div>
        </Card>
      )}
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="لا يوجد تواصل مسجّل مع هذا العميل" />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl bg-white p-3 shadow-card">
              <div className="text-sm font-medium text-navy">
                {ACTIVITY_LABEL[r.kind]}{' '}
                {r.note && <span className="font-normal text-navy/80">— {r.note}</span>}
              </div>
              <div className="text-xs text-purple">
                {r.created_by_name ?? '—'} · {dateTimeAr(r.created_at)}
                {r.follow_up_at && ` · متابعة ${dateTimeAr(r.follow_up_at)}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
