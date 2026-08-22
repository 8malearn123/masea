import { describe, expect, it } from 'vitest';
import { roleCan, ROLE_META } from '@/lib/permissions';

describe('RBAC permission matrix', () => {
  it('grants the general manager rbac.manage', () => {
    expect(roleCan('admin', 'rbac', 'manage')).toBe(true);
    expect(ROLE_META.admin.crossBranch).toBe(true);
  });

  it('denies rbac.manage to everyone else', () => {
    expect(roleCan('operations_manager', 'rbac', 'manage')).toBe(false);
    expect(roleCan('accountant', 'rbac', 'manage')).toBe(false);
  });

  it('scopes the accountant to finance, not GPS', () => {
    expect(roleCan('accountant', 'payments', 'view')).toBe(true);
    expect(roleCan('accountant', 'payments', 'edit')).toBe(true);
    expect(roleCan('accountant', 'gps', 'view')).toBe(false);
  });

  it('lets sales edit contracts but not delete them', () => {
    expect(roleCan('sales', 'contracts', 'edit')).toBe(true);
    expect(roleCan('sales', 'contracts', 'delete')).toBe(false);
  });

  it('marks driver and housing supervisor as mobile-only', () => {
    expect(ROLE_META.driver.webAccess).toBe(false);
    expect(ROLE_META.housing_supervisor.webAccess).toBe(false);
  });

  it('returns false for an unknown permission', () => {
    expect(roleCan(undefined, 'contracts', 'view')).toBe(false);
  });
});
