import { Link } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { FlagCircle } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import type { WorkerProfile } from '@/lib/funnel';
import {
  availabilityOf,
  AVAILABILITY_LABEL,
  type Availability,
  yearsLabel,
} from '@/features/catalog/lib/catalog';
import { RatingBadge } from '@/features/rating/components/RatingParts';

const AV_TONE: Record<Availability, string> = {
  available: 'bg-green-100 text-green-600',
  reserved: 'bg-gold-100 text-gold-600',
  soon: 'bg-navy-50 text-purple',
};

export function WorkerCard({ worker }: { worker: WorkerProfile }) {
  const av = availabilityOf(worker);
  return (
    <div className="overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-sm transition hover:shadow-md">
      <div className="relative grid h-40 place-items-center bg-navy-50 text-navy-200">
        {worker.photo_url ? (
          <img
            src={worker.photo_url}
            alt={worker.full_name}
            className="h-full w-full object-cover"
          />
        ) : (
          <UserRound size={48} />
        )}
        <span
          className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold ${AV_TONE[av]}`}
        >
          {AVAILABILITY_LABEL[av]}
        </span>
        <FlagCircle
          nationality={worker.nationality}
          size="md"
          className="absolute left-3 top-3 bg-white/90 ring-white/60"
        />
      </div>
      <div className="p-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-navy">{worker.full_name}</h3>
          <RatingBadge workerId={worker.id} />
        </div>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-purple">
          {worker.profession} · {worker.nationality}
        </p>
        <p className="mt-1 text-[11px] text-purple">
          العمر {worker.age !== null ? <span className="num">{worker.age}</span> : 'غير متوفر'}
          {worker.age !== null && ' سنة'} · خبرة {yearsLabel(worker.experience_years)}
        </p>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-xs text-purple">
            يبدأ من <span className="num font-bold text-navy">{sar(worker.monthly_salary)}</span>{' '}
            ر.س/شهر
          </span>
          <Link
            to={`/order/workers/${worker.id}`}
            className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy/90"
          >
            عرض الملف
          </Link>
        </div>
      </div>
    </div>
  );
}
