import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AppRole } from '@masiat/shared';
import { Table, ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import AccountingBoard from '@/features/accounting/components/AccountingBoard';
import { buildCsv, buildExcelXml, buildPrintHtml } from '@/shared/lib/exportTable';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

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

describe('accounting board (accountant)', () => {
  it('shows the dashboard with the kept and the new indicators', async () => {
    signIn('accountant');
    renderUi(<AccountingBoard />);
    expect(await screen.findByText('الإيراد (قبل الضريبة)')).toBeInTheDocument();
    expect(screen.getByText('إجمالي الذمم الدائنة')).toBeInTheDocument();
    expect(screen.getByText('هامش صافي الربح')).toBeInTheDocument();
    expect(screen.getByText('الدفتر متوازن')).toBeInTheDocument();
  });

  it('groups the navigation into the 13 sections and opens the general ledger', async () => {
    signIn('accountant');
    renderUi(<AccountingBoard />);
    const nav = screen.getByRole('navigation', { name: 'أقسام المحاسبة' });
    for (const g of [
      'المبيعات والتحصيل',
      'البنوك والصناديق',
      'الضرائب والفوترة الإلكترونية',
      'الإقفال المالي',
      'الإعدادات والصلاحيات',
    ])
      expect(within(nav).getByText(g)).toBeInTheDocument();
    await userEvent.click(within(nav).getByText('الأستاذ العام'));
    expect(await screen.findByText('الرصيد الافتتاحي')).toBeInTheDocument();
  });

  it('the assistant answers from the ledger and refuses write requests', async () => {
    signIn('accountant');
    renderUi(<AccountingBoard />);
    const nav = screen.getByRole('navigation', { name: 'أقسام المحاسبة' });
    await userEvent.click(within(nav).getByText('المساعد المحاسبي'));
    await userEvent.type(screen.getByLabelText('سؤالك'), 'رحّل القيد 5');
    await userEvent.click(screen.getByRole('button', { name: /اسأل/ }));
    expect(await screen.findByText(/للاستعلام فقط/)).toBeInTheDocument();
  });

  it('journal shows workflow states with the seeded pending entry', async () => {
    signIn('accountant');
    renderUi(<AccountingBoard />);
    const nav = screen.getByRole('navigation', { name: 'أقسام المحاسبة' });
    await userEvent.click(within(nav).getByText('القيود اليومية'));
    expect(await screen.findByText('استحقاق إيجار سكن العمالة — يونيو')).toBeInTheDocument();
  });
});

describe('shared Table sorting', () => {
  it('sorts by a sortable column', async () => {
    render(
      <Table
        columns={[
          {
            key: 'n',
            header: 'المبلغ',
            cell: (r: { n: number }) => String(r.n),
            sortValue: (r) => r.n,
          },
        ]}
        rows={[{ n: 3 }, { n: 1 }, { n: 2 }]}
        rowKey={(r) => String(r.n)}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'فرز حسب المبلغ' }));
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['1', '2', '3']);
  });
});

describe('exports', () => {
  const t = {
    title: 'ميزان المراجعة',
    subtitle: 'الفترة',
    headers: ['الحساب', 'المبلغ'],
    rows: [['البنك', 1234.5]],
    footer: ['الإجمالي', 1234.5],
  };
  it('Excel XML is RTL with numeric cells', () => {
    const x = buildExcelXml(t);
    expect(x).toContain('ss:RightToLeft="1"');
    expect(x).toContain('<Data ss:Type="Number">1234.5</Data>');
  });
  it('CSV has a BOM and escapes', () => {
    const c = buildCsv({ ...t, rows: [['بنك, الراجحي', 1]] });
    expect(c.charCodeAt(0)).toBe(0xfeff);
    expect(c).toContain('"بنك, الراجحي"');
  });
  it('print HTML is RTL with formatted amounts', () => {
    const h = buildPrintHtml(t);
    expect(h).toContain('dir="rtl"');
    expect(h).toContain('1,234.50');
  });
});
