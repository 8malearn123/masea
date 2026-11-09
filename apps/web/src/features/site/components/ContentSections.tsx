import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import { ArtifactStack, DiamondArt, FacetImage } from '@/features/site/components/DiamondArt';
import { Reveal } from '@/features/site/components/Reveal';
import { faqs, promises, STEPS, visibleServices } from '@/features/site/lib/siteContent';
import type { PublicSiteInfo } from '@/features/site/types';

function SectionHead({
  index,
  kicker,
  title,
  lead,
  light = false,
}: {
  index: string;
  kicker: string;
  title: string;
  lead?: string;
  light?: boolean;
}) {
  return (
    <Reveal className="max-w-2xl">
      <p
        className={`flex items-center gap-3 text-xs font-semibold ${light ? 'text-gold' : 'text-gold-600'}`}
      >
        <span className="num">{index}</span>
        <span className={`h-px w-8 ${light ? 'bg-gold' : 'bg-gold-600'}`} />
        {kicker}
      </p>
      <h2
        className={`mt-4 text-3xl font-bold leading-tight sm:text-[2.6rem] ${light ? 'text-white' : 'text-navy-900'}`}
      >
        {title}
      </h2>
      {lead && (
        <p className={`mt-4 text-base leading-[1.9] ${light ? 'text-navy-100/80' : 'text-purple'}`}>
          {lead}
        </p>
      )}
    </Reveal>
  );
}

/* --------------------------------- الخدمات --------------------------------- */
/** فهرس تحريري مرقّم بدل بطاقات متكررة؛ كل خدمة بإجراء مباشر. */
export function ServicesSection({
  info,
  onRequest,
}: {
  info: PublicSiteInfo;
  onRequest: (service: string) => void;
}) {
  const list = visibleServices(info);
  return (
    <section
      id="services"
      aria-labelledby="services-title"
      className="scroll-mt-20 bg-white py-20 sm:py-28"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <div id="services-title">
          <SectionHead
            index="01"
            kicker="خدماتنا"
            title="أربع طرق لتصل الراحة إلى بيتك"
            lead="اختر ما يناسب احتياجك: عاملة باسمك، أو بعقد شهري، أو لأيام محددة، أو لزيارة بالساعة."
          />
        </div>
        <ol className="mt-14 border-t border-navy-900/90">
          {list.map((s, i) => {
            const Icon = s.icon;
            const fact = s.fact(info);
            return (
              <Reveal as="li" key={s.code} delay={i * 60}>
                <article className="group grid gap-6 border-b border-navy-100 py-10 transition-colors hover:bg-navy-50/60 sm:py-12 lg:grid-cols-12 lg:items-center lg:gap-10 lg:px-4">
                  <div className="flex items-start gap-5 lg:col-span-5">
                    <span className="num pt-1 text-sm text-gold-600">0{i + 1}</span>
                    <div>
                      <p className="text-xs font-semibold text-purple">{s.kicker}</p>
                      <h3 className="mt-1.5 text-2xl font-bold text-navy-900 sm:text-[1.9rem]">
                        {s.title}
                      </h3>
                      {fact && (
                        <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-navy">
                          <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
                          {fact}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="leading-[1.9] text-purple lg:col-span-4">{s.body}</p>
                  <div className="flex items-center gap-4 lg:col-span-3 lg:justify-end">
                    <span className="site-facet-sm hidden h-14 w-14 shrink-0 place-items-center bg-navy-50 text-navy transition group-hover:bg-navy group-hover:text-white lg:grid">
                      <Icon size={22} strokeWidth={1.6} />
                    </span>
                    <div className="flex flex-col items-start gap-2">
                      <button
                        type="button"
                        onClick={() => onRequest(s.code)}
                        className="group/btn inline-flex items-center gap-2 bg-navy px-5 py-3 text-sm font-semibold text-white transition hover:bg-navy-700"
                        aria-label={`اطلب خدمة ${s.title}`}
                      >
                        اطلب الخدمة
                        <ArrowLeft
                          size={16}
                          className="transition group-hover/btn:-translate-x-1"
                        />
                      </button>
                      {s.browse && (
                        <Link
                          to={s.browse}
                          className="site-link-line py-2 text-xs text-purple hover:text-navy"
                        >
                          تصفّح العاملات المتاحات
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------- لماذا نحن -------------------------------- */
export function WhySection({ info }: { info: PublicSiteInfo }) {
  const list = promises(info);
  return (
    <section
      id="why"
      aria-labelledby="why-title"
      className="scroll-mt-20 bg-navy-50 py-20 sm:py-28"
    >
      <div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-12 lg:px-10">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <p className="flex items-center gap-3 text-xs font-semibold text-gold-600">
              <span className="num">02</span>
              <span className="h-px w-8 bg-gold-600" />
              لماذا ماسية الشرق
            </p>
            <Reveal>
              <h2
                id="why-title"
                className="mt-5 text-3xl font-bold leading-[1.35] text-navy-900 sm:text-[2.5rem]"
              >
                إدخال شخص إلى بيتك قرار.
                <span className="block text-navy">لذلك جعلنا كل خطوة مكتوبة وواضحة.</span>
              </h2>
            </Reveal>
            <DiamondArt glint={false} className="mt-10 hidden h-44 w-44 opacity-60 lg:block" />
          </div>
        </div>
        <ul className="lg:col-span-7">
          {list.map((p, i) => (
            <Reveal
              as="li"
              key={p.title}
              delay={i * 70}
              className="border-t border-navy-200 py-8 first:border-t-0 first:pt-0"
            >
              <div className="flex gap-6">
                <span className="num w-8 shrink-0 pt-1 text-sm text-gold-600">0{i + 1}</span>
                <div>
                  <h3 className="text-xl font-bold text-navy-900">{p.title}</h3>
                  <p className="mt-2 max-w-lg leading-[1.9] text-purple">{p.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* -------------------------------- كيف نعمل -------------------------------- */
export function HowSection() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-20 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <div id="how-title">
          <SectionHead
            index="03"
            kicker="كيف نعمل"
            title="من طلبك إلى أول يوم خدمة"
            lead="أربع خطوات واضحة — تعرف في كل واحدة منها ما الذي سيحدث بعدها."
          />
        </div>
        <ol className="relative mt-16 grid gap-10 lg:grid-cols-4 lg:gap-8">
          {/* خط التسلسل: أفقي على الشاشات الكبيرة، عمودي على الجوال */}
          <span
            aria-hidden
            className="absolute right-[15px] top-2 h-[calc(100%-2rem)] w-px bg-navy-100 lg:hidden"
          />
          <span
            aria-hidden
            className="absolute inset-x-0 top-[15px] hidden h-px bg-navy-100 lg:block"
          />
          {STEPS.map((s, i) => (
            <Reveal
              as="li"
              key={s.title}
              delay={i * 100}
              className="relative pr-12 lg:pr-0 lg:pt-12"
            >
              <span className="num absolute right-0 top-0 grid h-[31px] w-[31px] rotate-45 place-items-center border border-navy bg-white text-xs font-semibold text-navy">
                <span className="-rotate-45">{i + 1}</span>
              </span>
              <h3 className="text-lg font-bold text-navy-900">{s.title}</h3>
              <p className="mt-2 leading-[1.85] text-purple">{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ----------------------------- التجربة المميزة ----------------------------- */
/** قسم تحريري غير متماثل يكسر نمط البطاقات: صورة كبيرة (أو قصّة الماسة) ونص متداخل. */
export function ExperienceSection({
  info,
  onRequest,
}: {
  info: PublicSiteInfo;
  onRequest: () => void;
}) {
  const img = info.company.experience_image_url;
  return (
    <section
      aria-labelledby="exp-title"
      className="relative overflow-hidden bg-navy-900 py-20 text-white sm:py-28"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:px-10">
        <Reveal className="relative order-2 lg:order-1 lg:col-span-6">
          {img ? (
            <FacetImage src={img} alt="تجربة ماسية الشرق" className="aspect-[5/4] w-full" />
          ) : (
            <ArtifactStack />
          )}
          <div className="absolute -bottom-6 left-4 max-w-[78%] bg-gold px-6 py-5 text-navy-900 sm:left-8">
            <p className="text-sm font-semibold leading-relaxed">
              «نفس البنود التي توافق عليها في عرض السعر، هي التي تجدها في عقدك.»
            </p>
            <p className="mt-2 text-xs opacity-80">مبدأ نعمل به في كل طلب</p>
          </div>
        </Reveal>
        <div className="order-1 lg:order-2 lg:col-span-5 lg:col-start-8">
          <Reveal>
            <p className="flex items-center gap-3 text-xs font-semibold text-gold">
              <span className="num">04</span>
              <span className="h-px w-8 bg-gold" />
              تجربة ماسية الشرق
            </p>
            <h2 id="exp-title" className="mt-5 text-3xl font-bold leading-[1.35] sm:text-[2.5rem]">
              هدوء من أول اتصال
              <br />
              حتى يستقرّ كل شيء.
            </h2>
          </Reveal>
          <dl className="mt-10 space-y-7">
            {[
              [
                'الاختيار',
                'تطّلع على ملف العاملة: مهنتها وخبرتها ولغاتها وتوفّرها، قبل أي التزام.',
              ],
              ['الاتفاق', 'عرض سعر مكتوب، ثم عقد بالبنود نفسها يوقّعه الطرفان إلكترونيًا.'],
              ['المتابعة', 'رقم مرجعي لطلبك، وفريق فرعك على تواصل معك حتى تبدأ الخدمة.'],
            ].map(([t, d], i) => (
              <Reveal
                key={t}
                delay={i * 90}
                className="grid grid-cols-[88px_1fr] gap-4 border-t border-white/10 pt-6"
              >
                <dt className="text-sm font-semibold text-gold">{t}</dt>
                <dd className="leading-[1.85] text-navy-100/85">{d}</dd>
              </Reveal>
            ))}
          </dl>
          <Reveal delay={300}>
            <button
              type="button"
              onClick={onRequest}
              className="group mt-10 inline-flex items-center gap-3 border-b border-gold py-2 text-base font-semibold text-white"
            >
              ابدأ طلبك الآن
              <ArrowLeft size={17} className="text-gold transition group-hover:-translate-x-1" />
            </button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- الأسئلة --------------------------------- */
export function FaqSection({ info }: { info: PublicSiteInfo }) {
  const list = faqs(info);
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-white py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:px-10">
        <div className="lg:col-span-4" id="faq-title">
          <SectionHead index="05" kicker="الأسئلة الشائعة" title="إجابات قبل أن تسأل" />
        </div>
        <div className="lg:col-span-8">
          {list.map((f, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={f.q} delay={i * 40} className="border-b border-navy-100">
                <h3>
                  <button
                    type="button"
                    id={`faq-q-${i}`}
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-6 py-6 text-right text-lg font-semibold text-navy-900 transition hover:text-navy"
                  >
                    {f.q}
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center border transition ${
                        isOpen ? 'border-navy bg-navy text-white' : 'border-navy-200 text-navy'
                      }`}
                    >
                      {isOpen ? <Minus size={15} /> : <Plus size={15} />}
                    </span>
                  </button>
                </h3>
                <div
                  id={`faq-a-${i}`}
                  role="region"
                  aria-labelledby={`faq-q-${i}`}
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                    isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="max-w-2xl pb-6 leading-[1.9] text-purple">
                      {f.a}{' '}
                      {f.link && (
                        <Link to={f.link.to} className="site-link-line font-semibold text-navy">
                          {f.link.label}
                        </Link>
                      )}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
