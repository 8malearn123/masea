import { describe, expect, it } from 'vitest';
import { roleCan, ROLE_META } from '@/lib/permissions';

describe('branch_manager permission matrix', () => {
  it('runs operations for its branch (contracts/orders/targets)', () => {
    expect(roleCan('branch_manager', 'contracts', 'create')).toBe(true);
    expect(roleCan('branch_manager', 'contracts', 'approve')).toBe(true);
    expect(roleCan('branch_manager', 'orders', 'edit')).toBe(true);
    expect(roleCan('branch_manager', 'targets', 'create')).toBe(true);
  });

  it('manages team + approves leaves + submits payroll adjustments — but cannot approve payroll', () => {
    expect(roleCan('branch_manager', 'hr', 'view')).toBe(true);
    expect(roleCan('branch_manager', 'hr', 'create')).toBe(true); // submit adjustments
    expect(roleCan('branch_manager', 'hr', 'approve')).toBe(true); // approve leaves
    expect(roleCan('branch_manager', 'hr', 'manage')).toBe(false); // NOT final payroll approval
  });

  it('sees money as read-only, never controls it', () => {
    expect(roleCan('branch_manager', 'payments', 'view')).toBe(true);
    expect(roleCan('branch_manager', 'payments', 'edit')).toBe(false);
    expect(roleCan('branch_manager', 'pricing', 'view')).toBe(true);
    expect(roleCan('branch_manager', 'pricing', 'edit')).toBe(false);
  });

  it('is blocked from accounting and system administration', () => {
    expect(roleCan('branch_manager', 'accounting', 'view')).toBe(false);
    expect(roleCan('branch_manager', 'rbac', 'manage')).toBe(false);
    expect(roleCan('branch_manager', 'rbac', 'view')).toBe(false);
  });

  it('is a branch-scoped role (not cross-branch), unlike operations_manager', () => {
    expect(ROLE_META.branch_manager.crossBranch).toBe(false);
    expect(ROLE_META.operations_manager.crossBranch).toBe(true);
    // ops manager runs the same operations but across all branches
    expect(roleCan('operations_manager', 'orders', 'edit')).toBe(true);
  });
});
