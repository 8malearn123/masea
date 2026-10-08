/**
 * المطابقة القابلة للتفسير (المرحلة التاسعة): معايير بحالات صريحة
 * (matched/partial/missing/unknown)، نسبة حتمية ٠–١٠٠، التوفّر كشرط مستقل من
 * isWorkerAvailable، الترتيب، والعرض في شاشة الاختيار وملخّص الطلب.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/shared/ui';
import { FALLBACK_WORKERS, type WorkerProfile } from '@/lib/funnel';
import { emptyDraft } from '@/lib/orderTypes';
import {
  matchWorker,
  rankWorkers,
  scoreOf,
  type MatchCriterion,
  type RequestNeed,
} from '@/features/catalog/lib/matching';
import { addBooking, isWorkerAvailable } from '@/features/catalog/lib/availability';
import { MatchedWorkerPicker } from '@/features/catalog/components/MatchedWorkerPicker';
import RequestSummary from '@/features/requests/components/RequestSummary';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import { addDays, buildPeriod, today } from '@/features/requests/lib/period';
import { emptyPlaceDetails, type PlaceDetails } from '@/features/requests/types';

afterEach(cleanup);

/* ---------------------------- عاملات اختبار ---------------------------- */
// معرّفات خارج بيانات العرض: لا تقييمات ولا جداول مولّدة تؤثر على النتيجة
const housekeeper: WorkerProfile = {
  id: 'mx-housekeeper',
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
const plainHousekeeper: WorkerProfile = {
  ...housekeeper,
  id: 'mx-plain',
  bio_ar: 'نشيطة ومنظّمة.',
  languages: ['الإنجليزية'],
};
const nanny: WorkerProfile = {
  ...housekeeper,
  id: 'mx-nanny',
  profession: 'مربية أطفال',
  bio_ar: 'متخصصة في رعاية الأطفال حديثي الولادة.',
};
const cook: WorkerProfile = {
  ...housekeeper,
  id: 'mx-cook',
  profession: 'طباخة',
  experience_years: 9,
  bio_ar: 'تتقن المأكولات العربية وتجهيز الولائم.',
};
const driver: WorkerProfile = {
  ...housekeeper,
  id: 'mx-driver',
  profession: 'سائق',
  experience_years: 12,
  bio_ar: 'سائق خاص يلتزم بالمواعيد.',
};

const place = (patch: Partial<PlaceDetails>): PlaceDetails => ({
  ...emptyPlaceDetails(),
  ...patch,
});
const need = (patch: Partial<PlaceDetails>, extra: Partial<RequestNeed> = {}): RequestNeed => ({
  place: place(patch),
  period: null,
  ...extra,
});
const status = (w: WorkerProfile, n: RequestNeed, key: string) =>
  matchWorker(w, n).criteria.find((c) => c.key === key)?.status;

const home = (patch: Partial<PlaceDetails> = {}) =>
  need({ beneficiaryType: 'home', hasChildren: false, hasElderly: false, ...patch });

describe('معايير المطابقة', () => {
  it('مطابقة كاملة: طباخة لمناسبة فيها طبخ وضيافة', () => {
    const n = need({
      beneficiaryType: 'occasion',
      occasionType: 'wedding',
      guests: 120,
      careNeeds: ['cooking', 'serving'],
    });
    const m = matchWorker(cook, n);
    expect(m.score).toBe(100);
    expect(m.criteria.every((c) => c.status === 'matched')).toBe(true);
    expect(m.reasons).toEqual(
      expect.arrayContaining([
        'مناسبة لخدمة المناسبة',
        'لديها خبرة في الطبخ',
        'لديها خبرة في تجهيز الولائم والمناسبات',
      ]),
    );
    expect(m.gaps).toEqual([]);
  });

  it('مطابقة جزئية: مربية أطفال لمناسبة', () => {
    const n = need({ beneficiaryType: 'occasion', guests: 80, careNeeds: ['cooking'] });
    const m = matchWorker(nanny, n);
    expect(m.score).toBeGreaterThan(0);
    expect(m.score).toBeLessThan(100);
    expect(status(nanny, n, 'beneficiary')).toBe('missing');
    expect(m.gaps).toContain('مهنتها (مربية أطفال) لا تناسب خدمة المناسبة');
  });

  it('متطلب مفقود (بيانات معروفة تنفيه): السائق لا يشمل التنظيف', () => {
    const n = home({ careNeeds: ['cleaning'] });
    expect(status(driver, n, 'care:cleaning')).toBe('missing');
    expect(matchWorker(driver, n).gaps).toContain('مهنتها (سائق) لا تشمل التنظيف والترتيب');
  });

  it('متطلب غير معروف: لا يُحسب مطابقة ولا يُعرض كعدم توافق', () => {
    const n = home({ hasElderly: true, elderly: 1, elderlyCareNeeded: true });
    expect(status(housekeeper, n, 'elderly')).toBe('matched'); // نبذتها تذكر كبار السن
    expect(status(plainHousekeeper, n, 'elderly')).toBe('unknown');
    const m = matchWorker(plainHousekeeper, n);
    expect(m.unknowns).toContain('لا توجد بيانات عن خبرتها في رعاية كبار السن');
    expect(m.gaps.join()).not.toContain('كبار السن');
    expect(m.reasons.join()).not.toContain('كبار السن');
    expect(m.score).toBeLessThan(matchWorker(housekeeper, n).score);
  });

  it('أنواع المستفيد المختلفة تنتج معايير مختلفة', () => {
    const keys = (n: RequestNeed) => matchWorker(housekeeper, n).criteria.map((c) => c.key);
    expect(keys(home({ hasChildren: true, children: 2 }))).toContain('children');
    expect(keys(need({ beneficiaryType: 'occasion', guests: 100 }))).toContain('occasion');
    expect(keys(need({ beneficiaryType: 'facility', sections: 4, guests: 60 }))).not.toContain(
      'children',
    );
    expect(
      keys(need({ beneficiaryType: 'commercial', branchesCount: 2, guests: 40 })),
    ).not.toContain('occasion');
  });

  it('المنزل: الخبرة مقابل حجم المكان (أدوار/غرف)', () => {
    const big = home({ floors: 4, rooms: 12 });
    expect(status({ ...housekeeper, experience_years: 2 }, big, 'experience')).toBe('missing');
    expect(status({ ...housekeeper, experience_years: 5 }, big, 'experience')).toBe('partial');
    expect(status({ ...housekeeper, experience_years: 10 }, big, 'experience')).toBe('matched');
    // بيت صغير لا يتطلب حدًّا من الخبرة → المعيار لا ينطبق
    expect(status(housekeeper, home({ floors: 1, rooms: 1 }), 'experience')).toBeUndefined();
  });

  it('الأطفال: معيار فقط عند وجودهم، والدليل من المهنة أو النبذة', () => {
    const kids = home({ hasChildren: true, children: 2 });
    expect(status(nanny, kids, 'children')).toBe('matched');
    expect(status(cook, kids, 'children')).toBe('unknown');
    expect(status(driver, kids, 'children')).toBe('missing');
    expect(status(nanny, home(), 'children')).toBeUndefined();
    // احتياج «رعاية الأطفال» نفسه يغني عن معيار الأطفال (لا ازدواج)
    const both = home({ hasChildren: true, children: 2, careNeeds: ['children'] });
    expect(matchWorker(nanny, both).criteria.filter((c) => /children/.test(c.key))).toHaveLength(1);
  });

  it('رعاية كبار السن: فقط إذا احتاجوا رعاية', () => {
    expect(
      status(
        housekeeper,
        home({ hasElderly: true, elderly: 1, elderlyCareNeeded: false }),
        'elderly',
      ),
    ).toBeUndefined();
  });

  it('المنشأة: المهنة المناسبة والخبرة حسب الأقسام والمستفيدين', () => {
    const n = need({
      beneficiaryType: 'facility',
      facilityType: 'مستشفى',
      sections: 6,
      guests: 100,
      careNeeds: ['cleaning'],
    });
    expect(status(housekeeper, n, 'beneficiary')).toBe('matched');
    expect(status(nanny, n, 'beneficiary')).toBe('missing');
    expect(status({ ...housekeeper, experience_years: 2 }, n, 'experience')).toBe('missing');
  });

  it('النشاط التجاري: المهنة المناسبة والخبرة حسب الفروع والأشخاص', () => {
    const n = need({
      beneficiaryType: 'commercial',
      businessType: 'مقهى',
      branchesCount: 3,
      guests: 90,
    });
    expect(status(cook, n, 'beneficiary')).toBe('matched');
    expect(status(nanny, n, 'beneficiary')).toBe('missing');
    expect(status(cook, n, 'experience')).toBe('matched');
  });

  it('المناسبة: خبرة الولائم من المهنة أو النبذة، وإلا «لا توجد بيانات»', () => {
    const n = need({ beneficiaryType: 'occasion', guests: 60 });
    expect(status(cook, n, 'occasion')).toBe('matched');
    expect(status(plainHousekeeper, n, 'occasion')).toBe('unknown');
  });

  it('الجنسية والمهنة المطلوبتان واللغة العربية من الملاحظات', () => {
    const n = home({ notes: 'نفضّل من تجيد العربية' });
    expect(status(housekeeper, n, 'language')).toBe('matched');
    expect(status(plainHousekeeper, n, 'language')).toBe('missing');
    const req = { ...home(), nationality: 'إثيوبيا', profession: 'طباخة' };
    expect(status(cook, req, 'nationality')).toBe('matched');
    expect(status(cook, req, 'profession')).toBe('matched');
    expect(status(nanny, req, 'profession')).toBe('missing');
  });
});

describe('النسبة', () => {
  const needs: RequestNeed[] = [
    home({
      hasChildren: true,
      children: 3,
      hasElderly: true,
      elderly: 1,
      elderlyCareNeeded: true,
      careNeeds: ['children', 'cleaning'],
      floors: 3,
      rooms: 8,
    }),
    need({ beneficiaryType: 'occasion', guests: 200, careNeeds: ['cooking', 'serving'] }),
    need({ beneficiaryType: 'facility', sections: 5, guests: 80, careNeeds: ['cleaning'] }),
    need({ beneficiaryType: 'commercial', branchesCount: 2, guests: 50 }),
    need({}),
  ];

  it('بين ٠ و١٠٠ لكل عاملات العرض ولكل الطلبات', () => {
    for (const w of [...FALLBACK_WORKERS, housekeeper, nanny, cook, driver]) {
      for (const n of needs) {
        const s = matchWorker(w, n).score;
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });

  it('حتمية: نفس الطلب ونفس العاملة = نفس النتيجة، بلا عشوائية', () => {
    const random = vi.spyOn(Math, 'random');
    for (const n of needs) {
      expect(matchWorker(cook, n)).toEqual(matchWorker(cook, n));
    }
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('غير المعروف لا يصبح مطابقة إيجابية', () => {
    const c = (status: MatchCriterion['status']): MatchCriterion => ({
      key: 'k',
      label: '',
      detail: '',
      weight: 10,
      status,
    });
    const matched: MatchCriterion = { ...c('matched'), key: 'a' };
    expect(scoreOf([matched, c('unknown')])).toBe(50);
    expect(scoreOf([matched, c('unknown')])).toBe(scoreOf([matched, c('missing')]));
    expect(scoreOf([matched, c('partial')])).toBe(75);
    expect(scoreOf([])).toBe(0);
  });
});

describe('التوفّر شرط مستقل', () => {
  const from = today();
  const period = buildPeriod(addDays(from, 5), 'day', 3);
  const n = (p: RequestNeed['period']) => ({ ...home({ careNeeds: ['cleaning'] }), period: p });
  const far = buildPeriod(addDays(from, 200), 'day', 3); // خارج أفق الجدول المولَّد

  it('نفس نتيجة isWorkerAvailable حرفيًا (لا منطق توفّر مكرر)', () => {
    for (const w of FALLBACK_WORKERS) {
      expect(matchWorker(w, n(period)).availability).toEqual(
        isWorkerAvailable(w.id, period.startDate, period.endDate),
      );
    }
  });

  it('متاحة / تعارض جزئي / غير متاحة بالكامل — والنسبة لا تتغيّر', () => {
    const free = matchWorker(FALLBACK_WORKERS[0]!, n(period)); // w1 متاحة بالكامل
    expect(free).toMatchObject({ available: true, eligible: true });
    expect(free.reasons).toContain('متاحة طوال فترة الخدمة');

    const full = matchWorker(FALLBACK_WORKERS.find((w) => w.id === 'w6')!, n(period));
    expect(full.availability.status).toBe('unavailable');
    expect(full).toMatchObject({ available: false, eligible: false });
    expect(full.reasons).not.toContain('متاحة طوال فترة الخدمة');

    const partialWorker = { ...housekeeper, id: 'mx-partial' };
    addBooking(partialWorker.id, {
      start: far.endDate,
      end: addDays(far.endDate, 3),
      reason: 'x',
      request_no: 'MX-P',
    });
    const partial = matchWorker(partialWorker, n(far));
    expect(partial.availability.status).toBe('partial');
    expect(partial.eligible).toBe(false);
    expect(partial.score).toBe(matchWorker(partialWorker, n(null)).score);
  });

  it('بلا فترة: لا يُدّعى التوفّر وتبقى المطابقة ممكنة', () => {
    const m = matchWorker(housekeeper, n(null));
    expect(m.availability.status).toBe('unknown');
    expect(m).toMatchObject({ available: false, eligible: true });
    expect(m.reasons).not.toContain('متاحة طوال فترة الخدمة');
    expect(m.score).toBeGreaterThan(0);
  });
});

describe('الترتيب', () => {
  const from = today();
  const period = buildPeriod(addDays(from, 200), 'day', 3);
  const best = { ...cook, id: 'mx-rank-best' }; // أعلى مطابقة لكن ستُحجز
  const good = { ...housekeeper, id: 'mx-rank-good' }; // تطبخ (مهاراتها) بلا دليل على الولائم
  const fair = { ...nanny, id: 'mx-rank-fair' }; // مهنتها لا تناسب المناسبة
  addBooking(best.id, {
    start: period.startDate,
    end: period.endDate,
    reason: 'x',
    request_no: 'MX-R',
  });
  const n: RequestNeed = {
    ...need({ beneficiaryType: 'occasion', guests: 100, careNeeds: ['cooking', 'serving'] }),
    period,
  };

  it('المتاحة قبل غير المتاحة مهما علت نسبتها، ثم الأعلى مطابقة', () => {
    const ranked = rankWorkers([best, fair, good], n, 0);
    expect(matchWorker(best, n).score).toBeGreaterThan(matchWorker(good, n).score);
    expect(ranked.map((r) => r.worker.id)).toEqual([
      'mx-rank-good',
      'mx-rank-fair',
      'mx-rank-best',
    ]);
  });

  it('ترتيب ثابت عند التساوي (بالمعرّف) مهما كان ترتيب الإدخال', () => {
    const twins = ['mx-t-c', 'mx-t-a', 'mx-t-b'].map((id) => ({ ...good, id }));
    const a = rankWorkers(twins, n, 0).map((r) => r.worker.id);
    const b = rankWorkers([...twins].reverse(), n, 0).map((r) => r.worker.id);
    expect(a).toEqual(['mx-t-a', 'mx-t-b', 'mx-t-c']);
    expect(b).toEqual(a);
  });
});

/* -------------------------------- الواجهة -------------------------------- */
function wrap(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="/" element={ui} />
            <Route path="/order/request/:requestNo" element={<RequestSummary />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('شاشة اختيار العاملة', () => {
  const from = today();
  const insideW6 = buildPeriod(addDays(from, 5), 'day', 3);
  const kidsNeed = (period: RequestNeed['period']): RequestNeed => ({
    ...home({
      hasChildren: true,
      children: 2,
      hasElderly: true,
      elderly: 1,
      elderlyCareNeeded: true,
      careNeeds: ['children'],
    }),
    period,
  });
  const w = (id: string) => FALLBACK_WORKERS.find((x) => x.id === id)!;

  async function show(period: RequestNeed['period']) {
    const user = userEvent.setup();
    const props = (p: RequestNeed['period']) => ({
      workers: [w('w1'), w('w2'), w('w6')],
      need: kidsNeed(p),
      selectedId: null,
      onSelect: () => undefined,
    });
    const view = render(wrap(<MatchedWorkerPicker {...props(period)} />));
    const more = screen.queryByRole('button', { name: /عرض الباقي/ });
    if (more) await user.click(more);
    return {
      user,
      rerender: (p: RequestNeed['period']) =>
        view.rerender(wrap(<MatchedWorkerPicker {...props(p)} />)),
    };
  }

  it('تعرض النسبة والأسباب والنواقص وغير المعروف لكل عاملة', async () => {
    await show(insideW6);
    const maria = screen.getByRole('article', { name: w('w1').full_name });
    const m = matchWorker(w('w1'), kidsNeed(insideW6));
    expect(maria).toHaveTextContent(`${m.score}٪`);
    expect(within(maria).getByRole('list', { name: 'أسباب المطابقة' })).toHaveTextContent(
      'مناسبة لخدمة المنزل',
    );
    expect(within(maria).getByRole('list', { name: 'المتطلبات غير المتوفرة' })).toHaveTextContent(
      'لا توجد بيانات عن خبرتها في رعاية كبار السن',
    );
    expect(within(maria).getByRole('button', { name: /اختيار ماريا/ })).toBeEnabled();
    expect(within(maria).getByText('متاحة')).toBeInTheDocument();
  });

  it('غير المتاحة في قسم منفصل، تُظهر نسبتها، ولا تُختار', async () => {
    const { user } = await show(insideW6);
    expect(screen.queryByRole('article', { name: w('w6').full_name })).toBeNull(); // ليست خيارًا أساسيًا
    await user.click(screen.getByRole('button', { name: /غير متاحة خلال الفترة المحددة \(/ }));
    const faith = screen.getByRole('article', { name: w('w6').full_name });
    expect(faith).toHaveTextContent(`${matchWorker(w('w6'), kidsNeed(insideW6)).score}٪`);
    expect(within(faith).getByText('غير متاحة')).toBeInTheDocument();
    expect(within(faith).getByRole('button', { name: /اختيار فيث/ })).toBeDisabled();
  });

  it('فترة الطلب تغيّر التوفّر دون أن تغيّر النسبة', async () => {
    const { rerender } = await show(insideW6);
    const score = matchWorker(w('w6'), kidsNeed(insideW6)).score;
    rerender(buildPeriod(addDays(from, 50), 'day', 3));
    const faith = screen.getByRole('article', { name: w('w6').full_name });
    expect(within(faith).getByRole('button', { name: /اختيار فيث/ })).toBeEnabled();
    expect(faith).toHaveTextContent(`${score}٪`);
  });

  it('بلا فترة: رسالة التحقق ولا ادعاء «متاحة»', async () => {
    await show(null);
    expect(screen.getAllByText('حدد تاريخ البداية والمدة للتحقق من التوفر.').length).toBe(3);
    expect(screen.queryByText('متاحة')).toBeNull();
    expect(screen.queryByText(/متاحة طوال فترة الخدمة/)).toBeNull();
  });
});

describe('ملخّص الطلب', () => {
  it('يعرض اسم العاملة ونسبة المطابقة وحالة توفّرها دون تفاصيل الحساب', async () => {
    const svc = createMockRequestService();
    const worker = FALLBACK_WORKERS.find((x) => x.id === 'w1')!;
    const startDate = addDays(today(), 140);
    const res = await svc.submit({
      clientToken: 'match-summary-01',
      serviceName: 'تأجير يومي',
      price: { base: 300, vat: 45, total: 345 },
      worker,
      draft: {
        ...emptyDraft('daily_rental'),
        customerName: 'هيا آل مفرح',
        phone: '0501234567',
        startDate,
        days: 2,
        workerProfileId: worker.id,
        matchScore: 87,
      },
    });
    render(wrap(null, `/order/request/${res.requestNo}`));
    const section = (await screen.findByText('العاملة المخصّصة')).closest('section') as HTMLElement;
    expect(section).toHaveTextContent(worker.full_name);
    expect(section).toHaveTextContent('مطابقة 87٪');
    expect(section).toHaveTextContent('متاحة ومحجوزة لطلبك طوال فترة الخدمة');
    expect(section).not.toHaveTextContent(/وزن|weight|score/i);
  });
});
