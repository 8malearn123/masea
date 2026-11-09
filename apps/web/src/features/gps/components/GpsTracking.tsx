import { ExternalLink, MapPin, Navigation, Satellite, Truck } from 'lucide-react';
import { Badge, Card, Skeleton, Table, type Column } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { DRIVER_STATUS_LABEL, DRIVER_STATUS_TONE } from '@/features/orders/lib/orderStatus';
import { usePermissions } from '@/hooks/usePermissions';
import { useDriverLocations, useRecentScans } from '@/features/gps/hooks/useGps';
import { isToday } from '@/features/gps/api/gps.api';
import { SCAN_TYPE_LABEL, type ScanEvent } from '@/features/gps/types';

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export default function GpsTracking() {
  const { role } = usePermissions();
  const isDriver = role === 'driver';
  const { data: drivers = [], isLoading } = useDriverLocations();
  const { data: scans = [], isError, refetch } = useRecentScans();

  const onRoute = drivers.filter((d) => d.status === 'on_route').length;
  // السائق: كل مسحاته؛ الإدارة: مسح اليوم فقط
  const scanCount = isDriver ? scans.length : scans.filter((s) => isToday(s.scanned_at)).length;

  const columns: Column<ScanEvent>[] = [
    { key: 'scan_type', header: 'الحدث', cell: (s) => SCAN_TYPE_LABEL[s.scan_type] ?? s.scan_type },
    { key: 'subject', header: 'الجهة', cell: (s) => s.subject },
    {
      key: 'coords',
      header: 'الموقع',
      cell: (s) =>
        s.lat !== null && s.lng !== null ? (
          <span className="num text-xs text-purple">
            {s.lat.toFixed(3)}, {s.lng.toFixed(3)}
          </span>
        ) : (
          <span className="text-xs text-purple/60">بدون موقع</span>
        ),
    },
    {
      key: 'scanned_at',
      header: 'الوقت',
      cell: (s) => <span className="num text-xs">{dateAr(s.scanned_at)}</span>,
    },
    {
      key: 'open',
      header: '',
      cell: (s) =>
        s.lat !== null && s.lng !== null ? (
          <a
            href={mapsUrl(s.lat, s.lng)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-navy hover:underline"
          >
            <ExternalLink size={13} /> الخريطة
          </a>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Satellite size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">{isDriver ? 'تتبّعي' : 'التتبّع GPS'}</h1>
          <p className="text-sm text-purple">
            {isDriver ? 'موقعك الحالي وسجل حركتك.' : 'مواقع السائقين الحيّة وسجل الحركة.'}
          </p>
        </div>
      </div>

      {/* a driver sees his own focused counters, not fleet-wide totals */}
      <div className={`mb-5 grid gap-3 ${isDriver ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {!isDriver && (
          <Card className="py-4">
            <p className="text-xs text-purple">إجمالي السائقين</p>
            <p className="num mt-1 text-2xl font-bold text-navy">{drivers.length}</p>
          </Card>
        )}
        <Card className="py-4">
          <p className="text-xs text-purple">{isDriver ? 'حالتي' : 'في مهمة الآن'}</p>
          <p className="num mt-1 text-2xl font-bold text-gold-600">
            {isDriver ? (drivers[0] ? DRIVER_STATUS_LABEL[drivers[0].status] : '—') : onRoute}
          </p>
        </Card>
        <Card className="py-4">
          <p className="text-xs text-purple">{isDriver ? 'عمليات مسحي' : 'عمليات مسح اليوم'}</p>
          <p className="num mt-1 text-2xl font-bold text-teal">{scanCount}</p>
        </Card>
        {!isDriver && (
          <Card className="py-4">
            <p className="text-xs text-purple">الفروع المغطاة</p>
            <p className="num mt-1 text-2xl font-bold text-navy">
              {new Set(drivers.map((d) => d.branch)).size}
            </p>
          </Card>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* live drivers */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <Truck size={16} /> {isDriver ? 'موقعي' : 'مواقع السائقين'}
          </h2>
          {isLoading ? (
            <Card>
              <Skeleton className="h-40 w-full" />
            </Card>
          ) : drivers.length === 0 ? (
            <Card className="py-8 text-center text-sm text-purple">لا يوجد سائقون في نطاقك.</Card>
          ) : (
            <div className="space-y-3">
              {drivers.map((d) => (
                <Card key={d.id} className="flex items-center gap-3 py-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy">
                    <Navigation size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy">{d.full_name}</p>
                    <p className="num text-[11px] text-purple">
                      {d.vehicle_no ?? '—'} · {d.branch ?? '—'} ·{' '}
                      {d.lat !== null && d.lng !== null && d.updated_at
                        ? `${d.lat.toFixed(3)}, ${d.lng.toFixed(3)} · ${dateAr(d.updated_at)}`
                        : 'لم يُسجَّل موقع بعد'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={DRIVER_STATUS_TONE[d.status]}>
                      {DRIVER_STATUS_LABEL[d.status]}
                    </Badge>
                    {d.lat !== null && d.lng !== null && (
                      <a
                        href={mapsUrl(d.lat, d.lng)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-navy hover:underline"
                      >
                        <MapPin size={11} /> فتح في الخرائط
                      </a>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* movement log */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <MapPin size={16} /> {isDriver ? 'سجل حركتي' : 'سجل الحركة'}
          </h2>
          <Table
            columns={columns}
            rows={scans}
            rowKey={(s) => s.id}
            isError={isError}
            onRetry={() => void refetch()}
            emptyTitle="لا توجد عمليات مسح"
          />
        </div>
      </div>
    </div>
  );
}
