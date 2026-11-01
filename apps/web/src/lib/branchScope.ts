/**
 * نطاق الفرع للمستخدم الحالي — مرآة الواجهة لدالة `in_my_branch()` (0061).
 *
 * مع قاعدة بيانات فعلية: RLS هي المرجع، والصفوف تصل مُصفّاة أصلاً، فلا تصفية هنا.
 * في الوضع التجريبي لا يوجد RLS، فهذه الدالة هي التي تحجب بيانات الفروع الأخرى:
 * الأدوار العابرة للفروع ترى الكل، وغيرها يرى فرعه فقط — والسجل بلا فرع لا يراه
 * إلا الأدوار العابرة (نفس قاعدة قاعدة البيانات).
 */
import { useAuth } from '@/store/auth';
import { loadDemo } from '@/lib/demo';
import { ROLE_META, type RoleCode } from '@/lib/permissions';
import { isDemoMode } from '@/shared/lib/demoBackend';

export interface ViewerScope {
  crossBranch: boolean;
  /** فرع المستخدم (اسم المدينة في الوضع التجريبي). */
  branch: string | null;
}

export function viewerScope(): ViewerScope {
  const role = useAuth.getState().profile?.role as RoleCode | undefined;
  return {
    crossBranch: role ? (ROLE_META[role]?.crossBranch ?? false) : false,
    branch: loadDemo()?.branch ?? null,
  };
}

/** هل يقع هذا الفرع ضمن نطاق المستخدم؟ (بدون فرع = للأدوار العابرة فقط) */
export function inViewerBranch(branch: string | null | undefined, scope = viewerScope()): boolean {
  if (scope.crossBranch) return true;
  return !!branch && branch === scope.branch;
}

/** تصفية صفوف الوضع التجريبي على نطاق المستخدم؛ مع الـ backend تُعاد كما هي. */
export function scopeToViewerBranch<T>(
  rows: T[],
  branchOf: (row: T) => string | null | undefined,
): T[] {
  if (!isDemoMode() || !useAuth.getState().profile) return rows;
  const scope = viewerScope();
  return rows.filter((r) => inViewerBranch(branchOf(r), scope));
}
