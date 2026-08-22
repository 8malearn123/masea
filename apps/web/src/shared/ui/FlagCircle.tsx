/**
 * Small circular country flag — identity-friendly (soft ring + light field).
 * Flags are content (country emoji), framed to match the system's rounded look.
 */
const FLAG: Record<string, string> = {
  إندونيسيا: '🇮🇩',
  الفلبين: '🇵🇭',
  كينيا: '🇰🇪',
  إثيوبيا: '🇪🇹',
  سريلانكا: '🇱🇰',
  بنغلاديش: '🇧🇩',
  الهند: '🇮🇳',
  نيبال: '🇳🇵',
  أوغندا: '🇺🇬',
  السعودية: '🇸🇦',
};

export function flagFor(nationality: string | null | undefined): string {
  return (nationality && FLAG[nationality.trim()]) || '🌐';
}

const SIZES = {
  sm: 'h-6 w-6 text-[13px]',
  md: 'h-8 w-8 text-base',
  lg: 'h-10 w-10 text-lg',
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
      className={`grid shrink-0 place-items-center rounded-full bg-navy-50 ring-1 ring-navy-100 ${SIZES[size]} ${className}`}
    >
      <span className="leading-none">{flagFor(nationality)}</span>
    </span>
  );
}
