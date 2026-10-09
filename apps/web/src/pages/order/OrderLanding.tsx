import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  CalendarCheck,
  ChevronLeft,
  Mail,
  MapPin,
  PackageSearch,
  Phone,
  Plane,
  Quote,
  RefreshCw,
  ShieldCheck,
  Star,
  Truck,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { FlagCircle } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { fallbackPrice } from '@/shared/lib/pricing';
import { BRANCHES_AR, type ServiceCode, type WorkerProfile } from '@/lib/funnel';
import { useServices } from '@/hooks/useServices';
import { SERVICE_ICON } from '@/lib/serviceIcons';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import {
  AVAILABILITY_LABEL,
  availabilityOf,
  SERVICE_UNIT,
  yearsLabel,
} from '@/features/catalog/lib/catalog';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { useRatings } from '@/features/rating/hooks/useRatings';
import { reviewerDisplayName, reviewsLabel } from '@/features/rating/types';
import { RatingBadge, StarRow } from '@/features/rating/components/RatingParts';

const STEPS: { title: string; text: string }[] = [
  { title: 'تصفّح العاملات', text: 'استخدم الفلاتر لإيجاد العاملة الأنسب لاحتياج بيتك.' },
  { title: 'اختر الخدمة', text: 'استقدام، تأجير شهري أو يومي، أو نقل كفالة.' },
  { title: 'راجع السعر وادفع', text: 'الأساسي والضريبة والإجمالي واضحة قبل الدفع.' },
  { title: 'تابع طلبك', text: 'رقم طلب وصفحة تتبّع لكل طلب حتى المباشرة.' },
];

/**
 * شريط الثقة: ما يقدّمه النظام فعلًا في العرض — لا أرقام رضا أو دعم على مدار
 * الساعة غير قابلة للتحقق. مدة ضمان الاستبدال من إعدادات النظام.
 */
function trustStrip(
  guaranteeDays: number | null,
): { icon: LucideIcon; title: string; sub: string }[] {
  return [
    { icon: Star, title: 'تقييمات مرتبطة بطلب', sub: 'تقييم واحد لكل طلب' },
    {
      icon: RefreshCw,
      title: 'ضمان استبدال',
      sub: guaranteeDays ? `${guaranteeDays} يومًا حسب الإعدادات` : 'حسب شروط العقد',
    },
    { icon: CalendarCheck, title: 'جدول توفّر', sub: 'لكل عاملة' },
    { icon: ShieldCheck, title: 'سعر شفّاف', sub: 'قبل الدفع' },
    { icon: PackageSearch, title: 'تتبّع الطلب', sub: 'برقم الطلب' },
    { icon: Bot, title: 'مساعد العملاء', sub: 'إجابات الأسئلة الشائعة' },
  ];
}

function whyUs(guaranteeDays: number | null): { icon: LucideIcon; title: string; text: string }[] {
  return [
    {
      icon: BadgeCheck,
      title: 'ملفات واضحة',
      text: 'المهنة والخبرة واللغات وتقييمات العملاء وجدول التوفّر لكل عاملة.',
    },
    {
      icon: RefreshCw,
      title: guaranteeDays ? `ضمان استبدال ${guaranteeDays} يومًا` : 'ضمان استبدال',
      text: 'وفق شروط العقد المعتمدة — المدة تُدار من إعدادات النظام.',
    },
    { icon: Truck, title: 'إجراءات متابَعة', text: 'نتابع الطلب بخطوات واضحة حتى المباشرة.' },
    { icon: PackageSearch, title: 'تتبّع الطلب', text: 'رقم طلب وملف طلب يجمع كل التفاصيل.' },
    {
      icon: Wallet,
      title: 'أسعار شفّافة',
      text: 'الأساسي والضريبة والإجمالي واضحة قبل الدفع — لا رسوم خفية.',
    },
  ];
}

const WA = 'https://wa.me/966920000000';

/** حالة العاملة اليوم من جدول التوفّر (لا شارة «متاحة» ثابتة). */
function AvailabilityPill({
  worker,
  className = '',
}: {
  worker: WorkerProfile;
  className?: string;
}) {
  const av = availabilityOf(worker);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
        av === 'available' ? 'bg-teal-100 text-teal' : 'bg-gold-100 text-gold-600'
      } ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${av === 'available' ? 'bg-teal' : 'bg-gold-600'}`}
      />
      {AVAILABILITY_LABEL[av]}
    </span>
  );
}

function priceFrom(code: string): number {
  return fallbackPrice(code as ServiceCode, { quantity: 1 }).total;
}

export default function OrderLanding() {
  const { data: services = [] } = useServices();
  const { data: workers = [] } = useWorkerProfiles(8);
  const { data: allWorkers = [] } = useWorkerProfiles();
  const { data: config = [] } = useConfig();
  const { data: ratings = [] } = useRatings();
  const guaranteeDays = configValue(config, 'replacement_guarantee_days', 0) || null;
  // من بيانات العرض نفسها: المتاحات اليوم في جدول التوفّر وعدد الجنسيات
  const availableToday = allWorkers.filter((w) => availabilityOf(w) === 'available').length;
  const nationalities = [...new Set(allWorkers.map((w) => w.nationality))];
  const featured = workers.find((w) => availabilityOf(w) === 'available') ?? workers[0];
  // آخر تقييمات العاملات المكتوبة (بيانات العرض) بدل شهادات مؤلّفة
  const workerReviews = ratings.filter((r) => r.target_type === 'worker' && r.comment);
  const latestReviews = workerReviews.slice(0, 3);

  return (
    <div dir="rtl" className="min-h-screen bg-white text-navy-800">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-navy-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-navy text-lg font-bold text-white ring-1 ring-gold/40">
              م
            </div>
            <p className="text-sm font-bold text-navy-900">{BRAND.client.nameAr}</p>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-medium text-navy-800 lg:flex">
            <a href="#services" className="transition hover:text-navy">
              خدماتنا
            </a>
            <a href="#how" className="transition hover:text-navy">
              كيف نعمل
            </a>
            <a href="#workers" className="transition hover:text-navy">
              العاملات
            </a>
            <a href="#why" className="transition hover:text-navy">
              لماذا نحن
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="hidden text-sm font-medium text-purple transition hover:text-navy sm:inline"
            >
              دخول
            </Link>
            <Link to="/order/workers" className="btn-accent gap-2 rounded-xl px-5 py-2.5 shadow-sm">
              تصفّح العاملات <ChevronLeft size={16} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-navy text-white">
        <div className="bg-arabesque absolute inset-0 opacity-[0.16]" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 60% at 88% 0%, rgba(201,162,74,0.22) 0%, transparent 60%)',
          }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-2 lg:py-28">
          <div className="text-center lg:text-right">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-gold-100">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal" />
              </span>
              بيانات العرض · <span className="num">{availableToday}</span> من{' '}
              <span className="num">{allWorkers.length}</span> عاملة متاحة اليوم
            </span>
            <h1 className="text-3xl font-bold leading-snug tracking-tight [text-wrap:balance] md:text-5xl md:leading-[1.25]">
              استقدام تختار فيه <span className="text-gold">بنفسك</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-white/75 md:text-base lg:mx-0">
              تصفّح ملفات العاملات بالخبرة والمهارات والتقييمات وجدول التوفّر، واختر طريقة التعاقد
              التي تناسبك — كل شيء بشفافية ووضوح.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link
                to="/order/workers"
                className="btn-accent gap-2 rounded-xl px-8 py-3.5 text-base shadow-lg"
              >
                ابدأ التصفّح <ChevronLeft size={18} />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-8 py-3.5 text-base font-semibold text-white transition hover:bg-white/10"
              >
                كيف نعمل
              </a>
            </div>
          </div>

          {/* hero visual: featured worker + stats */}
          <div className="relative grid place-items-center">
            {featured && (
              <div className="w-full max-w-xs rounded-3xl border border-white/10 bg-white/95 p-4 text-navy-900 shadow-2xl">
                <div className="flex items-center gap-3">
                  <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-navy-50 text-navy">
                    <UserRound size={26} />
                    <FlagCircle
                      nationality={featured.nationality}
                      size="sm"
                      className="absolute -bottom-1 -left-1 bg-white"
                    />
                  </span>
                  <div className="flex-1">
                    <p className="font-bold text-navy">{featured.full_name}</p>
                    <p className="text-[11px] text-purple">
                      {featured.profession} · خبرة {yearsLabel(featured.experience_years)}
                    </p>
                  </div>
                  <RatingBadge workerId={featured.id} />
                </div>
                <AvailabilityPill worker={featured} className="mt-3" />
                <Link
                  to={`/order/workers/${featured.id}`}
                  className="mt-3 block rounded-xl bg-navy py-2.5 text-center text-sm font-bold text-white transition hover:bg-navy-700"
                >
                  عرض الملف
                </Link>
              </div>
            )}
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5">
              <div className="flex -space-x-3 -space-x-reverse">
                {nationalities.slice(0, 4).map((n) => (
                  <FlagCircle key={n} nationality={n} className="border-2 border-navy bg-white" />
                ))}
                {nationalities.length > 4 && (
                  <span className="num grid h-8 w-8 place-items-center rounded-full border-2 border-navy bg-gold text-[11px] font-bold text-white">
                    +{nationalities.length - 4}
                  </span>
                )}
              </div>
              <p className="text-xs text-white/80">
                <span className="num">{nationalities.length}</span> جنسيات في بيانات العرض · مهارات
                متنوّعة
              </p>
            </div>
          </div>
        </div>

        {/* trust strip */}
        <div className="relative border-t border-white/10 bg-navy-900/40">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
            {trustStrip(guaranteeDays).map((t) => (
              <div key={t.title} className="flex items-center gap-2.5 px-2 py-1.5">
                <t.icon size={20} className="shrink-0 text-gold" />
                <div className="leading-tight">
                  <p className="text-sm font-bold text-white">{t.title}</p>
                  <p className="text-[11px] text-white/65">{t.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center">
          <Eyebrow>خدماتنا</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold text-navy-900 md:text-4xl">
            طريقة تعاقد تناسب كل احتياج
          </h2>
          <p className="mt-3 text-sm text-purple">
            أربع طرق مرنة بأسعار واضحة وشفّافة — بدون أي رسوم خفية.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((s) => {
            const Icon = SERVICE_ICON[s.code as ServiceCode] ?? Plane;
            const featured = s.code === 'recruitment';
            const unit = SERVICE_UNIT[s.code as ServiceCode] ?? '';
            return (
              <div
                key={s.code}
                className={`group relative flex flex-col rounded-2xl border bg-white p-6 transition hover:-translate-y-1 hover:shadow-xl ${featured ? 'border-gold ring-1 ring-gold/30' : 'border-navy-100 hover:border-navy'}`}
              >
                {featured && (
                  <span className="absolute -top-3 right-5 rounded-full bg-gold px-3 py-1 text-[11px] font-bold text-white">
                    <Star size={11} aria-hidden className="me-1 inline fill-current align-[-1px]" />
                    الأكثر طلباً
                  </span>
                )}
                <span className="h-13 w-13 grid place-items-center rounded-2xl bg-navy-50 p-3 text-navy transition group-hover:bg-navy group-hover:text-white">
                  <Icon size={22} strokeWidth={1.7} />
                </span>
                <h3 className="mt-4 text-lg font-bold text-navy">{s.name_ar}</h3>
                <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-purple">
                  {s.tagline_ar}
                </p>
                <p className="mt-4 text-xs text-purple">
                  يبدأ من{' '}
                  <span className="num text-lg font-bold text-navy-900">
                    {sar(priceFrom(s.code))}
                  </span>{' '}
                  ريال {unit}
                </p>
                <Link
                  to={`/order/start?service=${s.code}`}
                  className="btn-accent mt-4 justify-center gap-1.5 rounded-xl py-2.5 text-sm"
                >
                  اطلب الآن <ArrowLeft size={15} />
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-navy-100 bg-navy-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <Eyebrow>كيف نعمل</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold text-navy-900 md:text-4xl">
              أربع خطوات للاستلام
            </h2>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative rounded-2xl bg-white p-6 shadow-sm">
                <span className="num text-2xl font-extrabold text-navy-100">٠{i + 1}</span>
                <h3 className="mt-2 font-bold text-navy">{s.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-purple">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workers */}
      <section id="workers" className="mx-auto max-w-6xl px-4 py-20">
        <div className="flex items-end justify-between">
          <div>
            <Eyebrow>متاحات الآن</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold text-navy-900 md:text-4xl">اختر عاملتك</h2>
          </div>
          <Link
            to="/order/workers"
            className="inline-flex items-center gap-1 text-sm font-semibold text-navy hover:underline"
          >
            عرض الكل <ArrowLeft size={15} />
          </Link>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {workers.map((w) => (
            <Link
              key={w.id}
              to={`/order/workers/${w.id}`}
              className="group flex flex-col rounded-2xl border border-navy-100 bg-white p-5 transition hover:-translate-y-1 hover:border-navy hover:shadow-xl"
            >
              <div className="flex items-center gap-3">
                <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-navy-50 text-navy">
                  <UserRound size={22} />
                  <FlagCircle
                    nationality={w.nationality}
                    size="sm"
                    className="absolute -bottom-1 -left-1 bg-white"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-navy">{w.full_name}</p>
                  <p className="text-[11px] text-purple">
                    {w.profession} · {w.nationality}
                  </p>
                </div>
                <RatingBadge workerId={w.id} className="shrink-0" />
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-navy-50 pt-3">
                <AvailabilityPill worker={w} />
                <span className="num text-xs text-purple">{sar(w.monthly_salary)} ريال/شهر</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Why us */}
      <section id="why" className="border-y border-navy-100 bg-navy-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <Eyebrow>لماذا ماسية الشرق</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold text-navy-900 md:text-4xl">ثقة في كل تفصيل</h2>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {whyUs(guaranteeDays).map((t) => (
              <div key={t.title} className="rounded-2xl bg-white p-6 shadow-sm">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-navy-50 text-navy">
                  <t.icon size={22} strokeWidth={1.7} />
                </span>
                <h3 className="mt-4 font-bold text-navy">{t.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-purple">{t.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* آراء العملاء — من تقييمات العاملات في بيانات العرض، لا شهادات مؤلّفة */}
      {latestReviews.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-20">
          <div className="text-center">
            <Eyebrow>آراء العملاء</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold text-navy-900 md:text-4xl">
              من تقييمات العملاء
            </h2>
            <p className="mt-3 text-sm text-purple">
              أحدث التعليقات من {reviewsLabel(workerReviews.length)} مكتوبة على العاملات · بيانات
              تجريبية للعرض
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {latestReviews.map((r) => (
              <div key={r.id} className="rounded-2xl border border-navy-100 bg-white p-6">
                <div className="flex items-center justify-between">
                  <Quote size={22} className="text-gold" />
                  <StarRow value={r.stars} />
                </div>
                <p className="mt-3 break-words text-sm leading-relaxed text-navy-800">
                  {r.comment}
                </p>
                <div className="mt-4 flex items-center gap-2.5 border-t border-navy-50 pt-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-navy-50 text-sm font-bold text-navy">
                    {reviewerDisplayName(r.customer_name).charAt(0)}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-navy">
                      {reviewerDisplayName(r.customer_name)}
                    </p>
                    <p className="text-[11px] text-purple">عن {r.target_name}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-navy px-6 py-14 text-center text-white">
          <div className="bg-arabesque absolute inset-0 opacity-[0.16]" />
          <div className="relative">
            <h2 className="text-3xl font-extrabold md:text-4xl">جاهز تختار عاملتك؟</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-white/75">
              تصفّح ملفات العاملات وجدول توفّرهن واختر طريقة التعاقد المناسبة لك.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/order/workers"
                className="btn-accent gap-2 rounded-xl px-8 py-3.5 text-base shadow-lg"
              >
                ابدأ التصفّح الآن <ChevronLeft size={18} />
              </Link>
              <a
                href={WA}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-8 py-3.5 text-base font-semibold text-white transition hover:bg-white/10"
              >
                واتساب
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-navy-900 py-14 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <div className="flex items-center gap-2.5">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-sm font-bold text-white">
                م
              </div>
              <p className="font-bold">{BRAND.client.nameAr}</p>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
              وجهتك الموثوقة لاستقدام العمالة المنزلية في المملكة بكل ثقة ووضوح.
            </p>
          </div>
          <div className="text-sm">
            <p className="mb-4 font-semibold">روابط</p>
            <ul className="space-y-3 text-white/65">
              <li>
                <a href="#services" className="transition hover:text-gold">
                  خدماتنا
                </a>
              </li>
              <li>
                <Link to="/order/workers" className="transition hover:text-gold">
                  العاملات
                </Link>
              </li>
              <li>
                <a href="#how" className="transition hover:text-gold">
                  كيف نعمل
                </a>
              </li>
              <li>
                <Link to="/login" className="transition hover:text-gold">
                  دخول الموظفين
                </Link>
              </li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="mb-4 font-semibold">تواصل</p>
            <ul className="space-y-3 text-white/65">
              <li className="flex items-center gap-2">
                <Phone size={15} className="text-gold" /> <span className="num">٩٢٠ ٠٠٠ ٠٠٠</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail size={15} className="text-gold" /> info@masiatalsharq.sa
              </li>
              <li className="flex items-center gap-2">
                <MapPin size={15} className="text-gold" /> {BRANCHES_AR.join(' · ')}
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-white/45">الهاتف والبريد بيانات تجريبية للعرض.</p>
          </div>
        </div>
        <div className="mx-auto mt-10 max-w-6xl border-t border-white/10 px-4 pt-6 text-center text-[11px] text-white/45">
          © <span className="num">٢٠٢٦</span> {BRAND.client.nameAr} · جميع الحقوق محفوظة
        </div>
      </footer>
    </div>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-gold-600">
      <span className="h-px w-6 bg-gold-600" /> {children}
    </span>
  );
}
