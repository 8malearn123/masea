import type { ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import type { ActionCode, ModuleCode } from '@/lib/permissions';

/** Renders children only if the user has (module, action). UI-only gating. */
export function PermissionGate({
  module, action = 'view', children, fallback = null,
}: {
  module: ModuleCode;
  action?: ActionCode;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = usePermissions();
  return <>{can(module, action) ? children : fallback}</>;
}
