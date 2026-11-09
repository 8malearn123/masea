import { ArrowDown, ArrowLeft, MapPin } from 'lucide-react';
import { DiamondArt, FacetImage, HeroArt } from '@/features/site/components/DiamondArt';
import { Reveal } from '@/features/site/components/Reveal';
import { hoursRange } from '@/features/site/lib/siteContent';
import type { PublicSiteInfo } from '@/features/site/types';

/**
 * الافتتاحية: من نحن، ماذا نقدّم، وكيف تطلب — في أول خمس ثوانٍ. تكوين تحريري غير
 * متماثل: العنوان الكبير مقابل قصّة الماسة (أو صورة الشركة الحقيقية إن رُفعت).
 */
export function Hero({
  info,
  name,
  onRequest,
}: {
  info: PublicSiteInfo;
  name: string;
  onRequest: () => void;
}) {
  const services = info.services.map((s) => s.name);
  const branches = info.branches;
  return (
    <section
      id="top"
      aria-labelledby="hero-title"
      className="relative overflow-hidden bg-navy-900 text-white"
    >
      {/* شبكة خطوط رفيعة — عمق بلا ضجيج */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to left, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '96px 96px',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-navy/40 blur-[120px]"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-28 sm:px-6 sm:pb-20 sm:pt-32 lg:min-h-[92vh] lg:grid-cols-12 lg:gap-8 lg:px-10 lg:pb-24">
        <div className="lg:col-span-7">
          <Reveal>
            <p className="flex items-center gap-3 text-xs font-medium text-gold">
              <span className="h-px w-10 bg-gold" />
              استقدام · تأجير شهري · يومي · بالساعة
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h1
              id="hero-title"
              className="mt-6 text-[2.5rem] font-extrabold leading-[1.32] sm:text-6xl sm:leading-[1.3] lg:text-[4.4rem]"
            >
              راحة بيتك
              <br />
              تبدأ <span className="text-gold">باختيار صحيح.</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 max-w-xl text-base leading-[1.9] text-navy-100/85 sm:text-lg">
              نوفّر العمالة المنزلية عبر الاستقدام، والتأجير الشهري واليومي وبالساعة — بعرض سعر
              مكتوب قبل أن تلتزم، وعقد واضح، ومتابعة لطلبك حتى تبدأ الخدمة.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onRequest}
                className="group inline-flex items-center justify-center gap-3 bg-gold px-7 py-4 text-base font-semibold text-navy-900 transition hover:bg-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
              >
                اطلب خدمتك الآن
                <ArrowLeft size={18} className="transition group-hover:-translate-x-1" />
              </button>
              <a
                href="#services"
                className="inline-flex items-center justify-center gap-2 border border-white/30 px-7 py-4 text-base font-medium text-white transition hover:border-white hover:bg-white/5"
              >
                اكتشف خدماتنا
                <ArrowDown size={17} />
              </a>
            </div>
          </Reveal>
          {(services.length > 0 || branches.length > 0) && (
            <Reveal delay={320}>
              <dl className="mt-12 grid max-w-xl grid-cols-2 gap-6 border-t border-white/10 pt-6 text-sm">
                {services.length > 0 && (
                  <div>
                    <dt className="text-xs text-navy-100/60">خدماتنا</dt>
                    <dd className="mt-1.5 leading-relaxed text-white/90">{services.join(' · ')}</dd>
                  </div>
                )}
                {branches.length > 0 && (
                  <div>
                    <dt className="text-xs text-navy-100/60">فروعنا</dt>
                    <dd className="mt-1.5 flex items-start gap-1.5 leading-relaxed text-white/90">
                      <MapPin size={14} className="mt-1 shrink-0 text-gold" />
                      {branches.join(' · ')}
                    </dd>
                  </div>
                )}
              </dl>
            </Reveal>
          )}
        </div>

        <div className="relative lg:col-span-5">
          <Reveal delay={200} className="relative mx-auto aspect-[4/5] w-full max-w-[460px]">
            {info.company.hero_image_url ? (
              <>
                <FacetImage
                  src={info.company.hero_image_url}
                  alt={`${name} — خدمة العمالة المنزلية`}
                  eager
                  className="h-full w-full"
                />
                <DiamondArt className="site-drift pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 opacity-90" />
              </>
            ) : (
              <HeroArt />
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

interface Fact {
  value: string;
  label: string;
  note?: string | undefined;
}

/** شريط الثقة: أرقام من النظام فقط — ما لا تتوفّر قيمته لا يظهر. */
export function TrustBand({ info }: { info: PublicSiteInfo }) {
  const facts: Fact[] = [];
  // سنوات الخبرة أولًا متى أدخل الإداري سنة التأسيس
  const year = info.company.founded_year;
  if (year) {
    const years = new Date().getFullYear() - year;
    if (years > 0)
      facts.push({ value: String(years), label: 'سنوات من الخبرة', note: `منذ ${year}` });
  }
  if (info.branches.length)
    facts.push({
      value: String(info.branches.length),
      label: 'فروع تخدمك',
      note: info.branches.join('، '),
    });
  if (info.services.length)
    facts.push({
      value: String(info.services.length),
      label: 'خدمات منزلية',
      note: 'من الاستقدام إلى الساعة',
    });
  if (info.nationalities > 0)
    facts.push({
      value: String(info.nationalities),
      label: 'جنسيات متاحة',
      note: 'في ملفات العاملات الحالية',
    });
  const hours = hoursRange(info);
  if (info.hourly_min_hours && info.hourly_max_hours)
    facts.push({
      value: `${info.hourly_min_hours}–${info.hourly_max_hours}`,
      label: 'ساعة للزيارة الواحدة',
      note: hours ? 'في التأجير بالساعة' : undefined,
    });
  if (!facts.length) return null;
  return (
    <section aria-label="ماسية الشرق بالأرقام" className="border-b border-navy-100 bg-white">
      <div className="mx-auto grid max-w-7xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4 lg:px-10">
        {facts.slice(0, 4).map((f, i) => (
          <Reveal
            key={f.label}
            delay={i * 80}
            className={`py-9 sm:py-11 ${i % 2 === 1 ? 'border-r border-navy-100 pr-5 sm:pr-8' : 'pl-5'} ${
              i >= 2 ? 'border-t border-navy-100 lg:border-t-0' : ''
            } ${i > 0 ? 'lg:border-r lg:pr-8' : ''}`}
          >
            <p className="num text-4xl font-semibold text-navy-900 sm:text-5xl">{f.value}</p>
            <p className="mt-2 text-sm font-semibold text-navy-800">{f.label}</p>
            {f.note && <p className="mt-1 text-xs leading-relaxed text-purple">{f.note}</p>}
          </Reveal>
        ))}
      </div>
    </section>
  );
}
