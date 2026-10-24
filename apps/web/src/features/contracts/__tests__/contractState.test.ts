import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isEditable,
  isRenewable,
  needsConfirmation,
  nextStatuses,
  transitionBlocker,
} from '@/features/contracts/lib/contractState';
import { formatContractNo, parseContractNo } from '@/features/contracts/lib/contractNo';
import { renderClause } from '@/features/contracts/lib/clauses';

describe('contract state machine', () => {
  it('allows only legal transitions', () => {
    expect(canTransition('draft', 'pending_approval')).toBe(true);
    expect(canTransition('pending_approval', 'approved')).toBe(true);
    expect(canTransition('approved', 'awaiting_signature')).toBe(true);
    expect(canTransition('awaiting_signature', 'signed')).toBe(true);
    expect(canTransition('signed', 'active')).toBe(true);
    expect(canTransition('active', 'completed')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('draft', 'signed')).toBe(false);
    expect(canTransition('draft', 'active')).toBe(false);
    expect(canTransition('signed', 'draft')).toBe(false);
    expect(canTransition('completed', 'active')).toBe(false);
    expect(canTransition('cancelled', 'draft')).toBe(false);
  });

  it('makes only drafts editable (signed contracts are immutable)', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('signed')).toBe(false);
    expect(isEditable('active')).toBe(false);
  });

  it('terminal states have no next steps', () => {
    expect(nextStatuses('completed')).toEqual([]);
    expect(nextStatuses('cancelled')).toEqual([]);
  });

  it('follows the Musaned track for musaned-origin contracts', () => {
    expect(canTransition('draft', 'musaned_created', 'musaned')).toBe(true);
    expect(canTransition('musaned_created', 'musaned_signed', 'musaned')).toBe(true);
    expect(canTransition('musaned_signed', 'active', 'musaned')).toBe(true);
    expect(canTransition('active', 'completed', 'musaned')).toBe(true);
    expect(nextStatuses('draft', 'musaned')).toEqual(['musaned_created', 'cancelled']);
  });

  it('keeps the two tracks separate', () => {
    // internal statuses are illegal on the Musaned track…
    expect(canTransition('draft', 'pending_approval', 'musaned')).toBe(false);
    expect(canTransition('musaned_signed', 'signed', 'musaned')).toBe(false);
    // …and Musaned statuses are illegal on the internal track.
    expect(canTransition('draft', 'musaned_created', 'internal')).toBe(false);
    expect(canTransition('draft', 'musaned_created')).toBe(false);
  });
});

describe('contract number', () => {
  it('formats as MAS-{year}-{00000}', () => {
    expect(formatContractNo(2026, 42)).toBe('MAS-2026-00042');
    expect(formatContractNo(2026, 1)).toBe('MAS-2026-00001');
  });

  it('parses a valid number and rejects bad input', () => {
    expect(parseContractNo('MAS-2026-00042')).toEqual({ year: 2026, seq: 42 });
    expect(parseContractNo('INVALID')).toBeNull();
  });
});

describe('clause variable substitution', () => {
  it('replaces known variables and keeps unknown ones', () => {
    expect(
      renderClause('العميل {{customer_name}} بمبلغ {{total}} ريال', {
        customer_name: 'محمد الأحمدي',
        total: '18,400.00',
      }),
    ).toBe('العميل محمد الأحمدي بمبلغ 18,400.00 ريال');
    expect(renderClause('قيمة {{missing}}', {})).toBe('قيمة {{missing}}');
  });
});

describe('contract transition guards (transition_contract mirror)', () => {
  it('requires the Musaned number before marking the contract created on مساند', () => {
    const c = { status: 'draft' as const, musaned_contract_no: null };
    expect(transitionBlocker(c, 'musaned_created', 'musaned')).toMatch(/رقم عقد مساند/);
    expect(
      transitionBlocker({ ...c, musaned_contract_no: '4062118045' }, 'musaned_created', 'musaned'),
    ).toBeNull();
  });

  it('blocks transitions outside the origin track', () => {
    const c = { status: 'draft' as const, musaned_contract_no: null };
    expect(transitionBlocker(c, 'pending_approval', 'musaned')).not.toBeNull();
    expect(transitionBlocker(c, 'pending_approval', 'internal')).toBeNull();
  });

  it('asks for confirmation on cancel / complete and renews live or finished contracts only', () => {
    expect(needsConfirmation('cancelled')).toBe(true);
    expect(needsConfirmation('completed')).toBe(true);
    expect(needsConfirmation('approved')).toBe(false);
    expect(isRenewable('active')).toBe(true);
    expect(isRenewable('completed')).toBe(true);
    expect(isRenewable('draft')).toBe(false);
    expect(isRenewable('cancelled')).toBe(false);
  });
});

describe('contract end date', () => {
  it('computes inclusive end dates for months and days', async () => {
    const { contractEndDate } = await import('@/features/contracts/lib/contractDates');
    expect(contractEndDate('2026-11-01', { unit: 'month', count: 3 })).toBe('2027-01-31');
    expect(contractEndDate('2026-01-31', { unit: 'month', count: 1 })).toBe('2026-02-28');
    expect(contractEndDate('2026-11-05', { unit: 'day', count: 3 })).toBe('2026-11-07');
    expect(contractEndDate('2026-11-05', { unit: 'day', count: 1 })).toBe('2026-11-05');
    expect(contractEndDate('', { unit: 'day', count: 3 })).toBeNull();
    expect(contractEndDate('2026-11-05', null)).toBeNull();
  });
});
