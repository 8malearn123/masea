/**
 * واجهة التجديد (الوضع التجريبي): الزر يظهر حيث تنطبق القواعد والصلاحية، شاشة
 * المراجعة قبل الإنشاء، الانتقال للنسخة الجديدة مع رابط الأصل، ورسالة النجاح
 * بعد الحفظ فقط.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import * as contractsApi from '@/features/contracts/api/contracts.api';
import ContractDetails from '@/features/contracts/components/ContractDetails';
import { ContractExpiryWidget } from '@/features/contracts/components/ContractExpiryWidget';
import { RenewContractButton } from '@/features/contracts/components/RenewContract';
import type { AppRole } from '@masiat/shared';

function signInDemo(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo account for ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}

function renderAt(path: string, extra?: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/contracts/:id" element={<ContractDetails />} />
            <Route path="/" element={extra ?? null} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('واجهة تجديد العقد', () => {
  it('تعرض مراجعة ثم تنشئ النسخة وتفتحها مع رابط العقد الأصلي', async () => {
    signInDemo('admin');
    renderAt('/contracts/00009');
    fireEvent.click(await screen.findByRole('button', { name: /تجديد العقد/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('العقد الأصلي')).toBeInTheDocument();
    expect(within(dialog).getByText('النسخة الجديدة المقترحة')).toBeInTheDocument();
    expect(within(dialog).getByText(/مسودة — تمرّ بالاعتماد/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getAllByText('2').length).toBeGreaterThan(0)); // الإصدار

    fireEvent.click(within(dialog).getByRole('button', { name: /تأكيد إنشاء النسخة/ }));

    expect(await screen.findByText(/تم إنشاء النسخة/)).toBeInTheDocument();
    // صفحة النسخة الجديدة: «الإصدار 2 — تجديد العقد MAS-2026-00009»
    const parentLinks = await screen.findAllByRole('link', { name: 'MAS-2026-00009' });
    expect(parentLinks[0]).toHaveAttribute('href', '/contracts/00009');
    expect(screen.getByText(/تجديد العقد/, { selector: 'p' })).toBeInTheDocument();
    expect(await screen.findByText('سجل النسخ')).toBeInTheDocument();
    // مدة نسخة التجديد مطابقة للأصل — لا بطاقة تعديل للمدة
    expect(screen.queryByText('تعديل مدة العقد')).not.toBeInTheDocument();
  });

  it('رسالة النجاح بعد الحفظ فقط، ولا تظهر عند الفشل', async () => {
    signInDemo('admin');
    let reject: (e: Error) => void = () => undefined;
    vi.spyOn(contractsApi, 'renewContract').mockImplementation(
      () => new Promise((_, rej) => (reject = rej)),
    );
    renderAt('/contracts/00008');
    fireEvent.click(await screen.findByRole('button', { name: /تجديد العقد/ }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /تأكيد إنشاء النسخة/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // ضغط مكرّر أثناء الحفظ
    await waitFor(() => expect(contractsApi.renewContract).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/تم إنشاء النسخة/)).not.toBeInTheDocument();

    reject(new Error('تعذّر تجديد العقد: permission denied'));
    expect(await screen.findByText(/تعذّر تجديد العقد/)).toBeInTheDocument();
    expect(screen.queryByText(/تم إنشاء النسخة/)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // يبقى على المراجعة
  });

  it('لا يظهر الزر للعقد الملغى ولا لمن لا يملك صلاحية الإنشاء', async () => {
    signInDemo('admin');
    renderAt('/contracts/00006'); // ملغى
    await screen.findByText('بيانات العقد');
    expect(screen.queryByRole('button', { name: /تجديد العقد/ })).not.toBeInTheDocument();
    cleanup();

    const parent = await contractsApi.getContract('00009');
    signInDemo('call_center');
    renderAt('/', parent && <RenewContractButton contract={parent} existingRenewals={[]} />);
    expect(screen.queryByRole('button', { name: /تجديد العقد/ })).not.toBeInTheDocument();
  });

  it('بطاقة التنبيهات: زر التجديد للعقد المستحق، و«تم التجديد» بعد إنشاء النسخة', async () => {
    signInDemo('admin');
    const row = (no: string) => screen.getByText(no).closest('li') as HTMLElement;
    renderAt('/', <ContractExpiryWidget />);
    await screen.findByLabelText(/^منتهية/);
    expect(
      within(row('MAS-2026-00008')).getByRole('button', { name: /تجديد العقد/ }),
    ).toBeVisible();
    // 00004 تواريخه لا تكوّن مدة كاملة — لا زر تجديد بل «عرض العقد» فقط
    expect(within(row('MAS-2026-00004')).queryByRole('button', { name: /تجديد العقد/ })).toBeNull();
    expect(within(row('MAS-2026-00004')).getByText('عرض العقد')).toBeVisible();
    cleanup();

    const parent = await contractsApi.getContract('00008');
    if (!parent?.end_date) throw new Error('seed');
    const { renewalTerm, defaultRenewalStart } =
      await import('@/features/contracts/lib/contractRenewal');
    const plan = renewalTerm(parent, defaultRenewalStart(parent));
    if (plan.error !== null) throw new Error(plan.error);
    await contractsApi.renewContract('00008', plan.term.start_date, plan.term.end_date);

    renderAt('/', <ContractExpiryWidget />);
    await screen.findByLabelText(/^منتهية/);
    expect(within(row('MAS-2026-00008')).getByText(/تم التجديد/)).toBeVisible();
    expect(within(row('MAS-2026-00008')).queryByRole('button', { name: /تجديد العقد/ })).toBeNull();
  });
});
