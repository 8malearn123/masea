import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_GROUPS, MODULES, ROLE_PERMISSIONS } from '@/lib/permissions';

describe('the corporate e-mail module is removed (0094)', () => {
  it('has no sidebar entry, group slot, route or grant', () => {
    expect(MODULES.some((m) => m.label.includes('البريد المؤسسي') || m.to === '/it-admin')).toBe(
      false,
    );
    expect(MODULE_GROUPS.flatMap((g) => g.modules).map(String)).not.toContain('it_admin');
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      expect([...perms].some((p) => p.startsWith('it_admin'))).toBe(false);
    }
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).not.toMatch(/it-admin|ItAdminBoard/);
  });
});
