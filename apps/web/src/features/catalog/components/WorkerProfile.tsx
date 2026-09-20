import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Languages,
  MessageCircle,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { flagFor } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import type { ServiceCode } from '@/lib/funnel';
import { AvailabilityCalendar } from '@/features/catalog/components/AvailabilityCalendar';
import { WorkerReviews } from '@/features/catalog/components/WorkerReviews';
import {
  availabilityOf,
  AVAILABILITY_LABEL,
  maritalOf,
  motherTongueOf,
  priorExperienceOf,
  ratingOf,
  religionOf,
  reviewsOf,
  servicePrices,
  skillsOf,
} from '@/features/catalog/lib/catalog';

const WA_NUMBER = '966920000000';

export default function WorkerProfile() {
  const { id = '' } = useParams();
  const { data: workers = [], isLoading } = useWorkerProfiles();
  const worker = workers.find((w) => w.id === id) ?? null;

  const prices = useMemo(() => (worker ? servicePrices(worker) : []), [worker]);
  const [service, setService] = useState<ServiceCode>('recruitment');
  const selected = prices.find((p) => p.code === service) ?? prices[0];

  if (isLoading) {
    return (
      <div dir="rtl" className="grid min-h-screen place-items-center bg-navy-50 text-purple">
        جارٍ التحميل…
      </div>
    );
  }
  if (!worker) {
    return (
      <div dir="rtl" className="grid min-h-screen place-items-center bg-navy-50">
        <div className="text-center">
          <p className="text-lg font-bold text-navy">العاملة غير موجودة</p>
          <Link
            to="/order/workers"
            className="mt-3 inline-block text-sm font-semibold text-navy hover:underline"
          >
            العودة للكتالوج
          </Link>
        </div>
      </div>
    );
  }

  const av = availabilityOf(worker);
  const rating = ratingOf(worker);
  const skills = skillsOf(worker);
  const prior = priorExperienceOf(worker);
  const waText = `مرحباً، مهتم بالعاملة ${worker.full_name} (${worker.profession}) — خدمة ${selected?.label ?? ''}.`;

  return (
    <div dir="rtl" className="min-h-screen bg-navy-50 pb-28 lg:pb-8">
      <header className="sticky top-0 z-10 border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link
            to="/order/workers"
            className="inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
          >
            <ArrowRight size={16} /> الكتالوج
          </Link>
          <span className="text-sm font-bold text-navy">{BRAND.client.nameAr}</span>
        </div>
      </header>

      <div className="mx-auto max-w-5xl gap-5 px-4 py-5 lg:grid lg:grid-cols-[1fr_320px]">
        {/* main */}
        <main className="space-y-4">
          {/* hero */}
          <div className="rounded-2xl border border-navy-100 bg-white p-4">
            <div className="flex items-center gap-4">
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-navy-50 text-navy-200">
                {worker.photo_url ? (
                  <img
                    src={worker.photo_url}
                    alt={worker.full_name}
                    className="h-full w-full rounded-2xl object-cover"
                  />
                ) : (
                  <UserRound size={36} />
                )}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-navy">{worker.full_name}</h1>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${av === 'available' ? 'bg-green-100 text-green-600' : 'bg-gold-100 text-gold-600'}`}
                  >
                    {AVAILABILITY_LABEL[av]}
                  </span>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-purple">
                  <span className="text-base leading-none">{flagFor(worker.nationality)}</span>
                  {worker.profession} · {worker.nationality}
                </p>
                <p className="num mt-1 inline-flex items-center gap-1 text-xs font-semibold text-gold-600">
                  <Star size={13} className="fill-current" /> {rating.toFixed(1)} (
                  {reviewsOf(worker)} تقييم)
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Attr label="العمر" value={`${worker.age ?? '—'} سنة`} />
              <Attr label="الخبرة" value={`${worker.experience_years} سنوات`} />
              <Attr label="الديانة" value={religionOf(worker)} />
              <Attr label="الحالة الاجتماعية" value={maritalOf(worker)} />
              <Attr label="اللغة الأم" value={motherTongueOf(worker)} />
              <Attr label="اللغات" value={worker.languages.join('، ')} />
              <Attr label="الراتب" value={`${sar(worker.monthly_salary)} ر.س`} />
            </div>
          </div>

          {/* intro video */}
          <Section icon={PlayCircle} title="فيديو تعريفي">
            <div className="grid aspect-video place-items-center rounded-xl bg-navy-900/90 text-navy-100/70">
              <PlayCircle size={40} />
            </div>
            <p className="mt-2 text-[11px] text-purple">٠:٤٨ · تعريف بالعاملة</p>
          </Section>

          {/* prior experience */}
          <Section icon={CalendarCheck} title={`الخبرة السابقة · ${worker.experience_years} سنوات`}>
            <ul className="space-y-2">
              {prior.map((p, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-xl bg-navy-50 px-3 py-2.5 text-sm"
                >
                  <span className="text-navy-900">
                    {p.country} — {p.detail}
                  </span>
                  <span className="num text-xs text-purple">{p.years} سنوات</span>
                </li>
              ))}
            </ul>
          </Section>

          {/* skills */}
          <Section icon={Sparkles} title="المهارات والتخصّصات">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {skills.map((s) => (
                <div key={s.label} className="rounded-xl border border-navy-100 p-2.5 text-center">
                  <p className="text-sm font-semibold text-navy">{s.label}</p>
                  <p className="text-[11px] text-teal">{s.level}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* جدول التوفّر */}
          <Section icon={CalendarDays} title="جدول التوفّر — التواريخ المحجوزة والمتاحة">
            <AvailabilityCalendar workerId={worker.id} />
          </Section>

          {/* التقييمات والتعليقات */}
          <Section icon={MessageSquare} title="تقييمات وتعليقات العملاء">
            <WorkerReviews workerId={worker.id} workerName={worker.full_name} />
          </Section>

          {/* trust */}
          <Section icon={ShieldCheck} title="عناصر الثقة">
            <div className="grid gap-2 sm:grid-cols-3">
              <Trust icon={BadgeCheck} title="الوثائق موثّقة" sub="جواز سفر وعقد ساري" />
              <Trust icon={Stethoscope} title="الفحص الطبي مكتمل" sub="لائقة صحياً · ٢٠٢٤" />
              <Trust icon={RefreshCw} title="ضمان الاستبدال" sub="استبدال مجاني خلال ٩٠ يوم" />
            </div>
          </Section>

          {worker.bio_ar && (
            <Section icon={Languages} title="نبذة">
              <p className="text-sm leading-relaxed text-navy-900">{worker.bio_ar}</p>
            </Section>
          )}
        </main>

        {/* order panel (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-2xl border border-navy-100 bg-white p-4">
            <OrderPanel
              prices={prices}
              service={service}
              onSelect={setService}
              workerId={worker.id}
              waText={waText}
            />
          </div>
        </aside>
      </div>

      {/* sticky order bar (mobile) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-navy-100 bg-white p-3 lg:hidden">
        <OrderPanel
          prices={prices}
          service={service}
          onSelect={setService}
          workerId={worker.id}
          waText={waText}
          compact
        />
      </div>
    </div>
  );
}

function OrderPanel({
  prices,
  service,
  onSelect,
  workerId,
  waText,
  compact,
}: {
  prices: ReturnType<typeof servicePrices>;
  service: ServiceCode;
  onSelect: (s: ServiceCode) => void;
  workerId: string;
  waText: string;
  compact?: boolean;
}) {
  const selected = prices.find((p) => p.code === service) ?? prices[0];
  return (
    <div>
      {!compact && <h2 className="mb-3 text-sm font-bold text-navy">كيف تشتغل معها؟</h2>}
      <div className={compact ? 'mb-2 grid grid-cols-4 gap-1.5' : 'mb-3 space-y-2'}>
        {prices.map((p) => {
          const active = p.code === service;
          return (
            <button
              key={p.code}
              type="button"
              onClick={() => onSelect(p.code)}
              className={`rounded-xl border px-2 py-2 text-center transition ${active ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy/40'} ${compact ? '' : 'flex items-center justify-between text-right'}`}
            >
              <span className={`block text-xs font-semibold text-navy ${compact ? '' : ''}`}>
                {p.label}
              </span>
              <span className="num block text-[11px] text-gold-600">
                {sar(p.total)} {p.unit}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Link
          to={`/order/start?service=${service}&worker=${workerId}`}
          className="flex-1 rounded-xl bg-gold py-2.5 text-center text-sm font-bold text-white transition hover:bg-gold-600"
        >
          اطلب هذه العاملة
        </Link>
        <a
          href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(waText)}`}
          target="_blank"
          rel="noreferrer"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-navy-100 text-green-600 hover:bg-navy-50"
          aria-label="واتساب"
        >
          <MessageCircle size={18} />
        </a>
      </div>
      {!compact && (
        <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-purple">
          <CheckCircle2 size={12} className="text-green-600" /> دفع آمن · ضمان استبدال ٩٠ يوم
        </p>
      )}
      {compact && selected && (
        <p className="num mt-1 text-center text-[11px] text-purple">
          {selected.label} · يبدأ من {sar(selected.total)} ر.س
        </p>
      )}
    </div>
  );
}

function Attr({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-navy-50 p-2.5">
      <p className="text-[11px] text-purple">{label}</p>
      <p className="num mt-0.5 text-sm font-semibold text-navy-900">{value}</p>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <Icon size={16} /> {title}
      </h2>
      {children}
    </div>
  );
}

function Trust({ icon: Icon, title, sub }: { icon: typeof Sparkles; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-navy-50 p-2.5">
      <Icon size={18} className="shrink-0 text-teal" />
      <div>
        <p className="text-xs font-semibold text-navy">{title}</p>
        <p className="text-[11px] text-purple">{sub}</p>
      </div>
    </div>
  );
}
