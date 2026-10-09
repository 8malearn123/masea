import { useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  Plane,
  Repeat2,
  ScanLine,
  Sparkles,
  Truck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Skeleton } from '@/shared/ui';
import { dateTimeAr, sar } from '@/shared/lib/format';
import { useOrders } from '@/features/orders/hooks/useOrders';
import {
  ORDER_SERVICE_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
} from '@/features/orders/lib/orderStatus';
import { TRIP_LEGS, TRIP_STEPS, nextStep, stageIndex } from '@/features/orders/lib/trip';
import { TripScanModal } from '@/features/orders/components/TripScanModal';
import type { Order, OrderStatus } from '@/features/orders/types';

const SERVICE_ICON: Record<string, LucideIcon> = {
  recruitment: Plane,
  monthly_rental: CalendarDays,
  daily_rental: Sparkles,
  sponsorship_transfer: Repeat2,
};

const ALL = { status: 'all', branch: 'all', search: '' } as const;

function Kpi({
  icon: Icon,
  label,
  value,
  bg,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
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
    </Card>
  );
}

/** A driver's personal trips portal — only the orders assigned to him. */
export function DriverTrips() {
  const { data: orders = [], isLoading } = useOrders(ALL);
  const [scanOrder, setScanOrder] = useState<Order | null>(null);

  const stats = useMemo(
    () => ({
      active: orders.filter((o) => o.status === 'assigned' || o.status === 'in_progress').length,
      done: orders.filter((o) => o.status === 'completed').length,
      total: orders.length,
    }),
    [orders],
  );

  const sorted = useMemo(() => {
    const rank = (s: OrderStatus) =>
      s === 'in_progress' ? 0 : s === 'assigned' || s === 'paid' ? 1 : 2;
    return [...orders].sort((a, b) => rank(a.status) - rank(b.status));
  }, [orders]);

  // keep the open modal's order in sync with the freshly-advanced data
  const liveScanOrder = scanOrder ? (orders.find((o) => o.id === scanOrder.id) ?? scanOrder) : null;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Truck size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">رحلاتي</h1>
          <p className="text-sm text-purple">
            الطلبات المُسندة إليك — امسح باركود العاملة لتحديث كل مرحلة.
          </p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Kpi icon={Loader} label="رحلات نشطة" value={stats.active} bg="bg-gold-100 text-gold-600" />
        <Kpi
          icon={CheckCircle2}
          label="مكتملة"
          value={stats.done}
          bg="bg-green-100 text-green-600"
        />
        <Kpi icon={Truck} label="إجمالي رحلاتي" value={stats.total} bg="bg-navy-50 text-navy" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-24 w-full" />
            </Card>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="لا توجد رحلات مُسندة"
          description="ستظهر هنا الطلبات عندما يُسندها لك مدير الفرع أو العمليات."
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((o) => (
            <TripCard key={o.id} order={o} onScan={() => setScanOrder(o)} />
          ))}
        </div>
      )}

      <TripScanModal order={liveScanOrder} onClose={() => setScanOrder(null)} />
    </div>
  );
}

function TripCard({ order, onScan }: { order: Order; onScan: () => void }) {
  const Icon = SERVICE_ICON[order.service_code] ?? Plane;
  const idx = stageIndex(order.trip_stage);
  const next = nextStep(order.trip_stage);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="num text-sm font-bold text-navy">{order.request_no}</span>
            <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-navy-900">{order.customer_name ?? '—'}</p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-purple">
            {ORDER_SERVICE_LABEL[order.service_code]}
            <span className="inline-flex items-center gap-1">
              <MapPin size={11} className="text-gold-600" /> {order.branch ?? '—'}
            </span>
            <span className="num">{sar(order.total_amount)} ر.س</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {next ? (
            <Button variant="primary" size="sm" onClick={onScan}>
              <ScanLine size={15} /> {next.action}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-lg bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-600">
              <CheckCircle2 size={14} /> اكتملت الرحلة
            </span>
          )}
          {order.customer_address && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.customer_address)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-semibold text-navy transition hover:bg-navy-50"
            >
              <Navigation size={14} className="text-gold-600" /> الاتجاهات للعميل
            </a>
          )}
        </div>
      </div>

      {/* trip details: where the customer is + appointment times */}
      {(order.dropoff_at || order.pickup_at || order.customer_address || order.customer_phone) && (
        <div className="mt-3 grid gap-2.5 rounded-xl bg-navy-50/60 p-3 text-[12px] sm:grid-cols-2">
          {order.dropoff_at && (
            <div className="flex items-center gap-2">
              <LogOut size={14} className="shrink-0 text-teal" />
              <span className="text-purple">متى تكون عند العميل:</span>
              <span className="num font-semibold text-navy-900">
                {dateTimeAr(order.dropoff_at)}
              </span>
            </div>
          )}
          {order.pickup_at && (
            <div className="flex items-center gap-2">
              <LogIn size={14} className="shrink-0 text-gold-600" />
              <span className="text-purple">متى تأخذها من العميل:</span>
              <span className="num font-semibold text-navy-900">{dateTimeAr(order.pickup_at)}</span>
            </div>
          )}
          {order.customer_phone && (
            <a
              href={`tel:${order.customer_phone}`}
              className="flex items-center gap-2 text-navy hover:underline"
            >
              <Phone size={14} className="shrink-0 text-navy" />
              <span className="text-purple">الهاتف:</span>
              <span className="num font-semibold">{order.customer_phone}</span>
            </a>
          )}
          {order.customer_address && (
            <a
              href={`https://www.google.com/maps/search/${encodeURIComponent(order.customer_address)}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-navy hover:underline"
            >
              <MapPin size={14} className="shrink-0 text-gold-600" />
              <span className="flex-1 text-navy-900">{order.customer_address}</span>
              <ExternalLink size={12} className="shrink-0 text-purple" />
            </a>
          )}
          {!order.dropoff_at && !order.pickup_at && (
            <div className="flex items-center gap-2 text-purple sm:col-span-2">
              <Clock size={14} /> لا توجد مواعيد محددة لهذه الرحلة.
            </div>
          )}
        </div>
      )}

      {/* two-leg progress, advanced by scanning */}
      <div className="mt-3 grid gap-3 rounded-xl border border-navy-100 p-3 sm:grid-cols-2">
        {TRIP_LEGS.map((leg) => (
          <div key={leg.leg}>
            <p className="mb-2 text-[11px] font-bold text-navy">{leg.label}</p>
            <ol className="space-y-1.5">
              {TRIP_STEPS.map((step, i) => {
                if (step.leg !== leg.leg) return null;
                const done = i <= idx;
                const current = i === idx + 1;
                return (
                  <li key={step.stage} className="flex items-center gap-2 text-[13px]">
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                        done
                          ? 'bg-teal text-white'
                          : current
                            ? 'bg-navy text-white ring-2 ring-navy/20'
                            : 'bg-navy-50 text-purple'
                      }`}
                    >
                      {done ? <Check size={12} /> : <span className="num">{i + 1}</span>}
                    </span>
                    <span
                      className={
                        done ? 'text-navy-900' : current ? 'font-semibold text-navy' : 'text-purple'
                      }
                    >
                      {step.short}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </Card>
  );
}
