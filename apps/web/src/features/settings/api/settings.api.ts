import { supabase } from '@/shared/lib/supabase';
import { isIgnorableWriteError } from '@/shared/lib/demoBackend';

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
export async function updateConfig(key: string, value: number): Promise<void> {
  try {
    const { error } = await supabase.from('app_config').update({ value }).eq('key', key);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  } catch {
    /* demo */
  }
  const row = CONFIG.find((c) => c.key === key);
  if (row) row.value = value;
}
