import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import type { ActionCode, ModuleCode } from '@/lib/permissions';

/**
 * Route guard — blocks users who lack (module, action) for the route, even if
 * they type the URL directly, and offers a way back to the dashboard.
 * Backend RLS (has_perm) independently returns EMPTY data; this guards navigation.
 */
export function RequirePerm({
  module,
  action = 'view',
  children,
}: {
  module: ModuleCode;
  action?: ActionCode;
  children: ReactNode;
}) {
  const { can } = usePermissions();
  if (!can(module, action)) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-center">
        <div>
          <div className="text-navy-300 grid place-items-center">
            <Lock size={40} strokeWidth={1.6} />
          </div>
          <p className="mt-3 font-bold text-navy">غير مصرّح بالوصول</p>
          <p className="mt-1 text-sm text-purple">هذه الصفحة خارج نطاق صلاحيات دورك.</p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-700"
          >
            العودة للوحة التحكم
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
