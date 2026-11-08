/**
 * HR reference lists (0075) — seeds and rules shared by the demo store and the
 * screens. The database enforces the same in guard_hr_lookup:
 *   · names trimmed, 1–60 chars, unique inside a list
 *   · system items are renamable but never disabled
 *   · «السعودية» keeps its name (payroll / GOSI / Saudization compare by it)
 */
import { z } from 'zod';
import type { HrLookup, HrLookupKind, LookupScope } from '@/features/hr/types';

export const SAUDI_NATIONALITY = 'السعودية';

type Seed = [code: string, name: string, extra?: Partial<HrLookup>];
function list(kind: HrLookupKind, rows: Seed[]): HrLookup[] {
  return rows.map(([code, name_ar, extra], i) => ({
    kind,
    code,
    name_ar,
    scope: 'both',
    is_active: true,
    is_system: false,
    sort_order: i + 1,
    ...extra,
  }));
}
const sys = { is_system: true };
const staff: Partial<HrLookup> = { scope: 'staff' };
const worker: Partial<HrLookup> = { scope: 'worker' };

/** Same rows as the 0075 seeds. */
export const DEFAULT_LOOKUPS: HrLookup[] = [
  ...list('department', [
    ['admin', 'الإدارة'],
    ['ops', 'العمليات'],
    ['finance', 'المالية'],
    ['hr', 'الموارد البشرية'],
    ['sales', 'المبيعات'],
    ['call_center', 'مركز الاتصال'],
    ['housing', 'السكن'],
  ]),
  ...list('job_title', [
    ['gm', 'المدير العام'],
    ['ops_manager', 'مدير العمليات'],
    ['branch_manager', 'مدير الفرع'],
    ['accountant', 'محاسب'],
    ['hr_specialist', 'أخصائي موارد بشرية'],
    ['sales', 'موظفة مبيعات'],
    ['call_center', 'موظفة مركز اتصال'],
    ['housing_m', 'مشرف سكن'],
    ['housing_f', 'مشرفة سكن'],
    ['driver', 'سائق'],
    ['recruitment', 'مندوب استقدام'],
  ]),
  ...list('nationality', [
    ['SA', SAUDI_NATIONALITY, { ...staff, ...sys }],
    ['IN', 'الهند'],
    ['PH', 'الفلبين'],
    ['BD', 'بنغلاديش'],
    ['EG', 'مصر', staff],
    ['PK', 'باكستان'],
    ['ID', 'إندونيسيا', worker],
    ['KE', 'كينيا', worker],
    ['UG', 'أوغندا', worker],
    ['ET', 'إثيوبيا', worker],
    ['LK', 'سريلانكا', worker],
  ]),
  ...list('profession', [
    ['housemaid', 'عاملة منزلية'],
    ['cook', 'طباخة'],
    ['nanny', 'مربية أطفال'],
    ['cleaner', 'عاملة نظافة'],
    ['driver', 'سائق'],
  ]),
  ...list('skill', [
    ['kids', 'محبة للأطفال'],
    ['cooking', 'تجيد الطبخ'],
    ['elderly', 'العناية بكبار السن'],
    ['cleaning', 'التنظيف'],
    ['ironing', 'الكي'],
    ['disability', 'رعاية ذوي الإعاقة'],
    ['driving', 'تجيد القيادة'],
  ]),
  ...list('language', [
    ['ar', 'العربية'],
    ['en', 'الإنجليزية'],
    ['tl', 'الفلبينية'],
    ['id', 'الإندونيسية'],
    ['sw', 'السواحيلية'],
    ['ur', 'الأردية'],
    ['bn', 'البنغالية'],
    ['si', 'السنهالية'],
  ]),
  ...list('doc_type', [
    ['national_id', 'الهوية الوطنية', sys],
    ['iqama', 'الإقامة', sys],
    ['passport', 'جواز سفر', sys],
    ['work_permit', 'رخصة العمل', sys],
    ['visa', 'التأشيرة', sys],
    ['contract', 'عقد عمل'],
    ['cv', 'السيرة الذاتية'],
    ['certificate', 'شهادة علمية/مهنية'],
    ['medical', 'التأمين الطبي'],
    ['driving_license', 'رخصة قيادة'],
    ['photo', 'صورة شخصية'],
    ['other', 'أخرى', sys],
  ]),
];

const bySort = (a: HrLookup, b: HrLookup) =>
  a.sort_order - b.sort_order || a.name_ar.localeCompare(b.name_ar, 'ar');

/** Items of one list, in display order. */
export function ofKind(items: HrLookup[], kind: HrLookupKind): HrLookup[] {
  return items.filter((i) => i.kind === kind).sort(bySort);
}

/**
 * Names to offer in a picker: active items (optionally for staff or workers),
 * plus any value the record already holds so editing never drops it.
 */
export function lookupNames(
  items: HrLookup[],
  kind: HrLookupKind,
  opts: { scope?: Exclude<LookupScope, 'both'>; keep?: string | readonly string[] | null } = {},
): string[] {
  const names = ofKind(items, kind)
    .filter((i) => i.is_active && (!opts.scope || i.scope === 'both' || i.scope === opts.scope))
    .map((i) => i.name_ar);
  const keep =
    opts.keep == null ? [] : typeof opts.keep === 'string' ? [opts.keep] : [...opts.keep];
  keep.forEach((k) => {
    if (k && !names.includes(k)) names.push(k);
  });
  return names;
}

/** Arabic label of a stored code (doc types); unknown codes show as-is. */
export function lookupLabel(items: HrLookup[], kind: HrLookupKind, code: string): string {
  return items.find((i) => i.kind === kind && i.code === code)?.name_ar ?? code;
}

/** {value: code, label} options for code-based lists (doc types). */
export function codeOptions(
  items: HrLookup[],
  kind: HrLookupKind,
  keep?: string | null,
): { value: string; label: string }[] {
  const opts = ofKind(items, kind)
    .filter((i) => i.is_active || i.code === keep)
    .map((i) => ({ value: i.code, label: i.name_ar }));
  if (keep && !opts.some((o) => o.value === keep)) opts.push({ value: keep, label: keep });
  return opts;
}

/* ------------------------------- validation ------------------------------- */
export const lookupNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'أدخل الاسم' })
  .max(60, { message: 'الاسم طويل جدًا (60 حرفًا كحد أقصى)' });

/** Mirror of guard_hr_lookup + the unique name index. Throws an Arabic message. */
export function assertLookupChange(
  items: HrLookup[],
  next: HrLookup,
  before: HrLookup | null,
): void {
  const name = lookupNameSchema.safeParse(next.name_ar);
  if (!name.success) throw new Error(name.error.issues[0]?.message ?? 'اسم غير صحيح');
  const clash = items.some(
    (i) => i.kind === next.kind && i.code !== next.code && i.name_ar.trim() === name.data,
  );
  if (clash) throw new Error(`«${name.data}» موجود في القائمة`);
  if (!before) {
    if (next.is_system) throw new Error('لا تُضاف عناصر نظامية من الواجهة');
    return;
  }
  if (before.kind !== next.kind || before.code !== next.code)
    throw new Error('لا يتغير نوع العنصر أو رمزه');
  if (before.is_system !== next.is_system) throw new Error('صفة «نظامي» لا تُعدَّل من الواجهة');
  if (before.is_system && !next.is_active)
    throw new Error(`«${before.name_ar}» عنصر نظامي يعتمد عليه النظام ولا يُعطَّل`);
  if (before.kind === 'nationality' && before.code === 'SA' && name.data !== before.name_ar)
    throw new Error('اسم الجنسية السعودية ثابت — تعتمد عليه الرواتب والتأمينات والسعودة');
}

/** A fresh code for a new item (the DB also generates one). */
export function newLookupCode(): string {
  return Math.random().toString(16).slice(2, 12).padEnd(10, '0');
}
