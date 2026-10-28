import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import ContractDetails from '@/features/contracts/components/ContractDetails';
import { contractFromAcceptedTerms } from '@/features/contracts/api/contracts.api';

afterEach(() => {
  cleanup();
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('contract created from accepted terms', () => {
  it('shows its source, the acceptance time and the accepted terms', async () => {
    const acc = DEMO_ACCOUNTS.find((a) => a.role === 'admin')!;
    saveDemo(acc);
    useAuth.setState({ profile: demoProfile(acc) });
    const c = contractFromAcceptedTerms({
      request_no: 'REQ-1A2B3C4D',
      customer_name: 'فهد العنزي',
      branch: 'شرورة',
      start_date: '2026-11-02',
      end_date: '2026-11-04',
      amounts: { base: 540, vat: 81, total: 621 },
      accepted_terms: ['نوع الخدمة: تأجير يومي.', 'المهمة: تنظيف لمدة 3 أيام.'],
      terms_accepted_at: '2026-10-28T09:15:00Z',
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/contracts/${c.id}`]}>
            <Routes>
              <Route path="/contracts/:id" element={<ContractDetails />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/موافقة إلكترونية على الشروط ·/)).toBeInTheDocument();
    expect(screen.getByText('REQ-1A2B3C4D')).toBeInTheDocument();
    expect(screen.getByText('تاريخ موافقة العميل')).toBeInTheDocument();
    expect(screen.getByText('الشروط التي وافق عليها العميل')).toBeInTheDocument();
    expect(await screen.findByText('المهمة: تنظيف لمدة 3 أيام.')).toBeInTheDocument();
    // signed → the next step is activating it, as any signed contract
    expect(screen.getAllByText('موقّع').length).toBeGreaterThan(0);
  });
});
