import { describe, expect, it } from 'vitest';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import {
  maritalOf,
  motherTongueOf,
  religionOf,
  spokenLanguages,
} from '@/features/catalog/lib/catalog';

describe('catalog personal attributes (filters)', () => {
  it('derives religion + mother tongue by nationality', () => {
    const ph = FALLBACK_WORKERS.find((w) => w.nationality === 'الفلبين')!;
    const id = FALLBACK_WORKERS.find((w) => w.nationality === 'إندونيسيا')!;
    expect(religionOf(ph)).toBe('مسيحية');
    expect(religionOf(id)).toBe('مسلمة');
    expect(motherTongueOf(id)).toBe('الإندونيسية');
  });

  it('marital status is stable per worker', () => {
    const w = FALLBACK_WORKERS[0]!;
    expect(maritalOf(w)).toBe(maritalOf(w));
    expect(['عزباء', 'متزوجة', 'مطلّقة', 'أرملة']).toContain(maritalOf(w));
  });

  it('prefers explicit field over the derived demo value', () => {
    expect(religionOf({ ...FALLBACK_WORKERS[0]!, religion: 'هندوسية' })).toBe('هندوسية');
  });

  it('collects the union of spoken languages', () => {
    const langs = spokenLanguages(FALLBACK_WORKERS);
    expect(langs).toContain('العربية');
    expect(langs.length).toBeGreaterThan(3);
  });
});
