import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Phone, X } from 'lucide-react';
import { BrandMark } from '@/features/site/components/DiamondArt';
import { displayPhone } from '@/features/site/lib/webLead';

export const NAV: { href: string; label: string }[] = [
  { href: '#services', label: 'خدماتنا' },
  { href: '#why', label: 'لماذا نحن' },
  { href: '#how', label: 'كيف نعمل' },
  { href: '#faq', label: 'الأسئلة الشائعة' },
];

/** شريط علوي: شفاف فوق الافتتاحية الداكنة، أبيض عند التمرير؛ قائمة كاملة على الجوال. */
export function SiteHeader({
  name,
  phone,
  onRequest,
}: {
  name: string;
  phone: string | null;
  onRequest: () => void;
}) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSolid(window.scrollY > 24));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dark = !solid && !open;
  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
          dark
            ? 'bg-transparent text-white'
            : 'border-b border-navy-100 bg-white/95 text-navy-900 backdrop-blur'
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-10">
          <a href="#top" className="flex items-center gap-3" aria-label={`${name} — العودة للأعلى`}>
            <BrandMark size={40} light={dark} />
            <span className="text-[15px] font-bold leading-tight">{name}</span>
          </a>

          <nav aria-label="أقسام الصفحة" className="hidden items-center gap-8 text-sm lg:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="site-link-line pb-0.5 opacity-90 hover:opacity-100"
              >
                {n.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {phone && (
              <a
                href={`tel:${phone}`}
                className="hidden items-center gap-2 text-sm opacity-90 hover:opacity-100 md:inline-flex"
              >
                <Phone size={15} className="text-gold" />
                <span className="num" dir="ltr">
                  {displayPhone(phone)}
                </span>
              </a>
            )}
            <button
              type="button"
              onClick={onRequest}
              className={`hidden px-5 py-2.5 text-sm font-semibold transition sm:inline-flex ${
                dark
                  ? 'bg-white text-navy-900 hover:bg-gold hover:text-white'
                  : 'bg-navy text-white hover:bg-navy-700'
              }`}
            >
              اطلب خدمتك
            </button>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="site-mobile-menu"
              aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
              className="grid h-11 w-11 place-items-center lg:hidden"
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>
      {open && (
        <div
          id="site-mobile-menu"
          className="fixed inset-x-0 bottom-0 top-[68px] z-40 flex flex-col justify-between overflow-y-auto bg-white px-6 pb-8 pt-6 lg:hidden"
        >
          <nav aria-label="القائمة" className="flex flex-col">
            {NAV.map((n, i) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="flex items-baseline justify-between border-b border-navy-100 py-5 text-2xl font-bold text-navy-900"
              >
                {n.label}
                <span className="num text-xs font-normal text-gold-600">0{i + 1}</span>
              </a>
            ))}
            <Link
              to="/order/track"
              onClick={() => setOpen(false)}
              className="py-5 text-base text-purple"
            >
              تتبّع طلبك
            </Link>
          </nav>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRequest();
              }}
              className="w-full bg-navy py-4 text-base font-semibold text-white"
            >
              اطلب خدمتك الآن
            </button>
            {phone && (
              <a
                href={`tel:${phone}`}
                className="flex w-full items-center justify-center gap-2 border border-navy-200 py-4 text-base text-navy"
              >
                <Phone size={17} />{' '}
                <span className="num" dir="ltr">
                  {displayPhone(phone)}
                </span>
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
