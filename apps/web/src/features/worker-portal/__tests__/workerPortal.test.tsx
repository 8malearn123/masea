/**
 * لوحة العاملة: دور «العاملة» بلا وحدات إدارية، ودخول مشترك مع بقية الحسابات،
 * ولوحة شخصية ببياناتها هي فقط من المخازن القائمة (بلا بيانات العميل الشخصية).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AppRole } from '@masiat/shared';
import { ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, findDemoAccount, saveDemo } from '@/lib/demo';
import { MODULES, ROLE_META, ROLE_PERMISSIONS } from '@/lib/permissions';
import { assignDriver } from '@/features/orders/api/orders.api';
import { getWorkerPortal } from '@/features/worker-portal/services/workerPortal';
import Dashboard from '@/pages/Dashboard';

afterEach(() => {
  cleanup();
  clearDemo();
  useAuth.setState({ profile: null });
});

const WORKER = DEMO_ACCOUNTS.find((a) => a.role === 'worker')!;
const LINK = { workerId: 'w3', residentId: 'r2' };

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('دور العاملة والدخول المشترك', () => {
  it('حساب تجريبي بنفس شاشة الدخول ومرتبط صراحةً بملفها وسجل سكنها', () => {
    expect(findDemoAccount('worker@demo.masea', 'demo1234')).toBe(WORKER);
    expect(WORKER).toMatchObject({ role: 'worker', workerId: 'w3', residentId: 'r2' });
    expect(ROLE_META.worker).toMatchObject({ label: 'العاملة', crossBranch: false });
  });

  it('بلا أي صلاحية على الوحدات الإدارية', () => {
    expect(ROLE_PERMISSIONS.worker.size).toBe(0);
    for (const m of MODULES) expect(ROLE_PERMISSIONS.worker.has(`${m.module}.view`)).toBe(false);
  });
});

describe('بيانات بوابة العاملة', () => {
  it('ملفها وسكنها ورمز المسح', async () => {
    const p = (await getWorkerPortal(LINK))!;
    expect(p.worker).toMatchObject({ id: 'w3', full_name: 'سيتي نورهاليزا' });
    expect(p.resident).toMatchObject({ id: 'r2', dorm: 'سكن جازان', barcode: 'MAS-W-1002' });
  });

  it('مهامها فقط، بحالة طلب التشغيل، وبلا بيانات العميل الشخصية', async () => {
    const p = (await getWorkerPortal(LINK))!;
    const nos = p.assignments.map((a) => a.requestNo);
    expect(nos).toContain('REQ-2A7F41C9'); // مُسند لها
    expect(nos).not.toContain('REQ-93BD5E08'); // مُسند لعاملة أخرى
    const mine = p.assignments.find((a) => a.requestNo === 'REQ-2A7F41C9')!;
    expect(mine).toMatchObject({ orderStatus: 'paid', tripStage: 'none', city: 'نجران' });
    for (const a of p.assignments) {
      for (const key of ['phone', 'national_id', 'address', 'customer_name']) {
        expect(a).not.toHaveProperty(key);
      }
    }
  });

  it('جدولها من حجوزات التوفّر، وتغيير الموظف للحالة ينعكس فورًا', async () => {
    const before = (await getWorkerPortal(LINK))!;
    expect(before.schedule.some((r) => r.request_no === 'REQ-2A7F41C9')).toBe(true);
    await assignDriver('o10', 'd1'); // o10 = طلب تشغيل REQ-2A7F41C9
    const after = (await getWorkerPortal(LINK))!;
    expect(after.assignments.find((a) => a.requestNo === 'REQ-2A7F41C9')?.orderStatus).toBe(
      'assigned',
    );
  });

  it('عاملة غير موجودة: null', async () => {
    expect(await getWorkerPortal({ workerId: 'w-missing', residentId: null })).toBeNull();
  });
});

describe('لوحة العاملة في الواجهة', () => {
  it('حساب العاملة يرى «لوحتي» ببياناته وتقييماته، لا لوحة الشركة', async () => {
    signIn('worker');
    renderDashboard();
    expect(await screen.findByText('سيتي نورهاليزا')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'لوحتي' })).toBeInTheDocument();
    expect(screen.getByText('MAS-W-1002')).toBeInTheDocument();
    const tasks = screen.getByRole('list', { name: 'مهامي' });
    expect(within(tasks).getByLabelText('مهمة REQ-2A7F41C9')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'جدولي' })).toBeInTheDocument();
    expect(await screen.findByLabelText('ملخص التقييمات')).toBeInTheDocument();
    // لا مؤشرات الشركة ولا بيانات العميل الشخصية
    const text = document.body.textContent ?? '';
    for (const s of [
      'إيرادات الشهر',
      'إجمالي العمالة',
      '0555102244',
      '1078451236',
      'نورة الشهري',
    ]) {
      expect(text).not.toContain(s);
    }
  });

  it('حساب بدور عاملة غير مرتبط بملف: رسالة واضحة', async () => {
    saveDemo({ ...WORKER, email: 'unlinked@demo.masea' });
    useAuth.setState({ profile: demoProfile(WORKER) });
    renderDashboard();
    expect(await screen.findByText('الحساب غير مرتبط بملف عاملة')).toBeInTheDocument();
  });
});
