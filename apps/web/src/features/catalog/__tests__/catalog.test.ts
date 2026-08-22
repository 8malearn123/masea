import { describe, expect, it } from 'vitest';
import type { WorkerProfile } from '@/lib/funnel';
import { availabilityOf, ratingOf, servicePrices, skillsOf } from '@/features/catalog/lib/catalog';

const worker: WorkerProfile = {
  id: 'w1',
  full_name: 'ماريا سانتوس',
  nationality: 'الفلبين',
  profession: 'عاملة منزلية',
  age: 32,
  experience_years: 6,
  languages: ['العربية', 'الإنجليزية'],
  monthly_salary: 1500,
  status: 'available',
  photo_url: null,
  bio_ar: null,
};

describe('catalog enrichment', () => {
  it('prices all four services from the shared engine', () => {
    const prices = servicePrices(worker);
    expect(prices.map((p) => p.code)).toEqual([
      'recruitment',
      'monthly_rental',
      'daily_rental',
      'sponsorship_transfer',
    ]);
    expect(prices.every((p) => p.total > 0)).toBe(true);
  });

  it('derives a stable rating and skills by profession', () => {
    expect(ratingOf(worker)).toBe(ratingOf(worker));
    expect(ratingOf(worker)).toBeGreaterThanOrEqual(4.4);
    expect(skillsOf(worker).length).toBeGreaterThan(0);
  });

  it('maps a non-available status to reserved', () => {
    expect(availabilityOf({ ...worker, status: 'reserved' })).toBe('reserved');
  });
});
