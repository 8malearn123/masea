/**
 * ظهور تنبيهات انتهاء العقود في لوحة التحكم وصفحة العقود (الوضع التجريبي):
 * الأعداد من بيانات العرض نفسها، احترام الصلاحية ونطاق الفرع، المهلة من
 * الإعدادات، وعدم عرض «لا تنبيهات» عند فشل الجلب.
 */
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/shared/ui';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import * as contractsApi from '@/features/contracts/api/contracts.api';
import * as settingsApi from '@/features/settings/api/settings.api';
import { ContractExpiryWidget } from '@/features/contracts/components/ContractExpiryWidget';
import ContractsList from '@/features/contracts/components/ContractsList';
import { CompanyOverview } from '@/features/dashboard/components/CompanyOverview';
import type { AppRole } from '@masiat/shared';

beforeAll(() => {
  // recharts (لوحة التحكم) يحتاج ResizeObserver غير الموجود في jsdom
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function signInDemo(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo account for ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}

/** فقرة «مهلة التنبيه N يومًا» — الرقم في عنصر فرعي بخط الأرقام. */
const windowText = (days: number) => (_: string, el: Element | null) =>
  el?.tagName === 'P' && new RegExp(`مهلة التنبيه\\s*${days}\\s*يومًا`).test(el.textContent ?? '');

function renderWith(ui: ReactNode, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
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

/*
 * بيانات العرض (contracts.api) فيها ثلاثة عقود سارية بتواريخ نهاية نسبية لليوم:
 * 00009 انتهى قبل ٦ أيام (نجران) · 00008 ينتهي بعد ٤ أيام (جازان) · 00004 بعد ١١ يومًا (نجران).
 */
describe('تنبيهات العقود في لوحة التحكم', () => {
  it('تعرض أعداد المنتهية والحرجة والقريبة للمدير مع وسم البيانات التجريبية', async () => {
    signInDemo('admin');
    renderWith(<ContractExpiryWidget />);
    expect(await screen.findByLabelText('منتهية 1')).toBeInTheDocument();
    expect(screen.getByText('تنبيهات انتهاء العقود')).toBeInTheDocument();
    expect(screen.getByLabelText('حرجة 1')).toBeInTheDocument();
    expect(screen.getByLabelText('قريبة الانتهاء 1')).toBeInTheDocument();
    expect(screen.getByLabelText('تاريخ النهاية غير محدد 0')).toBeInTheDocument();
    expect(screen.getByText('بيانات تجريبية')).toBeInTheDocument();
    expect(screen.getByText(/من إعدادات النظام/)).toBeInTheDocument();
    expect(screen.getByText(/عرض العقود التي تحتاج تجديدًا/)).toHaveAttribute(
      'href',
      '/contracts?tab=renewals',
    );
  });

  it('مدير الفرع يرى تنبيهات فرعه فقط', async () => {
    signInDemo('branch_manager'); // جازان
    renderWith(<ContractExpiryWidget />);
    expect(await screen.findByLabelText('حرجة 1')).toBeInTheDocument();
    expect(screen.getByLabelText('منتهية 0')).toBeInTheDocument(); // 00009 في نجران
    expect(screen.getByLabelText('قريبة الانتهاء 0')).toBeInTheDocument(); // 00004 في نجران
  });

  it('لا تظهر لمن لا يملك صلاحية عرض العقود', () => {
    signInDemo('housing_supervisor');
    renderWith(<ContractExpiryWidget />);
    expect(screen.queryByTestId('expiry-alerts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('expiry-alerts-loading')).not.toBeInTheDocument();
    expect(screen.queryByText('تنبيهات انتهاء العقود')).not.toBeInTheDocument();
  });

  it('تعرض خطأً عند فشل جلب العقود لا «لا تنبيهات»', async () => {
    signInDemo('admin');
    vi.spyOn(contractsApi, 'listContracts').mockRejectedValue(new Error('تعذّر جلب العقود'));
    renderWith(<ContractExpiryWidget />);
    expect(await screen.findByText('تعذّر تحميل تنبيهات العقود')).toBeInTheDocument();
    expect(screen.queryByText(/لا توجد عقود سارية/)).not.toBeInTheDocument();
  });

  it('تتغيّر الأعداد بتغيّر المهلة في الإعدادات', async () => {
    signInDemo('admin');
    vi.spyOn(settingsApi, 'listConfig').mockResolvedValue([
      {
        key: 'contract_expiry_alert_days',
        label_ar: 'مهلة التنبيه قبل انتهاء العقد',
        grp: 'العقود',
        value: 7,
        unit: 'يوم',
        sort_order: 8,
      },
    ]);
    renderWith(<ContractExpiryWidget />);
    // مهلة ٧: 00004 (بعد ١١ يومًا) خارج المهلة، و00008 (بعد ٤) «قريب» لأن «حرِج» يومان فأقل
    await waitFor(() => expect(screen.getByText(windowText(7))).toBeInTheDocument());
    expect(screen.getByLabelText('منتهية 1')).toBeInTheDocument();
    expect(screen.getByLabelText('حرجة 0')).toBeInTheDocument();
    expect(screen.getByLabelText('قريبة الانتهاء 1')).toBeInTheDocument();
  });

  it('تُفصح عن استخدام القيمة الافتراضية إذا لم يوجد المفتاح في الإعدادات', async () => {
    signInDemo('admin');
    vi.spyOn(settingsApi, 'listConfig').mockResolvedValue([]);
    renderWith(<ContractExpiryWidget />);
    expect(await screen.findByText(/قيمة افتراضية — غير مضبوطة في الإعدادات/)).toBeInTheDocument();
    expect(screen.getByText(windowText(30))).toBeInTheDocument();
  });

  it('مركّبة داخل لوحة التحكم العامة', async () => {
    signInDemo('admin');
    renderWith(<CompanyOverview />);
    expect(await screen.findByText('تنبيهات انتهاء العقود')).toBeInTheDocument();
  });
});

describe('تنبيهات العقود في صفحة العقود', () => {
  it('تعرض الأعداد وحالة كل عقد ومؤشّر «تحتاج تجديدًا»', async () => {
    signInDemo('admin');
    renderWith(<ContractsList />, '/contracts');
    expect(await screen.findByTestId('expiry-alerts')).toBeInTheDocument();
    expect(screen.getByLabelText('منتهية 1')).toBeInTheDocument();
    expect(screen.getByText('تحتاج تجديدًا')).toBeInTheDocument();
    // شارة حالة الانتهاء في الجدول
    expect(screen.getAllByText('منتهٍ').length).toBeGreaterThan(0);
  });

  it('يفتح تبويب التجديدات من الرابط ويعرض المنتهية والقريبة فقط', async () => {
    signInDemo('admin');
    renderWith(<ContractsList />, '/contracts?tab=renewals');
    await screen.findByTestId('expiry-alerts');
    expect(screen.getByRole('button', { name: /تجديدات/ })).toHaveClass('bg-navy');
    // 00004 و00008 و00009 فقط
    expect(await screen.findAllByText(/MAS-2026-0000[489]/)).not.toHaveLength(0);
    expect(screen.queryByText('MAS-2026-00002')).not.toBeInTheDocument();
  });

  it('لا تعرض بطاقة التنبيهات عند فشل الجلب', async () => {
    signInDemo('admin');
    vi.spyOn(contractsApi, 'listContracts').mockRejectedValue(new Error('تعذّر جلب العقود'));
    renderWith(<ContractsList />, '/contracts');
    expect(await screen.findByText('حدث خطأ')).toBeInTheDocument();
    expect(screen.queryByTestId('expiry-alerts')).not.toBeInTheDocument();
  });
});
