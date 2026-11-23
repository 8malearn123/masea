import { describe, expect, it } from 'vitest';
import { computeSettlement, creditNoteAmount } from '@/features/contracts/lib/settlement';

const rental = {
  status: 'active' as const,
  start_date: '2026-10-01',
  end_date: '2026-11-29', // 60 days
  total_amount: 6900,
  amount_paid: 6900,
};
const term200 = { cancelDailyDeduction: { value: 200, clause_ref: 'البند الثالث/10' } };

describe('contract settlement (mirror of compute_contract_settlement, 0090)', () => {
  it('before the service starts nothing is due and everything paid is refundable', () => {
    const p = computeSettlement({
      contract: { ...rental, status: 'signed' },
      delivered: false,
      effectiveDate: '2026-09-28',
      terms: term200,
    });
    expect(p.kind).toBe('cancel_before_start');
    expect(p.service_due).toBe(0);
    expect(p.due_basis).toBe('none');
    expect(p.balance).toBe(6900);
    expect(creditNoteAmount(p)).toBe(6900);
  });

  it('after start applies the contract term per used day (البند الثالث/10), return day included', () => {
    const p = computeSettlement({
      contract: rental,
      delivered: true,
      effectiveDate: '2026-10-10',
      terms: term200,
    });
    expect(p.days_total).toBe(60);
    expect(p.days_used).toBe(10);
    expect(p.days_remaining).toBe(50);
    expect(p.service_due).toBe(2000);
    expect(p.due_basis).toBe('contract_term');
    expect(p.due_basis_ref).toBe('البند الثالث/10');
    expect(p.balance).toBe(4900);
  });

  it('honours «احتساب يوم الإرجاع = 0» from the system settings', () => {
    const p = computeSettlement({
      contract: rental,
      delivered: true,
      effectiveDate: '2026-10-10',
      terms: term200,
      countReturnDay: false,
    });
    expect(p.days_used).toBe(9);
    expect(p.service_due).toBe(1800);
  });

  it('never charges more than the contract value', () => {
    const p = computeSettlement({
      contract: { ...rental, total_amount: 3450, amount_paid: 3450, end_date: '2026-10-30' },
      delivered: true,
      effectiveDate: '2026-10-25',
      terms: term200,
    });
    expect(p.service_due).toBe(3450);
    expect(p.balance).toBe(0);
  });

  it('without a daily term the due value is pro-rata (no invented deduction)', () => {
    const p = computeSettlement({ contract: rental, delivered: true, effectiveDate: '2026-10-15' });
    expect(p.due_basis).toBe('prorata');
    expect(p.service_due).toBe(1725); // 6,900 × 15 / 60
  });

  it('open-ended contracts need a manual value with its clause', () => {
    const p = computeSettlement({
      contract: { ...rental, end_date: null },
      delivered: true,
      effectiveDate: '2026-10-15',
    });
    expect(p.due_basis).toBe('manual');
    expect(p.service_due).toBe(0);
  });

  it('every fee must cite a clause; fees beyond the payment leave a balance due', () => {
    expect(() =>
      computeSettlement({
        contract: rental,
        delivered: true,
        effectiveDate: '2026-10-10',
        fees: [{ label: 'غرامة', amount: 100, clause_ref: '' }],
      }),
    ).toThrow('بند');
    const p = computeSettlement({
      contract: { ...rental, amount_paid: 1000 },
      delivered: true,
      effectiveDate: '2026-10-10',
      terms: term200,
      fees: [{ label: 'رسوم توصيل', amount: 50, clause_ref: 'البند الثالث/11' }],
    });
    expect(p.fees_total).toBe(50);
    expect(p.balance).toBe(-1050);
  });
});
