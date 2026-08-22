import { describe, expect, it } from 'vitest';
import { roleCan } from '@/lib/permissions';

describe('external_office permission matrix', () => {
  it('can view recruitment contracts assigned to it', () => {
    expect(roleCan('external_office', 'contracts', 'view')).toBe(true);
  });

  it('cannot create or edit contracts (follow-up only, no contract authoring)', () => {
    expect(roleCan('external_office', 'contracts', 'create')).toBe(false);
    expect(roleCan('external_office', 'contracts', 'edit')).toBe(false);
    expect(roleCan('external_office', 'contracts', 'approve')).toBe(false);
  });

  it('has no access to any other module', () => {
    expect(roleCan('external_office', 'accounting', 'view')).toBe(false);
    expect(roleCan('external_office', 'rbac', 'view')).toBe(false);
    expect(roleCan('external_office', 'hr', 'view')).toBe(false);
  });
});
