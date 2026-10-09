/**
 * المرحلة الحادية عشرة: صدق بيانات العرض — لا ادعاءات غير قابلة للتحقق، لا سمات
 * شخصية مستنتجة، لا إيموجي، وترتيب «الأعلى تقييمًا» بمتوسط مرجّح بالعدد.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { EmptyState, ToastProvider, flagFor } from '@/shared/ui';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import { PAYMENT_METHODS } from '@/lib/orderTypes';
import OrderLanding from '@/pages/order/OrderLanding';
import WorkerProfilePage from '@/features/catalog/components/WorkerProfile';
import { WorkerCard } from '@/features/catalog/components/WorkerCard';
import { availabilityOf, yearsLabel } from '@/features/catalog/lib/catalog';
import {
  compareByRating,
  globalAverage,
  weightedRating,
  type RankableRating,
} from '@/features/rating/lib/ratingRank';
import { getReviewService } from '@/features/rating/services/reviewService';
import type { RatingSummary } from '@/features/rating/types';

afterEach(cleanup);

/** إيموجي معروض كصورة (أو بمحدِّد العرض التعبيري) أو علم — لا رموز طباعية كـ «©». */
const EMOJI = /\p{Emoji_Presentation}|\p{Regional_Indicator}|\uFE0F/u;

function wrap(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="/" element={ui} />
            <Route path="/order/workers/:id" element={<WorkerProfilePage />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------ ترتيب التقييم ------------------------------ */
const summary = (stars: number[]): RatingSummary => {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  stars.forEach((s) => (distribution[s] = (distribution[s] ?? 0) + 1));
  return {
    count: stars.length,
    average: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
    distribution,
  };
};
const rank = (items: RankableRating[]) => [...items].sort(compareByRating(items)).map((i) => i.id);

describe('ترتيب «الأعلى تقييمًا» (متوسط مرجّح بالعدد)', () => {
  const single5 = { id: 'a-single', summary: summary([5]) };
  const many48 = { id: 'b-many', summary: summary([5, 5, 5, 5, 5, 5, 5, 5, 4, 4]) }; // 4.8 من 10
  const none = { id: 'c-none', summary: summary([]) };
  // بقية العاملات: يجعل المتوسط العام واقعيًا (~٤٫٥) كما في بيانات العرض
  const population = { id: 'p-rest', summary: summary([4, 4, 4, 4, 3]) };

  it('تقييم واحد بـ ٥ لا يتقدّم على عشرة تقييمات بمتوسط ٤٫٨', () => {
    const order = rank([single5, many48, population]);
    expect(order.indexOf('b-many')).toBeLessThan(order.indexOf('a-single'));
  });

  it('بلا تقييمات بعد كل المُقيَّمات، ولا تُعامل كصفر', () => {
    const low = { id: 'd-low', summary: summary([1, 2]) };
    expect(rank([none, low, single5])).toEqual(['a-single', 'd-low', 'c-none']);
    expect(weightedRating(none.summary, 4.5)).toBeNull();
  });

  it('التعادل: الأكثر تقييمات ثم المعرّف — ترتيب ثابت', () => {
    const x = { id: 'x', summary: summary([4, 4]) };
    const y = { id: 'y', summary: summary([4, 4]) };
    const z = { id: 'z', summary: summary([4, 4, 4]) };
    const items = [y, z, x];
    // متوسطات متساوية = الأقرب للمتوسط العام؛ z أكثر تقييمات
    expect(rank(items)).toEqual(rank([...items].reverse()));
    expect(rank([y, x])).toEqual(['x', 'y']);
  });

  it('عدد قليل جدًا يُسحب نحو المتوسط العام', () => {
    const prior = globalAverage([single5, many48, population])!;
    expect(prior).toBeCloseTo((5 + 48 + 19) / 16, 5);
    expect(weightedRating(single5.summary, prior)!).toBeLessThan(5);
    expect(weightedRating(many48.summary, prior)!).toBeGreaterThan(
      weightedRating(single5.summary, prior)!,
    );
  });

  it('على بيانات العرض: ماريا (٨ تقييمات ٤٫٨) قبل فيث (تقييم واحد ٥٫٠)', () => {
    const svc = getReviewService();
    const items = FALLBACK_WORKERS.map((w) => ({
      id: w.id,
      summary: svc.getWorkerRatingSummary(w.id),
    }));
    const order = rank(items);
    expect(order.indexOf('w1')).toBeLessThan(order.indexOf('w6'));
    // غير المقيَّمات في الآخر
    const unrated = items.filter((i) => i.summary.count === 0).map((i) => i.id);
    expect(order.slice(-unrated.length).sort()).toEqual(unrated.sort());
  });
});

/* ------------------------------ الصفحة الرئيسية ------------------------------ */
describe('الصفحة الرئيسية بلا ادعاءات غير قابلة للتحقق', () => {
  it('أرقام من بيانات العرض والإعدادات بدل ٢٠٠٠+ و٩٨٪ و٢٤/٧، وآراء من تقييمات فعلية', async () => {
    render(wrap(<OrderLanding />));
    const available = FALLBACK_WORKERS.filter((w) => availabilityOf(w) === 'available').length;
    expect(
      await screen.findByText(
        (_, el) =>
          el?.tagName === 'SPAN' &&
          /بيانات العرض/.test(el.textContent ?? '') &&
          new RegExp(`${available}\\s*من\\s*${FALLBACK_WORKERS.length}`).test(el.textContent ?? ''),
      ),
    ).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    for (const claim of [
      '٢٠٠٠',
      '2000+',
      '٩٨٪',
      '٢٤/٧',
      '24/7',
      '٣٢٠٠',
      'أبو فيصل',
      'موثّقة رسمياً',
      'الرياض',
    ]) {
      expect(text).not.toContain(claim);
    }
    // ضمان الاستبدال من الإعدادات (replacement_guarantee_days = 90)
    expect(await screen.findAllByText(/90 يومًا/)).not.toHaveLength(0);
    // آراء العملاء من تقييمات العرض الفعلية وموسومة كتجريبية
    expect(
      await screen.findByText(/أحدث التعليقات من .* بيانات تجريبية للعرض/),
    ).toBeInTheDocument();
    expect(screen.getByText('من تقييمات العملاء')).toBeInTheDocument();
    expect(EMOJI.test(text)).toBe(false);
  });

  it('شارات التوفّر تطابق جدول التوفّر (لا «متاحة الآن» ثابتة)', async () => {
    render(wrap(<OrderLanding />));
    await screen.findAllByText(FALLBACK_WORKERS[0]!.full_name);
    for (const w of FALLBACK_WORKERS.slice(0, 8)) {
      const name = screen.queryAllByText(w.full_name).at(-1);
      if (!name) continue;
      const card = name.closest('a') as HTMLElement;
      expect(card).toHaveTextContent(availabilityOf(w) === 'available' ? 'متاحة الآن' : 'محجوزة');
    }
  });
});

/* -------------------------------- ملف العاملة -------------------------------- */
describe('ملف العاملة بلا بيانات مولّدة أو مستنتجة', () => {
  it('الديانة والحالة الاجتماعية واللغة الأم «غير متوفر»، ولا فيديو أو سجل عمل أو فحص طبي مزعوم', async () => {
    render(wrap(null, '/order/workers/w1'));
    await screen.findByText('تقييمات وتعليقات العملاء');
    for (const label of ['الديانة', 'الحالة الاجتماعية', 'اللغة الأم']) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('غير متوفر');
    }
    const text = document.body.textContent ?? '';
    for (const claim of [
      'مسيحية',
      'فيديو تعريفي',
      'الإمارات',
      'الفحص الطبي مكتمل',
      '٢٠٢٤',
      'الوثائق موثّقة',
      '٩٠ يوم',
    ]) {
      expect(text).not.toContain(claim);
    }
    expect(screen.getByText(/تفاصيل جهات العمل السابقة غير متوفرة/)).toBeInTheDocument();
    expect(screen.getByText(/غير متوفرة في بيانات العرض — تُراجع عند التعاقد/)).toBeInTheDocument();
    expect(EMOJI.test(text)).toBe(false);
  });
});

/* ------------------------------ العرض والإيموجي ------------------------------ */
describe('العرض', () => {
  it('سطر العمر والخبرة بترتيب عربي صحيح وصيغة عدد سليمة', () => {
    render(wrap(<WorkerCard worker={FALLBACK_WORKERS[0]!} />));
    const line = screen.getByText(/^العمر/);
    expect(line).toHaveTextContent(`العمر ${FALLBACK_WORKERS[0]!.age} سنة · خبرة 6 سنوات`);
    expect(line).not.toHaveClass('num');
    expect([1, 2, 6, 12].map(yearsLabel)).toEqual(['سنة واحدة', 'سنتان', '6 سنوات', '12 سنة']);
  });

  it('لا إيموجي في طرق الدفع والأعلام وحالة «لا يوجد»', () => {
    for (const m of PAYMENT_METHODS) expect(typeof m.icon).not.toBe('string');
    for (const n of ['الفلبين', 'إندونيسيا', 'كينيا', 'غير معروفة'])
      expect(EMOJI.test(flagFor(n))).toBe(false);
    expect(flagFor('الفلبين')).toBe('PH');
    render(<EmptyState title="لا شيء" />);
    expect(EMOJI.test(document.body.textContent ?? '')).toBe(false);
    expect(within(document.body).getByText('لا شيء')).toBeInTheDocument();
  });
});
