/**
 * مسار الطلب التجريبي كاملًا: الإنشاء → الدفع التجريبي → التأكيد (وسم تجريبي)
 * → التتبّع، مع التحقق من الجوال، والضغط المزدوج، وأخطاء الدفع.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/shared/ui';
import StepWizard from '@/components/order/StepWizard';
import OrderTracking from '@/pages/order/OrderTracking';
import { emptyDraft } from '@/lib/orderTypes';
import { requestServiceFor } from '@/features/requests/services';
import { RequestServiceError } from '@/features/requests/services/types';

function wrap(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="/" element={ui} />
            <Route path="/order/track" element={<OrderTracking />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** يمشي بطلب تأجير يومي حتى خطوة بيانات العميل. */
async function walkToCustomer(user: ReturnType<typeof userEvent.setup>) {
  const { container } = render(
    wrap(
      <StepWizard
        service="daily_rental"
        serviceName="تأجير يومي"
        initialDraft={emptyDraft('daily_rental')}
        onReset={() => undefined}
      />,
    ),
  );
  const next = () => user.click(screen.getByRole('button', { name: 'التالي' }));
  await user.click(await screen.findByRole('button', { name: /منزل/ }));
  await next();
  await user.click(await screen.findByRole('button', { name: 'تنظيف وترتيب' }));
  await next();
  await user.type(container.querySelector('input[type="date"]') as HTMLInputElement, '2026-11-02');
  await next();
  await user.click(await screen.findByRole('button', { name: 'تنظيف' }));
  await next();
  await screen.findByText(/عاملة مرشّحة لاحتياج طلبك/);
  await next(); // الاختيار اختياري في التأجير اليومي
  await screen.findByLabelText('الاسم الكامل');
  return next;
}

async function fillCustomer(user: ReturnType<typeof userEvent.setup>, phone: string) {
  await user.type(screen.getByLabelText('الاسم الكامل'), 'هيا آل مفرح');
  await user.type(screen.getByLabelText('رقم الجوال'), phone);
  await user.selectOptions(screen.getByLabelText('الفرع'), 'نجران');
}

describe('مسار الطلب التجريبي', () => {
  it('يمنع المتابعة بجوال غير صالح برسالة واضحة', async () => {
    const user = userEvent.setup();
    await walkToCustomer(user);
    await fillCustomer(user, '12345');
    expect(await screen.findByText('رقم الجوال غير صحيح — مثال: 0501234567')).toBeVisible();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();
  });

  it('ينشئ طلبًا تجريبيًا واحدًا رغم الضغط المزدوج، ويعرض وسم «تجريبي» ورابط التتبّع', async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(requestServiceFor('mock'), 'submit');
    const next = await walkToCustomer(user);
    await fillCustomer(user, '+966 50 123 4567');
    await next(); // التسعير
    await next(); // الدفع

    const pay = await screen.findByRole('button', { name: /ادفع/ });
    fireEvent.click(pay);
    fireEvent.click(pay); // ضغط مزدوج سريع

    expect(await screen.findByText('تم استلام طلبك بنجاح', {}, { timeout: 4000 })).toBeVisible();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/طلب تجريبي/)).toBeVisible();
    expect(screen.queryByText(/لم يُحفظ في القاعدة/)).not.toBeInTheDocument();

    const requestNo = (await submit.mock.results[0]?.value)?.requestNo as string;
    expect(screen.getByText(requestNo)).toBeVisible();
    const track = screen.getByRole('link', { name: /تتبّع الطلب/ });
    expect(track).toHaveAttribute('href', `/order/track?no=${requestNo}`);

    // التتبّع يفتح الطلب نفسه مع وسم تجريبي
    await user.click(track);
    expect(await screen.findByText('مدفوع — قيد المعالجة')).toBeVisible();
    expect(screen.getByText('طلب تجريبي')).toBeVisible();
  });

  it('خطأ الإرسال يظهر للمستخدم ويبقى على خطوة الدفع (لا تعليق ولا تأكيد وهمي)', async () => {
    const user = userEvent.setup();
    vi.spyOn(requestServiceFor('mock'), 'submit').mockRejectedValueOnce(
      new RequestServiceError('تعذّر إرسال الطلب: الخدمة غير متاحة', 'backend'),
    );
    const next = await walkToCustomer(user);
    await fillCustomer(user, '0501234567');
    await next();
    await next();
    await user.click(await screen.findByRole('button', { name: /ادفع/ }));

    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      'تعذّر إرسال الطلب: الخدمة غير متاحة',
    );
    expect(screen.queryByText('تم استلام طلبك بنجاح')).not.toBeInTheDocument();
    // يعود الزر للعمل ويمكن إعادة المحاولة بنجاح
    await user.click(screen.getByRole('button', { name: /ادفع/ }));
    expect(await screen.findByText('تم استلام طلبك بنجاح', {}, { timeout: 4000 })).toBeVisible();
  });
});

describe('صفحة التتبّع', () => {
  it('لا تختلق طلبًا لرقم غير موجود', async () => {
    render(wrap(null, '/order/track?no=REQ-00000000'));
    expect(await screen.findByText('لم نعثر على هذا الطلب')).toBeVisible();
  });

  it('تعرض حالة خطأ قابلة لإعادة المحاولة عند فشل الجلب', async () => {
    const track = vi
      .spyOn(requestServiceFor('mock'), 'track')
      .mockRejectedValueOnce(new Error('network'));
    render(wrap(null, '/order/track?no=REQ-2A7F41C9'));
    expect(await screen.findByText('تعذّر جلب حالة الطلب')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(track).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('REQ-2A7F41C9')).toBeVisible();
  });
});
