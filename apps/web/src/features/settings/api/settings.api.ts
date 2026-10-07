import { supabase } from '@/shared/lib/supabase';
import { isDemoMode, isIgnorableWriteError } from '@/shared/lib/demoBackend';

export interface RefItem {
  code: string;
  name_ar: string;
  is_active: boolean;
  sort_order: number;
}
export interface ConfigItem {
  key: string;
  label_ar: string;
  grp: string;
  value: number;
  unit: string | null;
  sort_order: number;
}

/* ----------------------------- demo stores ------------------------------- */
let seq = 1;
const SOURCES: RefItem[] = [
  { code: 'website', name_ar: 'الموقع الإلكتروني', is_active: true, sort_order: 1 },
  { code: 'call_center', name_ar: 'مركز الاتصال', is_active: true, sort_order: 2 },
  { code: 'referral', name_ar: 'إحالة', is_active: true, sort_order: 3 },
  { code: 'walk_in', name_ar: 'زيارة للفرع', is_active: true, sort_order: 4 },
  { code: 'campaign', name_ar: 'حملة تسويقية', is_active: true, sort_order: 5 },
];
const STAGES: RefItem[] = [
  { code: 'new', name_ar: 'جديد', is_active: true, sort_order: 1 },
  { code: 'contacted', name_ar: 'تم التواصل', is_active: true, sort_order: 2 },
  { code: 'quoted', name_ar: 'عرض سعر مُرسل', is_active: true, sort_order: 3 },
  { code: 'negotiation', name_ar: 'تفاوض', is_active: true, sort_order: 4 },
  { code: 'won', name_ar: 'مكسوب', is_active: true, sort_order: 5 },
  { code: 'lost', name_ar: 'مفقود', is_active: true, sort_order: 6 },
];
/** أنواع المستفيد / مكان الخدمة — طلب العاملة يُقدّم لمنزل أو منشأة أو محل تجاري أو مناسبة. */
const BENEFICIARY_TYPES: RefItem[] = [
  { code: 'home', name_ar: 'منزل', is_active: true, sort_order: 1 },
  { code: 'facility', name_ar: 'منشأة', is_active: true, sort_order: 2 },
  { code: 'commercial', name_ar: 'مقهى / نشاط تجاري', is_active: true, sort_order: 3 },
  { code: 'occasion', name_ar: 'مناسبة / فعالية', is_active: true, sort_order: 4 },
];
/** أنواع المناسبات — تظهر عند اختيار «مناسبة / فعالية» كنوع للمستفيد. */
const OCCASION_TYPES: RefItem[] = [
  { code: 'wedding', name_ar: 'زفاف', is_active: true, sort_order: 1 },
  { code: 'opening', name_ar: 'افتتاح', is_active: true, sort_order: 2 },
  { code: 'event', name_ar: 'فعالية', is_active: true, sort_order: 3 },
  { code: 'conference', name_ar: 'مؤتمر', is_active: true, sort_order: 4 },
  { code: 'exhibition', name_ar: 'معرض', is_active: true, sort_order: 5 },
  // «أخرى» يفتح حقلًا لكتابة نوع المناسبة (الكود ثابت: OTHER_OCCASION_CODE)
  { code: 'other', name_ar: 'أخرى', is_active: true, sort_order: 6 },
];
/** احتياجات الرعاية داخل مكان الخدمة (أطفال، كبار سن، حالات خاصة…). */
const CARE_NEEDS: RefItem[] = [
  { code: 'newborn', name_ar: 'رعاية حديثي الولادة', is_active: true, sort_order: 1 },
  { code: 'children', name_ar: 'رعاية أطفال ومتابعة دراسية', is_active: true, sort_order: 2 },
  { code: 'elderly', name_ar: 'رعاية كبار السن', is_active: true, sort_order: 3 },
  { code: 'bedridden', name_ar: 'رعاية حالة طريح الفراش', is_active: true, sort_order: 4 },
  { code: 'special_needs', name_ar: 'رعاية ذوي احتياج خاص', is_active: true, sort_order: 5 },
  { code: 'cooking', name_ar: 'طبخ وإعداد وجبات', is_active: true, sort_order: 6 },
  { code: 'cleaning', name_ar: 'تنظيف وترتيب', is_active: true, sort_order: 7 },
  { code: 'serving', name_ar: 'ضيافة وتقديم', is_active: true, sort_order: 8 },
];

const CONFIG: ConfigItem[] = [
  {
    key: 'vat_rate',
    label_ar: 'ضريبة القيمة المضافة',
    grp: 'الضرائب والرسوم',
    value: 15,
    unit: '٪',
    sort_order: 1,
  },
  {
    key: 'commission_rate',
    label_ar: 'نسبة عمولة المبيعات',
    grp: 'المبيعات',
    value: 2.5,
    unit: '٪',
    sort_order: 2,
  },
  {
    key: 'quote_validity_days',
    label_ar: 'صلاحية عرض السعر',
    grp: 'المبيعات',
    value: 7,
    unit: 'يوم',
    sort_order: 3,
  },
  {
    key: 'late_grace_days',
    label_ar: 'مهلة سماح التأخير',
    grp: 'الغرامات',
    value: 3,
    unit: 'يوم',
    sort_order: 4,
  },
  {
    key: 'late_daily_pct',
    label_ar: 'غرامة التأخير اليومية',
    grp: 'الغرامات',
    value: 1,
    unit: '٪',
    sort_order: 5,
  },
  {
    key: 'late_max_pct',
    label_ar: 'حد غرامة التأخير',
    grp: 'الغرامات',
    value: 15,
    unit: '٪',
    sort_order: 6,
  },
  {
    key: 'replacement_guarantee_days',
    label_ar: 'ضمان استبدال العاملة',
    grp: 'الخدمة',
    value: 90,
    unit: 'يوم',
    sort_order: 7,
  },
  {
    key: 'contract_expiry_alert_days',
    label_ar: 'مهلة التنبيه قبل انتهاء العقد',
    grp: 'العقود',
    value: 30,
    unit: 'يوم',
    sort_order: 8,
  },
  {
    key: 'match_min_score',
    label_ar: 'أدنى نسبة مطابقة لترشيح العاملة',
    grp: 'العقود',
    value: 45,
    unit: '٪',
    sort_order: 9,
  },
];

const byOrder = (a: RefItem, b: RefItem) => a.sort_order - b.sort_order;

/* ------------------------------- sources --------------------------------- */
export async function listSources(): Promise<RefItem[]> {
  try {
    const { data, error } = await supabase.from('lead_sources').select('*').order('sort_order');
    if (!error && data && data.length > 0) return data as RefItem[];
  } catch {
    /* demo */
  }
  return [...SOURCES].sort(byOrder);
}
export async function saveSource(item: RefItem, isNew: boolean): Promise<void> {
  try {
    const { error } = await supabase.from('lead_sources').upsert(item);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  } catch {
    /* demo */
  }
  const idx = SOURCES.findIndex((s) => s.code === item.code);
  if (isNew && idx === -1) SOURCES.push(item);
  else if (idx !== -1) SOURCES[idx] = item;
}

/* -------------------------------- stages --------------------------------- */
export async function listStages(): Promise<RefItem[]> {
  try {
    const { data, error } = await supabase.from('lead_stages').select('*').order('sort_order');
    if (!error && data && data.length > 0) return data as RefItem[];
  } catch {
    /* demo */
  }
  return [...STAGES].sort(byOrder);
}
export async function saveStage(item: RefItem, isNew: boolean): Promise<void> {
  try {
    const { error } = await supabase.from('lead_stages').upsert(item);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  } catch {
    /* demo */
  }
  const idx = STAGES.findIndex((s) => s.code === item.code);
  if (isNew && idx === -1) STAGES.push(item);
  else if (idx !== -1) STAGES[idx] = item;
}

/** Generate a code from an Arabic name (demo new items). */
export function newCode(prefix = 'item'): string {
  return `${prefix}_${Date.now()}_${seq++}`;
}

/* ------------------------------- config ---------------------------------- */
export async function listConfig(): Promise<ConfigItem[]> {
  try {
    const { data, error } = await supabase.from('app_config').select('*').order('sort_order');
    if (!error && data && data.length > 0) return data as ConfigItem[];
  } catch {
    /* demo */
  }
  return [...CONFIG].sort((a, b) => a.sort_order - b.sort_order);
}
/**
 * تعديل قيمة نظام. الوضع التجريبي: المخزن المحلي. مع قاعدة بيانات فعلية: يُرمى
 * أي خطأ، وإن لم يتأثّر أي صف (RLS cfg_admin للمدير العام فقط، أو مفتاح غير
 * موجود) يُرمى خطأ بدل نجاح وهمي.
 */
export async function updateConfig(key: string, value: number): Promise<void> {
  if (isDemoMode()) {
    const row = CONFIG.find((c) => c.key === key);
    if (row) row.value = value;
    return;
  }
  const { data, error } = await supabase
    .from('app_config')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select('key');
  if (error) throw new Error(`تعذّر حفظ القيمة: ${error.message}`);
  if (!data || (data as unknown[]).length === 0) {
    throw new Error('لم تُحفظ القيمة — تعديل قيم النظام للمدير العام فقط، أو أن المفتاح غير موجود');
  }
}

/* ------------------- prototype reference lists (mock) --------------------- */
/**
 * القوائم المرجعية الجديدة لنموذج طلب العاملة (أنواع المستفيد، أنواع المناسبات،
 * احتياجات الرعاية). في مرحلة الـPrototype تُقرأ وتُكتب من مخزن mock في الذاكرة
 * حتى تُنشأ جداولها؛ الشكل هو نفسه `RefItem` المستخدم في بقية القوائم المرجعية،
 * فلا تكرار لمفهوم ولا شاشة «عرض فقط»: الإداري يضيف ويعدّل ويعطّل من الإعدادات.
 */
export type RefKind = 'sources' | 'stages' | 'beneficiary_types' | 'occasion_types' | 'care_needs';

const MOCK_LISTS: Record<Exclude<RefKind, 'sources' | 'stages'>, RefItem[]> = {
  beneficiary_types: BENEFICIARY_TYPES,
  occasion_types: OCCASION_TYPES,
  care_needs: CARE_NEEDS,
};

export const REF_KIND_LABEL: Record<RefKind, string> = {
  sources: 'مصادر العملاء',
  stages: 'مراحل المبيعات',
  beneficiary_types: 'أنواع المستفيد',
  occasion_types: 'أنواع المناسبات',
  care_needs: 'احتياجات الرعاية',
};

/** قائمة مرجعية واحدة بأي نوع — نقطة قراءة موحّدة لكل الشاشات. */
export async function listRef(kind: RefKind): Promise<RefItem[]> {
  if (kind === 'sources') return listSources();
  if (kind === 'stages') return listStages();
  return [...MOCK_LISTS[kind]].sort(byOrder);
}

/** إضافة/تعديل/تعطيل عنصر في أي قائمة مرجعية (الحذف = تعطيل، لا حذف نهائي). */
export async function saveRef(kind: RefKind, item: RefItem, isNew: boolean): Promise<void> {
  if (kind === 'sources') return saveSource(item, isNew);
  if (kind === 'stages') return saveStage(item, isNew);
  const store = MOCK_LISTS[kind];
  const idx = store.findIndex((r) => r.code === item.code);
  if (isNew && idx === -1) store.push(item);
  else if (idx !== -1) store[idx] = item;
}

/** العناصر المُفعّلة فقط — ما يُعرض للعميل في نماذج الطلب. */
export function activeOnly(items: RefItem[]): RefItem[] {
  return items.filter((i) => i.is_active);
}

/** الاسم العربي لكود في قائمة مرجعية (للملخّصات والعروض). */
export function refName(items: RefItem[], code: string | null): string {
  if (!code) return '—';
  return items.find((i) => i.code === code)?.name_ar ?? code;
}

/** قيمة معيار من قيم النظام مع قيمة احتياطية عند عدم التحميل بعد. */
export function configValue(items: ConfigItem[], key: string, fallback: number): number {
  const row = items.find((c) => c.key === key);
  return row ? Number(row.value) : fallback;
}
