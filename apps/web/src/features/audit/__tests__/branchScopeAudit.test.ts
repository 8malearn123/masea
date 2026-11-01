import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import { inViewerBranch, scopeToViewerBranch } from '@/lib/branchScope';
import { listContracts } from '@/features/contracts/api/contracts.api';
import {
  applyAuditFilters,
  EMPTY_AUDIT_FILTERS,
  listAuditLog,
} from '@/features/audit/api/audit.api';
import { auditChanges, listDemoAudit, recordAudit } from '@/shared/lib/auditTrail';

function loginAs(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo account for ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}

afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('branch scope (mirror of in_my_branch)', () => {
  it('a branch role sees its own branch only — never rows without a branch', () => {
    const acc = loginAs('branch_manager');
    expect(inViewerBranch(acc.branch)).toBe(true);
    expect(inViewerBranch(acc.branch === 'حبونا' ? 'نجران' : 'حبونا')).toBe(false);
    expect(inViewerBranch(null)).toBe(false);
  });

  it('a cross-branch role sees every branch and unassigned rows', () => {
    loginAs('admin');
    const rows = [{ b: 'نجران' }, { b: 'جازان' }, { b: null }];
    expect(scopeToViewerBranch(rows, (r) => r.b)).toHaveLength(3);
  });

  it("demo contracts list is limited to the manager's branch", async () => {
    const acc = loginAs('branch_manager');
    const rows = await listContracts({ status: 'all', service: 'all', branch: 'all', search: '' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.branch_id === acc.branch)).toBe(true);
  });
});

describe('audit trail', () => {
  it('records a UI change with the actor and branch of the session', () => {
    const acc = loginAs('branch_manager');
    const e = recordAudit({
      action: 'update',
      entity: 'customers',
      record_ref: 'سعد الوادعي',
      old_data: { phone: '0555100203' },
      new_data: { phone: '0555100230' },
    });
    expect(e.actor_name).toBe(acc.name);
    expect(e.branch).toBe(acc.branch);
    expect(listDemoAudit()[0]?.id).toBe(e.id);
    expect(auditChanges(e)).toEqual([
      { field: 'phone', before: '0555100203', after: '0555100230' },
    ]);
  });

  it('a branch manager reads only the trail of their branch', async () => {
    const acc = loginAs('branch_manager');
    const rows = await listAuditLog(EMPTY_AUDIT_FILTERS);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.branch === acc.branch)).toBe(true);
  });

  it('the general manager reads the whole trail, including head-office changes', async () => {
    loginAs('admin');
    const rows = await listAuditLog(EMPTY_AUDIT_FILTERS);
    expect(rows.some((r) => r.branch === null)).toBe(true);
    expect(new Set(rows.map((r) => r.branch)).size).toBeGreaterThan(2);
  });

  it('filters by entity, action and date', () => {
    const rows = listDemoAudit();
    const contracts = applyAuditFilters(rows, { ...EMPTY_AUDIT_FILTERS, entity: 'contracts' });
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts.every((r) => r.entity === 'contracts')).toBe(true);
    const future = applyAuditFilters(rows, { ...EMPTY_AUDIT_FILTERS, from: '2999-01-01' });
    expect(future).toHaveLength(0);
  });
});
