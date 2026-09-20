import { describe, expect, it } from 'vitest';
import { expiryAlerts, expiryTone } from '@/features/contracts/lib/contractInsights';
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
