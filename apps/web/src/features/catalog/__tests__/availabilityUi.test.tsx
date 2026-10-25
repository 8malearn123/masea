/**
 * التوفّر في الواجهة (المرحلة الثامنة): التقويم، منع اختيار العاملة غير المتاحة،
 * إعادة الحساب عند تغيّر الفترة أو العاملة، ورفض الحجز المتعارض في خدمة الطلبات،
 * وموضع زر المساعد على الجوال.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import { emptyDraft } from '@/lib/orderTypes';
import StepWizard from '@/components/order/StepWizard';
import { AvailabilityCalendar } from '@/features/catalog/components/AvailabilityCalendar';
import { MatchedWorkerPicker } from '@/features/catalog/components/MatchedWorkerPicker';
import { PeriodFields } from '@/features/requests/components/PeriodFields';
import { bookedRangesOf, isWorkerAvailable } from '@/features/catalog/lib/availability';
import { addDays, buildPeriod, today } from '@/features/requests/lib/period';
import { emptyPlaceDetails, type PlaceDetails } from '@/features/requests/types';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import { listRequestFiles } from '@/features/requests/api/requests.api';
import { fabPlacement } from '@/features/chatbot/lib/fabPosition';

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

afterEach(cleanup);

const FROM = today();
const worker = (id: string) => FALLBACK_WORKERS.find((w) => w.id === id)!;
const place: PlaceDetails = {
  ...emptyPlaceDetails(),
  beneficiaryType: 'home',
  hasChildren: true,
  children: 2,
  hasElderly: false,
  careNeeds: ['children'],
};
/** w6 محجوزة من اليوم لـ٤٥ يومًا (جدول تجريبي مقصود)، وw1 متاحة بالكامل. */
const insideW6 = buildPeriod(addDays(FROM, 5), 'day', 3);
const afterW6 = buildPeriod(addDays(FROM, 50), 'day', 3);

describe('التقويم', () => {
  it('يعرض الأيام المحجوزة والمتاحة والفترة المطلوبة', () => {
    const from = addDays(FROM, 5);
    render(
      <AvailabilityCalendar workerId="w6" highlight={{ start: from, end: addDays(from, 2) }} />,
    );
    const booked = screen.getByRole('img', { name: new RegExp(`${dateAr(from)}: محجوزة`) });
    expect(booked).toHaveAttribute('data-state', 'booked');
    expect(booked).toHaveAttribute('data-in-range', 'true');
    expect(screen.getByText('غير متاحة')).toBeInTheDocument(); // مفتاح الألوان
    expect(screen.getByText('المدة المطلوبة')).toBeInTheDocument();
    cleanup();

    render(<AvailabilityCalendar workerId="w1" highlight={{ start: from, end: from }} />);
    expect(screen.getByRole('img', { name: new RegExp(`${dateAr(from)}: متاحة`) })).toHaveAttribute(
      'data-state',
      'available',
    );
    expect(screen.getByText('لا توجد حجوزات — الجدول مفتوح بالكامل.')).toBeInTheDocument();
  });

  it('يعرض الحجز الجديد على كامل نطاقه', async () => {
    const svc = createMockRequestService();
    const start = addDays(FROM, 70);
    const res = await submitFor(svc, 'w1', start, 6, 'cal-range-0001');
    expect(res.created).toBe(true);
    render(<AvailabilityCalendar workerId="w1" highlight={{ start, end: addDays(start, 5) }} />);
    for (let i = 0; i < 6; i++) {
      const iso = addDays(start, i);
      expect(
        screen.getByRole('img', { name: new RegExp(`^${dateAr(iso)}: محجوزة`) }),
      ).toBeInTheDocument();
    }
  });
});

async function renderPicker(period: ReturnType<typeof buildPeriod> | null) {
  const user = userEvent.setup();
  const ui = (p: typeof period) => (
    <MatchedWorkerPicker
      workers={[worker('w1'), worker('w6')]}
      need={{ place, period: p }}
      selectedId={null}
      onSelect={() => undefined}
    />
  );
  const view = render(wrap(ui(period)));
  const showAll = screen.queryByRole('button', { name: /عرض الباقي|عرض كل العاملات/ });
  if (showAll) await user.click(showAll);
  // غير المتاحات للفترة في قسم منفصل مطويّ
  const blocked = screen.queryByRole('button', { name: /غير متاحة خلال الفترة المحددة \(/ });
  if (blocked) await user.click(blocked);
  return { user, rerender: (p: typeof period) => view.rerender(wrap(ui(p))) };
}

const card = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('اختيار العاملة حسب فترة الطلب', () => {
  it('يمنع اختيار العاملة غير المتاحة ويعرض السبب والتعارض', async () => {
    await renderPicker(insideW6);
    const busy = card(worker('w6').full_name);
    expect(busy).toBeDisabled();
    expect(busy).toHaveAccessibleName(/غير متاحة خلال الفترة المحددة/);
    expect(card(worker('w1').full_name)).toBeEnabled();

    const summaries = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(summaries).toContain('غير متاحة');
    expect(summaries).toContain('متاحة');
    expect(summaries).toContain('لا يوجد');
    expect(screen.getAllByText('العاملة غير متاحة خلال الفترة المحددة.').length).toBeGreaterThan(0);
  });

  it('تغيّر الفترة يعيد الحساب', async () => {
    const { rerender } = await renderPicker(insideW6);
    expect(card(worker('w6').full_name)).toBeDisabled();
    rerender(afterW6);
    expect(card(worker('w6').full_name)).toBeEnabled();
  });

  it('بلا فترة لا يدّعي التوفّر', async () => {
    await renderPicker(null);
    expect(screen.getAllByText('حدد تاريخ البداية والمدة للتحقق من التوفر.')).toHaveLength(2);
    expect(screen.queryByText('متاحة')).toBeNull();
  });

  it('تغيّر العاملة يعيد فحص الفترة نفسها', () => {
    const props = {
      startDate: insideW6.startDate,
      unit: 'day' as const,
      count: 3,
      maxCount: 30,
      onChange: () => undefined,
    };
    const { rerender } = render(<PeriodFields {...props} workerId="w6" workerName="فيث" />);
    expect(screen.getByText(/فيث غير متاحة خلال الفترة المحددة/)).toBeVisible();
    rerender(<PeriodFields {...props} workerId="w1" workerName="ماريا" />);
    expect(screen.getByText(/ماريا متاحة طوال المدة/)).toBeVisible();
    expect(screen.queryByText(/غير متاحة/)).toBeNull();
  });

  it('المعالج لا يتجاوز خطوة الاختيار بعاملة غير متاحة للفترة', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <StepWizard
          service="monthly_rental"
          serviceName="تأجير شهري"
          initialDraft={{
            ...emptyDraft('monthly_rental'),
            place,
            startDate: insideW6.startDate,
            workerProfileId: 'w6',
          }}
          onReset={() => undefined}
        />,
      ),
    );
    const next = () => user.click(screen.getByRole('button', { name: 'التالي' }));
    await screen.findByRole('button', { name: /منزل/ });
    await next(); // نوع المستفيد
    await next(); // المكان
    await screen.findByLabelText('تاريخ بداية الخدمة');
    expect(screen.getByText(/غير متاحة خلال الفترة المحددة/)).toBeVisible(); // تحذير المدة
    await next(); // المدة
    expect(
      await screen.findByText(
        'العاملة غير متاحة خلال الفترة المحددة. اختر عاملة أخرى أو غيّر التواريخ.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();
  });
});

async function submitFor(
  svc: ReturnType<typeof createMockRequestService>,
  workerId: string,
  startDate: string,
  days: number,
  token: string,
) {
  const w = worker(workerId);
  return svc.submit({
    clientToken: token,
    serviceName: 'تأجير يومي',
    price: { base: 300, vat: 45, total: 345 },
    worker: w,
    draft: {
      ...emptyDraft('daily_rental'),
      customerName: 'هيا آل مفرح',
      phone: '0501234567',
      branch: 'نجران',
      startDate,
      days,
      taskType: 'تنظيف',
      workerProfileId: w.id,
    },
  });
}

describe('الحجز عند إنشاء الطلب التجريبي', () => {
  it('يحجز الفترة كاملة، ويرفض طلبًا متعارضًا دون حجز ثانٍ أو ملف طلب', async () => {
    const svc = createMockRequestService();
    const start = addDays(FROM, 90);
    const first = await submitFor(svc, 'w1', start, 6, 'book-ok-000001');
    const booking = bookedRangesOf('w1').find((r) => r.request_no === first.requestNo);
    expect(booking).toMatchObject({ start, end: addDays(start, 5) });

    const before = bookedRangesOf('w1');
    const files = (await listRequestFiles()).length;
    await expect(submitFor(svc, 'w1', addDays(start, 3), 4, 'book-clash-01')).rejects.toMatchObject(
      {
        kind: 'validation',
        message: expect.stringContaining('العاملة غير متاحة خلال الفترة المحددة'),
      },
    );
    expect(bookedRangesOf('w1')).toEqual(before); // الحجز القائم لم يتغيّر ولا حجز جديد
    expect((await listRequestFiles()).length).toBe(files); // لا ملف طلب ناقص

    // فترة ملاصقة بعد نهاية الحجز مقبولة
    const after = await submitFor(svc, 'w1', addDays(start, 6), 2, 'book-adj-0001');
    expect(after.created).toBe(true);
    expect(isWorkerAvailable('w1', addDays(start, 6), addDays(start, 7)).available).toBe(false);
  });

  it('الطلب بلا عاملة لا يحجز شيئًا ويُنشأ عاديًا', async () => {
    const svc = createMockRequestService();
    const res = await svc.submit({
      clientToken: 'book-none-0001',
      serviceName: 'تأجير يومي',
      price: { base: 300, vat: 45, total: 345 },
      draft: {
        ...emptyDraft('daily_rental'),
        customerName: 'سعد آل مريح',
        phone: '0551234567',
        startDate: addDays(FROM, 4),
      },
    });
    expect(res.created).toBe(true);
  });
});

describe('موضع زر المساعد على الجوال (375px)', () => {
  const g = { viewportHeight: 812, base: 16, size: 48, gap: 8 };
  const nav = { top: 740, bottom: 784, left: 40, right: 335 };

  it('يبقى في الزاوية إذا لم يغطِّ شيئًا', () => {
    expect(fabPlacement([], g)).toEqual({ bottom: 16, hidden: false });
    expect(fabPlacement([{ top: 100, bottom: 140, left: 0, right: 375 }], g).bottom).toBe(16);
    expect(fabPlacement([{ top: 760, bottom: 800, left: 200, right: 360 }], g).bottom).toBe(16);
  });

  it('يرتفع فوق صف أزرار التالي/السابق/الدفع إذا كان الموضع فوقه حرًا', () => {
    const p = fabPlacement([nav], g);
    expect(p).toEqual({ bottom: 812 - 740 + 8, hidden: false });
    expect(812 - p.bottom).toBeLessThanOrEqual(nav.top - 8);
  });

  it('يرتفع فوق الشريط السفلي في صفحة العاملة', () => {
    const bar = { top: 732, bottom: 812, left: 0, right: 375 };
    expect(fabPlacement([bar], g)).toEqual({ bottom: 88, hidden: false });
  });

  it('يختفي مؤقتًا بدل أن يغطي حقلًا فوق الأزرار مباشرة', () => {
    const select = { top: 670, bottom: 714, left: 40, right: 335 };
    const p = fabPlacement([nav, select], g);
    expect(p.hidden).toBe(false); // فوق الحقل حر
    expect(812 - p.bottom).toBeLessThanOrEqual(select.top - 8);
    // حقول متتالية حتى منتصف الشاشة → لا موضع حر قريب → يختفي ولا يغطي شيئًا
    const stack = Array.from({ length: 8 }, (_, i) => ({
      top: 740 - i * 52,
      bottom: 784 - i * 52,
      left: 40,
      right: 335,
    }));
    expect(fabPlacement(stack, g)).toEqual({ bottom: 16, hidden: true });
  });
});

describe('ملخص التوفر داخل البطاقة', () => {
  it('يعرض الفترة المطلوبة والتعارض بالتواريخ فقط', async () => {
    await renderPicker(insideW6);
    const lists = screen.getAllByLabelText('ملخص التوفر');
    const busy = lists.find((l) => within(l).queryByText('غير متاحة'))!;
    expect(busy).toHaveTextContent(dateAr(insideW6.startDate));
    expect(busy).not.toHaveTextContent(/REQ-/);
  });
});
