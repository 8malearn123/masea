import { useEffect } from 'react';
import type { PublicSiteInfo } from '@/features/site/types';

export const SITE_TITLE = 'ماسية الشرق للاستقدام | استقدام وتأجير العمالة المنزلية';
export const SITE_DESCRIPTION =
  'استقدام العمالة المنزلية وتأجيرها شهريًا ويوميًا وبالساعة — عرض سعر مكتوب، وعقد إلكتروني، ومتابعة لطلبك حتى تبدأ الخدمة.';

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * بيانات منظمة (schema.org) من البيانات الحقيقية فقط — ما لم يُدخله الإداري لا يُذكر.
 */
export function buildJsonLd(info: PublicSiteInfo, url: string): Record<string, unknown> {
  const c = info.company;
  const sameAs = [c.instagram_url, c.x_url, c.snapchat_url, c.tiktok_url, c.linkedin_url].filter(
    Boolean,
  );
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: c.display_name ?? 'ماسية الشرق للاستقدام',
    ...(c.legal_name ? { legalName: c.legal_name } : {}),
    url,
    description: SITE_DESCRIPTION,
    ...(c.phone ? { telephone: c.phone } : {}),
    ...(c.email ? { email: c.email } : {}),
    ...(c.address
      ? { address: { '@type': 'PostalAddress', streetAddress: c.address, addressCountry: 'SA' } }
      : {}),
    ...(c.founded_year ? { foundingDate: String(c.founded_year) } : {}),
    ...(c.hero_image_url?.startsWith('https://') ? { image: c.hero_image_url } : {}),
    ...(info.branches.length
      ? { areaServed: info.branches.map((b) => ({ '@type': 'City', name: b })) }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(info.services.length
      ? {
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: 'خدمات العمالة المنزلية',
            itemListElement: info.services.map((s) => ({
              '@type': 'Offer',
              itemOffered: { '@type': 'Service', name: s.name },
            })),
          },
        }
      : {}),
  };
}

/** عنوان الصفحة ووصفها وOpen Graph والبيانات المنظمة — تُعاد عند مغادرة الصفحة. */
export function useSiteSeo(info: PublicSiteInfo | undefined): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = SITE_TITLE;
    const url = `${window.location.origin}/`;
    setMeta('name', 'description', SITE_DESCRIPTION);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:locale', 'ar_SA');
    setMeta('property', 'og:title', SITE_TITLE);
    setMeta('property', 'og:description', SITE_DESCRIPTION);
    setMeta('property', 'og:url', url);
    setMeta('name', 'twitter:card', 'summary_large_image');
    const img = info?.company.hero_image_url;
    if (img?.startsWith('https://')) setMeta('property', 'og:image', img);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
    let ld: HTMLScriptElement | null = null;
    if (info) {
      ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.id = 'site-jsonld';
      document.getElementById('site-jsonld')?.remove();
      ld.textContent = JSON.stringify(buildJsonLd(info, url));
      document.head.appendChild(ld);
    }
    return () => {
      document.title = prevTitle;
      ld?.remove();
    };
  }, [info]);
}
