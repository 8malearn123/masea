/**
 * مدة الطلب (المرحلة السابعة): الأسبوع كوحدة جديدة في دالة الحساب الوحيدة،
 * والحالات الحدّية للتواريخ، والتحقق بـ Zod، والتفاعل في المعالج، والحفظ في
 * الطلب التجريبي، والعرض في ملخّص الطلب وصفحة التتبّع.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/shared/ui';
import StepWizard from '@/components/order/StepWizard';
import RequestSummary from '@/features/requests/components/RequestSummary';
import OrderTracking from '@/pages/order/OrderTracking';
import { dateAr } from '@/shared/lib/format';
import { DURATION_UNITS, draftPeriod, emptyDraft, priceParams } from '@/lib/orderTypes';
import type { ServiceCode } from '@/lib/funnel';
import { buildPeriod, computeEndDate, periodLabel } from '@/features/requests/lib/period';
import { contractEndDate } from '@/features/contracts/lib/contractTerm';
import {
  DURATION_LIMITS_FALLBACK,
  durationIssue,
  durationLimitsFrom,
  maxDurationCount,
} from '@/features/requests/schemas/request.schema';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import { emptyPlaceDetails } from '@/features/requests/types';
import { answerHome, futureDay } from './placeHelpers';

function wrap(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="/" element={ui} />
            <Route path="/order/request/:requestNo" element={<RequestSummary />} />
            <Route path="/order/track" element={<OrderTracking />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('حساب تاريخ النهاية (دالة واحدة: computeEndDate)', () => {
  const end = computeEndDate;

  it('الأيام: يوم واحد وعدة أيام (يوم البداية محسوب)', () => {
    expect(end('2026-10-10', 'day', 1)).toBe('2026-10-10');
    expect(end('2026-10-10', 'day', 3)).toBe('2026-10-12'); // مثال المتطلبات
    expect(end('2026-10-31', 'day', 2)).toBe('2026-11-01');
  });

  it('الأسابيع: أسبوع = ٧ أيام، وعدة أسابيع', () => {
    expect(end('2026-10-10', 'week', 1)).toBe('2026-10-16');
    expect(end('2026-10-10', 'week', 3)).toBe('2026-10-30');
    expect(end('2026-12-28', 'week', 1)).toBe('2027-01-03'); // عبر السنة
    expect(end('2028-02-25', 'week', 1)).toBe('2028-03-02'); // عبر ٢٩ فبراير
    expect(end('2027-02-25', 'week', 1)).toBe('2027-03-03');
  });

  it('الأشهر: شهر وعدة أشهر', () => {
    expect(end('2026-10-10', 'month', 1)).toBe('2026-11-09');
    expect(end('2026-10-10', 'month', 6)).toBe('2027-04-09');
    expect(end('2026-01-01', 'month', 12)).toBe('2026-12-31');
  });

  it('نهاية الشهر: ٢٩ و٣٠ و٣١ في شهر أقصر تنتهي في آخر يوم منه', () => {
    expect(end('2027-01-31', 'month', 1)).toBe('2027-02-28');
    expect(end('2027-01-30', 'month', 1)).toBe('2027-02-28');
    expect(end('2027-01-29', 'month', 1)).toBe('2027-02-28');
    expect(end('2026-03-31', 'month', 1)).toBe('2026-04-30');
    expect(end('2026-05-31', 'month', 3)).toBe('2026-08-30');
    expect(end('2026-04-30', 'month', 1)).toBe('2026-05-29');
  });

  it('فبراير والسنة الكبيسة', () => {
    expect(end('2028-01-31', 'month', 1)).toBe('2028-02-29');
    expect(end('2028-01-29', 'month', 1)).toBe('2028-02-28');
    expect(end('2028-02-29', 'month', 1)).toBe('2028-03-28');
    expect(end('2028-02-29', 'month', 12)).toBe('2029-02-28');
    expect(end('2027-02-28', 'month', 1)).toBe('2027-03-27');
    expect(end('2028-02-28', 'day', 2)).toBe('2028-02-29');
    expect(end('2027-02-28', 'day', 2)).toBe('2027-03-01');
  });

  it('الانتقال من ديسمبر إلى يناير', () => {
    expect(end('2026-12-31', 'day', 1)).toBe('2026-12-31');
    expect(end('2026-12-31', 'day', 2)).toBe('2027-01-01');
    expect(end('2026-12-15', 'month', 1)).toBe('2027-01-14');
    expect(end('2026-12-31', 'month', 2)).toBe('2027-02-28');
  });

  it('النهاية لا تسبق البداية أبدًا، ومدخلات غير صالحة لا تنتج تاريخًا', () => {
    for (const unit of ['day', 'week', 'month'] as const) {
      for (const start of ['2026-01-31', '2028-02-29', '2026-12-31', '2027-06-15']) {
        for (const n of [1, 2, 5, 12]) expect(end(start, unit, n) >= start).toBe(true);
      }
    }
    expect(end('', 'week', 2)).toBe('');
    expect(end('2026-02-30', 'day', 2)).toBe('2026-03-03'); // parseDay يتسامح؛ التحقق يرفضه
  });

  it('صياغة المدة بالعربية للأسابيع', () => {
    const label = (n: number) => periodLabel(buildPeriod('2026-10-10', 'week', n));
    expect(label(1)).toBe('أسبوع واحد');
    expect(label(2)).toBe('أسبوعان');
    expect(label(3)).toBe('3 أسابيع');
    expect(label(11)).toBe('11 أسبوعًا');
  });

  it('العقود تستخدم نفس الدالة: نفس النتيجة للأيام والأشهر', () => {
    expect(contractEndDate('monthly_rental', '2027-01-31', 1)).toBe(
      computeEndDate('2027-01-31', 'month', 1),
    );
    expect(contractEndDate('daily_rental', '2026-12-31', 3)).toBe(
      computeEndDate('2026-12-31', 'day', 3),
    );
  });
});

describe('التحقق من المدة (Zod)', () => {
  const TODAY = '2026-10-10';
  const limits = DURATION_LIMITS_FALLBACK;
  const daily = (patch: Record<string, unknown> = {}) => ({
    service: 'daily_rental',
    startDate: '2026-10-12',
    durationUnit: 'day',
    days: 3,
    ...patch,
  });
  const issue = (d: Parameters<typeof durationIssue>[0]) => durationIssue(d, limits, TODAY);

  it('مدة صحيحة تمر', () => {
    expect(issue(daily())).toBeNull();
    expect(issue(daily({ startDate: TODAY }))).toBeNull(); // اليوم نفسه مسموح
    expect(issue(daily({ durationUnit: 'week', days: 4 }))).toBeNull();
    expect(
      issue({ service: 'monthly_rental', startDate: TODAY, durationUnit: 'month', months: 24 }),
    ).toBeNull();
  });

  it('تاريخ البداية مطلوب وصالح وليس في الماضي', () => {
    expect(issue(daily({ startDate: '' }))).toBe('حدّد تاريخ بداية الخدمة.');
    expect(issue(daily({ startDate: '2026-02-30' }))).toBe('تاريخ بداية الخدمة غير صالح.');
    expect(issue(daily({ startDate: '2026-10-09' }))).toBe('تاريخ بداية الخدمة لا يكون في الماضي.');
  });

  it('الوحدة من الوحدات المتاحة للخدمة فقط', () => {
    expect(issue(daily({ durationUnit: 'month' }))).toBe('اختر وحدة مدة متاحة لهذه الخدمة.');
    expect(issue(daily({ durationUnit: '' }))).toBe('اختر وحدة مدة متاحة لهذه الخدمة.');
    expect(
      issue({ service: 'monthly_rental', startDate: TODAY, durationUnit: 'week', months: 2 }),
    ).toBe('اختر وحدة مدة متاحة لهذه الخدمة.');
  });

  it('العدد صحيح موجب وضمن الحد الأعلى من الإعدادات', () => {
    for (const bad of [0, -2, 1.5, Number.NaN]) {
      expect(issue(daily({ days: bad }))).toBe('مدة الخدمة رقم صحيح موجب (١ على الأقل).');
    }
    expect(issue(daily({ days: 31 }))).toBe('أقصى مدة لهذه الخدمة 30 يومًا.');
    expect(issue(daily({ durationUnit: 'week', days: 5 }))).toBe('أقصى مدة لهذه الخدمة 4 أسابيع.');
    expect(
      issue({ service: 'monthly_rental', startDate: TODAY, durationUnit: 'month', months: 25 }),
    ).toBe('أقصى مدة لهذه الخدمة 24 شهرًا.');
  });

  it('الحدود تُقرأ من الإعدادات (مع قيمة احتياطية للقيم غير الصالحة)', () => {
    const cfg = (key: string, value: number) => ({
      key,
      label_ar: '',
      grp: '',
      value,
      unit: '',
      sort_order: 1,
    });
    const custom = durationLimitsFrom([cfg('request_max_days', 60), cfg('request_max_months', 6)]);
    expect(custom).toEqual({ maxDays: 60, maxMonths: 6 });
    expect(maxDurationCount('week', custom)).toBe(8);
    expect(durationIssue(daily({ days: 45 }), custom, TODAY)).toBeNull();
    expect(durationLimitsFrom([cfg('request_max_days', -1)])).toEqual(DURATION_LIMITS_FALLBACK);
  });

  it('خدمة الطلبات ترفض مدة غير صحيحة عند الإرسال', async () => {
    const svc = createMockRequestService();
    const base = {
      serviceName: 'تأجير يومي',
      price: { base: 300, vat: 45, total: 345 },
      draft: {
        ...emptyDraft('daily_rental'),
        customerName: 'هيا آل مفرح',
        phone: '0501234567',
        startDate: futureDay(5),
        days: 2,
      },
    };
    await expect(
      svc.submit({ ...base, clientToken: 'dur-bad-0001', draft: { ...base.draft, days: 0 } }),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      svc.submit({
        ...base,
        clientToken: 'dur-bad-0002',
        draft: { ...base.draft, startDate: '2020-01-01' },
      }),
    ).rejects.toThrow('في الماضي');
  });
});

describe('وحدات المدة والتسعير', () => {
  it('وحدات كل خدمة والتسعير اليومي بعدد الأيام الفعلي', () => {
    expect(DURATION_UNITS.daily_rental).toEqual(['day', 'week']);
    expect(DURATION_UNITS.monthly_rental).toEqual(['month']);
    const d = { ...emptyDraft('daily_rental'), durationUnit: 'week' as const, days: 2 };
    expect(priceParams(d).quantity).toBe(14);
    expect(priceParams({ ...d, durationUnit: 'day' }).quantity).toBe(2);
  });

  it('وحدة غير متاحة للخدمة تعود لوحدتها الافتراضية', () => {
    const d = {
      ...emptyDraft('monthly_rental'),
      durationUnit: 'week' as const,
      startDate: '2026-10-10',
      months: 2,
    };
    expect(draftPeriod(d)).toMatchObject({ unit: 'month', endDate: '2026-12-09' });
  });
});

/* ------------------------------ المعالج ------------------------------ */

async function walkToDates(service: ServiceCode = 'daily_rental') {
  const user = userEvent.setup();
  const draft = emptyDraft(service);
  render(
    wrap(
      <StepWizard
        service={service}
        serviceName={service === 'daily_rental' ? 'تأجير يومي' : 'تأجير شهري'}
        initialDraft={draft}
        onReset={() => undefined}
      />,
    ),
  );
  const next = () => user.click(screen.getByRole('button', { name: 'التالي' }));
  await user.click(await screen.findByRole('button', { name: /منزل/ }));
  await next();
  await answerHome(user);
  await user.click(await screen.findByRole('button', { name: 'تنظيف وترتيب' }));
  await next();
  await screen.findByLabelText('تاريخ بداية الخدمة');
  return { user, next };
}

/** قيمة بطاقة الملخص (البداية/المدة/النهاية) في خطوة المدة. */
const stat = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';

describe('المدة في المعالج', () => {
  it('النهاية تُحسب فورًا وتتحدث عند تغيير البداية والوحدة والعدد', async () => {
    const { user } = await walkToDates();
    const start = screen.getByLabelText('تاريخ بداية الخدمة');
    expect(stat('تاريخ نهاية الخدمة')).toContain('—'); // غير مكتملة → لا نهاية
    expect(screen.getByText('حدّد تاريخ بداية الخدمة.')).toBeVisible();

    const s1 = futureDay(10);
    await user.type(start, s1);
    expect(stat('تاريخ نهاية الخدمة')).toContain(dateAr(s1)); // يوم واحد

    // تغيير العدد
    const count = screen.getByLabelText('عدد الأيام');
    await user.clear(count);
    await user.type(count, '3');
    expect(stat('تاريخ نهاية الخدمة')).toContain(dateAr(computeEndDate(s1, 'day', 3)));
    expect(stat('مدة الخدمة')).toContain('3 أيام');

    // تغيير الوحدة: ٣ أيام → ٣ أسابيع
    const units = screen.getByRole('radiogroup', { name: 'وحدة المدة' });
    await user.click(within(units).getByRole('radio', { name: 'أسبوع' }));
    expect(within(units).getByRole('radio', { name: 'أسبوع' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText('عدد الأسابيع')).toHaveValue(3);
    expect(stat('تاريخ نهاية الخدمة')).toContain(dateAr(computeEndDate(s1, 'week', 3)));
    expect(stat('مدة الخدمة')).toContain('3 أسابيع');

    // تغيير البداية
    const s2 = futureDay(40);
    await user.clear(start);
    await user.type(start, s2);
    expect(stat('تاريخ نهاية الخدمة')).toContain(dateAr(computeEndDate(s2, 'week', 3)));
    expect(stat('تاريخ نهاية الخدمة')).not.toContain(dateAr(computeEndDate(s1, 'week', 3)));
  });

  it('مدة غير صحيحة: رسالة واضحة وتعطيل «التالي» ولا تاريخ نهاية قديم', async () => {
    const { user } = await walkToDates();
    await user.type(screen.getByLabelText('تاريخ بداية الخدمة'), futureDay(3));
    const count = screen.getByLabelText('عدد الأيام');
    await user.clear(count);
    await user.type(count, '45');
    expect(screen.getByText('أقصى مدة لهذه الخدمة 30 يومًا.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();
    expect(stat('تاريخ نهاية الخدمة')).toContain('—');

    await user.clear(count);
    expect(screen.getByText('مدة الخدمة رقم صحيح موجب (١ على الأقل).')).toBeVisible();
    expect(stat('تاريخ نهاية الخدمة')).toContain('—');

    // الوحدة الأسبوعية تقصّ العدد لأقصاها بدل أن تبقى قيمة غير صالحة
    await user.type(count, '20');
    await user.click(screen.getByRole('radio', { name: 'أسبوع' }));
    expect(screen.getByLabelText('عدد الأسابيع')).toHaveValue(4);
    expect(screen.getByRole('button', { name: 'التالي' })).toBeEnabled();
  });

  it('يمنع التاريخ الماضي', async () => {
    const { user } = await walkToDates();
    await user.type(screen.getByLabelText('تاريخ بداية الخدمة'), futureDay(-1));
    expect(screen.getByText('تاريخ بداية الخدمة لا يكون في الماضي.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();
  });

  it('الرجوع للخلف ثم العودة يحتفظ بالمدة', async () => {
    const { user, next } = await walkToDates();
    const s = futureDay(12);
    await user.type(screen.getByLabelText('تاريخ بداية الخدمة'), s);
    await user.click(screen.getByRole('radio', { name: 'أسبوع' }));
    const count = screen.getByLabelText('عدد الأسابيع');
    await user.clear(count);
    await user.type(count, '2');
    await user.click(screen.getByRole('button', { name: 'السابق' }));
    await next();
    expect(await screen.findByLabelText('تاريخ بداية الخدمة')).toHaveValue(s);
    expect(screen.getByLabelText('عدد الأسابيع')).toHaveValue(2);
    expect(screen.getByRole('radio', { name: 'أسبوع' })).toHaveAttribute('aria-checked', 'true');
    expect(stat('تاريخ نهاية الخدمة')).toContain(dateAr(computeEndDate(s, 'week', 2)));
  });

  it('التأجير الشهري: وحدة الشهر فقط بلا اختيار وحدة', async () => {
    const { user } = await walkToDates('monthly_rental');
    expect(screen.queryByRole('radiogroup', { name: 'وحدة المدة' })).toBeNull();
    const s = futureDay(5);
    await user.type(screen.getByLabelText('تاريخ بداية الخدمة'), s);
    expect(screen.getByLabelText('عدد الأشهر')).toHaveValue(3);
    expect(stat('تاريخ نهاية الخدمة')).toContain(dateAr(computeEndDate(s, 'month', 3)));
  });

  it('المناسبة: تاريخ المناسبة يظهر منفصلًا عن تاريخ بداية الخدمة', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <StepWizard
          service="daily_rental"
          serviceName="تأجير يومي"
          initialDraft={emptyDraft('daily_rental')}
          onReset={() => undefined}
        />,
      ),
    );
    const next = () => user.click(screen.getByRole('button', { name: 'التالي' }));
    await user.click(await screen.findByRole('button', { name: /مناسبة \/ فعالية/ }));
    await user.selectOptions(await screen.findByLabelText('نوع المناسبة'), 'wedding');
    await next();
    const eventDay = futureDay(20);
    await user.type(await screen.findByLabelText('تاريخ المناسبة (اختياري)'), eventDay);
    await user.type(screen.getByLabelText('عدد الحضور التقريبي'), '120');
    await user.click(screen.getByRole('button', { name: 'طبخ وإعداد وجبات' }));
    await next();

    const start = await screen.findByLabelText('تاريخ بداية الخدمة');
    expect(start).toHaveValue(''); // لا يحل تاريخ المناسبة محل بداية الخدمة
    expect(screen.getByText(/منفصل عن/)).toHaveTextContent(dateAr(eventDay));
    await user.type(start, futureDay(2));
    expect(screen.getByText(/خارج مدة الخدمة/)).toBeVisible();
    const count = screen.getByLabelText('عدد الأيام');
    await user.clear(count);
    await user.type(count, '20');
    expect(screen.queryByText(/خارج مدة الخدمة/)).toBeNull();
  });
});

describe('الحفظ والعرض', () => {
  it('يحفظ المدة في الطلب التجريبي ويعرضها في الملخّص والتتبّع', async () => {
    const svc = createMockRequestService();
    const startDate = futureDay(30);
    const res = await svc.submit({
      clientToken: 'dur-save-0001',
      serviceName: 'تأجير يومي',
      price: { base: 300, vat: 45, total: 345 },
      draft: {
        ...emptyDraft('daily_rental'),
        customerName: 'هيا آل مفرح',
        phone: '0501234567',
        branch: 'نجران',
        startDate,
        durationUnit: 'week',
        days: 2,
        taskType: 'تنظيف',
        place: { ...emptyPlaceDetails() },
      },
    });
    const endDate = computeEndDate(startDate, 'week', 2);
    const file = await svc.getFile(res.requestNo);
    expect(file?.period).toEqual({ startDate, endDate, unit: 'week', count: 2 });
    expect(await svc.track(res.requestNo)).toMatchObject({
      period: { startDate, endDate, unit: 'week', count: 2 },
    });

    render(wrap(null, `/order/request/${res.requestNo}`));
    const section = (await screen.findByText('مدة الطلب')).closest('section') as HTMLElement;
    const cell = (label: string) => within(section).getByText(label).parentElement?.textContent;
    expect(cell('تاريخ بداية الخدمة')).toContain(dateAr(startDate));
    expect(cell('مدة الخدمة')).toContain('أسبوعان');
    expect(cell('تاريخ نهاية الخدمة')).toContain(dateAr(endDate));
    cleanup();

    render(wrap(null, `/order/track?no=${res.requestNo}`));
    const dd = await screen.findByText('تاريخ نهاية الخدمة');
    expect(dd.parentElement).toHaveTextContent(dateAr(endDate));
    expect(screen.getByText('مدة الخدمة').parentElement).toHaveTextContent('أسبوعان');
    expect(screen.queryByText('هيا آل مفرح')).toBeNull(); // لا بيانات شخصية في التتبّع
  });

  it('لا تُعرض النهاية لطلب بلا تاريخ بداية', async () => {
    const svc = createMockRequestService();
    const res = await svc.submit({
      clientToken: 'dur-save-0002',
      serviceName: 'تأجير يومي',
      price: { base: 300, vat: 45, total: 345 },
      draft: { ...emptyDraft('daily_rental'), customerName: 'سعد آل مريح', phone: '0551234567' },
    });
    expect((await svc.getFile(res.requestNo))?.period).toBeNull();
    render(wrap(null, `/order/request/${res.requestNo}`));
    await screen.findByText('بيانات مكان الخدمة');
    expect(screen.queryByText('تاريخ نهاية الخدمة')).toBeNull();
  });
});
