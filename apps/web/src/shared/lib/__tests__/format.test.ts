import { describe, expect, it } from 'vitest';
import { sar, toArabicDigits } from '@/shared/lib/format';

describe('formatters', () => {
  it('formats SAR with two decimals and grouping', () => {
    expect(sar(1000)).toBe('1,000.00');
    expect(sar(18400)).toBe('18,400.00');
    expect(sar(null)).toBe('0.00');
  });

  it('converts Latin digits to Arabic-Indic', () => {
    expect(toArabicDigits('2026')).toBe('٢٠٢٦');
    expect(toArabicDigits(115)).toBe('١١٥');
  });
});
