import { describe, expect, it } from 'vitest';
import {
  contractInsight,
  contractKpis,
  expiryAlerts,
  expirySummary,
  expiryTone,
  matchesTab,
  needsRenewal,
} from '@/features/contracts/lib/contractInsights';
import type { ContractListItem, ContractStatus } from '@/features/contracts/types';

const NOW = new Date('2026-09-20T09:00:00Z');

function day(offset: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function contract(id: string, status: ContractStatus, endOffset: number | null): ContractListItem {
  return {
    id,
    contract_no: `MAS-2026-${id}`,
    service_code: 'monthly_rental',
    template_id: null,
    customer_id: `cust-${id}`,
    worker_id: null,
    branch_id: 'نجران',
    created_by: null,
    start_date: '2026-03-01',
    end_date: endOffset === null ? null : day(endOffset),
    base_amount: 6000,
    vat_amount: 900,
    total_amount: 6900,
    amount_paid: 6900,
    status,
    version: 1,
    parent_contract_id: null,
    signed_at: null,
    created_at: '2026-03-01T09:00:00Z',
    customer_name: 'عميل تجريبي',
    worker_name: null,
    musaned_contract_no: null,
    assigned_office_id: null,
    assigned_at: null,
    recruitment_stage: null,
    visa_number: null,
    expected_arrival_date: null,
    flight_no: null,
  };
}

describe('تنبيهات انتهاء العقود', () => {
  const rows = [
    contract('A', 'active', 3), // حرِج
    contract('B', 'active', 25), // قريب
    contract('C', 'active', -4), // منتهٍ ولم يُجدَّد
    contract('D', 'active', 90), // خارج المهلة
    contract('E', 'cancelled', 2), // ملغى — لا تنبيه
    contract('F', 'active', null), // بلا تاريخ نهاية
  ];

  it('ينبّه فقط للعقود السارية داخل المهلة أو المنتهية', () => {
    const ids = expiryAlerts(rows, 30, NOW).map((a) => a.contract.id);
    expect(ids).toEqual(['C', 'A', 'B']);
  });

  it('يصنّف الإلحاح ويصوغ الرسالة بالعربية', () => {
    const [expired, critical, soon] = expiryAlerts(rows, 30, NOW);
    expect(expired?.urgency).toBe('expired');
    expect(expired?.message).toBe('انتهى منذ 4 يومًا');
    expect(critical?.urgency).toBe('critical');
    expect(soon?.urgency).toBe('soon');
    expect(soon?.message).toBe('ينتهي بعد 25 يومًا');
  });

  it('تتّسع التنبيهات باتّساع المهلة الإدارية', () => {
    expect(expiryAlerts(rows, 7, NOW).map((a) => a.contract.id)).toEqual(['C', 'A']);
    expect(expiryAlerts(rows, 120, NOW)).toHaveLength(4);
  });

  it('يعطي لونًا لكل درجة إلحاح', () => {
    expect(expiryTone('expired')).toBe('danger');
    expect(expiryTone('soon')).toBe('gold');
  });
});

describe('تصنيف حالة الانتهاء (مصدر واحد)', () => {
  const state = (c: ContractListItem, window = 30) => contractInsight(c, NOW, window).expiry;

  it('يصنّف المنتهي والحرِج والقريب والسليم', () => {
    expect(state(contract('a', 'active', -1))).toBe('expired');
    expect(state(contract('b', 'active', 0))).toBe('critical');
    expect(state(contract('c', 'active', 10))).toBe('critical');
    expect(state(contract('d', 'active', 11))).toBe('soon');
    expect(state(contract('e', 'active', 30))).toBe('soon');
    expect(state(contract('f', 'active', 31))).toBe('ok');
  });

  it('لا يصنّف العقد بلا تاريخ نهاية منتهيًا ولا قريبًا', () => {
    const c = contract('n', 'active', null);
    expect(state(c)).toBe('no_end_date');
    expect(needsRenewal(state(c))).toBe(false);
    expect(expiryAlerts([c], 30, NOW)).toHaveLength(0);
  });

  it('لا ينطبق على غير الساري ولا على نقل الكفالة بلا مدة', () => {
    expect(state(contract('d1', 'draft', -10))).toBe('not_applicable');
    expect(state(contract('c1', 'completed', -10))).toBe('not_applicable');
    expect(state(contract('x1', 'cancelled', 2))).toBe('not_applicable');
    expect(state({ ...contract('t1', 'active', null), service_code: 'sponsorship_transfer' })).toBe(
      'not_applicable',
    );
  });

  it('يعدّ الحالات ويتغيّر العدد بتغيّر المهلة', () => {
    const rows = [
      contract('A', 'active', 3),
      contract('B', 'active', 25),
      contract('C', 'active', -4),
      contract('D', 'active', 90),
      contract('F', 'active', null),
      contract('G', 'draft', 5),
    ];
    expect(expirySummary(rows, 30, NOW)).toEqual({
      expired: 1,
      critical: 1,
      soon: 1,
      noEndDate: 1,
      needsRenewal: 3,
    });
    // مهلة ٧ أيام: «حرِج» = يومان فأقل، فالعقد الذي بقي له ٣ أيام «قريب»
    expect(expirySummary(rows, 7, NOW)).toMatchObject({ critical: 0, soon: 1, needsRenewal: 2 });
    // مهلة ١٢٠ يومًا: «حرِج» = ٤٠ يومًا فأقل
    expect(expirySummary(rows, 120, NOW)).toMatchObject({ critical: 2, soon: 1, needsRenewal: 4 });
  });

  it('تبويب التجديدات ومؤشّره يشملان المنتهي غير المجدَّد', () => {
    const rows = [
      contract('A', 'active', 3),
      contract('C', 'active', -4),
      contract('F', 'active', null),
    ];
    const inRenewals = rows.filter((c) => matchesTab(c, contractInsight(c, NOW, 30), 'renewals'));
    expect(inRenewals.map((c) => c.id)).toEqual(['A', 'C']);
    const k = contractKpis(rows, NOW, 30);
    expect(k).toMatchObject({ renewals: 2, expired: 1, expiringSoon: 1, noEndDate: 1 });
  });
});
