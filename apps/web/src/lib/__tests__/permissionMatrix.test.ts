import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, type RoleCode } from '@/lib/permissions';

/**
 * The frontend matrix must mirror the DB (supabase/tests/role_permissions.json is
 * dumped from role_permissions after all migrations, and 30_permission_matrix.sql
 * checks the DB against the same file).
 */
const matrix = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../supabase/tests/role_permissions.json'), 'utf8'),
) as Record<string, string[]>;

// accounting.post / accounting.reopen are enforced by the accounting duty model
// (features/accounting/data/access.ts), not by the generic ActionCode set.
const DB_ONLY = new Set(['accounting.post', 'accounting.reopen']);

describe('permission matrix (frontend ↔ database)', () => {
  it('covers the same roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(Object.keys(matrix).sort());
  });

  it.each(Object.keys(matrix))('%s has the same grants in both', (role) => {
    const db = (matrix[role] ?? []).filter((p) => !DB_ONLY.has(p)).sort();
    const fe = [...ROLE_PERMISSIONS[role as RoleCode]].sort();
    expect(fe).toEqual(db);
  });
});
