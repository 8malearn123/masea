/**
 * سجل التدقيق المشترك — نفس شكل صفوف `audit_log` (0061) ومعه أسماء عربية
 * للكيانات والعمليات والحقول. في الوضع التجريبي يحفظ عمليات الواجهة في الذاكرة
 * (`recordAudit`) فوق بذرة واقعية؛ مع قاعدة البيانات تكتبه المشغّلات وحدها.
 */
import { useAuth } from '@/store/auth';
import { loadDemo } from '@/lib/demo';

export interface AuditEntry {
  id: string;
  created_at: string;
  /** insert | update | delete — أو حدث دلالي من دالة backend (contract.transition …) */
  action: string;
  /** اسم الجدول (contracts, quotes, promotions …) */
  entity: string;
  /** مرجع مقروء: رقم العقد / رمز الكوبون / مفتاح الإعداد … */
  record_ref: string | null;
  actor_name: string | null;
  /** فرع السجل (اسم المدينة) — أساس تصفية مدير الفرع */
  branch: string | null;
  /** في التعديل: القيم السابقة للحقول التي تغيّرت فقط */
  old_data: Record<string, unknown> | null;
  /** في التعديل: القيم الجديدة للحقول التي تغيّرت فقط */
  new_data: Record<string, unknown> | null;
}

export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  contracts: 'العقود',
  quotes: 'عروض الأسعار',
  promotions: 'الخصومات والكوبونات',
  campaigns: 'الحملات التسويقية',
  payments: 'المدفوعات',
  customers: 'العملاء',
  leads: 'العملاء المحتملون',
  role_permissions: 'صلاحيات الأدوار',
  roles: 'الأدوار',
  user_profiles: 'المستخدمون',
  pricing_rules: 'قواعد التسعير',
  app_config: 'إعدادات النظام',
  service_requests: 'الطلبات',
  ratings: 'التقييمات',
  loyalty_config: 'إعدادات الولاء',
  sales: 'المبيعات',
  sale_notes: 'ملاحظات المبيعات',
  worker_bookings: 'حجوزات التأجير بالساعة',
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  insert: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  'contract.transition': 'تغيير حالة عقد',
  'contract.create_from_terms': 'عقد من موافقة الشروط',
  'contract.renew': 'تجديد عقد',
  'quote.convert': 'تحويل عرض إلى عقد',
};

/** أسماء عربية للحقول الأكثر تعديلاً؛ ما عداها يُعرض باسمه البرمجي. */
export const AUDIT_FIELD_LABEL: Record<string, string> = {
  status: 'الحالة',
  base_amount: 'المبلغ قبل الضريبة',
  gross_amount: 'المبلغ قبل الخصم',
  discount_amount: 'قيمة الخصم',
  vat_amount: 'الضريبة',
  total_amount: 'الإجمالي',
  amount: 'المبلغ',
  branch_id: 'الفرع',
  phone: 'الجوال',
  full_name: 'الاسم',
  city: 'المدينة',
  role: 'الدور',
  is_active: 'مفعّل',
  discount_pct: 'نسبة الخصم',
  usage_limit: 'حد الاستخدام',
  ends_at: 'تاريخ الانتهاء',
  starts_at: 'تاريخ البداية',
  base_price: 'السعر الأساسي',
  min_price: 'الحد الأدنى للسعر',
  value: 'القيمة',
  start_date: 'تاريخ البداية',
  end_date: 'تاريخ النهاية',
  worker_id: 'العاملة',
  valid_until: 'صالح حتى',
  stage_code: 'المرحلة',
  assigned_to: 'المسؤول',
  action: 'الإجراء',
  module: 'الوحدة',
};

export const auditEntityLabel = (e: string) => AUDIT_ENTITY_LABEL[e] ?? e;
export const auditActionLabel = (a: string) => AUDIT_ACTION_LABEL[a] ?? a;
export const auditFieldLabel = (f: string) => AUDIT_FIELD_LABEL[f] ?? f;

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** الحقول التي تغيّرت (للتعديل) أو القيم المسجّلة (للإنشاء/الحذف). */
export function auditChanges(e: Pick<AuditEntry, 'old_data' | 'new_data'>): AuditChange[] {
  const keys = new Set([...Object.keys(e.old_data ?? {}), ...Object.keys(e.new_data ?? {})]);
  return [...keys]
    .filter((k) => k !== 'id' && k !== 'created_at' && k !== 'updated_at')
    .map((field) => ({ field, before: e.old_data?.[field], after: e.new_data?.[field] }));
}

export function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

// بذرة واقعية تطابق بيانات العرض (العقود والخصومات والصلاحيات في الوضع التجريبي)
const SEED: AuditEntry[] = [
  {
    id: 'au-1',
    created_at: ago(2),
    action: 'contract.transition',
    entity: 'contracts',
    record_ref: 'MAS-2026-00012',
    actor_name: 'فهد آل منصور',
    branch: 'نجران',
    old_data: { status: 'approved' },
    new_data: { status: 'signed' },
  },
  {
    id: 'au-2',
    created_at: ago(5),
    action: 'update',
    entity: 'promotions',
    record_ref: 'NATIONAL95',
    actor_name: 'منصور المكرمي',
    branch: null,
    old_data: { discount_pct: 5, usage_limit: null },
    new_data: { discount_pct: 10, usage_limit: 50 },
  },
  {
    id: 'au-3',
    created_at: ago(9),
    action: 'insert',
    entity: 'payments',
    record_ref: 'MAS-2026-00009',
    actor_name: 'ريم الشهري',
    branch: 'جازان',
    old_data: null,
    new_data: { amount: 6000, method: 'transfer' },
  },
  {
    id: 'au-4',
    created_at: ago(26),
    action: 'update',
    entity: 'customers',
    record_ref: 'سعد الوادعي',
    actor_name: 'نايف اليامي',
    branch: 'نجران',
    old_data: { phone: '0555100203' },
    new_data: { phone: '0555100230' },
  },
  {
    id: 'au-5',
    created_at: ago(30),
    action: 'insert',
    entity: 'role_permissions',
    record_ref: 'branch_manager.sales_ops.view',
    actor_name: 'منصور المكرمي',
    branch: null,
    old_data: null,
    new_data: { role_code: 'branch_manager', module: 'sales_ops', action: 'view' },
  },
  {
    id: 'au-6',
    created_at: ago(49),
    action: 'update',
    entity: 'pricing_rules',
    record_ref: 'استقدام — الفلبين',
    actor_name: 'منصور المكرمي',
    branch: null,
    old_data: { base_price: 15500 },
    new_data: { base_price: 16000 },
  },
  {
    id: 'au-7',
    created_at: ago(73),
    action: 'update',
    entity: 'quotes',
    record_ref: 'QT-1003',
    actor_name: 'ماجد الحازمي',
    branch: 'جازان',
    old_data: { status: 'sent' },
    new_data: { status: 'accepted' },
  },
  {
    id: 'au-8',
    created_at: ago(96),
    action: 'update',
    entity: 'contracts',
    record_ref: 'MAS-2026-00007',
    actor_name: 'عبدالرحمن آل سالم',
    branch: 'شرورة',
    old_data: { end_date: '2026-11-30' },
    new_data: { end_date: '2026-12-31' },
  },
];

const ENTRIES: AuditEntry[] = [...SEED];
let seq = SEED.length;

export function listDemoAudit(): AuditEntry[] {
  return [...ENTRIES].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * تسجيل عملية من الواجهة في الوضع التجريبي (مع الـ backend المشغّل يكتب السجل
 * فلا تُستدعى). المنفّذ وفرعه من الجلسة الحالية ما لم يُمرَّر فرع السجل.
 */
export function recordAudit(
  input: Omit<AuditEntry, 'id' | 'created_at' | 'actor_name' | 'branch'> & {
    branch?: string | null;
  },
): AuditEntry {
  seq += 1;
  const entry: AuditEntry = {
    ...input,
    id: `au-${seq}`,
    created_at: new Date().toISOString(),
    actor_name: useAuth.getState().profile?.full_name ?? null,
    branch: input.branch !== undefined ? input.branch : (loadDemo()?.branch ?? null),
  };
  ENTRIES.push(entry);
  return entry;
}
