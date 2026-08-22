/** Unified formatters (RTL-aware). Numbers use mono numerals, LTR-embedded. */

/** Money in SAR (two decimals, grouped). Render inside a `.num` span. */
export function sar(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Gregorian date in Arabic. */
export function dateAr(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Gregorian date + time in Arabic (for appointments). */
export function dateTimeAr(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('ar-SA', {
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
