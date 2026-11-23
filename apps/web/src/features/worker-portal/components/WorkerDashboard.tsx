import type { ReactNode } from 'react';
import {
  BedDouble,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  MapPin,
  ScanLine,
  Star,
  UserRound,
  UserX,
} from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, SkeletonCard } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { periodLabel } from '@/features/requests/lib/period';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '@/features/orders/lib/orderStatus';
import { TRIP_STEPS } from '@/features/orders/lib/trip';
import type { TripStage } from '@/features/orders/types';
import {
  RESIDENT_STATUS_LABEL,
  RESIDENT_STATUS_TONE,
  SCAN_DIRECTION_LABEL,
} from '@/features/housing/types';
import { RatingSummaryPanel, ReviewList } from '@/features/rating/components/RatingParts';
import { currentWorkerLink, useWorkerPortal } from '@/features/worker-portal/hooks/useWorkerPortal';
import type { WorkerAssignment } from '@/features/worker-portal/services/workerPortal';

/** وصف مرحلة الرحلة كما يعرضه السائق (نفس نصوص `TRIP_STEPS`). */
function tripStageText(stage: TripStage | null): string | null {
  if (!stage) return null;
  if (stage === 'none') return 'لم تبدأ رحلة التوصيل بعد';
  return TRIP_STEPS.find((s) => s.stage === stage)?.done ?? null;
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof UserRound;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <Icon size={16} aria-hidden className="text-gold-600" /> {title}
      </h2>
      {children}
    </Card>
  );
}

function AssignmentItem({ a }: { a: WorkerAssignment }) {
  const trip = tripStageText(a.tripStage);
  return (
    <li className="rounded-xl border border-navy-100 p-3" aria-label={`مهمة ${a.requestNo}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-navy">{a.serviceName}</p>
        {a.orderStatus ? (
          <Badge tone={ORDER_STATUS_TONE[a.orderStatus]}>{ORDER_STATUS_LABEL[a.orderStatus]}</Badge>
        ) : (
          <Badge tone="neutral">الحالة غير متوفرة</Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-purple">
        رقم الطلب <span className="num">{a.requestNo}</span>
      </p>
      {a.period && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-sm text-navy-900">
          <CalendarDays size={14} aria-hidden className="text-purple" />
          من {dateAr(a.period.startDate)} إلى {dateAr(a.period.endDate)} ({periodLabel(a.period)})
        </p>
      )}
      <p className="mt-1 flex items-center gap-1 text-xs text-purple">
        <MapPin size={12} aria-hidden />{' '}
        {[...new Set([a.city, a.branch].filter(Boolean))].join(' · ') || '—'}
      </p>
      {trip && <p className="mt-1.5 text-xs font-semibold text-teal">{trip}</p>}
    </li>
  );
}

/**
 * لوحة العاملة الشخصية: ملفها وسكنها ورمز المسح، ومهامها المُسندة وحالتها،
 * وجدول حجوزاتها، وحركات السكن، وتقييمات العملاء لها. بياناتها هي فقط.
 */
export function WorkerDashboard() {
  const link = currentWorkerLink();
  const { data, isLoading, isError, refetch } = useWorkerPortal(link);

  if (!link) {
    return (
      <EmptyState
        icon={UserX}
        title="الحساب غير مرتبط بملف عاملة"
        description="يربط الإداري حسابك بملفك في العمالة لتظهر بياناتك هنا."
      />
    );
  }
  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        title="تعذّر تحميل لوحتك"
        description="حاولي مرة أخرى بعد قليل."
        onRetry={() => void refetch()}
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        icon={UserX}
        title="لم نعثر على ملفك"
        description="ملف العاملة المرتبط بالحساب غير موجود — راجعي الإدارة."
      />
    );
  }

  const { worker, resident, schedule, assignments, housingScans } = data;

  return (
    <div className="space-y-4">
      {/* البطاقة التعريفية */}
      <Card className="flex flex-wrap items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-navy text-xl font-bold text-white">
          {worker.full_name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-navy">{worker.full_name}</p>
          <p className="text-sm text-purple">
            {worker.profession} · {worker.nationality}
          </p>
          {resident && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-navy-900">
              <BedDouble size={14} aria-hidden className="text-purple" /> {resident.dorm}
              <Badge tone={RESIDENT_STATUS_TONE[resident.status]}>
                {RESIDENT_STATUS_LABEL[resident.status]}
              </Badge>
            </p>
          )}
        </div>
        {resident && (
          <div className="w-full rounded-xl bg-navy-50 px-4 py-2 text-center sm:w-auto">
            <p className="flex items-center justify-center gap-1 text-[11px] text-purple">
              <ScanLine size={12} aria-hidden /> رمزك للمسح
            </p>
            <p className="num text-base font-bold text-navy" dir="ltr">
              {resident.barcode}
            </p>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={ClipboardList} title="مهامي">
          {assignments.length === 0 ? (
            <EmptyState icon={BriefcaseBusiness} title="لا توجد مهام مُسندة لك حاليًا" />
          ) : (
            <ul className="space-y-2.5" aria-label="مهامي">
              {assignments.map((a) => (
                <AssignmentItem key={a.requestNo} a={a} />
              ))}
            </ul>
          )}
        </Section>

        <Section icon={CalendarDays} title="جدولي">
          {schedule.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="لا حجوزات قادمة"
              description="جدولك متاح للحجز."
            />
          ) : (
            <ul className="divide-y divide-navy-50" aria-label="جدولي">
              {schedule.map((r) => (
                <li
                  key={`${r.start}-${r.end}-${r.reason}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span className="text-navy-900">
                    من {dateAr(r.start)} إلى {dateAr(r.end)}
                  </span>
                  <Badge tone={r.kind === 'unavailable' ? 'gold' : 'navy'}>{r.reason}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={BedDouble} title="حركات السكن">
          {housingScans.length === 0 ? (
            <EmptyState icon={BedDouble} title="لا توجد حركات مسجّلة بعد" />
          ) : (
            <ul className="divide-y divide-navy-50" aria-label="حركات السكن">
              {housingScans.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span className="font-semibold text-navy">
                    {SCAN_DIRECTION_LABEL[s.direction]}
                  </span>
                  <span className="text-xs text-purple">
                    {s.dorm} · {dateAr(s.scanned_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={Star} title="تقييماتي">
          <RatingSummaryPanel workerId={worker.id} />
          <div className="mt-3">
            <ReviewList workerId={worker.id} />
          </div>
        </Section>
      </div>
    </div>
  );
}
