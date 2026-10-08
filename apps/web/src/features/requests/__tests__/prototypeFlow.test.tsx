import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/shared/ui';
import StepWizard from '@/components/order/StepWizard';
import { ChatWidget } from '@/features/chatbot/components/ChatWidget';
import { emptyDraft } from '@/lib/orderTypes';
import { answerHome, futureDay } from './placeHelpers';

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

// vitest يعمل بلا globals، فالتنظيف بعد كل اختبار يدوي.
afterEach(cleanup);

describe('مسار الطلب التفاعلي (Prototype)', () => {
  it('يبدأ التأجير اليومي بخطوة نوع المستفيد ويُظهر أنواع المناسبات عند اختيارها', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <StepWizard
          service="daily_rental"
          serviceName="تأجير يومي"
          initialDraft={emptyDraft('daily_rental')}
          onReset={() => undefined}
        />,
      ),
    );

    // الخطوة الأولى: أنواع المستفيد من القائمة المرجعية
    expect(await screen.findByRole('button', { name: /منزل/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /مناسبة/ }));

    // اختيار «مناسبة» يفتح قائمة أنواع المناسبات
    expect(await screen.findByLabelText('نوع المناسبة')).toBeInTheDocument();
  });

  it('يمشي بالطلب حتى ترشيح العاملة ويُظهر نسبة المطابقة والتواريخ', async () => {
    const user = userEvent.setup();
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

    // ١) نوع المستفيد
    await user.click(await screen.findByRole('button', { name: /منزل/ }));
    await next();

    // ٢) بيانات مكان الخدمة — أسئلة المنزل واحتياج رعاية واحد على الأقل
    await answerHome(user);
    await user.click(await screen.findByRole('button', { name: 'تنظيف وترتيب' }));
    await next();

    // ٣) المدة: تاريخ البداية وعدد الأيام ثم تاريخ النهاية المحسوب
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dateInput, futureDay(25));
    expect(await screen.findByText('تاريخ نهاية الخدمة')).toBeInTheDocument();
    await next();

    // ٤) نوع المهمة
    await user.click(await screen.findByRole('button', { name: 'تنظيف' }));
    await next();

    // ٥) ترشيح العاملة حسب الاحتياج
    expect(await screen.findByText(/عاملة مرشّحة لاحتياج طلبك/)).toBeInTheDocument();
    expect(screen.getAllByText(/مطابقة/).length).toBeGreaterThan(0);
  });

  it('المساعد يجيب عن سؤال العميل من قاعدة معرفة ماسية الشرق', async () => {
    const user = userEvent.setup();
    render(wrap(<ChatWidget />));

    await user.click(screen.getByRole('button', { name: 'فتح مساعد العملاء' }));
    await user.type(screen.getByPlaceholderText('اكتب سؤالك…'), 'وش فروعكم؟');
    await user.click(screen.getByRole('button', { name: 'إرسال' }));

    await waitFor(() =>
      expect(screen.getByText(/نجران، جازان، شرورة، وحبونا/)).toBeInTheDocument(),
    );
  });
});
