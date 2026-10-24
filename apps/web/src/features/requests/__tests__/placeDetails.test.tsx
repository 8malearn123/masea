/**
 * نوع المستفيد وتفاصيل مكان الخدمة (المرحلة السادسة): الحقول الشرطية لكل نوع،
 * التحقق بـ Zod، مسح بيانات النوع السابق، الحفظ في الطلب التجريبي، والعرض في
 * ملخّص الطلب.
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
import { emptyDraft } from '@/lib/orderTypes';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import { placeDetailsSchema, placeStepIssue } from '@/features/requests/schemas/request.schema';
import {
  buildServiceDetails,
  emptyPlaceDetails,
  placeForType,
  type PlaceDetails,
} from '@/features/requests/types';
import { answer, futureDay } from './placeHelpers';

function wrap(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="/" element={ui} />
            <Route path="/order/request/:requestNo" element={<RequestSummary />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

afterEach(cleanup);

const place = (patch: Partial<PlaceDetails>): PlaceDetails => ({
  ...emptyPlaceDetails(),
  ...patch,
});
const issue = (p: PlaceDetails, step: 'beneficiary' | 'place' = 'place') => placeStepIssue(p, step);

function startWizard() {
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
  const pick = async (name: RegExp) => user.click(await screen.findByRole('button', { name }));
  return { user, next, pick };
}

describe('التحقق (placeDetailsSchema)', () => {
  it('نوع المستفيد مطلوب', () => {
    expect(issue(place({}), 'beneficiary')).toBe('اختر نوع المستفيد من الخدمة.');
  });

  it('نوع المناسبة مطلوب للمناسبة فقط، والنص مطلوب عند «أخرى»', () => {
    const occ = place({ beneficiaryType: 'occasion', guests: 80 });
    expect(issue(occ, 'beneficiary')).toBe('اختر نوع المناسبة.');
    expect(issue({ ...occ, occasionType: 'other' }, 'beneficiary')).toBe('اكتب نوع المناسبة.');
    expect(
      issue({ ...occ, occasionType: 'other', customOccasionType: 'حفل تخرّج' }, 'beneficiary'),
    ).toBeNull();
    expect(issue({ ...occ, occasionType: 'wedding' }, 'beneficiary')).toBeNull();
    // المنزل لا يُسأل عن نوع المناسبة
    expect(issue(place({ beneficiaryType: 'home' }), 'beneficiary')).toBeNull();
  });

  it('المنزل: أدوار وغرف موجبة، وأسئلة الأطفال وكبار السن شرطية', () => {
    const home = place({ beneficiaryType: 'home', hasChildren: false, hasElderly: false });
    expect(issue(home)).toBeNull();
    expect(issue({ ...home, floors: 0 })).toContain('عدد الأدوار');
    expect(issue({ ...home, rooms: -2 })).toContain('عدد الغرف');
    expect(issue({ ...home, floors: 1.5 })).toContain('عدد الأدوار');
    expect(issue({ ...home, hasChildren: null })).toBe('حدّد هل يوجد أطفال.');
    // عدد الأطفال مطلوب فقط عند «نعم»
    expect(issue({ ...home, hasChildren: true, children: 0 })).toContain('عدد الأطفال');
    expect(issue({ ...home, hasChildren: true, children: 2 })).toBeNull();
    expect(issue({ ...home, hasChildren: false, children: 0 })).toBeNull();
    // سؤال الرعاية فقط عند وجود كبار سن
    expect(issue({ ...home, hasElderly: null })).toBe('حدّد هل يوجد كبار سن.');
    expect(issue({ ...home, hasElderly: true, elderlyCareNeeded: null })).toBe(
      'حدّد هل يحتاج كبار السن إلى رعاية.',
    );
    expect(issue({ ...home, hasElderly: true, elderlyCareNeeded: false })).toBeNull();
  });

  it('المنشأة والنشاط التجاري والمناسبة: حقولها مطلوبة ولا قيم سالبة', () => {
    const facility = place({ beneficiaryType: 'facility', facilityType: 'مستشفى', guests: 40 });
    expect(issue(facility)).toBeNull();
    expect(issue({ ...facility, facilityType: ' ' })).toBe('اكتب نوع المنشأة.');
    expect(issue({ ...facility, guests: -5 })).toContain('المستفيدين');

    const shop = place({ beneficiaryType: 'commercial', businessType: 'مقهى', guests: 30 });
    expect(issue(shop)).toBeNull();
    expect(issue({ ...shop, businessType: '' })).toBe('اكتب نوع النشاط.');
    expect(issue({ ...shop, branchesCount: 0 })).toContain('عدد الفروع');

    const occ = place({ beneficiaryType: 'occasion', occasionType: 'wedding', guests: 0 });
    expect(issue(occ)).toContain('عدد الحضور');
    expect(issue({ ...occ, guests: 150, eventDate: '2020-01-01' })).toContain('الماضي');
    expect(issue({ ...occ, guests: 150, eventDate: '2099-02-30' })).toContain('غير صالح');
    expect(issue({ ...occ, guests: 150 })).toBeNull();
  });

  it('المنزل لا يُطالب بحقول المنشأة (والعكس)', () => {
    const r = placeDetailsSchema.safeParse(
      place({ beneficiaryType: 'home', hasChildren: false, hasElderly: false, guests: 0 }),
    );
    expect(r.success).toBe(true);
  });
});

describe('تغيير النوع والبيانات المحفوظة', () => {
  it('تغيير النوع يمسح بيانات النوع السابق ويبقي الاحتياجات والملاحظات', () => {
    const home = place({
      beneficiaryType: 'home',
      floors: 3,
      rooms: 7,
      hasChildren: true,
      children: 2,
      careNeeds: ['cleaning'],
      notes: 'الدور الثالث للضيوف',
    });
    const occ = placeForType(home, 'occasion');
    expect(occ).toMatchObject({
      beneficiaryType: 'occasion',
      floors: 1,
      rooms: 3,
      hasChildren: null,
      children: 0,
      careNeeds: ['cleaning'],
      notes: 'الدور الثالث للضيوف',
    });
    // اختيار النوع نفسه لا يمسح شيئًا
    expect(placeForType(home, 'home')).toBe(home);
  });

  it('يُحفظ في الطلب ما يخص النوع المختار فقط', () => {
    const home = buildServiceDetails(
      place({
        beneficiaryType: 'home',
        floors: 2,
        rooms: 5,
        hasChildren: false,
        children: 4, // قيمة قديمة لا تُحفظ
        hasElderly: true,
        elderly: 1,
        elderlyCareNeeded: true,
        occasionType: 'wedding', // لا يُحفظ لغير المناسبة
        guests: 99,
      }),
    );
    expect(home).toEqual({
      beneficiaryType: 'home',
      occasionType: null,
      customOccasionType: null,
      locationDetails: {
        kind: 'home',
        floors: 2,
        rooms: 5,
        hasChildren: false,
        childrenCount: null,
        hasElderly: true,
        elderlyNeedCare: true,
      },
      careNeeds: [],
      notes: '',
    });

    const occ = buildServiceDetails(
      place({
        beneficiaryType: 'occasion',
        occasionType: 'other',
        customOccasionType: '  حفل تخرّج ',
        guests: 60,
        floors: 4,
      }),
    );
    expect(occ.customOccasionType).toBe('حفل تخرّج');
    expect(occ.locationDetails).toEqual({ kind: 'occasion', eventDate: null, attendees: 60 });
    expect(occ.locationDetails).not.toHaveProperty('floors');

    // النص المخصّص لا يُحفظ إلا مع «أخرى»
    expect(
      buildServiceDetails(
        place({ beneficiaryType: 'occasion', occasionType: 'wedding', customOccasionType: 'x' }),
      ).customOccasionType,
    ).toBeNull();
  });
});

describe('الحقول الشرطية في المعالج', () => {
  it('المنزل: الأدوار والغرف، وعدد الأطفال يظهر بعد «نعم» فقط، والرعاية بعد كبار السن', async () => {
    const { user, next, pick } = startWizard();
    await pick(/منزل/);
    await next();

    expect(await screen.findByText('عدد الأدوار')).toBeInTheDocument();
    expect(screen.getByText('عدد الغرف')).toBeInTheDocument();
    expect(screen.queryByText('عدد الأطفال')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'هل يحتاجون إلى رعاية؟' })).toBeNull();
    // حقول الأنواع الأخرى لا تظهر
    expect(screen.queryByLabelText('نوع المنشأة')).toBeNull();
    expect(screen.queryByLabelText('عدد الحضور التقريبي')).toBeNull();

    // التحقق: لا متابعة قبل الإجابة
    expect(screen.getByText('حدّد هل يوجد أطفال.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();

    await answer(user, 'هل يوجد أطفال؟', true);
    expect(screen.getByText('عدد الأطفال')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'زيادة عدد الأطفال' }));
    await answer(user, 'هل يوجد كبار سن؟', true);
    expect(screen.getByText('حدّد هل يحتاج كبار السن إلى رعاية.')).toBeVisible();
    await answer(user, 'هل يحتاجون إلى رعاية؟', true);
    await user.click(screen.getByRole('button', { name: 'رعاية كبار السن' }));
    expect(screen.getByRole('button', { name: 'التالي' })).toBeEnabled();

    // «لا» تخفي عدد الأطفال
    await answer(user, 'هل يوجد أطفال؟', false);
    expect(screen.queryByText('عدد الأطفال')).not.toBeInTheDocument();
  });

  it('المنشأة: نوع المنشأة والأقسام وعدد المستفيدين', async () => {
    const { user, next, pick } = startWizard();
    await pick(/منشأة/);
    await next();
    expect(await screen.findByLabelText('نوع المنشأة')).toBeInTheDocument();
    expect(screen.getByText('عدد الأقسام')).toBeInTheDocument();
    expect(screen.queryByText('عدد الأدوار')).toBeNull();
    expect(screen.getByText('اكتب نوع المنشأة.')).toBeVisible();
    await user.type(screen.getByLabelText('نوع المنشأة'), 'مستشفى');
    await user.type(screen.getByLabelText('عدد المستفيدين / الموظفين'), '40');
    expect(screen.getByLabelText('عدد المستفيدين / الموظفين')).toHaveValue(40);
  });

  it('المقهى / النشاط التجاري: نوع النشاط والفروع وعدد الأشخاص', async () => {
    const { next, pick } = startWizard();
    await pick(/مقهى \/ نشاط تجاري/);
    await next();
    expect(await screen.findByLabelText('نوع النشاط')).toBeInTheDocument();
    expect(screen.getByText('عدد الفروع')).toBeInTheDocument();
    expect(screen.getByLabelText('عدد الأشخاص المطلوب خدمتهم يوميًا')).toBeInTheDocument();
    expect(screen.queryByText('هل يوجد أطفال؟')).toBeNull();
  });

  it('المناسبة: أنواع المناسبة، و«أخرى» تفتح حقلًا مطلوبًا، ثم التاريخ والحضور', async () => {
    const { user, next, pick } = startWizard();
    await pick(/مناسبة \/ فعالية/);
    const select = await screen.findByLabelText('نوع المناسبة');
    const names = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(
      expect.arrayContaining(['زفاف', 'افتتاح', 'فعالية', 'مؤتمر', 'معرض', 'أخرى']),
    );
    expect(screen.getByText('اختر نوع المناسبة.')).toBeVisible();
    expect(screen.queryByLabelText('اكتب نوع المناسبة')).toBeNull();

    await user.selectOptions(select, 'other');
    const custom = screen.getByLabelText('اكتب نوع المناسبة');
    expect(screen.getByText('اكتب نوع المناسبة.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();
    await user.type(custom, 'حفل تخرّج');
    expect(screen.getByRole('button', { name: 'التالي' })).toBeEnabled();

    await next();
    expect(await screen.findByLabelText('تاريخ المناسبة (اختياري)')).toBeInTheDocument();
    expect(screen.getByLabelText('عدد الحضور التقريبي')).toBeInTheDocument();
    expect(screen.queryByText('عدد الغرف')).toBeNull();

    // الرجوع للخلف يحتفظ بالاختيارات
    await user.click(screen.getByRole('button', { name: 'السابق' }));
    expect(await screen.findByLabelText('اكتب نوع المناسبة')).toHaveValue('حفل تخرّج');
    expect(screen.getByLabelText('نوع المناسبة')).toHaveValue('other');
  });

  it('تغيير النوع من منزل إلى مناسبة ثم العودة يمسح بيانات المنزل', async () => {
    const { user, next, pick } = startWizard();
    await pick(/منزل/);
    await next();
    await user.click(await screen.findByRole('button', { name: 'زيادة عدد الأدوار' }));
    await answer(user, 'هل يوجد أطفال؟', true);
    await user.click(screen.getByRole('button', { name: 'السابق' }));

    await pick(/مناسبة \/ فعالية/);
    await pick(/منزل/);
    await next();
    expect(await screen.findByText('عدد الأدوار')).toBeInTheDocument();
    const floors = screen.getByRole('button', { name: 'إنقاص عدد الأدوار' }).parentElement;
    expect(floors).toHaveTextContent('1'); // عاد للقيمة الافتراضية
    expect(screen.queryByText('عدد الأطفال')).toBeNull();
    expect(screen.getByText('حدّد هل يوجد أطفال.')).toBeVisible();
  });
});

describe('الحفظ والعرض في ملخّص الطلب', () => {
  const base = {
    clientToken: 'phase6-token-0001',
    serviceName: 'تأجير يومي',
    price: { base: 300, vat: 45, total: 345 },
  };
  const draft = (p: PlaceDetails) => ({
    ...emptyDraft('daily_rental'),
    customerName: 'هيا آل مفرح',
    phone: '0501234567',
    branch: 'نجران',
    startDate: futureDay(25),
    days: 1,
    taskType: 'تنظيف',
    place: p,
  });

  it('يحفظ تفاصيل المنزل في details ويعرضها بتسميات عربية', async () => {
    const svc = createMockRequestService();
    const res = await svc.submit({
      ...base,
      draft: draft(
        place({
          beneficiaryType: 'home',
          floors: 2,
          rooms: 6,
          hasChildren: true,
          children: 3,
          hasElderly: true,
          elderly: 1,
          elderlyCareNeeded: false,
          careNeeds: ['cleaning'],
          notes: 'الدور العلوي غير مستخدم',
        }),
      ),
    });
    const file = await svc.getFile(res.requestNo);
    expect(file?.details.locationDetails).toEqual({
      kind: 'home',
      floors: 2,
      rooms: 6,
      hasChildren: true,
      childrenCount: 3,
      hasElderly: true,
      elderlyNeedCare: false,
    });
    expect(file).not.toHaveProperty('place');

    render(wrap(null, `/order/request/${res.requestNo}`));
    const section = (await screen.findByText('بيانات مكان الخدمة')).closest(
      'section',
    ) as HTMLElement;
    const cell = (label: string) => within(section).getByText(label).parentElement?.textContent;
    await within(section).findByText('منزل'); // الأسماء من القوائم المرجعية
    expect(cell('نوع المستفيد')).toContain('منزل');
    expect(cell('عدد الأدوار')).toContain('2');
    expect(cell('عدد الغرف')).toContain('6');
    expect(cell('يوجد أطفال')).toContain('نعم');
    expect(cell('عدد الأطفال')).toContain('3');
    expect(cell('يوجد كبار سن')).toContain('نعم');
    expect(cell('يحتاجون إلى رعاية')).toContain('لا');
    expect(within(section).getByText('الدور العلوي غير مستخدم')).toBeVisible();
    expect(within(section).queryByText('نوع المناسبة')).toBeNull();
    expect(within(section).queryByText('عدد الحضور التقريبي')).toBeNull();
  });

  it('مناسبة «أخرى»: يعرض النوع المكتوب والحضور فقط، ويرفض الطلب الناقص', async () => {
    const svc = createMockRequestService();
    await expect(
      svc.submit({
        ...base,
        clientToken: 'phase6-token-0002',
        draft: draft(place({ beneficiaryType: 'occasion', occasionType: 'other', guests: 50 })),
      }),
    ).rejects.toMatchObject({ kind: 'validation', message: 'اكتب نوع المناسبة.' });

    const res = await svc.submit({
      ...base,
      clientToken: 'phase6-token-0003',
      draft: draft(
        place({
          beneficiaryType: 'occasion',
          occasionType: 'other',
          customOccasionType: 'حفل تخرّج',
          guests: 50,
          floors: 5, // بقايا لا تُحفظ
        }),
      ),
    });
    render(wrap(null, `/order/request/${res.requestNo}`));
    const section = (await screen.findByText('بيانات مكان الخدمة')).closest(
      'section',
    ) as HTMLElement;
    expect(within(section).getByText('نوع المناسبة').parentElement).toHaveTextContent('حفل تخرّج');
    expect(within(section).getByText('عدد الحضور التقريبي').parentElement).toHaveTextContent('50');
    expect(within(section).queryByText('عدد الأدوار')).toBeNull();
    expect(within(section).queryByText('يوجد أطفال')).toBeNull();
  });
});
