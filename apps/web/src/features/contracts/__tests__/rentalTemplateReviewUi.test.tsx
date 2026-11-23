/**
 * «مراجعة قالب عقد التأجير» (الوضع التجريبي): المعاينة وتقرير المطابقة
 * ظاهران، الاعتماد بصلاحية contracts.approve فقط، وبعده يُقفل النص.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import RentalTemplateReview from '@/features/contracts/components/RentalTemplateReview';
import { resetRentalDemoStore } from '@/features/contracts/api/rentalContract.api';
import type { AppRole } from '@masiat/shared';

function signInDemo(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo account for ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <RentalTemplateReview />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  clearDemo();
  resetRentalDemoStore();
  useAuth.setState({ profile: null });
});

describe('مراجعة قالب عقد التأجير', () => {
  it('تعرض المعاينة الكاملة وتقرير المطابقة والقالب بانتظار الاعتماد', async () => {
    resetRentalDemoStore('pending_review');
    signInDemo('admin');
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'عقد تأجير خدمات عمالية' }),
    ).toBeInTheDocument();
    expect(screen.getByText('بانتظار الاعتماد')).toBeInTheDocument();
    expect(screen.getByTitle('معاينة عقد تأجير خدمات عمالية')).toBeInTheDocument();
    expect(screen.getByText('تقرير المطابقة مع الأصل')).toBeInTheDocument();
    expect(screen.getByText('الأقسام الاثنا عشر بترتيب الأصل')).toBeInTheDocument();
    expect(screen.getByText('سياسة الاستبدال المقترحة')).toBeInTheDocument();
  });

  it('الاعتماد يقفل النص (مدير)', async () => {
    resetRentalDemoStore('pending_review');
    signInDemo('admin');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /اعتماد القالب/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^اعتماد$/ }));
    expect(await screen.findByText('النص مقفل')).toBeInTheDocument();
    expect(screen.getByText('معتمد')).toBeInTheDocument();
    expect(await screen.findByText(/تم اعتماد القالب/)).toBeInTheDocument(); // toast
    expect(screen.queryByRole('button', { name: /^اعتماد القالب$/ })).toBeNull();
  });

  it('المبيعات تراجع ولا تعتمد', async () => {
    resetRentalDemoStore('pending_review');
    signInDemo('sales');
    renderPage();
    expect(await screen.findByText('بانتظار الاعتماد')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /اعتماد القالب/ })).toBeNull();
  });
});
