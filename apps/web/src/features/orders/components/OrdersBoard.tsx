import { useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader,
  MapPin,
  Plane,
  Repeat2,
  Search,
  Sparkles,
  Star,
  Truck,
  UserPlus,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import {
  useAssignDriver,
  useDrivers,
  useOrders,
  useSetOrderStatus,
} from '@/features/orders/hooks/useOrders';
import { DriverTrips } from '@/features/orders/components/DriverTrips';
import {
  DRIVER_STATUS_LABEL,
  DRIVER_STATUS_TONE,
  nextOrderStatuses,
  orderTransitionError,
  ORDER_SERVICE_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
} from '@/features/orders/lib/orderStatus';
import type { Driver, Order, OrderFilters, OrderStatus } from '@/features/orders/types';

const SERVICE_ICON: Record<string, LucideIcon> = {
  recruitment: Plane,
  monthly_rental: CalendarDays,
  daily_rental: Sparkles,
  sponsorship_transfer: Repeat2,
};

const STATUS_PILLS: { value: OrderFilters['status']; label: string }[] = [
  { value: 'all', label: 'الكل' },
  ...Object.entries(ORDER_STATUS_LABEL).map(([v, l]) => ({ value: v as OrderStatus, label: l })),
];

const BRANCH_OPTIONS = [
  { value: 'all', label: 'كل الفروع' },
  ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
];

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
  bg,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: string;
  bg: string;
}) {
  return (
    <Card className="flex items-center gap-3 py-4">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${bg}`}>
        <Icon size={20} />
      </span>
      <div>
        <p className="num text-2xl font-bold leading-none text-navy">{value}</p>
        <p className="mt-1 text-xs text-purple">{label}</p>
      </div>
      <span className={`ms-auto h-10 w-1 rounded-full ${tone}`} />
    </Card>
  );
}

function DriverInitial({ name, size = 'h-9 w-9' }: { name: string; size?: string }) {
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-full bg-navy text-sm font-bold text-white`}
    >
      {name.charAt(0)}
    </span>
  );
}

/** The driver gets a personal "my trips" portal, not the dispatch board. */
export default function OrdersBoard() {
  const { role } = usePermissions();
  return role === 'driver' ? <DriverTrips /> : <DispatchBoard />;
}

function DispatchBoard() {
  const { can } = usePermissions();
  const editable = can('orders', 'edit');
  const [filters, setFilters] = useState<OrderFilters>({
    status: 'all',
    branch: 'all',
    search: '',
  });
  const [assignOrder, setAssignOrder] = useState<Order | null>(null);

  const { data: orders = [], isLoading, isError, refetch } = useOrders(filters);
  const { data: drivers = [] } = useDrivers();
  const setStatus = useSetOrderStatus();

  const stats = useMemo(
    () => ({
      total: orders.length,
      pending: orders.filter((o) => o.status === 'new' || o.status === 'paid').length,
      active: orders.filter((o) => o.status === 'assigned' || o.status === 'in_progress').length,
      done: orders.filter((o) => o.status === 'completed').length,
    }),
    [orders],
  );

  const driverLoad = useMemo(() => {
    const map = new Map<string, number>();
    orders.forEach((o) => {
      if (o.driver_id && (o.status === 'assigned' || o.status === 'in_progress')) {
        map.set(o.driver_id, (map.get(o.driver_id) ?? 0) + 1);
      }
    });
    return map;
  }, [orders]);

  function patch(p: Partial<OrderFilters>) {
    setFilters((f) => ({ ...f, ...p }));
  }

  const columns: Column<Order>[] = [
    {
      key: 'request_no',
      header: 'رقم الطلب',
      cell: (o) => <span className="num font-semibold text-navy">{o.request_no}</span>,
    },
    {
      key: 'customer_name',
      header: 'العميل',
      cell: (o) => <span className="text-navy-900">{o.customer_name ?? '—'}</span>,
    },
    {
      key: 'service_code',
      header: 'الخدمة',
      cell: (o) => {
        const Icon = SERVICE_ICON[o.service_code] ?? Plane;
        return (
          <span className="inline-flex items-center gap-1.5 text-navy-900">
            <Icon size={14} className="text-purple" /> {ORDER_SERVICE_LABEL[o.service_code]}
          </span>
        );
      },
    },
    {
      key: 'branch',
      header: 'الفرع',
      cell: (o) => (
        <span className="inline-flex items-center gap-1 text-sm">
          <MapPin size={12} className="text-gold-600" /> {o.branch ?? '—'}
        </span>
      ),
    },
    {
      key: 'driver_name',
      header: 'السائق',
      cell: (o) =>
        o.driver_name ? (
          <span className="inline-flex items-center gap-2">
            <DriverInitial name={o.driver_name} size="h-7 w-7" />
            <span className="text-sm text-navy-900">{o.driver_name}</span>
          </span>
        ) : (
          <span className="text-sm text-purple/50">غير مُسند</span>
        ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (o) => <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (o) =>
        editable ? (
          <div className="flex items-center justify-end gap-2">
            {!o.driver_id && o.status !== 'cancelled' && o.status !== 'completed' && (
              <button
                type="button"
                onClick={() => setAssignOrder(o)}
                className="inline-flex items-center gap-1 rounded-lg bg-gold px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-gold-600"
              >
                <UserPlus size={13} /> إسناد
              </button>
            )}
            <StatusSelect
              order={o}
              onChange={(status) => setStatus.mutate({ orderId: o.id, status })}
            />
          </div>
        ) : (
          <span className="text-xs text-purple/40">—</span>
        ),
    },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Truck size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">الطلبات والسائقون</h1>
          <p className="text-sm text-purple">لوحة متابعة الطلبات وإسناد السائقين لحظيًا.</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={ClipboardList}
          label="إجمالي الطلبات"
          value={stats.total}
          tone="bg-navy"
          bg="bg-navy-50 text-navy"
        />
        <Kpi
          icon={Clock}
          label="بانتظار الإسناد"
          value={stats.pending}
          tone="bg-gold"
          bg="bg-gold-100 text-gold-600"
        />
        <Kpi
          icon={Loader}
          label="قيد التنفيذ"
          value={stats.active}
          tone="bg-teal"
          bg="bg-teal-100 text-teal"
        />
        <Kpi
          icon={CheckCircle2}
          label="مكتملة"
          value={stats.done}
          tone="bg-green-500"
          bg="bg-green-100 text-green-600"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* orders */}
        <div className="lg:col-span-2">
          <Card className="mb-4">
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
                  <Search size={16} />
                </span>
                <Input
                  placeholder="بحث برقم الطلب أو العميل"
                  value={filters.search}
                  onChange={(e) => patch({ search: e.target.value })}
                  className="pr-9"
                />
              </div>
              <Select
                value={filters.branch}
                onChange={(e) => patch({ branch: e.target.value })}
                options={BRANCH_OPTIONS}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_PILLS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => patch({ status: p.value })}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    filters.status === p.value
                      ? 'bg-navy text-white'
                      : 'bg-navy-50 text-navy hover:bg-navy-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Card>

          <Table
            columns={columns}
            rows={orders}
            rowKey={(o) => o.id}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            emptyTitle="لا توجد طلبات مطابقة"
          />
        </div>

        {/* drivers panel */}
        <div>
          <Card>
            <h2 className="mb-4 flex items-center justify-between text-sm font-bold text-navy">
              <span className="flex items-center gap-2">
                <UserRound size={16} /> السائقون
              </span>
              <span className="num rounded-full bg-navy-50 px-2 py-0.5 text-xs text-navy">
                {drivers.length}
              </span>
            </h2>
            <ul className="space-y-2.5">
              {drivers.map((d) => {
                const load = driverLoad.get(d.id) ?? 0;
                return (
                  <li
                    key={d.id}
                    className="flex items-center gap-3 rounded-xl border border-navy-100 p-3 transition hover:border-navy/40"
                  >
                    <DriverInitial name={d.full_name} size="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-navy">{d.full_name}</p>
                      <p className="num text-[11px] text-purple">
                        {d.vehicle_no ?? '—'} · {d.branch ?? '—'}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Badge tone={DRIVER_STATUS_TONE[d.status]}>
                          {DRIVER_STATUS_LABEL[d.status]}
                        </Badge>
                        <span className="num inline-flex items-center gap-0.5 text-[11px] text-gold-600">
                          <Star size={11} className="fill-current" /> {d.rating.toFixed(1)}
                        </span>
                        {load > 0 && (
                          <span className="num text-[11px] text-teal">{load} طلب نشط</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <AssignDriverModal
        order={assignOrder}
        drivers={drivers}
        onClose={() => setAssignOrder(null)}
      />
    </div>
  );
}

function StatusSelect({ order, onChange }: { order: Order; onChange: (s: OrderStatus) => void }) {
  // نفس القواعد المركزية التي تطبّقها الخدمة (مثلًا: لا «مكتمل» قبل انتهاء الرحلة)
  const next = nextOrderStatuses(order.status).filter((s) => !orderTransitionError(order, s));
  if (next.length === 0) return <span className="text-xs text-purple/40">—</span>;
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value as OrderStatus);
      }}
      className="rounded-lg border border-navy-100 bg-white px-2.5 py-1.5 text-xs text-navy outline-none transition focus:border-navy"
    >
      <option value="">تغيير الحالة…</option>
      {next.map((s) => (
        <option key={s} value={s}>
          {ORDER_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function AssignDriverModal({
  order,
  drivers,
  onClose,
}: {
  order: Order | null;
  drivers: Driver[];
  onClose: () => void;
}) {
  const assign = useAssignDriver();
  const available = drivers.filter((d) => d.status === 'available');

  return (
    <Modal open={order !== null} onClose={onClose} title="إسناد سائق">
      {order && (
        <div>
          <p className="mb-4 text-sm text-purple">
            الطلب <span className="num font-semibold text-navy">{order.request_no}</span> — اختر
            سائقًا متاحًا.
          </p>
          {available.length === 0 ? (
            <p className="rounded-xl bg-navy-50 p-4 text-center text-sm text-purple">
              لا يوجد سائقون متاحون حاليًا.
            </p>
          ) : (
            <div className="space-y-2">
              {available.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={assign.isPending}
                  onClick={() =>
                    assign.mutate({ orderId: order.id, driverId: d.id }, { onSuccess: onClose })
                  }
                  className="flex w-full items-center gap-3 rounded-xl border border-navy-100 p-3 text-right transition hover:border-navy hover:bg-navy-50 disabled:opacity-60"
                >
                  <DriverInitial name={d.full_name} size="h-9 w-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-navy">{d.full_name}</span>
                    <span className="num block text-[11px] text-purple">
                      {d.vehicle_no ?? '—'} · {d.branch ?? '—'}
                    </span>
                  </span>
                  <span className="num inline-flex items-center gap-0.5 text-[11px] text-gold-600">
                    <Star size={11} className="fill-current" /> {d.rating.toFixed(1)}
                  </span>
                  <span className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white">
                    إسناد
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
