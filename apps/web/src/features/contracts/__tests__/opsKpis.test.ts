import { describe, expect, it } from 'vitest';
import { computeOpsKpis, EMPTY_OPS_FILTERS } from '@/features/contracts/lib/opsKpis';
import type { ContractListItem } from '@/features/contracts/types';
import type { Refund, Replacement, Settlement } from '@/features/contracts/api/contractOps.api';
import type { Trial } from '@/features/contracts/api/trials.api';

const c = (id: string, o: Partial<ContractListItem>): ContractListItem =>
  ({
    id,
    contract_no: `MAS-${id}`,
    service_code: 'monthly_rental',
    status: 'active',
    branch_id: 'نجران',
    branch_name: 'نجران',
    created_by: 'u1',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    created_at: '2026-10-30T00:00:00Z',
    total_amount: 3450,
    ...o,
  }) as ContractListItem;

const data = {
  contracts: [
    c('a', {}),
    c('b', { status: 'cancelled', branch_id: 'جازان', branch_name: 'جازان' }),
    c('t', { service_code: 'transfer_trial' }),
    c('x', { service_code: 'sponsorship_transfer', status: 'draft' }),
    c('t2', { service_code: 'transfer_trial', status: 'completed', created_by: 'u2' }),
  ],
  settlements: [{ contract_id: 'b', status: 'pending_finance' } as Settlement],
  refunds: [
    { contract_id: 'b', status: 'partially_refunded', paid_total: 1000 } as Refund,
    { contract_id: 'a', status: 'refunded', paid_total: 500 } as Refund,
  ],
  replacements: [{ contract_id: 'a', status: 'scheduled' } as Replacement],
  trials: [
    { contract_id: 't', status: 'in_trial', end_date: '2026-11-25' } as Trial,
    {
      contract_id: 't2',
      status: 'wants_transfer',
      transfer_contract_id: 'x',
      end_date: '2026-11-20',
    } as Trial,
  ],
};
const opts = { today: '2026-11-23', expiringDays: 3 };

describe('contract operations KPIs', () => {
  it('computes the nine indicators', () => {
    const k = computeOpsKpis(data, EMPTY_OPS_FILTERS, opts).values;
    expect(k).toEqual({
      active: 2,
      cancelled: 1,
      awaiting_settlement: 1,
      refunds_pending: 1,
      refunded_total: 1500,
      replacements: 1,
      trials_active: 1,
      trials_expiring: 1,
      transfers_pending: 1,
    });
  });

  it('filters by branch, employee, service and period', () => {
    expect(
      computeOpsKpis(data, { ...EMPTY_OPS_FILTERS, branch: 'جازان' }, opts).values.cancelled,
    ).toBe(1);
    expect(
      computeOpsKpis(data, { ...EMPTY_OPS_FILTERS, branch: 'جازان' }, opts).values.active,
    ).toBe(0);
    expect(
      computeOpsKpis(data, { ...EMPTY_OPS_FILTERS, employee: 'u2' }, opts).values.transfers_pending,
    ).toBe(1);
    expect(
      computeOpsKpis(data, { ...EMPTY_OPS_FILTERS, service: 'transfer_trial' }, opts).values
        .trials_active,
    ).toBe(1);
    expect(
      computeOpsKpis(data, { ...EMPTY_OPS_FILTERS, from: '2026-12-01' }, opts).values.active,
    ).toBe(0);
  });

  it('a transfer is no longer pending once Musaned signed', () => {
    const signed = {
      ...data,
      contracts: data.contracts.map((x) =>
        x.id === 'x' ? { ...x, status: 'musaned_signed' as const } : x,
      ),
    };
    expect(computeOpsKpis(signed, EMPTY_OPS_FILTERS, opts).values.transfers_pending).toBe(0);
  });
});
