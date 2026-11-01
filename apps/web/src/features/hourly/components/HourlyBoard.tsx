import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, List, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Drawer,
  ErrorState,
  Input,
  Pagination,
  Select,
  Skeleton,
  StatTile,
  Table,
  paginate,
} from '@/shared/ui';
import type { BadgeTone, Column } from '@/shared/ui';
import { dateAr, dateTimeAr, sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { addDays, today } from '@/features/requests/lib/period';
import { useBookings, useSetBookingStatus } from '@/features/hourly/hooks/useHourly';
import { canMoveBooking, type HourlyBooking } from '@/features/hourly/api/hourly.api';
import {
  BOOKING_STATUS_LABEL,
  hourlyTotals,
  minutesOf,
  type BookingStatus,
} from '@/features/hourly/lib/hourly';
import { BookingModal } from '@/features/hourly/components/BookingModal';

const TONE: Record<BookingStatus, BadgeTone> = {
  booked: 'navy',
  in_progress: 'gold',
  completed: 'success',
  cancelled: 'danger',
  no_show: 'neutral',
};
const BLOCK: Record<BookingStatus, string> = {
  booked: 'bg-navy text-white',
  in_progress: 'bg-gold-500 text-white',
  completed: 'bg-green-600 text-white',
  cancelled: 'bg-red-100 text-red-700 line-through',
  no_show: 'bg-gray-200 text-gray-600',
};
const DAY_START = 6 * 60;
const DAY_END = 24 * 60;
const PAGE_SIZE = 15;
const monthStart = () => `${today().slice(0, 8)}01`;

/** التأجير بالساعة: تقويم تشغيلي يومي لكل عاملة + قائمة الحجوزات + تقرير الفترة. */
export default function HourlyBoard() {
  const { can } = usePermissions();
  const { data: bookings = [], isLoading, isError, refetch } = useBookings();
  const [tab, setTab] = useState<'calendar' | 'list'>('calendar');
  const [creating, setCreating] = useState(false);
  const [day, setDay] = useState(today());
  const [selected, setSelected] = useState<HourlyBooking | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(addDays(today(), 30));

  const inRange = useMemo(
    () =>
      bookings.filter((b) => (!from || b.booking_date >= from) && (!to || b.booking_date <= to)),
    [bookings, from, to],
  );
  const totals = useMemo(() => hourlyTotals(inRange), [inRange]);
  const live = selected ? (bookings.find((b) => b.id === selected.id) ?? selected) : null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <Clock size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">التأجير بالساعة</h1>
            <p className="text-sm text-purple">
              حجوزات مستقلة عن التأجير اليومي — بوقت وصول وانصراف ومنع للتعارض.
            </p>
          </div>
        </div>
        {can('hourly', 'create') && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> حجز جديد
          </Button>
        )}
      </div>

      <div className="mb-3 grid gap-3 rounded-2xl bg-white p-4 shadow-card sm:grid-cols-2">
        <Input
          label="تقرير الفترة — من"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input label="إلى" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {isLoading ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="الحجوزات"
            value={totals.count}
            {...(totals.cancelled ? { hint: `${totals.cancelled} ملغاة/غياب` } : {})}
          />
          <StatTile label="الساعات المحجوزة" value={totals.hours} />
          <StatTile
            label="الإيراد (قبل الضريبة)"
            value={`${sar(totals.revenue)} ر.س`}
            tone="success"
          />
          <StatTile label="المكتملة" value={totals.completed} />
        </div>
      )}

      <div className="mb-4 flex gap-2 border-b border-navy-100" role="tablist">
        {(
          [
            ['calendar', 'التقويم التشغيلي', CalendarDays],
            ['list', 'الحجوزات', List],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
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
      ) : tab === 'calendar' ? (
        <DayCalendar
          day={day}
          setDay={setDay}
          bookings={bookings}
          isLoading={isLoading}
          onOpen={setSelected}
        />
      ) : (
        <BookingList rows={inRange} isLoading={isLoading} onOpen={setSelected} />
      )}

      <BookingModal
        open={creating}
        onClose={() => setCreating(false)}
        defaultDate={day >= today() ? day : today()}
      />
      <BookingDrawer booking={live} onClose={() => setSelected(null)} />
    </div>
  );
}

function DayCalendar({
  day,
  setDay,
  bookings,
  isLoading,
  onOpen,
}: {
  day: string;
  setDay: (d: string) => void;
  bookings: HourlyBooking[];
  isLoading: boolean;
  onOpen: (b: HourlyBooking) => void;
}) {
  const { data: workers = [] } = useWorkerProfiles();
  const scroller = useRef<HTMLDivElement>(null);
  // RTL page, LTR timeline: open at the start of the day (the far left)
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = -el.scrollWidth;
  }, [day, isLoading, workers.length]);
  const ofDay = bookings.filter((b) => b.booking_date === day);
  // every bookable worker + any worker who has a booking that day (e.g. no longer listed)
  const rows = [
    ...workers.map((w) => ({ id: w.id, name: w.full_name })),
    ...ofDay
      .filter((b) => !workers.some((w) => w.id === b.worker_profile_id))
      .map((b) => ({ id: b.worker_profile_id, name: b.worker_name ?? '—' })),
  ].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START / 60 + i);
  const pct = (min: number) =>
    ((Math.min(Math.max(min, DAY_START), DAY_END) - DAY_START) / (DAY_END - DAY_START)) * 100;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-label="اليوم السابق"
          onClick={() => setDay(addDays(day, -1))}
        >
          <ChevronRight size={16} />
        </Button>
        <Input
          aria-label="اليوم"
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          aria-label="اليوم التالي"
          onClick={() => setDay(addDays(day, 1))}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDay(today())}>
          اليوم
        </Button>
        <span className="text-sm text-purple">
          {dateAr(day)} · {ofDay.filter((b) => b.status !== 'cancelled').length} حجز
        </span>
      </div>
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div ref={scroller} className="overflow-x-auto rounded-2xl bg-white p-3 shadow-card">
          <div className="min-w-[56rem]">
            <div className="flex border-b border-navy-50 pb-1 text-[11px] text-purple">
              <div className="sticky right-0 z-10 w-40 shrink-0 bg-white" />
              <div className="relative h-4 flex-1" dir="ltr">
                {hours.map((h) => (
                  <span
                    key={h}
                    className="num absolute -translate-x-1/2"
                    style={{ left: `${pct(h * 60)}%` }}
                  >
                    {String(h).padStart(2, '0')}
                  </span>
                ))}
              </div>
            </div>
            {rows.map((r) => {
              const mine = ofDay.filter((b) => b.worker_profile_id === r.id);
              return (
                <div
                  key={r.id}
                  className="flex items-center border-b border-navy-50 py-1.5 last:border-0"
                >
                  <div className="sticky right-0 z-10 w-40 shrink-0 truncate bg-white text-sm font-medium text-navy">
                    {r.name}
                  </div>
                  <div className="relative h-9 flex-1 rounded-lg bg-navy-50/40" dir="ltr">
                    {hours.map((h) => (
                      <span
                        key={h}
                        className="absolute inset-y-0 border-l border-white"
                        style={{ left: `${pct(h * 60)}%` }}
                      />
                    ))}
                    {mine.map((b) => {
                      const left = pct(minutesOf(b.start_time));
                      const width = pct(minutesOf(b.end_time)) - left;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => onOpen(b)}
                          title={`${b.customer_name ?? ''} · ${b.start_time}–${b.end_time} · ${BOOKING_STATUS_LABEL[b.status]}`}
                          className={`absolute inset-y-1 overflow-hidden rounded-md px-1.5 text-[11px] font-medium ${BLOCK[b.status]}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                        >
                          <span dir="rtl" className="block truncate">
                            {b.start_time}–{b.end_time} · {b.customer_name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-purple">
        {(Object.keys(BLOCK) as BookingStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`h-3 w-3 rounded ${BLOCK[s].split(' ')[0]}`} />{' '}
            {BOOKING_STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

function BookingList({
  rows,
  isLoading,
  onOpen,
}: {
  rows: HourlyBooking[];
  isLoading: boolean;
  onOpen: (b: HourlyBooking) => void;
}) {
  const [status, setStatus] = useState<BookingStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const visible = rows.filter((b) => status === 'all' || b.status === status);
  const columns: Column<HourlyBooking>[] = [
    {
      key: 'no',
      header: 'رقم الحجز',
      cell: (b) => <span className="num font-medium text-navy">HB-{b.booking_no}</span>,
    },
    {
      key: 'when',
      header: 'الموعد',
      cell: (b) => (
        <span className="text-xs">
          {dateAr(b.booking_date)}
          <span className="num block">
            {b.start_time}–{b.end_time}
          </span>
        </span>
      ),
      sortValue: (b) => `${b.booking_date}${b.start_time}`,
    },
    {
      key: 'hours',
      header: 'الساعات',
      cell: (b) => <span className="num">{b.hours}</span>,
      sortValue: (b) => b.hours,
    },
    { key: 'worker', header: 'العاملة', cell: (b) => b.worker_name ?? '—' },
    {
      key: 'customer',
      header: 'العميل',
      cell: (b) => (
        <span>
          {b.customer_name}
          <span className="num block text-xs text-purple">{b.customer_phone}</span>
        </span>
      ),
    },
    { key: 'branch', header: 'الفرع', cell: (b) => b.branch ?? '—' },
    {
      key: 'total',
      header: 'الإجمالي',
      cell: (b) => <span className="num">{sar(b.total_amount)}</span>,
      sortValue: (b) => b.total_amount,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (b) => <Badge tone={TONE[b.status]}>{BOOKING_STATUS_LABEL[b.status]}</Badge>,
    },
    {
      key: 'open',
      header: '',
      cell: (b) => (
        <Button size="sm" variant="ghost" onClick={() => onOpen(b)}>
          التفاصيل
        </Button>
      ),
    },
  ];
  return (
    <>
      <div className="mb-3 max-w-xs">
        <Select
          label="الحالة"
          options={[
            { value: 'all', label: 'كل الحالات' },
            ...(Object.entries(BOOKING_STATUS_LABEL) as [BookingStatus, string][]).map(
              ([value, label]) => ({ value, label }),
            ),
          ]}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as BookingStatus | 'all');
            setPage(1);
          }}
        />
      </div>
      <Table
        columns={columns}
        rows={paginate(visible, page, PAGE_SIZE)}
        rowKey={(b) => b.id}
        isLoading={isLoading}
        emptyTitle="لا توجد حجوزات في الفترة المحددة"
      />
      <Pagination page={page} size={PAGE_SIZE} total={visible.length} onChange={setPage} />
    </>
  );
}

function BookingDrawer({
  booking,
  onClose,
}: {
  booking: HourlyBooking | null;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const setStatus = useSetBookingStatus();
  const canEdit = can('hourly', 'edit') || can('orders', 'edit');
  const act = (to: BookingStatus) => booking && setStatus.mutate({ id: booking.id, status: to });
  return (
    <Drawer
      open={booking !== null}
      onClose={onClose}
      title={booking ? `حجز HB-${booking.booking_no}` : ''}
      subtitle={
        booking && <Badge tone={TONE[booking.status]}>{BOOKING_STATUS_LABEL[booking.status]}</Badge>
      }
      footer={
        booking &&
        canEdit && (
          <div className="flex flex-wrap gap-2">
            {canMoveBooking(booking.status, 'in_progress') && (
              <Button
                variant="success"
                loading={setStatus.isPending}
                onClick={() => act('in_progress')}
              >
                تسجيل بداية الخدمة
              </Button>
            )}
            {canMoveBooking(booking.status, 'completed') && (
              <Button
                variant="success"
                loading={setStatus.isPending}
                onClick={() => act('completed')}
              >
                تسجيل نهاية الخدمة
              </Button>
            )}
            {canMoveBooking(booking.status, 'no_show') && (
              <Button
                variant="outline"
                loading={setStatus.isPending}
                onClick={() => act('no_show')}
              >
                لم يحضر العميل
              </Button>
            )}
            {canMoveBooking(booking.status, 'cancelled') && (
              <Button
                variant="danger"
                loading={setStatus.isPending}
                onClick={() => act('cancelled')}
              >
                إلغاء الحجز
              </Button>
            )}
          </div>
        )
      }
    >
      {booking && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {(
            [
              ['العميل', booking.customer_name ?? '—'],
              ['الجوال', booking.customer_phone ?? '—'],
              ['العاملة', booking.worker_name ?? '—'],
              ['المهمة', booking.profession ?? '—'],
              ['التاريخ', dateAr(booking.booking_date)],
              ['الوصول ← الانصراف', `${booking.start_time} ← ${booking.end_time}`],
              ['عدد الساعات', String(booking.hours)],
              ['سعر الساعة', `${sar(booking.hourly_rate)} ر.س`],
              ['الإجمالي شامل الضريبة', `${sar(booking.total_amount)} ر.س`],
              ['الفرع', booking.branch ?? '—'],
              [
                'بداية الخدمة الفعلية',
                booking.actual_start_at ? dateTimeAr(booking.actual_start_at) : '—',
              ],
              [
                'نهاية الخدمة الفعلية',
                booking.actual_end_at ? dateTimeAr(booking.actual_end_at) : '—',
              ],
              ['العنوان', booking.address ?? '—'],
              ['ملاحظات', booking.notes ?? '—'],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-purple">{k}</dt>
              <dd className="font-medium text-navy">{v}</dd>
            </div>
          ))}
          {booking.contract_id && (
            <div className="col-span-2">
              <Link
                to={`/contracts/${booking.contract_id}`}
                className="text-sm font-medium text-navy underline"
              >
                فتح عقد الحجز {booking.contract_no ?? ''}
              </Link>
            </div>
          )}
        </dl>
      )}
    </Drawer>
  );
}
