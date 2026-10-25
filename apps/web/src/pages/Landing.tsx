import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BRAND, BRANCHES } from '@masiat/shared';
import { NAV } from '@/nav';
import {
  CreditCard,
  FileText,
  HardHat,
  LayoutDashboard,
  MapPin,
  Sparkles,
  Star,
  Users,
  Zap,
} from 'lucide-react';

/* ---------- helpers ---------- */
const toArabic = (s: number | string) =>
  String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)] ?? d);

function CountUp({
  to,
  suffix = '',
  duration = 1500,
}: {
  to: number;
  suffix?: string;
  duration?: number;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const tick = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setN(Math.round(to * eased));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref} className="num">
      {toArabic(n)}
      {suffix}
    </span>
  );
}

/* ---------- data ---------- */
const STATS = [
  { to: 1200, suffix: '+', label: 'عامل تحت الإدارة' },
  { to: 3500, suffix: '+', label: 'عقد مُنفّذ' },
  { to: 850, suffix: '+', label: 'عميل نشط' },
  { to: 4, suffix: '', label: 'فروع تشغيلية' },
];

const PILLARS = [
  {
    icon: Zap,
    title: 'إدارة العمليات',
    text: 'تتبّع العمالة والعقود والعملاء ورحلات السائقين لحظيًا من لوحة موحّدة.',
    cls: 'sm:col-span-2',
  },
  {
    icon: CreditCard,
    title: 'المالية والمدفوعات',
    text: 'فوترة وضريبة قيمة مضافة ومدفوعات إلكترونية وغرامات بشكل آلي.',
    cls: '',
  },
  {
    icon: Users,
    title: 'الموارد البشرية',
    text: 'رواتب وحضور واحتساب GOSI ومتابعة الأداء والأهداف.',
    cls: '',
  },
  {
    icon: Star,
    title: 'التسويق والولاء',
    text: 'حملات ونقاط ولاء وعروض ذكية لرفع تكرار الطلبات.',
    cls: 'sm:col-span-2',
  },
];

const STEPS = [
  { n: '١', title: 'سجّل دخولك', text: 'ادخل بحسابك أو جرّب أحد الحسابات التجريبية فورًا.' },
  { n: '٢', title: 'أدِر عملياتك', text: 'عمالة، عقود، عملاء، مالية وموارد بشرية في مكان واحد.' },
  { n: '٣', title: 'حلّل وقرّر', text: 'مؤشرات ورسوم بيانية لحظية تدعم قرارك التشغيلي.' },
];

const NAVLINKS = [
  { href: '#features', label: 'الوحدات' },
  { href: '#how', label: 'كيف يعمل' },
  { href: '#branches', label: 'الفروع' },
];

/* ---------- product mockup ---------- */
function DashboardMock() {
  const bars = [55, 80, 40, 95, 65, 75, 50];
  return (
    <div className="animate-float rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-black/5">
      <div className="flex gap-3">
        {/* sidebar */}
        <div className="hidden w-28 shrink-0 rounded-xl bg-navy p-3 sm:block">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-gold text-[10px] font-bold text-white">
              م
            </div>
            <span className="h-2 w-12 rounded bg-white/30" />
          </div>
          {[LayoutDashboard, HardHat, FileText, CreditCard, Star].map((E, i) => (
            <div
              key={i}
              className={`mb-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 ${i === 0 ? 'bg-white/15' : ''}`}
            >
              <E size={11} aria-hidden />
              <span className="h-1.5 w-10 rounded bg-white/25" />
            </div>
          ))}
        </div>
        {/* content */}
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between">
            <span className="h-3 w-24 rounded bg-navy-100" />
            <span className="h-6 w-6 rounded-full bg-teal-100" />
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[
              { c: 'text-navy', v: '١٢٠٠' },
              { c: 'text-teal', v: '٨٥٠' },
              { c: 'text-gold', v: '٣٫٥م' },
            ].map((k, i) => (
              <div key={i} className="rounded-lg bg-navy-50 p-2">
                <div className="h-1.5 w-8 rounded bg-navy-100" />
                <div className={`num mt-1.5 text-sm font-extrabold ${k.c}`}>{k.v}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-navy-50 p-3">
            <div className="mb-2 h-1.5 w-16 rounded bg-navy-100" />
            <div className="flex h-20 items-end justify-between gap-1.5">
              {bars.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-gradient-to-t from-navy to-purple"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- page ---------- */
export default function Landing() {
  return (
    <div className="min-h-screen bg-navy-50 text-navy-900">
      {/* Navbar */}
      <header className="sticky top-0 z-30 border-b border-navy-100/60 bg-white/75 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-lg font-bold text-white">
              م
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold">{BRAND.client.nameAr}</p>
              <p className="text-[11px] text-purple">نظام إدارة الموارد</p>
            </div>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-medium text-navy-900 md:flex">
            {NAVLINKS.map((l) => (
              <a key={l.href} href={l.href} className="transition hover:text-gold">
                {l.label}
              </a>
            ))}
          </nav>
          <Link to="/login" className="btn-primary">
            دخول النظام
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-navy text-white">
        <div className="bg-grid absolute inset-0 opacity-50" />
        <div
          className="animate-gradient pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(40% 50% at 85% 10%, rgba(200,151,10,0.55) 0%, transparent 60%), radial-gradient(45% 55% at 5% 90%, rgba(88,179,179,0.45) 0%, transparent 60%), radial-gradient(50% 50% at 50% 50%, rgba(86,78,133,0.35) 0%, transparent 70%)',
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:py-28 lg:grid-cols-2">
          <div className="animate-fade-up text-center lg:text-right">
            <span className="badge mb-5 bg-white/10 text-gold-100 ring-1 ring-white/20">
              منصّة الاستقدام الذكية · {BRAND.contract}
            </span>
            <h1 className="text-4xl font-extrabold leading-[1.15] md:text-5xl lg:text-6xl">
              أدِر منظومة الاستقدام
              <br />
              من{' '}
              <span className="bg-gradient-to-l from-gold to-teal bg-clip-text text-transparent">
                مكان واحد
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-md text-sm text-navy-100 md:text-base lg:mx-0">
              نظام ERP متكامل لـ{BRAND.client.nameAr} — عمالة وعقود ومالية وموارد بشرية وولاء،
              بتصميم عربي أنيق وأداء لحظي.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link to="/login" className="btn-gold px-7 py-3 text-base shadow-lg shadow-gold/20">
                ابدأ الآن مجانًا
              </Link>
              <a
                href="#features"
                className="btn px-7 py-3 text-base text-white ring-1 ring-white/30 hover:bg-white/10"
              >
                استكشف الوحدات
              </a>
            </div>
            <p className="mt-5 text-xs text-navy-100/80">
              <Sparkles size={12} aria-hidden className="me-1 inline align-[-1px]" /> جرّب فورًا
              بحساب تجريبي — بدون تسجيل
            </p>
          </div>

          <div className="animate-fade-up" style={{ animationDelay: '0.15s' }}>
            <DashboardMock />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto -mt-12 max-w-6xl px-4">
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-white p-5 shadow-card md:grid-cols-4 md:gap-4 md:p-7">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-2xl font-extrabold text-navy md:text-4xl">
                <CountUp to={s.to} suffix={s.suffix} />
              </p>
              <p className="mt-1 text-xs text-purple md:text-sm">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pillars (bento) */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="mx-auto max-w-xl text-center">
          <span className="text-sm font-semibold text-gold">قدرات متكاملة</span>
          <h2 className="mt-2 text-3xl font-bold md:text-4xl">كل ما تحتاجه إدارة الاستقدام</h2>
          <p className="mt-3 text-sm text-purple">
            أربع ركائز تجمع العمليات والمالية والموارد البشرية والتسويق في تجربة واحدة.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className={`card transition duration-300 hover:-translate-y-1 hover:shadow-xl ${p.cls}`}
            >
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-navy text-white">
                <p.icon size={22} aria-hidden />
              </div>
              <h3 className="mt-4 text-lg font-bold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-purple">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-xl text-center">
            <span className="text-sm font-semibold text-gold">ثلاث خطوات</span>
            <h2 className="mt-2 text-3xl font-bold md:text-4xl">ابدأ خلال دقائق</h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-navy text-xl font-extrabold text-gold">
                  {s.n}
                </div>
                <h3 className="mt-4 font-bold">{s.title}</h3>
                <p className="mx-auto mt-2 max-w-xs text-sm text-purple">{s.text}</p>
                {i < STEPS.length - 1 && (
                  <span
                    className="absolute top-7 hidden h-px w-full -translate-x-1/2 bg-navy-100 md:block"
                    style={{ right: '-50%' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules from NAV */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <div className="mx-auto max-w-xl text-center">
          <span className="text-sm font-semibold text-gold">+٢٠ وحدة</span>
          <h2 className="mt-2 text-3xl font-bold md:text-4xl">نظام واحد لكل أقسامك</h2>
          <p className="mt-3 text-sm text-purple">
            وحدات متكاملة منظّمة حسب مجالات العمل، بصلاحيات دقيقة لكل دور.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {NAV.map((group) => (
            <div key={group.title} className="card transition hover:shadow-lg">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
                <span className="h-2 w-2 rounded-full bg-gold" />
                {group.title}
              </h3>
              <ul className="space-y-2.5">
                {group.items.map((item) => (
                  <li key={item.to} className="flex items-center gap-3 text-sm">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-navy-50 text-navy">
                      <item.icon size={16} aria-hidden />
                    </span>
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Quote */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <div className="text-5xl text-gold">”</div>
          <p className="mt-2 text-xl font-bold leading-relaxed text-navy md:text-2xl">
            نظام أتمتة كامل صُمّم خصيصًا لإدارة الاستقدام — من أول عقد حتى آخر دفعة، بدقة واحترافية.
          </p>
          <p className="mt-6 text-sm text-purple">— فريق {BRAND.client.nameAr}</p>
        </div>
      </section>

      {/* Branches */}
      <section id="branches" className="mx-auto max-w-6xl px-4 py-20">
        <div className="relative overflow-hidden rounded-3xl bg-navy p-10 text-center text-white md:p-16">
          <div className="bg-grid absolute inset-0 opacity-40" />
          <div className="relative">
            <h2 className="text-3xl font-bold md:text-4xl">حضور تشغيلي عبر فروعنا</h2>
            <p className="mt-3 text-sm text-navy-100">
              شبكة فروع متكاملة لخدمة عملائنا أينما كانوا.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {BRANCHES.map((b) => (
                <span
                  key={b}
                  className="rounded-xl bg-white/10 px-6 py-3 text-sm font-semibold ring-1 ring-white/20 transition hover:bg-white/20"
                >
                  <MapPin size={14} aria-hidden className="me-1 inline align-[-2px]" /> {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="flex flex-col items-center gap-5 rounded-3xl bg-gradient-to-l from-gold to-gold-600 px-6 py-14 text-center text-white">
          <h2 className="text-3xl font-extrabold md:text-4xl">جاهز لتطوير إدارتك؟</h2>
          <p className="max-w-md text-sm text-white/90">
            سجّل دخولك الآن وابدأ بإدارة عمليات الاستقدام بكفاءة واحترافية.
          </p>
          <Link
            to="/login"
            className="btn bg-navy px-8 py-3 text-base text-white hover:bg-navy-900"
          >
            دخول النظام
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-navy-100 bg-white py-10">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-sm font-bold text-white">
                م
              </div>
              <p className="text-sm font-bold text-navy">{BRAND.client.nameAr}</p>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-purple">
              نظام ERP متكامل لإدارة الاستقدام والموارد البشرية والمالية.
            </p>
          </div>
          <div className="text-sm">
            <p className="mb-3 font-semibold text-navy">روابط</p>
            <ul className="space-y-2 text-purple">
              {NAVLINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="transition hover:text-gold">
                    {l.label}
                  </a>
                </li>
              ))}
              <li>
                <Link to="/login" className="transition hover:text-gold">
                  دخول النظام
                </Link>
              </li>
            </ul>
          </div>
          <div className="text-sm sm:text-left">
            <p className="mb-3 font-semibold text-navy">التطوير</p>
            <p className="text-xs text-purple">من تطوير {BRAND.vendor.nameAr}</p>
            <p className="num mt-1 text-xs text-purple">عقد {BRAND.contract}</p>
            <p className="num mt-4 text-[11px] text-navy-100">© ٢٠٢٦ — جميع الحقوق محفوظة</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
