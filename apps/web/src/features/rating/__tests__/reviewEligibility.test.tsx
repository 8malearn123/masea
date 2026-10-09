/**
 * أهلية تقييم العاملة: تقييم جديد فقط عندما تكون حالة طلب التشغيل المرتبط
 * «مكتملة» صراحةً في مخزن الطلبات المشترك — لا استنتاج من التواريخ أو الدفع أو
 * النص. التقييم القائم يبقى مقروءًا، ومنع التكرار باقٍ.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/shared/ui';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import { emptyDraft } from '@/lib/orderTypes';
import {
  advanceTripStage,
  assignDriver,
  demoOrderStatusOf,
  findDemoOrderByRequestNo,
  setOrderStatus,
} from '@/features/orders/api/orders.api';
import { useSetOrderStatus } from '@/features/orders/hooks/useOrders';
import type { OrderStatus } from '@/features/orders/types';
import {
  blankRequestFile,
  getRequestFile,
  saveRequestFile,
} from '@/features/requests/api/requests.api';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import RequestSummary from '@/features/requests/components/RequestSummary';
import {
  DUPLICATE_REVIEW_MESSAGE,
  getReviewService,
  REVIEW_NOT_READY_MESSAGE,
} from '@/features/rating/services/reviewService';

afterEach(cleanup);

const svc = getReviewService();
const worker = (id: string) => FALLBACK_WORKERS.find((w) => w.id === id)!;
const COMPLETED_SEED = 'REQ-5D2C8A17'; // خدمة مكتملة جاهزة في بيانات العرض
const PAID_SEED = 'REQ-2A7F41C9'; // مدفوع وفترته بدأت — ليس مكتملًا

let seq = 0;
/** طلب جديد عبر خدمة الطلبات (يُنشئ طلب التشغيل بحالة «مدفوع»). */
async function newRequest(workerId = 'w8') {
  seq += 1;
  const w = worker(workerId);
  const res = await createMockRequestService().submit({
    clientToken: `eligibility-${seq}-${Math.random().toString(36).slice(2)}`,
    serviceName: 'تأجير يومي',
    price: { base: 300, vat: 45, total: 345 },
    worker: w,
    draft: {
      ...emptyDraft('daily_rental'),
      customerName: 'ريم الدوسري',
      phone: '0501234567',
      workerProfileId: w.id,
    },
  });
  return { requestNo: res.requestNo, workerId: w.id };
}

const staffSets = (requestNo: string, status: OrderStatus) =>
  setOrderStatus(findDemoOrderByRequestNo(requestNo)!.id, status);
/** «مُسند» يتم بإسناد سائق (لا يُختار يدويًا بلا سائق). */
const staffAssigns = (requestNo: string, driverId = 'd1') =>
  assignDriver(findDemoOrderByRequestNo(requestNo)!.id, driverId);

/** مسار الموظفين الصالح من «مدفوع»: إسناد سائق ← قيد التنفيذ ← مكتمل. */
async function staffCompletes(requestNo: string) {
  await staffAssigns(requestNo);
  for (const s of ['in_progress', 'completed'] as const) await staffSets(requestNo, s);
}

describe('أهلية التقييم في خدمة التقييمات', () => {
  it('خدمة مكتملة: التقييم متاح', async () => {
    expect(demoOrderStatusOf(COMPLETED_SEED)).toBe('completed');
    expect(await svc.getReviewEligibility(COMPLETED_SEED, 'w2')).toEqual({ status: 'eligible' });
  });

  it('طلب جديد أو جارٍ أو ملغى: لا تقييم جديد، والرسالة واضحة', async () => {
    const { requestNo, workerId } = await newRequest();
    expect(demoOrderStatusOf(requestNo)).toBe('paid');
    for (const status of ['paid', 'assigned', 'in_progress', 'cancelled'] as const) {
      if (status === 'assigned') await staffAssigns(requestNo);
      else if (status !== 'paid') await staffSets(requestNo, status);
      expect(await svc.getReviewEligibility(requestNo, workerId)).toEqual({
        status: 'not_completed',
        serviceStatus: status,
      });
      await expect(
        svc.addReview({ requestNo, workerId, rating: 5, comment: '' }),
      ).rejects.toMatchObject({ kind: 'not_completed', message: REVIEW_NOT_READY_MESSAGE });
    }
    expect(svc.getRequestReview(requestNo, workerId)).toBeNull();
  });

  it('لا استنتاج من الدفع أو التواريخ أو النص: طلب العرض المدفوع ليس مكتملًا', async () => {
    const file = (await getRequestFile(PAID_SEED))!;
    expect(file.status).toContain('مدفوع');
    expect(await svc.getReviewEligibility(PAID_SEED, file.worker!.id)).toMatchObject({
      status: 'not_completed',
      serviceStatus: 'paid',
    });
  });

  it('طلب غير موجود: not_found', async () => {
    expect(await svc.getReviewEligibility('REQ-00000000', 'w1')).toEqual({ status: 'not_found' });
    await expect(
      svc.addReview({ requestNo: 'REQ-00000000', workerId: 'w1', rating: 4, comment: '' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('طلب بلا طلب تشغيل مرتبط (حالة غير معروفة): لا تقييم', async () => {
    const requestNo = 'REQ-0E0E0E0E';
    saveRequestFile({
      ...blankRequestFile(requestNo),
      worker: { id: 'w8', full_name: 'x', nationality: 'كينيا', profession: 'عاملة منزلية' },
    });
    expect(demoOrderStatusOf(requestNo)).toBeNull();
    expect(await svc.getReviewEligibility(requestNo, 'w8')).toEqual({
      status: 'not_completed',
      serviceStatus: null,
    });
    await expect(
      svc.addReview({ requestNo, workerId: 'w8', rating: 4, comment: '' }),
    ).rejects.toMatchObject({ kind: 'not_completed' });
  });

  it('عاملة غير مرتبطة بالطلب أو طلب بلا عاملة', async () => {
    expect(await svc.getReviewEligibility(COMPLETED_SEED, 'w1')).toEqual({
      status: 'worker_mismatch',
    });
    const requestNo = 'REQ-0F0F0F0F';
    saveRequestFile(blankRequestFile(requestNo));
    expect(await svc.getReviewEligibility(requestNo, 'w1')).toEqual({ status: 'no_worker' });
  });

  it('تغيير الحالة من الموظف يفتح التقييم، ثم يُمنع التكرار ولا يُعاد فتح المكتمل', async () => {
    const { requestNo, workerId } = await newRequest('w10');
    await staffCompletes(requestNo);
    expect(await svc.getReviewEligibility(requestNo, workerId)).toEqual({ status: 'eligible' });
    const row = await svc.addReview({ requestNo, workerId, rating: 5, comment: 'ممتازة' });
    await expect(
      svc.addReview({ requestNo, workerId, rating: 2, comment: '' }),
    ).rejects.toMatchObject({ kind: 'duplicate', message: DUPLICATE_REVIEW_MESSAGE });

    // محاولة إعادة الطلب «قيد التنفيذ» مرفوضة: يبقى مكتملًا والتقييم القائم ظاهرًا
    await expect(staffSets(requestNo, 'in_progress')).rejects.toThrow('الطلب مكتمل');
    expect(demoOrderStatusOf(requestNo)).toBe('completed');
    expect(await svc.getReviewEligibility(requestNo, workerId)).toEqual({
      status: 'reviewed',
      review: row,
    });
    await expect(
      svc.addReview({ requestNo, workerId, rating: 3, comment: '' }),
    ).rejects.toMatchObject({ kind: 'duplicate' });
  });

  it('إرسالان متزامنان لطلب مكتمل: يمر واحد فقط', async () => {
    const { requestNo, workerId } = await newRequest('w11');
    await staffCompletes(requestNo);
    const results = await Promise.allSettled([
      svc.addReview({ requestNo, workerId, rating: 4, comment: '' }),
      svc.addReview({ requestNo, workerId, rating: 4, comment: '' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('مسار الرحلة الكامل (إسناد ثم المسح حتى الإرجاع للسكن) يجعل الحالة مكتملة', async () => {
    const { requestNo, workerId } = await newRequest('w9');
    const orderId = findDemoOrderByRequestNo(requestNo)!.id;
    await assignDriver(orderId, 'd1');
    for (const scan of ['warehouse_out', 'customer_arrived', 'service_end', 'warehouse_in']) {
      await advanceTripStage(orderId, scan);
    }
    expect(demoOrderStatusOf(requestNo)).toBe('completed');
    expect(await svc.getReviewEligibility(requestNo, workerId)).toEqual({ status: 'eligible' });
  });

  it('خطّاف الموظفين (useSetOrderStatus) يكتب في المخزن الذي تقرؤه خدمة التقييمات', async () => {
    const { requestNo, workerId } = await newRequest('w7');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSetOrderStatus(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    });
    const orderId = findDemoOrderByRequestNo(requestNo)!.id;
    await staffAssigns(requestNo);
    for (const status of ['in_progress', 'completed'] as const) {
      await act(() => result.current.mutateAsync({ orderId, status }));
    }
    expect(await svc.getReviewEligibility(requestNo, workerId)).toEqual({ status: 'eligible' });
  });
});

describe('انتقالات مرفوضة لا تفتح التقييم', () => {
  const notCompleted = (requestNo: string, workerId: string, serviceStatus: OrderStatus) =>
    expect(svc.getReviewEligibility(requestNo, workerId)).resolves.toEqual({
      status: 'not_completed',
      serviceStatus,
    });

  it('«مدفوع» ← «مكتمل» مباشرة: مرفوض والتقييم مغلق', async () => {
    const { requestNo, workerId } = await newRequest('w5');
    await expect(staffSets(requestNo, 'completed')).rejects.toThrow('من «مدفوع» إلى «مكتمل»');
    await notCompleted(requestNo, workerId, 'paid');
    await expect(
      svc.addReview({ requestNo, workerId, rating: 5, comment: '' }),
    ).rejects.toMatchObject({ kind: 'not_completed' });
  });

  it('مسح الإرجاع للسكن على طلب «مدفوع» غير مُسند: مرفوض ولا يتغير الطلب', async () => {
    const { requestNo, workerId } = await newRequest('w5');
    const before = { ...findDemoOrderByRequestNo(requestNo)! };
    await expect(advanceTripStage(before.id, 'warehouse_in')).rejects.toThrow(
      'من «مدفوع» إلى «مكتمل»',
    );
    expect(findDemoOrderByRequestNo(requestNo)).toEqual(before);
    await notCompleted(requestNo, workerId, 'paid');
  });

  it('الملغى نهائي: لا إكمال ولا إسناد ولا مسح', async () => {
    const { requestNo, workerId } = await newRequest('w5');
    await staffSets(requestNo, 'cancelled');
    const orderId = findDemoOrderByRequestNo(requestNo)!.id;
    await expect(staffSets(requestNo, 'completed')).rejects.toThrow('الطلب ملغى');
    await expect(assignDriver(orderId, 'd1')).rejects.toThrow('الطلب ملغى');
    await expect(advanceTripStage(orderId, 'warehouse_in')).rejects.toThrow('الطلب ملغى');
    await notCompleted(requestNo, workerId, 'cancelled');
  });

  it('رحلة بدأت ولم تنتهِ: لا إكمال يدوي قبل مسح الإرجاع', async () => {
    const { requestNo, workerId } = await newRequest('w5');
    const orderId = findDemoOrderByRequestNo(requestNo)!.id;
    await assignDriver(orderId, 'd3');
    await advanceTripStage(orderId, 'warehouse_out');
    await advanceTripStage(orderId, 'customer_arrived');
    await expect(staffSets(requestNo, 'completed')).rejects.toThrow('الرحلة لم تنتهِ');
    expect(findDemoOrderByRequestNo(requestNo)).toMatchObject({
      status: 'in_progress',
      trip_stage: 'delivered',
    });
    await notCompleted(requestNo, workerId, 'in_progress');
  });

  it('خطّاف الموظفين: الرفض يعيد الواجهة لحالتها ولا يغيّر المخزن', async () => {
    const { requestNo, workerId } = await newRequest('w5');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSetOrderStatus(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    });
    const orderId = findDemoOrderByRequestNo(requestNo)!.id;
    await act(async () => {
      await expect(result.current.mutateAsync({ orderId, status: 'completed' })).rejects.toThrow(
        'من «مدفوع» إلى «مكتمل»',
      );
    });
    await notCompleted(requestNo, workerId, 'paid');
  });
});

/* -------------------------------- الواجهة -------------------------------- */
function renderRequest(requestNo: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <MemoryRouter initialEntries={[`/order/request/${requestNo}`]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="/order/request/:requestNo" element={<RequestSummary />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  render(ui);
}

const workerSection = async () =>
  (await screen.findByText('العاملة المخصّصة')).closest('section') as HTMLElement;

describe('أهلية التقييم في ملف الطلب', () => {
  it('طلب غير مكتمل: الرسالة بدل النموذج', async () => {
    const { requestNo } = await newRequest('w8');
    renderRequest(requestNo);
    const section = await workerSection();
    expect(await within(section).findByText(REVIEW_NOT_READY_MESSAGE)).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /أضف تقييمك/ })).toBeNull();
    expect(within(section).queryByRole('radiogroup')).toBeNull();
  });

  it('خدمة مكتملة: زر «أضف تقييمك» ثم النموذج', async () => {
    renderRequest(COMPLETED_SEED);
    const section = await workerSection();
    await userEvent
      .setup()
      .click(await within(section).findByRole('button', { name: /أضف تقييمك/ }));
    expect(within(section).getByRole('radiogroup', { name: 'عدد النجوم' })).toBeInTheDocument();
    expect(within(section).queryByText(REVIEW_NOT_READY_MESSAGE)).toBeNull();
  });

  it('بعد تعليم الموظف للطلب مكتملًا يظهر التقييم عند فتح الملف', async () => {
    const { requestNo } = await newRequest('w12');
    renderRequest(requestNo);
    expect(await within(await workerSection()).findByText(REVIEW_NOT_READY_MESSAGE)).toBeVisible();
    cleanup();
    await staffCompletes(requestNo);
    renderRequest(requestNo);
    const section = await workerSection();
    expect(await within(section).findByRole('button', { name: /أضف تقييمك/ })).toBeVisible();
  });

  it('محاولة إكمال غير صالحة من الموظف لا تُظهر نموذج التقييم', async () => {
    const { requestNo } = await newRequest('w6');
    await expect(staffSets(requestNo, 'completed')).rejects.toThrow();
    renderRequest(requestNo);
    const section = await workerSection();
    expect(await within(section).findByText(REVIEW_NOT_READY_MESSAGE)).toBeVisible();
    expect(within(section).queryByRole('button', { name: /أضف تقييمك/ })).toBeNull();
  });
});
