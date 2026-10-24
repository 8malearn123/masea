/** Unified formatters (RTL-aware). Numbers use mono numerals, LTR-embedded. */

/** Money in SAR (two decimals, grouped). Render inside a `.num` span. */
export function sar(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Arabic locale pinned to the Gregorian calendar: plain `ar-SA` defaults to
 * Umm al-Qura in browsers (Hijri lives in `hijri()` below).
 */
const AR_GREGORIAN = 'ar-SA-u-ca-gregory';

/** Gregorian date in Arabic. A bare yyyy-mm-dd is a calendar day (no timezone shift). */
export function dateAr(value: string | null | undefined): string {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(value).toLocaleDateString(AR_GREGORIAN, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
}

/** Gregorian date + time in Arabic (for appointments). */
export function dateTimeAr(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(AR_GREGORIAN, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Hijri (Umm al-Qura) date in Arabic. */
export function hijri(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Convert Latin digits to Arabic-Indic. */
export function toArabicDigits(value: string | number): string {
  const map = '٠١٢٣٤٥٦٧٨٩';
  return String(value).replace(/[0-9]/g, (d) => map[Number(d)] ?? d);
}
