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
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { sar } from '@/shared/lib/format';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import type { ServiceCode } from '@/lib/funnel';
import { AvailabilityCalendar } from '@/features/catalog/components/AvailabilityCalendar';
import { WorkerReviews } from '@/features/catalog/components/WorkerReviews';
import { RatingBadge } from '@/features/rating/components/RatingParts';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import {
  availabilityOf,
  AVAILABILITY_LABEL,
  maritalOf,
  motherTongueOf,
  religionOf,
  servicePrices,
  skillsOf,
  yearsLabel,
} from '@/features/catalog/lib/catalog';

const WA_NUMBER = '966920000000';

export default function WorkerProfile() {
  const { id = '' } = useParams();
  const { data: workers = [], isLoading } = useWorkerProfiles();
  const { data: config = [] } = useConfig();
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
  const skills = skillsOf(worker);
  const guaranteeDays = configValue(config, 'replacement_guarantee_days', 0) || null;
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
                  {worker.profession} · {worker.nationality}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <RatingBadge workerId={worker.id} className="text-xs" />
                  <a
                    href="#reviews"
                    className="text-[11px] font-semibold text-navy hover:underline"
                  >
                    عرض التقييمات
                  </a>
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Attr label="العمر" value={worker.age !== null ? `${worker.age} سنة` : 'غير متوفر'} />
              <Attr label="الخبرة" value={yearsLabel(worker.experience_years)} />
              <Attr label="الديانة" value={religionOf(worker) ?? 'غير متوفر'} />
              <Attr label="الحالة الاجتماعية" value={maritalOf(worker) ?? 'غير متوفر'} />
              <Attr label="اللغة الأم" value={motherTongueOf(worker) ?? 'غير متوفر'} />
              <Attr label="اللغات" value={worker.languages.join('، ')} />
              <Attr label="الراتب" value={`${sar(worker.monthly_salary)} ر.س`} />
            </div>
          </div>

          {/* الخبرة — من الملف فقط؛ لا سجل جهات عمل مولّد */}
          <Section icon={CalendarCheck} title="الخبرة">
            <p className="text-sm text-navy-900">
              إجمالي الخبرة المسجّلة:{' '}
              <span className="font-bold">{yearsLabel(worker.experience_years)}</span>
            </p>
            <p className="mt-1 text-[11px] text-purple">
              تفاصيل جهات العمل السابقة غير متوفرة في بيانات العرض.
            </p>
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
          <div id="reviews" className="scroll-mt-20">
            <Section icon={MessageSquare} title="تقييمات وتعليقات العملاء">
              <WorkerReviews workerId={worker.id} />
            </Section>
          </div>

          {/* trust */}
          <Section icon={ShieldCheck} title="عناصر الثقة">
            <div className="grid gap-2 sm:grid-cols-3">
              <Trust
                icon={RefreshCw}
                title="ضمان الاستبدال"
                sub={guaranteeDays ? `${guaranteeDays} يومًا حسب إعدادات النظام` : 'حسب شروط العقد'}
              />
              <Trust
                icon={BadgeCheck}
                title="الوثائق والفحص الطبي"
                sub="غير متوفرة في بيانات العرض — تُراجع عند التعاقد"
              />
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
      <div
        data-fab-avoid
        className="fixed inset-x-0 bottom-0 z-20 border-t border-navy-100 bg-white p-3 lg:hidden"
      >
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
          <CheckCircle2 size={12} className="text-green-600" /> سعر شفّاف قبل الدفع
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
      {/* الأرقام داخل النص العربي تُعرض باتجاهها الصحيح دون خط الأرقام على الجملة كلها */}
      <p className="mt-0.5 text-sm font-semibold text-navy-900 [unicode-bidi:plaintext]">{value}</p>
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
