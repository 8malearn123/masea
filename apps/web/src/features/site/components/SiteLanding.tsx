import { useCallback, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSiteInfo } from '@/features/site/hooks/useSite';
import { useSiteSeo } from '@/features/site/lib/seo';
import { SiteHeader } from '@/features/site/components/SiteHeader';
import { Hero, TrustBand } from '@/features/site/components/HeroSections';
import {
  ExperienceSection,
  FaqSection,
  HowSection,
  ServicesSection,
  WhySection,
} from '@/features/site/components/ContentSections';
import { FinalCta, MobileCtaBar, SiteFooter } from '@/features/site/components/ClosingSections';
import { BrandMark, DiamondArt } from '@/features/site/components/DiamondArt';

/**
 * صفحة الهبوط العامة لماسية الشرق (/). كل البيانات حقيقية ومُدارة (public_site_info)،
 * وكل زر «اطلب» يقود إلى نموذج يرسل الطلب فعليًا إلى خط المبيعات.
 */
export default function SiteLanding() {
  const { data: info, isLoading, isError, refetch } = useSiteInfo();
  useSiteSeo(info);
  const nameRef = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<{ service: string | null; key: number }>({
    service: null,
    key: 0,
  });

  const openRequest = useCallback((service?: string) => {
    if (service) setPreset((p) => ({ service, key: p.key + 1 }));
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById('request')
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => nameRef.current?.focus({ preventScroll: true }), reduce ? 0 : 650);
  }, []);

  if (isLoading || !info) {
    return (
      <div dir="rtl" className="grid min-h-screen place-items-center bg-navy-900 text-white">
        {isError ? (
          <div className="px-6 text-center">
            <BrandMark size={52} light />
            <p className="mt-5 text-lg font-semibold">تعذّر تحميل الصفحة</p>
            <p className="mt-2 text-sm text-navy-100/70">تحقّق من اتصالك ثم أعد المحاولة.</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-6 inline-flex items-center gap-2 bg-gold px-6 py-3 text-sm font-semibold text-navy-900"
            >
              <RefreshCw size={16} /> إعادة المحاولة
            </button>
          </div>
        ) : (
          <div role="status" aria-label="جارٍ التحميل" className="flex flex-col items-center">
            <DiamondArt className="h-24 w-24" />
          </div>
        )}
      </div>
    );
  }

  const name = info.company.display_name ?? 'ماسية الشرق للاستقدام';
  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-white font-sans text-navy-900 antialiased">
      <a
        href="#request"
        className="sr-only focus:not-sr-only focus:fixed focus:right-4 focus:top-4 focus:z-50 focus:bg-gold focus:px-4 focus:py-2 focus:text-navy-900"
      >
        انتقل إلى نموذج الطلب
      </a>
      <SiteHeader name={name} phone={info.company.phone} onRequest={() => openRequest()} />
      <main>
        <Hero info={info} name={name} onRequest={() => openRequest()} />
        <TrustBand info={info} />
        <ServicesSection info={info} onRequest={openRequest} />
        <WhySection info={info} />
        <HowSection />
        <ExperienceSection info={info} onRequest={() => openRequest()} />
        <FaqSection info={info} />
        <FinalCta ref={nameRef} info={info} presetService={preset.service} presetKey={preset.key} />
      </main>
      <SiteFooter info={info} name={name} />
      <MobileCtaBar info={info} onRequest={() => openRequest()} />
    </div>
  );
}
