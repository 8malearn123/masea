import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AppRole } from '@masiat/shared';
import { ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import PricingBoard from '@/features/pricing/components/PricingBoard';

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(role);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
function renderBoard(path = '/pricing') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <PricingBoard />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('pricing board', () => {
  it('header, six tabs, live KPIs and the calculator summary', async () => {
    signIn('admin');
    renderBoard();
    expect(screen.getByText('التسعير وعروض الأسعار')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(await screen.findByText('ملخص السعر')).toBeInTheDocument();
    expect(screen.getByText('الإجمالي النهائي شامل الضريبة')).toBeInTheDocument();
    // seeded Philippines recruitment: 16,000 + 15% = 18,400
    expect(screen.getAllByText('18,400.00').length).toBeGreaterThan(0);
  });

  it('keyboard: arrow keys move between tabs (RTL)', async () => {
    signIn('admin');
    renderBoard();
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: /قائمة الأسعار/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /الإعدادات/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('KPI tile opens the filtered quotes list', async () => {
    signIn('admin');
    renderBoard();
    await userEvent.click(await screen.findByRole('button', { name: /العروض المقبولة/ }));
    expect(screen.getByRole('tab', { name: /عروض الأسعار/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('منيرة اليامي')).toBeInTheDocument();
    expect(screen.queryByText('حصة آل سالم')).not.toBeInTheDocument();
  });

  it('view-only roles get no price editing or settings save', async () => {
    signIn('branch_manager');
    renderBoard('/pricing?tab=prices');
    await screen.findByText('قائمة الأسعار الأساسية');
    expect(screen.queryByRole('button', { name: /سعر جديد/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'الإجراءات' })).not.toBeInTheDocument();
    cleanup();
    renderBoard('/pricing?tab=settings');
    expect(await screen.findByText(/للعرض فقط/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /حفظ التغييرات/ })).not.toBeInTheDocument();
  });

  it('quote drawer shows the 8 sections and WhatsApp keeps the status', async () => {
    signIn('admin');
    renderBoard('/pricing?tab=quotes');
    await userEvent.click(await screen.findByRole('button', { name: /فتح العرض QT-1003/ }));
    const dialog = await screen.findByRole('dialog', { name: /QT-1003/ });
    for (const s of [
      'معلومات العميل',
      'تفاصيل الخدمة',
      'تفصيل السعر',
      'الخصومات المطبقة',
      'الضرائب والرسوم',
      'صلاحية العرض',
      'حالة العرض',
      'سجل التغييرات والإرسال',
    ])
      expect(within(dialog).getByText(s)).toBeInTheDocument();
    const open = window.open;
    window.open = () => null;
    await userEvent.click(within(dialog).getByRole('button', { name: /واتساب/ }));
    window.open = open;
    expect((await within(dialog).findAllByText(/فُتح رابط واتساب/)).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('مسودة').length).toBeGreaterThan(0);
  });
});
