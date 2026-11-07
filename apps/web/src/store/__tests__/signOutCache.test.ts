import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: async () => ({ error: null }) } },
}));
import { queryClient } from '@/lib/queryClient';
import { useAuth } from '@/store/auth';
import { DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';

describe('sign-out', () => {
  it("drops every cached query so the next user never sees the previous user's data", async () => {
    const gm = DEMO_ACCOUNTS.find((a) => a.role === 'admin')!;
    saveDemo(gm);
    useAuth.setState({ profile: demoProfile(gm) });
    queryClient.setQueryData(['hr', 'payroll-run', '2026-11'], { run: { total_net: 87626.22 } });
    expect(queryClient.getQueryData(['hr', 'payroll-run', '2026-11'])).toBeTruthy();
    await useAuth.getState().signOut();
    expect(queryClient.getQueryData(['hr', 'payroll-run', '2026-11'])).toBeUndefined();
    expect(useAuth.getState().profile).toBeNull();
  });
});
