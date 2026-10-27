import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import ContractWizard from '@/features/contracts/components/ContractWizard';

afterEach(() => {
  cleanup();
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('contract wizard from a quote', () => {
  it('shows the quote it comes from and its customer', async () => {
    const acc = DEMO_ACCOUNTS.find((a) => a.role === 'admin')!;
    saveDemo(acc);
    useAuth.setState({ profile: demoProfile(acc) });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter
            initialEntries={['/contracts/new?service=recruitment&quote=quote-1&quantity=2']}
          >
            <ContractWizard />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/QT-1001/)).toBeInTheDocument();
    expect(screen.getByText(/سعد الوادعي/)).toBeInTheDocument();
  });
});
