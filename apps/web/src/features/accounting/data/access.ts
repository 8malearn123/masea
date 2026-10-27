import type { RoleCode } from '@/lib/permissions';

/**
 * Fine-grained accounting duties, layered UNDER the ten system roles (which
 * stay the source of module access via has_perm). A duty profile narrows what
 * an accounting user may do per area × action, and is enforced server-side by
 * has_acc_perm(area, action) (0057) inside the posting/approval functions and
 * RLS — the UI mirror below only decides what to show.
 */
export type AccArea =
  | 'gl'
  | 'ar'
  | 'ap'
  | 'bank'
  | 'assets'
  | 'budget'
  | 'tax'
  | 'close'
  | 'reports'
  | 'audit'
  | 'settings';
export type AccAction = 'view' | 'create' | 'edit' | 'approve' | 'post' | 'export' | 'reopen';

export const ACC_AREA_LABEL: Record<AccArea, string> = {
  gl: 'المحاسبة العامة والقيود',
  ar: 'ذمم العملاء والتحصيل',
  ap: 'ذمم الموردين والمدفوعات',
  bank: 'البنوك والصناديق',
  assets: 'الأصول الثابتة',
  budget: 'مراكز التكلفة والموازنات',
  tax: 'الضرائب والفوترة الإلكترونية',
  close: 'الإقفال المالي',
  reports: 'التقارير المالية',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والصلاحيات',
};
export const ACC_ACTION_LABEL: Record<AccAction, string> = {
  view: 'عرض',
  create: 'إنشاء',
  edit: 'تعديل',
  approve: 'اعتماد',
  post: 'ترحيل',
  export: 'تصدير',
  reopen: 'إعادة فتح',
};
export const ACC_AREAS = Object.keys(ACC_AREA_LABEL) as AccArea[];
export const ACC_ACTIONS = Object.keys(ACC_ACTION_LABEL) as AccAction[];

export interface DutyProfile {
  code: string;
  name: string;
  caps: string[]; // `${area}.${action}`
  is_system: boolean; // seeded (editable caps, not deletable)
  is_active: boolean;
}

const all = (areas: AccArea[], actions: AccAction[]) =>
  areas.flatMap((a) => actions.map((x) => `${a}.${x}`));
const VIEW_EXPORT: AccAction[] = ['view', 'export'];
const WORK: AccAction[] = ['view', 'create', 'edit', 'export'];

export const DEFAULT_DUTIES: DutyProfile[] = [
  {
    code: 'cfo',
    name: 'المدير المالي',
    caps: [
      ...all(
        ACC_AREAS.filter((a) => a !== 'settings'),
        ACC_ACTIONS,
      ),
      'settings.view',
    ],
    is_system: true,
    is_active: true,
  },
  {
    code: 'general_accountant',
    name: 'المحاسب العام',
    caps: [
      ...all(['gl', 'bank', 'assets', 'tax'], WORK),
      ...all(['ar', 'ap', 'budget', 'close'], ['view']),
      ...all(['reports'], VIEW_EXPORT),
      'gl.post', // posts what an approver approved (SoD blocks self-approval)
    ],
    is_system: true,
    is_active: true,
  },
  {
    code: 'ar_accountant',
    name: 'محاسب العملاء',
    caps: [...all(['ar'], WORK), 'gl.view', 'bank.view', ...all(['reports'], VIEW_EXPORT)],
    is_system: true,
    is_active: true,
  },
  {
    code: 'ap_accountant',
    name: 'محاسب الموردين',
    caps: [
      ...all(['ap'], WORK),
      'bank.view',
      'bank.create',
      'gl.view',
      ...all(['reports'], VIEW_EXPORT),
    ],
    is_system: true,
    is_active: true,
  },
  {
    code: 'internal_auditor',
    name: 'المراجع الداخلي',
    caps: all(
      ACC_AREAS.filter((a) => a !== 'settings'),
      VIEW_EXPORT,
    ),
    is_system: true,
    is_active: true,
  },
  {
    code: 'reports_only',
    name: 'مستخدم التقارير فقط',
    caps: all(['reports'], VIEW_EXPORT),
    is_system: true,
    is_active: true,
  },
];

/** Default duty when no explicit assignment exists (keeps current behaviour). */
export const ROLE_DEFAULT_DUTY: Partial<Record<RoleCode, string>> = {
  accountant: 'cfo',
  operations_manager: 'reports_only',
};

export function dutyCan(
  role: RoleCode | undefined,
  duty: DutyProfile | undefined,
  area: AccArea,
  action: AccAction,
): boolean {
  if (role === 'admin') return true; // مدير النظام
  if (!duty || !duty.is_active) return false;
  return duty.caps.includes(`${area}.${action}`);
}

/* ------------------------------- audit trail ----------------------------- */
export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string; // create / update / approve / post / reverse / close / reopen / ...
  entity: string; // journal_entry / period / account / bank_rule / ...
  entity_id: string;
  before: unknown;
  after: unknown;
  note?: string;
}

/** Field-level diff for the audit viewer. */
export function auditDiff(
  before: unknown,
  after: unknown,
): { field: string; from: string; to: string }[] {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({
      field: k,
      from: JSON.stringify(b[k] ?? null),
      to: JSON.stringify(a[k] ?? null),
    }));
}
