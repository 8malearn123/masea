/**
 * تقييمات العاملات (المرحلة العاشرة): خدمة التقييمات التجريبية، التحقق بـ Zod،
 * منع التكرار لكل (طلب + عاملة)، الربط بالمطابقة بلا تقييم مفترض، والعرض.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/shared/ui';
import { FALLBACK_WORKERS, type WorkerProfile } from '@/lib/funnel';
import { emptyDraft } from '@/lib/orderTypes';
import { listWorkerReviews } from '@/features/rating/api/rating.api';
import {
  createMockReviewService,
  DUPLICATE_REVIEW_MESSAGE,
  getReviewService,
} from '@/features/rating/services/reviewService';
import { reviewFormSchema, REVIEW_COMMENT_MAX } from '@/features/rating/schemas/review.schema';
import { reviewerDisplayName, reviewsLabel } from '@/features/rating/types';
import { RatingSummaryPanel, ReviewList } from '@/features/rating/components/RatingParts';
import { ratingOf } from '@/features/catalog/lib/catalog';
import { matchWorker } from '@/features/catalog/lib/matching';
import WorkerProfilePage from '@/features/catalog/components/WorkerProfile';
import RequestSummary from '@/features/requests/components/RequestSummary';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import { emptyPlaceDetails } from '@/features/requests/types';
import {
  assignDriver,
  findDemoOrderByRequestNo,
  setOrderStatus,
} from '@/features/orders/api/orders.api';

afterEach(cleanup);

const worker = (id: string) => FALLBACK_WORKERS.find((w) => w.id === id)!;
const svc = getReviewService();
let seq = 0;

/**
 * طلب تجريبي حقيقي (عبر خدمة الطلبات) مرتبط بعاملة، ثم يُعلَّم «مكتملًا» من
 * مسار الموظفين (`setOrderStatus`) — التقييم يتطلب خدمة مكتملة صراحةً.
 */
async function requestWith(w: WorkerProfile | null, customerName = 'هيا آل مفرح') {
  seq += 1;
  const res = await createMockRequestService().submit({
    clientToken: `review-req-${seq}-${Math.random().toString(36).slice(2)}`,
    serviceName: 'تأجير يومي',
    price: { base: 300, vat: 45, total: 345 },
    ...(w ? { worker: w } : {}),
    draft: {
      ...emptyDraft('daily_rental'),
      customerName,
      phone: '0501234567',
      ...(w ? { workerProfileId: w.id } : {}),
    },
  });
  const orderId = findDemoOrderByRequestNo(res.requestNo)!.id;
  await assignDriver(orderId, 'd1'); // «مُسند» يتطلب سائقًا
  for (const s of ['in_progress', 'completed'] as const) await setOrderStatus(orderId, s);
  return res.requestNo;
}

describe('خدمة التقييمات (Mock)', () => {
  it('تقييمات العاملة الأحدث أولًا، وقائمة فارغة لعاملة بلا تقييمات', async () => {
    const reviews = await svc.getWorkerReviews('w1');
    expect(reviews.length).toBe(8);
    const dates = reviews.map((r) => r.created_at);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(await svc.getWorkerReviews('w7')).toEqual([]);
    expect(await svc.getWorkerReviews('worker-not-found')).toEqual([]);
  });

  it('الملخّص من السجلات نفسها: المتوسط والعدد والتوزيع', async () => {
    const rows = await listWorkerReviews('w1');
    const summary = svc.getWorkerRatingSummary('w1');
    const mean = rows.reduce((s, r) => s + r.stars, 0) / rows.length;
    expect(summary.count).toBe(rows.length);
    expect(summary.average).toBe(Math.round(mean * 10) / 10);
    expect(Object.values(summary.distribution).reduce((a, b) => a + b, 0)).toBe(rows.length);
    expect(summary.distribution[5]).toBe(rows.filter((r) => r.stars === 5).length);
    // بلا تقييمات: لا متوسط (لا يُعرض ٠ كتقييم)
    expect(svc.getWorkerRatingSummary('w7')).toEqual({
      count: 0,
      average: null,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it('بيانات العرض متنوعة بين العاملات', () => {
    const counts = FALLBACK_WORKERS.map((w) => svc.getWorkerRatingSummary(w.id).count);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(8); // تقييمات كثيرة
    expect(counts.filter((c) => c === 0).length).toBeGreaterThan(0); // بلا تقييمات
    expect(counts.filter((c) => c === 1).length).toBeGreaterThan(0); // قليلة
    expect(svc.getWorkerRatingSummary('w3').average).toBeLessThan(4); // متوسط
  });

  it('يضيف تقييمًا مرتبطًا بالطلب والعاملة ويحدّث الملخّص', async () => {
    const w = worker('w8');
    const before = svc.getWorkerRatingSummary(w.id).count;
    const requestNo = await requestWith(w);
    const row = await svc.addReview({
      requestNo,
      workerId: w.id,
      rating: 4,
      comment: '  ممتازة في الطبخ  ',
    });
    expect(row).toMatchObject({
      worker_id: w.id,
      request_no: requestNo,
      stars: 4,
      comment: 'ممتازة في الطبخ',
      customer_name: 'هيا آل مفرح',
      target_type: 'worker',
    });
    expect(svc.getWorkerRatingSummary(w.id).count).toBe(before + 1);
    expect(svc.getRequestReview(requestNo, w.id)?.id).toBe(row.id);
  });

  it('يمنع تقييمًا ثانيًا لنفس الطلب والعاملة (متتابعًا أو متزامنًا)', async () => {
    const w = worker('w10');
    const requestNo = await requestWith(w);
    await svc.addReview({ requestNo, workerId: w.id, rating: 5, comment: '' });
    const count = svc.getWorkerRatingSummary(w.id).count;
    await expect(
      svc.addReview({ requestNo, workerId: w.id, rating: 1, comment: 'تغيير رأي' }),
    ).rejects.toMatchObject({ kind: 'duplicate', message: DUPLICATE_REVIEW_MESSAGE });
    expect(svc.getWorkerRatingSummary(w.id).count).toBe(count);

    const other = await requestWith(w);
    const results = await Promise.allSettled([
      svc.addReview({ requestNo: other, workerId: w.id, rating: 4, comment: '' }),
      svc.addReview({ requestNo: other, workerId: w.id, rating: 4, comment: '' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(svc.getWorkerRatingSummary(w.id).count).toBe(count + 1);
  });

  it('لا تقييم لطلب بلا عاملة، أو لطلب غير موجود، أو لعاملة غير مرتبطة بالطلب', async () => {
    const noWorker = await requestWith(null);
    await expect(
      svc.addReview({ requestNo: noWorker, workerId: 'w1', rating: 5, comment: '' }),
    ).rejects.toMatchObject({ kind: 'no_worker' });
    await expect(
      svc.addReview({ requestNo: 'REQ-00000000', workerId: 'w1', rating: 5, comment: '' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
    const req = await requestWith(worker('w8'));
    await expect(
      svc.addReview({ requestNo: req, workerId: 'w1', rating: 5, comment: '' }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('خدمة جديدة تقرأ نفس المخزن (عقد واحد)', () => {
    expect(createMockReviewService().getWorkerRatingSummary('w1')).toEqual(
      svc.getWorkerRatingSummary('w1'),
    );
  });
});

describe('التحقق (Zod)', () => {
  const parse = (rating: unknown, comment = '') => reviewFormSchema.safeParse({ rating, comment });
  const msg = (r: ReturnType<typeof parse>) => (r.success ? null : r.error.issues[0]?.message);

  it('النجوم عدد صحيح من ١ إلى ٥', () => {
    for (const ok of [1, 2, 3, 4, 5]) expect(parse(ok).success).toBe(true);
    for (const bad of [6, -1, 2.5, '5', Number.NaN]) {
      expect(msg(parse(bad))).toBe('التقييم عدد صحيح من ١ إلى ٥ نجوم.');
    }
  });

  it('التقييم الفارغ بالكامل مرفوض (النجوم مطلوبة)', () => {
    expect(msg(parse(0))).toBe('اختر تقييمًا من ١ إلى ٥ نجوم.');
    expect(msg(parse(undefined))).toBe('اختر تقييمًا من ١ إلى ٥ نجوم.');
    expect(msg(parse(0, 'تعليق بلا نجوم'))).toBe('اختر تقييمًا من ١ إلى ٥ نجوم.');
  });

  it('التعليق اختياري، يُقص، لا يكون مسافات فقط، ولا يتجاوز الحد', () => {
    expect(parse(5, '').success).toBe(true);
    const trimmed = parse(5, '  جيدة  ');
    expect(trimmed.success && trimmed.data.comment).toBe('جيدة');
    expect(msg(parse(5, '    '))).toContain('مسافات فقط');
    expect(parse(5, 'ا'.repeat(REVIEW_COMMENT_MAX)).success).toBe(true);
    expect(msg(parse(5, 'ا'.repeat(REVIEW_COMMENT_MAX + 1)))).toBe('التعليق لا يتجاوز 500 حرف.');
  });

  it('أسماء العرض غير حساسة وصيغة العدد', () => {
    expect(reviewerDisplayName('محمد الأحمدي')).toBe('محمد أ.');
    expect(reviewerDisplayName('منيرة آل مفرح')).toBe('منيرة م.');
    expect(reviewerDisplayName('سارة')).toBe('سارة');
    expect(reviewerDisplayName('  ')).toBe('عميل');
    expect([1, 2, 5, 23].map(reviewsLabel)).toEqual([
      'تقييم واحد',
      'تقييمان',
      '5 تقييمات',
      '23 تقييمًا',
    ]);
  });
});

describe('التكامل مع المطابقة', () => {
  const home = { place: { ...emptyPlaceDetails(), beneficiaryType: 'home' }, period: null };
  const rating = (id: string) =>
    matchWorker(worker(id), home).criteria.find((c) => c.key === 'rating');

  it('التقييم الفعلي يدخل النسبة، وبلا تقييمات لا معيار ولا تقييم مفترض', () => {
    const avg = svc.getWorkerRatingSummary('w1').average!;
    expect(rating('w1')).toMatchObject({ status: avg >= 4.5 ? 'matched' : 'partial' });
    expect(rating('w1')?.detail).toContain(avg.toFixed(1));
    expect(rating('w12')).toBeUndefined();
    expect(ratingOf(worker('w12'))).toBeNull();
  });

  it('تقييم جديد ينعكس على المطابقة بشكل حتمي', async () => {
    const w = worker('w7');
    expect(rating('w7')).toBeUndefined();
    const requestNo = await requestWith(w);
    await svc.addReview({ requestNo, workerId: w.id, rating: 5, comment: '' });
    expect(rating('w7')).toMatchObject({ status: 'matched' });
    expect(matchWorker(w, home)).toEqual(matchWorker(w, home));
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
            <Route path="/order/workers/:id" element={<WorkerProfilePage />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('عرض التقييمات', () => {
  it('الملخّص والتوزيع وقائمة التعليقات بأسماء عرض', async () => {
    render(
      wrap(
        <>
          <RatingSummaryPanel workerId="w1" />
          <ReviewList workerId="w1" />
        </>,
      ),
    );
    const panel = await screen.findByLabelText('ملخص التقييمات');
    expect(panel).toHaveTextContent(svc.getWorkerRatingSummary('w1').average!.toFixed(1));
    expect(panel).toHaveTextContent('8 تقييمات');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(5);
    const list = await screen.findByRole('list', { name: 'قائمة التقييمات' });
    expect(list).toHaveTextContent('محمد أ.');
    expect(list).not.toHaveTextContent('محمد الأحمدي');
  });

  it('حالة «لا توجد تقييمات بعد» بدل صفر', async () => {
    render(
      wrap(
        <>
          <RatingSummaryPanel workerId="w12" />
          <ReviewList workerId="w12" />
        </>,
      ),
    );
    await waitFor(() => expect(screen.getAllByText('لا توجد تقييمات بعد')).toHaveLength(2));
    expect(screen.queryByText('0.0')).toBeNull();
  });

  it('ملف العاملة يعرض قسم التقييمات، والعاملة غير الموجودة لها حالة واضحة', async () => {
    render(wrap(null, '/order/workers/w4'));
    await screen.findByText('تقييمات وتعليقات العملاء');
    const section = document.getElementById('reviews') as HTMLElement;
    expect(await within(section).findByLabelText('ملخص التقييمات')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'عرض التقييمات' })).toHaveAttribute('href', '#reviews');
    cleanup();
    render(wrap(null, '/order/workers/w-missing'));
    expect(await screen.findByText('العاملة غير موجودة')).toBeInTheDocument();
  });
});

describe('حالات إضافية', () => {
  it('تعليق طويل (٥٠٠ حرف) يُعرض كاملًا في القائمة', async () => {
    const w = worker('w11');
    const requestNo = await requestWith(w);
    const long = 'ممتاز'.repeat(REVIEW_COMMENT_MAX / 5); // ٥٠٠ حرف بلا مسافات طرفية
    await svc.addReview({ requestNo, workerId: w.id, rating: 5, comment: long });
    render(wrap(<ReviewList workerId={w.id} />));
    expect(await screen.findByText(long)).toBeInTheDocument();
  });

  it('المطابقة حتمية عند غياب التقييمات (بلا معيار تقييم)', () => {
    const home = { place: { ...emptyPlaceDetails(), beneficiaryType: 'home' }, period: null };
    const a = matchWorker(worker('w12'), home);
    expect(a.criteria.some((c) => c.key === 'rating')).toBe(false);
    expect(matchWorker(worker('w12'), home)).toEqual(a);
  });
});

describe('التقييم من ملف الطلب', () => {
  it('إضافة ناجحة تحدّث الملخّص فورًا، ثم لا يمكن التقييم مرة ثانية', async () => {
    const user = userEvent.setup();
    const w = worker('w5');
    const before = svc.getWorkerRatingSummary(w.id).count;
    const requestNo = await requestWith(w, 'نوال الشهري');
    render(wrap(null, `/order/request/${requestNo}`));

    const section = (await screen.findByText('العاملة المخصّصة')).closest('section') as HTMLElement;
    expect(within(section).getByRole('link', { name: 'عرض التقييمات' })).toHaveAttribute(
      'href',
      `/order/workers/${w.id}#reviews`,
    );
    await user.click(await within(section).findByRole('button', { name: /أضف تقييمك/ }));

    // خطأ تحقق: بلا نجوم
    await user.click(within(section).getByRole('button', { name: /إرسال التقييم/ }));
    expect(within(section).getByRole('alert')).toHaveTextContent('اختر تقييمًا من ١ إلى ٥ نجوم.');

    // اختيار بالنجوم (أزرار راديو — تعمل بلوحة المفاتيح)
    await user.click(within(section).getByRole('radio', { name: /^5 نجوم/ }));
    expect(within(section).queryByRole('alert')).toBeNull(); // الخطأ يختفي بعد التصحيح
    await user.keyboard('{ArrowLeft}');
    await user.type(within(section).getByLabelText('تعليقك (اختياري)'), 'منظّمة ومتعاونة');
    await user.click(within(section).getByRole('button', { name: /إرسال التقييم/ }));

    expect(await within(section).findByText(/قيّمت هذه العاملة لهذا الطلب/)).toBeInTheDocument();
    expect(svc.getWorkerRatingSummary(w.id).count).toBe(before + 1);
    const mine = svc.getRequestReview(requestNo, w.id)!;
    expect(mine.comment).toBe('منظّمة ومتعاونة');
    expect(
      await within(section).findByText(new RegExp(`\\(${reviewsLabel(before + 1)}\\)`)),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /أضف تقييمك/ })).toBeNull();

    // محاولة ثانية عبر الخدمة نفسها مرفوضة برسالة واضحة
    await expect(
      svc.addReview({ requestNo, workerId: w.id, rating: 3, comment: '' }),
    ).rejects.toThrow(DUPLICATE_REVIEW_MESSAGE);
  });

  it('رسالة التكرار تظهر في النموذج إذا قُيّم الطلب من مكان آخر أثناء فتحه', async () => {
    const user = userEvent.setup();
    const w = worker('w9');
    const requestNo = await requestWith(w);
    render(wrap(null, `/order/request/${requestNo}`));
    const section = (await screen.findByText('العاملة المخصّصة')).closest('section') as HTMLElement;
    await user.click(await within(section).findByRole('button', { name: /أضف تقييمك/ }));
    await svc.addReview({ requestNo, workerId: w.id, rating: 4, comment: '' }); // من تبويب آخر
    await user.click(within(section).getByRole('radio', { name: /^3 نجوم/ }));
    await user.click(within(section).getByRole('button', { name: /إرسال التقييم/ }));
    expect(await within(section).findByText(DUPLICATE_REVIEW_MESSAGE)).toBeInTheDocument();
  });

  it('طلب بلا عاملة لا يعرض نموذج التقييم', async () => {
    const requestNo = await requestWith(null);
    render(wrap(null, `/order/request/${requestNo}`));
    await screen.findByText('العاملة المخصّصة');
    expect(screen.queryByRole('button', { name: /أضف تقييمك/ })).toBeNull();
  });
});
