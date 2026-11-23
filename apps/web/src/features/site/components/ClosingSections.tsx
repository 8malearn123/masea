import { forwardRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { BrandMark } from '@/features/site/components/DiamondArt';
import { Reveal } from '@/features/site/components/Reveal';
import { RequestForm } from '@/features/site/components/RequestForm';
import { NAV } from '@/features/site/components/SiteHeader';
import { visibleServices } from '@/features/site/lib/siteContent';
import { displayPhone, whatsappLink } from '@/features/site/lib/webLead';
import type { PublicSiteInfo } from '@/features/site/types';

/** الخاتمة: عنوان محفّز + نموذج الطلب + وسائل التواصل الرسمية المُدارة فقط. */
export const FinalCta = forwardRef<
  HTMLInputElement,
  { info: PublicSiteInfo; presetService: string | null; presetKey: number }
>(function FinalCta({ info, presetService, presetKey }, nameRef) {
  const c = info.company;
  return (
    <section
      id="request"
      aria-labelledby="request-title"
      className="scroll-mt-16 bg-navy-50 py-20 sm:py-28"
    >
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:gap-16 lg:px-10">
        <div className="lg:col-span-5">
          <Reveal>
            <p className="flex items-center gap-3 text-xs font-semibold text-gold-600">
              <span className="h-px w-8 bg-gold-600" />
              ابدأ الآن
            </p>
            <h2
              id="request-title"
              className="mt-5 text-3xl font-bold leading-[1.3] text-navy-900 sm:text-[2.7rem]"
            >
              أخبرنا ما يحتاجه بيتك،
              <span className="block text-navy">ونحن نتولّى الباقي.</span>
            </h2>
            <p className="mt-5 max-w-md leading-[1.9] text-purple">
              أرسل طلبك في أقل من دقيقة، ويتواصل معك فريق أقرب فرع لترتيب الخيارات المتاحة وعرض
              السعر.
            </p>
          </Reveal>
          {(c.phone || c.whatsapp || c.email || c.working_hours) && (
            <Reveal delay={120}>
              <ul className="mt-10 space-y-4 border-t border-navy-200 pt-8 text-sm">
                {c.phone && (
                  <li>
                    <a
                      href={`tel:${c.phone}`}
                      className="flex items-center gap-3 text-navy-900 hover:text-navy"
                    >
                      <Phone size={17} className="text-gold-600" />
                      <span className="num text-base" dir="ltr">
                        {displayPhone(c.phone)}
                      </span>
                    </a>
                  </li>
                )}
                {c.whatsapp && (
                  <li>
                    <a
                      href={whatsappLink(c.whatsapp, 'السلام عليكم، أرغب في الاستفسار عن خدماتكم.')}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 text-navy-900 hover:text-navy"
                    >
                      <MessageCircle size={17} className="text-gold-600" /> تواصل عبر واتساب
                    </a>
                  </li>
                )}
                {c.email && (
                  <li>
                    <a
                      href={`mailto:${c.email}`}
                      className="flex items-center gap-3 text-navy-900 hover:text-navy"
                    >
                      <Mail size={17} className="text-gold-600" />
                      <span dir="ltr">{c.email}</span>
                    </a>
                  </li>
                )}
                {c.working_hours && (
                  <li className="flex items-center gap-3 text-purple">
                    <Clock size={17} className="text-gold-600" /> {c.working_hours}
                  </li>
                )}
              </ul>
            </Reveal>
          )}
        </div>
        <Reveal delay={80} className="lg:col-span-7">
          <div className="site-facet-sm bg-white p-6 shadow-[0_30px_80px_-40px_rgba(14,26,43,0.45)] sm:p-10">
            <RequestForm
              ref={nameRef}
              info={info}
              presetService={presetService}
              presetKey={presetKey}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
});

/* ---------------------------------- التذييل ---------------------------------- */
export function SiteFooter({ info, name }: { info: PublicSiteInfo; name: string }) {
  const c = info.company;
  const socials = [
    ['إنستغرام', c.instagram_url],
    ['إكس', c.x_url],
    ['سناب شات', c.snapchat_url],
    ['تيك توك', c.tiktok_url],
    ['لينكدإن', c.linkedin_url],
  ].filter((s): s is [string, string] => Boolean(s[1]));
  const year = new Date().getFullYear();
  return (
    <footer className="bg-navy-900 pb-28 pt-16 text-navy-100/80 sm:pb-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <div className="grid gap-12 border-b border-white/10 pb-12 md:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="flex items-center gap-3 text-white">
              <BrandMark size={46} />
              <div>
                <p className="text-base font-bold">{name}</p>
                {c.legal_name && c.legal_name !== name && (
                  <p className="text-xs text-navy-100/60">{c.legal_name}</p>
                )}
              </div>
            </div>
            <p className="mt-5 max-w-xs text-sm leading-[1.9]">
              استقدام وتأجير العمالة المنزلية — شهريًا ويوميًا وبالساعة.
            </p>
            {info.branches.length > 0 && (
              <p className="mt-4 flex items-start gap-2 text-sm">
                <MapPin size={15} className="mt-1 shrink-0 text-gold" />
                {info.branches.join(' · ')}
              </p>
            )}
            {c.address && <p className="mt-2 text-sm">{c.address}</p>}
            {c.maps_url && (
              <a
                href={c.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="site-link-line mt-2 inline-block text-sm text-gold"
              >
                الموقع على الخريطة
              </a>
            )}
          </div>
          <nav aria-label="روابط الأقسام" className="lg:col-span-2">
            <p className="text-xs font-semibold text-white">الصفحة</p>
            <ul className="mt-5 space-y-3 text-sm">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="site-link-line hover:text-white">
                    {n.label}
                  </a>
                </li>
              ))}
              <li>
                <a href="#request" className="site-link-line hover:text-white">
                  اطلب خدمتك
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-label="الخدمات" className="lg:col-span-3">
            <p className="text-xs font-semibold text-white">الخدمات</p>
            <ul className="mt-5 space-y-3 text-sm">
              {visibleServices(info).map((s) => (
                <li key={s.code}>
                  <a href="#services" className="site-link-line hover:text-white">
                    {s.title}
                  </a>
                </li>
              ))}
              <li>
                <Link to="/order/workers" className="site-link-line hover:text-white">
                  تصفّح العاملات
                </Link>
              </li>
              <li>
                <Link to="/order/track" className="site-link-line hover:text-white">
                  تتبّع طلبك
                </Link>
              </li>
            </ul>
          </nav>
          <div className="lg:col-span-3">
            <p className="text-xs font-semibold text-white">تواصل</p>
            <ul className="mt-5 space-y-3 text-sm">
              {c.phone && (
                <li>
                  <a href={`tel:${c.phone}`} className="num hover:text-white" dir="ltr">
                    {displayPhone(c.phone)}
                  </a>
                </li>
              )}
              {c.email && (
                <li>
                  <a href={`mailto:${c.email}`} className="hover:text-white" dir="ltr">
                    {c.email}
                  </a>
                </li>
              )}
              {socials.map(([label, url]) => (
                <li key={label}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="site-link-line hover:text-white"
                  >
                    {label}
                  </a>
                </li>
              ))}
              {!c.phone && !c.email && socials.length === 0 && (
                <li>
                  <a href="#request" className="site-link-line text-gold">
                    أرسل طلبك وسيتواصل معك فريقنا
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-4 pt-8 text-xs text-navy-100/60 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © <span className="num">{year}</span> {c.legal_name ?? name}
            {c.cr_number && (
              <>
                {' '}
                · سجل تجاري <span className="num">{c.cr_number}</span>
              </>
            )}
            {c.vat_number && (
              <>
                {' '}
                · الرقم الضريبي <span className="num">{c.vat_number}</span>
              </>
            )}
          </p>
          <div className="flex items-center gap-5">
            {c.privacy_url && (
              <a
                href={c.privacy_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
              >
                سياسة الخصوصية
              </a>
            )}
            {c.terms_url && (
              <a
                href={c.terms_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
              >
                الشروط والأحكام
              </a>
            )}
            <Link to="/login" className="hover:text-white">
              دخول الموظفين
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------- شريط الطلب الثابت على الجوال ------------------------- */
/** يظهر بعد تجاوز الافتتاحية ويختفي عند الوصول للنموذج. */
export function MobileCtaBar({ info, onRequest }: { info: PublicSiteInfo; onRequest: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const form = document.getElementById('request');
        const formTop = form ? form.getBoundingClientRect().top : Infinity;
        setShow(window.scrollY > window.innerHeight * 0.6 && formTop > window.innerHeight * 0.8);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    const phone = window.matchMedia?.('(max-width: 639px)').matches ?? true;
    document.documentElement.style.setProperty('--site-cta-offset', show && phone ? '76px' : '0px');
    return () => {
      document.documentElement.style.removeProperty('--site-cta-offset');
    };
  }, [show]);
  const wa = info.company.whatsapp;
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-navy-100 bg-white/95 p-3 backdrop-blur transition-transform duration-300 sm:hidden ${
        show ? 'translate-y-0' : 'translate-y-full'
      }`}
      aria-hidden={!show}
    >
      <button
        type="button"
        tabIndex={show ? 0 : -1}
        onClick={onRequest}
        className="flex-1 bg-navy py-3.5 text-sm font-semibold text-white"
      >
        اطلب خدمتك الآن
      </button>
      {wa && (
        <a
          tabIndex={show ? 0 : -1}
          href={whatsappLink(wa, 'السلام عليكم، أرغب في الاستفسار عن خدماتكم.')}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="تواصل عبر واتساب"
          className="grid w-14 place-items-center bg-[#1f8f4e] text-white"
        >
          <MessageCircle size={20} />
        </a>
      )}
    </div>
  );
}
