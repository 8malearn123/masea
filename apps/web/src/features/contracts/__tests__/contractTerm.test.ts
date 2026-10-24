import { describe, expect, it } from 'vitest';
import {
  contractEndDate,
  contractTermLabel,
  contractTermUnit,
  inferTermCount,
  validateContractTerm,
} from '@/features/contracts/lib/contractTerm';
import {
  createDraft,
  demoMutateContract,
  getContract,
  listContracts,
  updateContractTerm,
  type CreateDraftInput,
} from '@/features/contracts/api/contracts.api';
import { expiryAlerts } from '@/features/contracts/lib/contractInsights';
import { buildContractHtml } from '@/features/contracts/lib/contractHtml';
import type { ContractListItem } from '@/features/contracts/types';

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

function input(over: Partial<CreateDraftInput>): CreateDraftInput {
  return {
    service_code: 'monthly_rental',
    customer_id: 'cust-1',
    customer_name: 'محمد الأحمدي',
    branch_id: 'نجران',
    start_date: '2026-10-01',
    end_date: '2026-12-31',
    quantity: 3,
    nationality: 'الفلبين',
    profession: 'عاملة منزلية',
    clauses: ['قيمة الإيجار الشهري ومدة العقد ٣ أشهر تبدأ من 2026-10-01.'],
    ...over,
  };
}

describe('مدة العقد — حساب تاريخ النهاية', () => {
  it('يشتقّ وحدة المدة من الخدمة', () => {
    expect(contractTermUnit('recruitment')).toBe('month');
    expect(contractTermUnit('monthly_rental')).toBe('month');
    expect(contractTermUnit('daily_rental')).toBe('day');
    expect(contractTermUnit('sponsorship_transfer')).toBeNull();
  });

  it('يحسب النهاية من البداية والمدة لكل خدمة', () => {
    expect(contractEndDate('monthly_rental', '2026-10-01', 3)).toBe('2026-12-31');
    expect(contractEndDate('daily_rental', '2026-10-01', 5)).toBe('2026-10-05');
    expect(contractEndDate('recruitment', '2026-10-01', 24)).toBe('2028-09-30');
    expect(contractEndDate('sponsorship_transfer', '2026-10-01', 1)).toBeNull();
  });

  it('يعالج نهاية الشهر والسنة الكبيسة', () => {
    expect(contractEndDate('monthly_rental', '2028-01-31', 1)).toBe('2028-02-29');
    expect(contractEndDate('recruitment', '2028-02-29', 12)).toBe('2029-02-28');
  });

  it('يرفض المدخلات غير المنطقية', () => {
    expect(validateContractTerm('monthly_rental', '', 3)).toBe('حدّد تاريخ البداية');
    expect(validateContractTerm('monthly_rental', '2027-02-30', 3)).toBe('تاريخ البداية غير صالح');
    expect(validateContractTerm('monthly_rental', '2026-10-01', 0)).toContain('عدد الأشهر');
    expect(validateContractTerm('daily_rental', '2026-10-01', 2.5)).toContain('عدد الأيام');
    expect(validateContractTerm('monthly_rental', '2026-10-01', Number.NaN)).toContain(
      'عدد الأشهر',
    );
    expect(validateContractTerm('recruitment', '2026-10-01', 7)).toContain('خيارات');
    expect(validateContractTerm('monthly_rental', '2026-10-01', 3)).toBeNull();
    expect(validateContractTerm('sponsorship_transfer', '2026-10-01', 0)).toBeNull();
  });

  it('يستنتج المدة من تاريخَي عقد قائم ويصوغها بالعربية', () => {
    expect(inferTermCount('monthly_rental', '2026-10-01', '2026-12-31')).toBe(3);
    expect(inferTermCount('daily_rental', '2026-10-01', '2026-10-05')).toBe(5);
    expect(inferTermCount('monthly_rental', '2026-10-01', '2026-12-20')).toBeNull();
    expect(inferTermCount('monthly_rental', '2026-10-01', null)).toBeNull();
    expect(
      contractTermLabel({
        service_code: 'monthly_rental',
        start_date: '2026-10-05',
        end_date: '2026-12-04',
      }),
    ).toBe('شهران');
    expect(
      contractTermLabel({
        service_code: 'recruitment',
        start_date: '2026-10-01',
        end_date: '2027-09-30',
      }),
    ).toBe('12 شهرًا');
  });
});

describe('حفظ مدة العقد (الوضع التجريبي)', () => {
  it('يحفظ تاريخ البداية والنهاية عند الإنشاء ويبقى العقد ظاهرًا بعد إعادة الجلب', async () => {
    const created = await createDraft(input({}));
    expect(created.start_date).toBe('2026-10-01');
    expect(created.end_date).toBe('2026-12-31');

    const fetched = await getContract(created.id);
    expect(fetched?.end_date).toBe('2026-12-31');
    expect(fetched?.customer_name).toBe('محمد الأحمدي');
    const list = await listContracts(ALL);
    expect(list.some((c) => c.id === created.id && c.end_date === '2026-12-31')).toBe(true);
  });

  it('يرفض إنشاء عقد نهايته تسبق بدايته أو بتاريخ غير صالح', async () => {
    await expect(createDraft(input({ end_date: '2026-09-01' }))).rejects.toThrow(
      'تاريخ النهاية لا يمكن أن يسبق تاريخ البداية',
    );
    await expect(createDraft(input({ start_date: '2026-02-30' }))).rejects.toThrow(
      'تاريخ البداية غير صالح',
    );
  });

  it('يحفظ تاريخ النهاية عند تعديل مدة المسودة', async () => {
    const created = await createDraft(input({}));
    const term = await updateContractTerm(created.id, '2026-11-01', '2027-04-30');
    expect(term).toEqual({ start_date: '2026-11-01', end_date: '2027-04-30' });
    expect((await getContract(created.id))?.end_date).toBe('2027-04-30');
  });

  it('لا يشارك العقد المُعاد مرجعَ مخزن العرض (حتى يُعاد رسم الشاشة بعد التعديل)', async () => {
    const created = await createDraft(input({}));
    const shown = await getContract(created.id);
    await updateContractTerm(created.id, '2026-11-01', '2027-01-31');
    // النسخ المعروضة سابقًا لا تتغيّر في مكانها — React Query يرى بيانات جديدة فيعيد الرسم
    expect(created.end_date).toBe('2026-12-31');
    expect(shown?.end_date).toBe('2026-12-31');
    expect((await getContract(created.id))?.end_date).toBe('2027-01-31');
  });

  it('لا يعدّل مدة عقد غير مسودة', async () => {
    const created = await createDraft(input({}));
    demoMutateContract(created.id, { status: 'active' });
    await expect(updateContractTerm(created.id, '2026-11-01', '2027-01-31')).rejects.toThrow(
      'مسودة',
    );
    expect((await getContract(created.id))?.end_date).toBe('2026-12-31');
  });

  it('يظهر العقد الجديد في تصنيف التنبيه المناسب', async () => {
    const now = new Date('2026-09-15T09:00:00Z');
    const make = async (service: CreateDraftInput['service_code'], start: string, n: number) => {
      const end = contractEndDate(service, start, n);
      const c = await createDraft(
        input({ service_code: service, start_date: start, end_date: end, quantity: n }),
      );
      demoMutateContract(c.id, { status: 'active' }); // يبدأ التنبيه بعد تفعيل العقد
      return c.id;
    };
    const expired = await make('daily_rental', '2026-09-01', 10); // انتهى 09-10
    const critical = await make('monthly_rental', '2026-08-21', 1); // ينتهي 09-20
    const soon = await make('monthly_rental', '2026-08-10', 2); // ينتهي 10-09

    const alerts = expiryAlerts(await listContracts(ALL), 30, now);
    const urgency = (id: string) => alerts.find((a) => a.contract.id === id)?.urgency;
    expect(urgency(expired)).toBe('expired');
    expect(urgency(critical)).toBe('critical');
    expect(urgency(soon)).toBe('soon');
  });
});

describe('طباعة العقد', () => {
  const base = {
    id: 'p1',
    contract_no: 'MAS-2026-00099',
    service_code: 'monthly_rental',
    template_id: null,
    customer_id: 'cust-1',
    worker_id: null,
    branch_id: 'نجران',
    created_by: null,
    start_date: '2026-10-01',
    end_date: '2026-12-31',
    base_amount: 6000,
    vat_amount: 900,
    total_amount: 6900,
    amount_paid: 0,
    status: 'draft',
    version: 1,
    parent_contract_id: null,
    signed_at: null,
    created_at: '2026-10-01T09:00:00Z',
    customer_name: 'محمد الأحمدي',
    worker_name: null,
    musaned_contract_no: null,
    assigned_office_id: null,
    assigned_at: null,
    recruitment_stage: null,
    visa_number: null,
    expected_arrival_date: null,
    flight_no: null,
  } satisfies ContractListItem;

  it('يتضمّن تاريخ النهاية والمدة في بيانات العقد المطبوعة', () => {
    const html = buildContractHtml(base, []);
    expect(html).toContain('تاريخ النهاية');
    expect(html).toContain('2026-12-31');
    expect(html).toContain('مدة العقد');
    expect(html).toContain('3 أشهر');
  });

  it('لا يطبع تاريخ نهاية لنقل الكفالة', () => {
    const html = buildContractHtml(
      { ...base, service_code: 'sponsorship_transfer', end_date: null },
      [],
    );
    expect(html).not.toContain('تاريخ النهاية');
  });
});
