/**
 * RBAC permission model (frontend mirror of supabase 0013_rbac.sql).
 *
 * The backend (RLS + has_perm) is the source of truth for security; this
 * mirror only drives UI gating (sidebar, PermissionGate). Keep both in sync.
 */
import type { AppRole } from '@masiat/shared';

export type RoleCode = AppRole;

export type ModuleCode =
  | 'contracts'
  | 'leads'
  | 'gps'
  | 'pricing'
  | 'payments'
  | 'hr'
  | 'call_center'
  | 'loyalty'
  | 'housing'
  | 'orders'
  | 'rating'
  | 'rbac'
  | 'reports'
  | 'targets'
  | 'accounting'
  | 'settings';

export type ActionCode = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' | 'manage';

type Sym = 'full' | 'edit' | 'view' | 'manage';
/** A grant is either a shorthand symbol or an explicit action list. */
type Grant = Sym | ActionCode[];

function expand(grant: Grant): ActionCode[] {
  if (Array.isArray(grant)) return grant;
  switch (grant) {
    case 'full':
      return ['view', 'create', 'edit', 'delete', 'approve', 'export'];
    case 'edit':
      return ['view', 'create', 'edit'];
    case 'view':
      return ['view'];
    case 'manage':
      return ['view', 'manage'];
  }
}

/** The matrix from section 2 — identical to the SQL seed. */
const GRANTS: Record<RoleCode, Partial<Record<ModuleCode, Grant>>> = {
  admin: {
    contracts: 'full',
    leads: 'full',
    gps: 'full',
    // full + manage: الإدارة تعدّل إعدادات التسعير (ضريبة/غرامات/تعويضات)
    pricing: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'],
    payments: 'full',
    hr: 'full',
    call_center: 'full',
    loyalty: 'full',
    housing: 'full',
    orders: 'full',
    rating: 'full',
    rbac: 'manage',
    reports: 'full',
    targets: 'full',
    accounting: 'full',
    settings: 'manage',
  },
  operations_manager: {
    contracts: 'full',
    leads: 'full',
    gps: 'full',
    // full + manage: مدير العمليات يدير إعدادات التسعير كالمدير العام
    pricing: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'],
    payments: 'view',
    hr: 'view',
    call_center: 'full',
    loyalty: 'full',
    housing: 'full',
    orders: 'full',
    rating: 'full',
    reports: 'full',
    targets: 'full',
    accounting: 'view',
    settings: 'manage',
  },
  branch_manager: {
    // الرأس التشغيلي لفرعه فقط — يملك العمليات، لا المال ولا النظام.
    contracts: 'full', // إنشاء + اعتماد (فرعه)
    leads: 'full',
    orders: 'full',
    targets: 'full',
    loyalty: 'edit',
    call_center: 'edit',
    // إدارة الفريق + اعتماد الإجازات + تقديم تعديلات الرواتب (لا اعتماد نهائي)
    hr: ['view', 'create', 'edit', 'approve'],
    gps: 'view',
    payments: 'view', // إيرادات الفرع (عرض)
    pricing: 'view', // عرض + خصم محدود في مسار الصفقة
    rating: 'view',
    reports: 'view',
    housing: 'view',
    // محجوب: accounting (المال) + rbac (النظام)
  },
  sales: {
    contracts: 'edit',
    leads: 'full',
    pricing: 'edit',
    call_center: 'view',
    loyalty: 'edit',
    orders: 'edit',
    rating: 'view',
    reports: 'view',
    targets: 'view',
  },
  call_center: {
    contracts: 'view',
    leads: ['view', 'create'],
    gps: 'view',
    pricing: 'view',
    call_center: 'full',
    loyalty: 'edit',
    orders: 'edit',
    rating: 'edit',
    targets: 'view',
  },
  // السائق يرى رحلاته المُسندة فقط ويحدّث حالتها، ويتتبّع موقعه — لا لوحة شرف ولا أسطول.
  driver: { gps: 'edit', orders: 'edit' },
  housing_supervisor: { housing: 'full' },
  hr: { hr: 'full', housing: 'view', reports: 'view' },
  accountant: {
    // محاسبي فقط: المدفوعات + النظام المحاسبي + التقارير المالية (واللوحة المالية متاحة للجميع).
    // بيانات الرواتب/الإيراد تصل المحاسب عبر القيود والتقارير، لا عبر فتح وحدات HR/العقود.
    payments: 'full',
    accounting: 'full',
    reports: 'full',
  },
  external_office: {
    // يطّلع على عقود الاستقدام المُسندة له ويحدّث مراحلها ويكتب ملاحظات
    // (عبر دالة advance_recruitment_stage المبنية على الإسناد) — لا ينشئ عقوداً.
    contracts: 'view',
  },
};

/** role → "module.action" set */
export const ROLE_PERMISSIONS: Record<RoleCode, Set<string>> = Object.fromEntries(
  (Object.keys(GRANTS) as RoleCode[]).map((role) => {
    const set = new Set<string>();
    const mods = GRANTS[role];
    (Object.keys(mods) as ModuleCode[]).forEach((m) => {
      expand(mods[m] as Sym).forEach((a) => set.add(`${m}.${a}`));
    });
    return [role, set];
  }),
) as Record<RoleCode, Set<string>>;

export function roleCan(
  role: RoleCode | undefined,
  module: ModuleCode,
  action: ActionCode,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(`${module}.${action}`) ?? false;
}

export interface RoleMeta {
  label: string;
  crossBranch: boolean;
  webAccess: boolean; // driver / housing_supervisor are mobile-only
}

export const ROLE_META: Record<RoleCode, RoleMeta> = {
  admin: { label: 'المدير العام', crossBranch: true, webAccess: true },
  operations_manager: { label: 'مدير العمليات', crossBranch: true, webAccess: true },
  branch_manager: { label: 'مدير الفرع', crossBranch: false, webAccess: true },
  sales: { label: 'موظف المبيعات', crossBranch: false, webAccess: true },
  call_center: { label: 'موظف مركز الاتصال', crossBranch: false, webAccess: true },
  driver: { label: 'السائق', crossBranch: false, webAccess: false },
  housing_supervisor: { label: 'مشرفة السكن', crossBranch: false, webAccess: false },
  hr: { label: 'الموارد البشرية', crossBranch: true, webAccess: true },
  accountant: { label: 'المحاسب', crossBranch: true, webAccess: true },
  external_office: { label: 'المكتب الخارجي', crossBranch: false, webAccess: true },
};

export interface ModuleNav {
  module: ModuleCode;
  label: string;
  to: string;
}

/** Sidebar grouping — modules render under these ordered sections. A group with
 *  no visible modules for the current role is hidden entirely. Every ModuleCode
 *  must appear in exactly one group. */
export interface ModuleGroup {
  key: string;
  label: string;
  modules: ModuleCode[];
}

export const MODULE_GROUPS: ModuleGroup[] = [
  { key: 'sales', label: 'المبيعات والعقود', modules: ['leads', 'contracts', 'pricing'] },
  { key: 'care', label: 'خدمة العملاء', modules: ['call_center', 'loyalty', 'rating'] },
  { key: 'ops', label: 'العمليات والميدان', modules: ['orders', 'gps', 'housing'] },
  { key: 'people', label: 'الموارد البشرية', modules: ['hr'] },
  {
    key: 'finance',
    label: 'المالية والتقارير',
    modules: ['payments', 'accounting', 'targets', 'reports'],
  },
  { key: 'system', label: 'النظام', modules: ['settings', 'rbac'] },
];

/** Sidebar source — filtered by `view` permission at render time. */
export const MODULES: ModuleNav[] = [
  { module: 'contracts', label: 'العقود', to: '/contracts' },
  { module: 'leads', label: 'العملاء المحتملون', to: '/leads' },
  { module: 'orders', label: 'الطلبات والسائقون', to: '/orders' },
  { module: 'gps', label: 'التتبّع GPS', to: '/gps' },
  { module: 'pricing', label: 'التسعير', to: '/pricing' },
  { module: 'payments', label: 'المدفوعات', to: '/payments' },
  { module: 'call_center', label: 'مركز الاتصال', to: '/call-center' },
  { module: 'loyalty', label: 'الولاء والتسويق', to: '/loyalty' },
  { module: 'rating', label: 'التقييم', to: '/rating' },
  { module: 'hr', label: 'الموارد البشرية', to: '/hr' },
  { module: 'housing', label: 'السكن', to: '/housing' },
  { module: 'targets', label: 'الأهداف ولوحة الشرف', to: '/targets' },
  { module: 'accounting', label: 'المحاسبة', to: '/accounting' },
  { module: 'reports', label: 'التقارير', to: '/reports' },
  { module: 'settings', label: 'الإعدادات', to: '/settings' },
  { module: 'rbac', label: 'الحسابات والصلاحيات', to: '/rbac' },
];
