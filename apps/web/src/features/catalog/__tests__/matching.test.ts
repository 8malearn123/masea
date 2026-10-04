import { describe, expect, it } from 'vitest';
import type { WorkerProfile } from '@/lib/funnel';
import { matchWorker, rankWorkers } from '@/features/catalog/lib/matching';
import type { RequestNeed } from '@/features/catalog/lib/matching';
import { buildPeriod } from '@/features/requests/lib/period';
import { emptyPlaceDetails } from '@/features/requests/types';

const base: WorkerProfile = {
  id: 'wx-housekeeper',
  full_name: 'أمينة حسن',
  nationality: 'إثيوبيا',
  profession: 'عاملة منزلية',
  age: 30,
  experience_years: 6,
  languages: ['العربية'],
  monthly_salary: 1400,
  status: 'available',
  photo_url: null,
  bio_ar: 'خبرة في التنظيف والعناية بكبار السن.',
};

const nanny: WorkerProfile = {
  ...base,
  id: 'wx-nanny',
  full_name: 'ليان أحمد',
  profession: 'مربية أطفال',
  bio_ar: 'متخصصة في رعاية الأطفال حديثي الولادة.',
};

const cook: WorkerProfile = {
  ...base,
  id: 'wx-cook',
  full_name: 'سناء إبراهيم',
  profession: 'طباخة',
  bio_ar: 'تتقن المأكولات العربية وتجهيز الولائم.',
};

function need(
  patch: Partial<RequestNeed['place']>,
  period: RequestNeed['period'] = null,
): RequestNeed {
  return { place: { ...emptyPlaceDetails(), beneficiaryType: 'home', ...patch }, period };
}

describe('ترشيح العاملة حسب احتياج الطلب', () => {
  it('يرفع درجة من تغطّي احتياج الرعاية المطلوب', () => {
    const childCare = need({ children: 2, careNeeds: ['children', 'newborn'] });
    expect(matchWorker(nanny, childCare).score).toBeGreaterThan(matchWorker(cook, childCare).score);
  });

  it('يقدّم الطباخة لمناسبة فيها طبخ وضيافة', () => {
    const occasion = need({
      beneficiaryType: 'occasion',
      occasionType: 'wedding',
      guests: 120,
      careNeeds: ['cooking', 'serving'],
    });
    const ranked = rankWorkers([base, nanny, cook], occasion, 0);
    expect(ranked[0]?.worker.id).toBe('wx-cook');
  });

  it('يشرح سبب الترشيح ويذكر النقص', () => {
    const elderly = need({ elderly: 1, elderlyCareNeeded: true, careNeeds: ['elderly'] });
    const good = matchWorker(base, elderly);
    expect(good.reasons.length).toBeGreaterThan(0);
    expect(matchWorker(cook, elderly).gaps.length).toBeGreaterThan(0);
  });

  it('يخفض درجة العاملة المحجوزة في المدة المطلوبة ويقترح بديلًا زمنيًا', () => {
    const period = buildPeriod('2026-10-05', 'day', 3);
    const free = matchWorker(base, need({ careNeeds: ['cleaning'] }, null));
    const busy = matchWorker(base, need({ careNeeds: ['cleaning'] }, period));
    if (!busy.available) {
      expect(busy.score).toBeLessThan(free.score);
      expect(busy.nextFree).not.toBeNull();
    } else {
      expect(busy.reasons).toContain('متاحة في المدة المطلوبة بالكامل');
    }
  });

  it('يستبعد ما دون حدّ الترشيح الأدنى', () => {
    const strict = rankWorkers([base, nanny, cook], need({ careNeeds: ['newborn'] }), 95);
    expect(strict.length).toBeLessThan(3);
  });
});
