/**
 * شارة دائرية صغيرة للدولة — رمز الدولة (ISO) بنص محايد بدل إيموجي العلم
 * (CLAUDE.md: لا إيموجي). اسم الجنسية الكامل في `title` للقارئ.
 */
const COUNTRY_CODE: Record<string, string> = {
  إندونيسيا: 'ID',
  الفلبين: 'PH',
  كينيا: 'KE',
  إثيوبيا: 'ET',
  سريلانكا: 'LK',
  بنغلاديش: 'BD',
  الهند: 'IN',
  نيبال: 'NP',
  أوغندا: 'UG',
  السعودية: 'SA',
};

/** رمز الدولة (ISO) للجنسية، أو «—» إن لم يُعرف. */
export function flagFor(nationality: string | null | undefined): string {
  return (nationality && COUNTRY_CODE[nationality.trim()]) || '—';
}

const SIZES = {
  sm: 'h-6 w-6 text-[9px]',
  md: 'h-8 w-8 text-[10px]',
  lg: 'h-10 w-10 text-xs',
} as const;

export function FlagCircle({
  nationality,
  size = 'md',
  className = '',
}: {
  nationality: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      title={nationality ?? ''}
      aria-label={nationality ?? undefined}
      className={`grid shrink-0 place-items-center rounded-full bg-navy-50 font-bold tracking-wide text-navy ring-1 ring-navy-100 ${SIZES[size]} ${className}`}
    >
      <span className="num leading-none">{flagFor(nationality)}</span>
    </span>
  );
}
