import type { ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import type { RoleCode } from '@/lib/permissions';

/** Renders children only for the listed roles. */
export function RoleGate({
  roles, children, fallback = null,
}: {
  roles: RoleCode[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role } = usePermissions();
  return <>{role && roles.includes(role) ? children : fallback}</>;
}
