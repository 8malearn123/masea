import { describe, expect, it } from 'vitest';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import {
  attributeOptions,
  maritalOf,
  motherTongueOf,
  religionOf,
  spokenLanguages,
} from '@/features/catalog/lib/catalog';

describe('catalog personal attributes (filters)', () => {
  it('never infers religion, mother tongue or marital status', () => {
    const ph = FALLBACK_WORKERS.find((w) => w.nationality === 'الفلبين')!;
    const id = FALLBACK_WORKERS.find((w) => w.nationality === 'إندونيسيا')!;
    // بيانات العرض لا تحوي هذه الحقول → غير متوفر، لا استنتاج من الجنسية أو المعرّف
    for (const w of [ph, id, ...FALLBACK_WORKERS]) {
      expect(religionOf(w)).toBeNull();
      expect(motherTongueOf(w)).toBeNull();
      expect(maritalOf(w)).toBeNull();
    }
  });

  it('uses the explicit field when present', () => {
    expect(religionOf({ ...FALLBACK_WORKERS[0]!, religion: 'هندوسية' })).toBe('هندوسية');
    expect(maritalOf({ ...FALLBACK_WORKERS[0]!, marital_status: ' متزوجة ' })).toBe('متزوجة');
    expect(motherTongueOf({ ...FALLBACK_WORKERS[0]!, mother_tongue: 'السواحيلية' })).toBe(
      'السواحيلية',
    );
  });

  it('builds filter options only from values that exist', () => {
    expect(attributeOptions(FALLBACK_WORKERS, religionOf)).toEqual([]);
    const two = [
      { ...FALLBACK_WORKERS[0]!, religion: 'مسيحية' },
      { ...FALLBACK_WORKERS[1]!, religion: 'مسلمة' },
      FALLBACK_WORKERS[2]!,
    ];
    expect(attributeOptions(two, religionOf)).toEqual(['مسلمة', 'مسيحية']);
  });

  it('collects the union of spoken languages', () => {
    const langs = spokenLanguages(FALLBACK_WORKERS);
    expect(langs).toContain('العربية');
    expect(langs.length).toBeGreaterThan(3);
  });
});
