import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AppRole } from '@masiat/shared';
import { ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import LoyaltyBoard from '@/features/loyalty/components/LoyaltyBoard';
import { TicketsPanel } from '@/features/call-center/components/TicketsPanel';
import PipelineBoard from '@/features/crm/components/PipelineBoard';

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(role);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
function renderUi(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('loyalty edit forms open with the item values', () => {
  it('campaign edit is prefilled', async () => {
    signIn('admin');
    renderUi(<LoyaltyBoard />);
    await userEvent.click(screen.getByRole('button', { name: /التسويق/ }));
    const card = (await screen.findByText('برنامج أحضر صديقًا')).closest('div.py-4') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'تعديل' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('برنامج أحضر صديقًا')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('MAS-REF10-M4X8')).toBeInTheDocument();
  });

  it('wheel prize edit is prefilled', async () => {
    signIn('admin');
    renderUi(<LoyaltyBoard />);
    await userEvent.click(screen.getByRole('button', { name: /الإدارة/ }));
    await screen.findByText('500 نقطة');
    const card = screen.getByText('جوائز عجلة الحظ').closest('h2')!.parentElement!.parentElement!;
    // seed order: w1..w7 — '500 نقطة' is the 4th prize
    await userEvent.click(within(card).getAllByRole('button', { name: 'تعديل' })[3]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('500 نقطة')).toBeInTheDocument();
  });
});

describe('view-only roles see no write buttons', () => {
  it('sales cannot manage campaigns or wheel prizes', async () => {
    signIn('sales');
    renderUi(<LoyaltyBoard />);
    await userEvent.click(screen.getByRole('button', { name: /التسويق/ }));
    await screen.findByText('برنامج أحضر صديقًا');
    expect(screen.queryByRole('button', { name: /حملة جديدة/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حذف' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /الإدارة/ }));
    await screen.findByText('500 نقطة');
    expect(screen.queryByRole('button', { name: /إضافة جائزة/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حذف' })).not.toBeInTheDocument();
  });

  it('sales can read tickets but not change or close them', async () => {
    signIn('sales');
    renderUi(<TicketsPanel />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'متابعة' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('تغيير الحالة')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: /تحديد كمحلولة/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByPlaceholderText(/تحديث للعميل/)).not.toBeInTheDocument();
  });

  it('call center can add leads but not move or edit them', async () => {
    signIn('call_center');
    renderUi(<PipelineBoard />);
    await screen.findByText('عبدالله آل مفرح');
    expect(screen.getByRole('button', { name: /عميل محتمل جديد/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تعديل' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });
});
