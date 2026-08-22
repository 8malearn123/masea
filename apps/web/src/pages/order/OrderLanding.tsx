import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  Clock,
  Headset,
  Mail,
  MapPin,
  Phone,
  Plane,
  Quote,
  RefreshCw,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Star,
  Truck,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { flagFor } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { fallbackPrice } from '@/shared/lib/pricing';
import type { ServiceCode } from '@/lib/funnel';
import { useServices } from '@/hooks/useServices';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { ratingOf, SERVICE_UNIT } from '@/features/catalog/lib/catalog';

const SERVICE_ICON: Record<string, LucideIcon> = {
  recruitment: Plane,
  monthly_rental: CalendarDays,
  daily_rental: Sparkles,
  sponsorship_transfer: Repeat2,
};

const STEPS: { title: string; text: string }[] = [
  { title: 'تصفّح العاملات', text: 'استخدم الفلاتر لإيجاد العاملة الأنسب لاحتياج بيتك.' },
  { title: 'اختر الخدمة', text: 'استقدام، تأجير شهري أو يومي، أو نقل كفالة.' },
  { title: 'ادفع بأمان', text: 'سعر شفّاف بالكامل وطرق دفع موثوقة.' },
  { title: 'استلم العاملة', text: 'نتابع معك حتى الوصول مع ضمان الاستبدال.' },
];

const TRUST_STRIP: { icon: LucideIcon; title: string; sub: string }[] = [
  { icon: Star, title: '٩٨٪', sub: 'رضا العملاء' },
  { icon: RefreshCw, title: 'ضمان استبدال', sub: '٩٠ يوم' },
  { icon: BadgeCheck, title: 'موثّقة رسمياً', sub: 'وثائق وفحص طبي' },
  { icon: ShieldCheck, title: 'دفع آمن', sub: 'طرق موثوقة' },
  { icon: Clock, title: 'إجراءات سريعة', sub: 'متابعة كاملة' },
  { icon: Headset, title: 'دعم ٢٤/٧', sub: 'في كل خطوة' },
];

const WHY: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: BadgeCheck,
    title: 'موثّقة بالكامل',
    text: 'جوازات وعقود وفحوصات طبية موثّقة رسمياً قبل عرض أي عاملة.',
  },
  {
    icon: RefreshCw,
    title: 'ضمان استبدال ٩٠ يوم',
    text: 'إن لم تكن العاملة مناسبة، نستبدلها مجاناً.',
  },
  { icon: Truck, title: 'إجراءات سريعة', text: 'نختصر الإجراءات ونتابع التأشيرات حتى الوصول.' },
  { icon: Headset, title: 'دعم ٢٤/٧', text: 'فريق متاح لمتابعة طلبك في كل وقت.' },
  {
    icon: Wallet,
    title: 'أسعار شفّافة',
    text: 'الأساسي والضريبة والإجمالي واضحة قبل الدفع — لا رسوم خفية.',
  },
];

const TESTIMONIALS: { name: string; city: string; text: string }[] = [
  {
    name: 'أبو فيصل',
    city: 'الرياض',
    text: 'تجربة مريحة من التصفّح للاستلام. شفنا الفيديو والخبرة قبل الاختيار، والعاملة وصلت بسرعة.',
  },
  {
    name: 'نورة العتيبي',
    city: 'جدة',
    text: 'أكثر شي عجبني وضوح الأسعار من البداية، ما في رسوم مفاجئة. وضمان الاستبدال أعطاني راحة بال.',
  },
  {
    name: 'محمد الدوسري',
    city: 'الدمام',
    text: 'استأجرت عاملة شهرياً لظروف مؤقتة، الإجراءات بسيطة والدعم متجاوب. أنصح فيهم.',
  },
];

const WA = 'https://wa.me/966920000000';

function priceFrom(code: string): number {
  return fallbackPrice(code as ServiceCode, { quantity: 1 }).total;
}

export default function OrderLanding() {
  const { data: services = [] } = useServices();
  const { data: workers = [] } = useWorkerProfiles(8);

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
              مباشر · <span className="num">٢٠٠٠+</span> عاملة متاحة الآن
            </span>
            <h1 className="text-3xl font-bold leading-snug tracking-tight [text-wrap:balance] md:text-5xl md:leading-[1.25]">
              استقدام تختار فيه <span className="text-gold">بنفسك</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-white/75 md:text-base lg:mx-0">
              تصفّح ملفات موثّقة بالفيديو والخبرة والتقييم، واختر طريقة التعاقد التي تناسبك — كل شيء
              بشفافية ووضوح.
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
            {workers[0] && (
              <div className="w-full max-w-xs rounded-3xl border border-white/10 bg-white/95 p-4 text-navy-900 shadow-2xl">
                <div className="flex items-center gap-3">
                  <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-navy-50 text-navy">
                    <UserRound size={26} />
                    <span className="absolute -bottom-1 -left-1 text-lg leading-none">
                      {flagFor(workers[0].nationality)}
                    </span>
                  </span>
                  <div className="flex-1">
                    <p className="font-bold text-navy">{workers[0].full_name}</p>
                    <p className="text-[11px] text-purple">
                      {workers[0].profession} ·{' '}
                      <span className="num">{workers[0].experience_years}</span> سنوات خبرة
                    </p>
                  </div>
                  <span className="num inline-flex items-center gap-0.5 text-xs font-bold text-gold-600">
                    <Star size={12} className="fill-current" /> {ratingOf(workers[0]).toFixed(1)}
                  </span>
                </div>
                <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-1 text-[11px] font-bold text-teal">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal" /> متاحة الآن
                </span>
                <Link
                  to={`/order/workers/${workers[0].id}`}
                  className="mt-3 block rounded-xl bg-navy py-2.5 text-center text-sm font-bold text-white transition hover:bg-navy-700"
                >
                  عرض الملف
                </Link>
              </div>
            )}
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5">
              <div className="flex -space-x-3 -space-x-reverse">
                {['إندونيسيا', 'الفلبين', 'كينيا', 'إثيوبيا'].map((n) => (
                  <span
                    key={n}
                    title={n}
                    className="grid h-8 w-8 place-items-center rounded-full border-2 border-navy bg-white text-base leading-none"
                  >
                    {flagFor(n)}
                  </span>
                ))}
                <span className="num grid h-8 w-8 place-items-center rounded-full border-2 border-navy bg-gold text-[11px] font-bold text-white">
                  +٨
                </span>
              </div>
              <p className="text-xs text-white/80">
                <span className="num">١٢</span> جنسية مختلفة · مهارات متنوّعة
              </p>
            </div>
          </div>
        </div>

        {/* trust strip */}
        <div className="relative border-t border-white/10 bg-navy-900/40">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
            {TRUST_STRIP.map((t) => (
              <div key={t.title} className="flex items-center gap-2.5 px-2 py-1.5">
                <t.icon size={20} className="shrink-0 text-gold" />
                <div className="leading-tight">
                  <p className="num text-sm font-bold text-white">{t.title}</p>
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
            const Icon = SERVICE_ICON[s.code] ?? Plane;
            const featured = s.code === 'recruitment';
            const unit = SERVICE_UNIT[s.code as ServiceCode] ?? '';
            return (
              <div
                key={s.code}
                className={`group relative flex flex-col rounded-2xl border bg-white p-6 transition hover:-translate-y-1 hover:shadow-xl ${featured ? 'border-gold ring-1 ring-gold/30' : 'border-navy-100 hover:border-navy'}`}
              >
                {featured && (
                  <span className="absolute -top-3 right-5 rounded-full bg-gold px-3 py-1 text-[11px] font-bold text-white">
                    ★ الأكثر طلباً
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
                  <span className="absolute -bottom-1 -left-1 text-base leading-none">
                    {flagFor(w.nationality)}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-navy">{w.full_name}</p>
                  <p className="text-[11px] text-purple">
                    {w.profession} · {w.nationality}
                  </p>
                </div>
                <span className="num inline-flex items-center gap-0.5 text-xs font-bold text-gold-600">
                  <Star size={11} className="fill-current" /> {ratingOf(w).toFixed(1)}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-navy-50 pt-3">
                <span className="rounded-lg bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal">
                  متاحة
                </span>
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
            {WHY.map((t) => (
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

      {/* Testimonials */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center">
          <Eyebrow>آراء العملاء</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold text-navy-900 md:text-4xl">عائلات وثقت بنا</h2>
          <p className="mt-3 text-sm text-purple">
            <span className="num">٣٢٠٠+</span> تقييم
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="rounded-2xl border border-navy-100 bg-white p-6">
              <Quote size={22} className="text-gold" />
              <p className="mt-3 text-sm leading-relaxed text-navy-800">{t.text}</p>
              <div className="mt-4 flex items-center gap-2.5 border-t border-navy-50 pt-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-navy-50 text-sm font-bold text-navy">
                  {t.name.charAt(0)}
                </span>
                <div>
                  <p className="text-sm font-bold text-navy">{t.name}</p>
                  <p className="text-[11px] text-purple">{t.city}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-navy px-6 py-14 text-center text-white">
          <div className="bg-arabesque absolute inset-0 opacity-[0.16]" />
          <div className="relative">
            <h2 className="text-3xl font-extrabold md:text-4xl">جاهز تختار عاملتك؟</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-white/75">
              تصفّح أكثر من <span className="num">٢٠٠٠</span> عاملة موثّقة واختر طريقة التعاقد
              المناسبة لك اليوم.
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
                <MapPin size={15} className="text-gold" /> الرياض، السعودية
              </li>
            </ul>
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
