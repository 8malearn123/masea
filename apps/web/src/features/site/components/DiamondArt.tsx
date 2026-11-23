/**
 * «ماسية» = ماسة: قصّة ماسة هندسية بخطوط ذهبية رفيعة — عمل فني أصلي (SVG) بدل صور
 * مخزون، خفيف ولا يُكسر. يحلّ محلّه تلقائيًا ما يرفعه الإداري من صور حقيقية للشركة.
 */
export function DiamondArt({
  className = '',
  glint = true,
}: {
  className?: string;
  glint?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 400 400"
      className={className}
      role="img"
      aria-label="قصّة ماسة — هوية ماسية الشرق"
    >
      <defs>
        <linearGradient id="dg-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f58a8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0e1a2b" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="dg-gold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c9a24a" stopOpacity="0.25" />
          <stop offset="0.5" stopColor="#e8b23a" />
          <stop offset="1" stopColor="#c9a24a" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinejoin="round">
        {/* التاج */}
        <path d="M120 120 L200 70 L280 120 L330 160 L70 160 Z" fill="url(#dg-face)" />
        {/* الجناح */}
        <path d="M70 160 L200 340 L330 160 Z" fill="url(#dg-face)" opacity="0.7" />
        <g stroke="#c9a24a" strokeOpacity="0.55" strokeWidth="1">
          <path d="M70 160 L120 120 L200 70 L280 120 L330 160 L200 340 Z" />
          <path d="M70 160 H330" />
          <path d="M120 120 L160 160 L200 70 L240 160 L280 120" />
          <path d="M160 160 L200 340 L240 160" />
          <path d="M120 120 L115 160 M280 120 L285 160" />
          <path d="M115 160 L200 340 L285 160" strokeOpacity="0.3" />
        </g>
        {glint && (
          <path
            className="site-glint"
            d="M70 160 L120 120 L200 70 L280 120 L330 160"
            stroke="url(#dg-gold)"
            strokeWidth="2"
          />
        )}
      </g>
    </svg>
  );
}

/** صورة داخل إطار مقصوص بزوايا الماسة، مع خطوط الهوية فوقها. */
export function FacetImage({
  src,
  alt,
  className = '',
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <div className={`site-facet relative overflow-hidden bg-navy-800 ${className}`}>
      <img
        src={src}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        {...(eager ? { fetchPriority: 'high' as const } : {})}
        className="h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-900/40 via-transparent to-transparent" />
    </div>
  );
}

/** علامة ماسية الشرق الحالية (حرف «م» بلون الهوية — نفس علامة الموقع والأيقونة). */
export function BrandMark({ size = 44, light = false }: { size?: number; light?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-2xl font-bold ring-1 ring-gold/50 ${
        light ? 'bg-white text-navy' : 'bg-navy text-white'
      }`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      م
    </span>
  );
}

/**
 * تكوين الافتتاحية بلا صورة: ماسة كبيرة داخل إطارات مثمّنة متتالية، وبطاقتان صغيرتان
 * بآليتين حقيقيتين في الخدمة (عرض السعر المكتوب، والعقد الموقّع).
 */
export function HeroArt() {
  return (
    <div className="relative h-full w-full">
      <div className="site-facet absolute inset-0 border border-white/10 bg-gradient-to-b from-navy-800 via-navy-900 to-navy-900" />
      <svg aria-hidden viewBox="0 0 400 500" className="absolute inset-0 h-full w-full">
        {[0, 1, 2].map((i) => {
          const m = 34 + i * 30;
          const w = 400 - m * 2;
          const h = 500 - m * 2;
          const c = Math.min(w, h) * 0.14;
          return (
            <polygon
              key={i}
              fill="none"
              stroke="#c9a24a"
              strokeOpacity={0.22 - i * 0.05}
              points={`${m + c},${m} ${m + w - c},${m} ${m + w},${m + c} ${m + w},${m + h - c} ${m + w - c},${m + h} ${m + c},${m + h} ${m},${m + h - c} ${m},${m + c}`}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <DiamondArt className="site-drift w-[82%]" />
      </div>
      <div className="absolute -right-3 top-[14%] w-44 bg-white px-4 py-3 text-navy-900 shadow-2xl sm:-right-8">
        <p className="text-[11px] text-purple">عرض سعر مكتوب</p>
        <div className="mt-2 space-y-1.5">
          <span className="block h-1.5 w-full bg-navy-100" />
          <span className="block h-1.5 w-4/5 bg-navy-100" />
          <span className="block h-1.5 w-3/5 bg-navy-100" />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-navy-100 pt-2">
          <span className="text-[11px] font-semibold">الإجمالي</span>
          <span className="h-2 w-14 bg-gold" />
        </div>
      </div>
      <div className="absolute -left-3 bottom-[12%] w-48 bg-navy px-4 py-3 text-white shadow-2xl sm:-left-8">
        <p className="text-[11px] text-navy-100/80">عقد إلكتروني</p>
        <svg aria-hidden viewBox="0 0 160 36" className="mt-1 h-8 w-full">
          <path
            d="M6 26 C 20 6, 30 34, 44 18 S 66 8, 74 22 S 98 30, 110 14 S 140 20, 154 10"
            fill="none"
            stroke="#e8b23a"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <p className="mt-1 border-t border-white/15 pt-1.5 text-[11px] text-navy-100/80">
          موقّع من الطرفين
        </p>
      </div>
    </div>
  );
}

/**
 * قسم التجربة بلا صورة: مراحل حقيقية في النظام كأوراق متراكبة — عرض السعر، العقد،
 * والرقم المرجعي للطلب. رسم توضيحي بلا بيانات.
 */
export function ArtifactStack() {
  return (
    <div className="site-facet relative aspect-[5/4] w-full overflow-hidden bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900">
      <DiamondArt glint={false} className="absolute -left-10 -top-10 h-56 w-56 opacity-40" />
      <div className="absolute left-[12%] top-[16%] w-[46%] -rotate-6 bg-white p-4 text-navy-900 shadow-2xl">
        <p className="text-xs font-semibold">عرض السعر</p>
        <div className="mt-3 space-y-2">
          {['السعر الأساسي', 'الخصم', 'الضريبة'].map((l, i) => (
            <div
              key={l}
              className="flex items-center justify-between gap-2 text-[10px] text-purple"
            >
              <span>{l}</span>
              <span className={`h-1.5 bg-navy-100 ${['w-12', 'w-8', 'w-10'][i]}`} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-navy-100 pt-2 text-[11px] font-semibold">
          الإجمالي <span className="h-2 w-14 bg-gold" />
        </div>
      </div>
      <div className="absolute right-[10%] top-[30%] w-[46%] rotate-3 bg-white p-4 text-navy-900 shadow-2xl">
        <p className="text-xs font-semibold">العقد</p>
        <div className="mt-3 space-y-1.5">
          <span className="block h-1.5 w-full bg-navy-100" />
          <span className="block h-1.5 w-11/12 bg-navy-100" />
          <span className="block h-1.5 w-4/5 bg-navy-100" />
        </div>
        <svg aria-hidden viewBox="0 0 160 30" className="mt-3 h-7 w-3/4">
          <path
            d="M4 22 C 18 4, 28 30, 42 14 S 64 6, 72 18 S 96 26, 108 12 S 136 16, 154 8"
            fill="none"
            stroke="#1f58a8"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <p className="border-t border-navy-100 pt-1.5 text-[10px] text-purple">توقيع الطرفين</p>
      </div>
      <div className="absolute right-[8%] top-[8%] flex items-center gap-3 border border-gold/60 bg-navy-900/80 px-4 py-2.5 text-white shadow-xl">
        <span className="text-[11px] font-semibold">رقم طلبك</span>
        <span className="num text-xs tracking-widest">••••••</span>
      </div>
    </div>
  );
}
