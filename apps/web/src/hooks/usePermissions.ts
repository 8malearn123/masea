import { useAuth } from '@/store/auth';
import { loadDemo } from '@/lib/demo';
import {
  MODULES,
  ROLE_META,
  ROLE_PERMISSIONS,
  type ActionCode,
  type ModuleCode,
  type RoleCode,
} from '@/lib/permissions';

/**
 * Current user's permissions for UI gating. Security is enforced in the
 * backend (RLS + has_perm); this only decides what the UI shows.
 */
export function usePermissions() {
  const { profile } = useAuth();
  const role = (profile?.role ?? undefined) as RoleCode | undefined;
  const perms = role ? ROLE_PERMISSIONS[role] : undefined;

  const can = (module: ModuleCode, action: ActionCode): boolean =>
    perms?.has(`${module}.${action}`) ?? false;

  // The driver's web app is a simplified personal portal: relabel the shared
  // modules to his own scope (رحلاتي / تتبّعي) instead of the dispatch labels.
  const DRIVER_LABELS: Partial<Record<ModuleCode, string>> = {
    orders: 'رحلاتي',
    gps: 'تتبّعي',
  };
  const modules = MODULES.filter((m) => can(m.module, 'view')).map((m) =>
    role === 'driver' && DRIVER_LABELS[m.module]
      ? { ...m, label: DRIVER_LABELS[m.module] as string }
      : m,
  );
  const meta = role ? ROLE_META[role] : undefined;
  const branchLabel = loadDemo()?.branch ?? null;

  return {
    role,
    meta,
    can,
    modules,
    branchLabel,
    userId: profile?.id ?? null,
    fullName: profile?.full_name ?? 'مستخدم',
  };
}
