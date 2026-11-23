import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import {
  decideRequest,
  executeRequest,
  listAccounts,
  listRequests,
  resetItAdminDemo,
  submitRequest,
} from '@/features/it-admin/api/itAdmin.api';
import { roleCan as can } from '@/lib/permissions';

function as(role: AppRole, idx = 0): void {
  const acc = DEMO_ACCOUNTS.filter((a) => a.role === role)[idx];
  if (!acc) throw new Error(`no demo ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: { ...demoProfile(acc), id: `${acc.email}-${idx}` } });
}

beforeEach(() => resetItAdminDemo());
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('corporate e-mail registry (demo mirror of 0093)', () => {
  it('seeds the company list as 26 unique requested accounts with pending create requests', async () => {
    const accounts = await listAccounts();
    expect(accounts).toHaveLength(26);
    expect(new Set(accounts.map((a) => a.address)).size).toBe(26);
    expect(accounts.every((a) => a.status === 'requested')).toBe(true);
    expect(accounts.find((a) => a.address === 'maram@masiatalsharq.com')?.note).toContain(
      'maram.almustanir',
    );
    expect((await listRequests()).filter((r) => r.status === 'pending')).toHaveLength(26);
  });

  it('only the admin role manages it (permission mirror)', () => {
    expect(can('admin', 'it_admin', 'manage')).toBe(true);
    expect(can('sales', 'it_admin', 'view')).toBe(false);
    expect(can('hr', 'it_admin', 'view')).toBe(false);
  });

  it('refuses duplicates and foreign domains; four eyes; execution activates', async () => {
    as('admin');
    await expect(
      submitRequest({
        type: 'create',
        accountId: null,
        employeeName: 'Karim',
        address: 'karim@masiatalsharq.com',
      }),
    ).rejects.toThrow('مكررة');
    await expect(
      submitRequest({ type: 'create', accountId: null, employeeName: 'x', address: 'x@gmail.com' }),
    ).rejects.toThrow('دومين');
    await submitRequest({
      type: 'create',
      accountId: null,
      employeeName: 'لمى',
      address: 'lama@masiatalsharq.com',
      displayName: 'Lama',
    });
    const [mine] = await listRequests();
    await expect(decideRequest(mine!, true)).rejects.toThrow('أربع أعين');
    useAuth.setState({ profile: { ...useAuth.getState().profile!, id: 'another-admin' } });
    await decideRequest(mine!, true);
    await expect(executeRequest(mine!, 'password: 1234')).rejects.toThrow('كلمات المرور');
    await executeRequest(mine!, 'أُنشئ في لوحة المزوّد');
    expect((await listAccounts()).find((a) => a.address === 'lama@masiatalsharq.com')?.status).toBe(
      'active',
    );
  });
});
