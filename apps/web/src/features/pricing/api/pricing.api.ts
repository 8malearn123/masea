import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { DEFAULT_PRICING_CONFIG, type PriceDetail, type PricingConfig } from '@/shared/lib/pricing';
import type {
  ConfigMeta,
  PricingLogEntry,
  PricingOp,
  PricingRule,
  PricingRuleChange,
} from '@/features/pricing/types';

let seq = 0;
function rule(
  service_code: string,
  nationality: string | null,
  profession: string | null,
  duration_unit: string,
  base_price: number,
  min_price: number,
): PricingRule {
  seq += 1;
  return {
    id: `pr-${seq}`,
    service_code,
    nationality,
    profession,
    duration_unit,
    base_price,
    min_price,
    is_active: true,
  };
}

// Mirrors supabase 0012 seed (base_price · min_price floor).
const FALLBACK: PricingRule[] = [
  rule('recruitment', 'الفلبين', null, 'fixed', 16000, 15000),
  rule('recruitment', 'إندونيسيا', null, 'fixed', 14000, 13200),
  rule('recruitment', 'كينيا', null, 'fixed', 13000, 12200),
  rule('recruitment', 'أوغندا', null, 'fixed', 12000, 11300),
  rule('recruitment', 'بنغلاديش', null, 'fixed', 11000, 10400),
  rule('recruitment', 'سريلانكا', null, 'fixed', 13500, 12700),
  rule('monthly_rental', 'الفلبين', null, 'month', 2500, 2300),
  rule('monthly_rental', 'إندونيسيا', null, 'month', 2200, 2050),
  rule('monthly_rental', 'كينيا', null, 'month', 2000, 1850),
  rule('monthly_rental', 'أوغندا', null, 'month', 1900, 1780),
  rule('monthly_rental', 'سريلانكا', null, 'month', 2300, 2150),
  rule('daily_rental', null, 'تنظيف', 'day', 180, 160),
  rule('daily_rental', null, 'طبخ', 'day', 220, 200),
  rule('daily_rental', null, 'رعاية', 'day', 200, 180),
  rule('sponsorship_transfer', null, null, 'fixed', 2000, 1800),
];

/** All rules incl. disabled (price-list management). */
export async function listAllPricingRules(): Promise<PricingRule[]> {
  try {
    const { data, error } = await supabase
      .from('pricing_rules')
      .select(
        'id, service_code, nationality, profession, duration_unit, base_price, min_price, is_active, updated_at',
      );
    if (!error && data && data.length > 0) return data as PricingRule[];
  } catch {
    /* fall through */
  }
  return FALLBACK.map((r) => ({ ...r }));
}

/** Active rules — the price source for the calculator, contracts and orders. */
export async function listPricingRules(): Promise<PricingRule[]> {
  return (await listAllPricingRules()).filter((r) => r.is_active);
}

const CHANGES: PricingRuleChange[] = [];
export async function listRuleChanges(ruleId?: string): Promise<PricingRuleChange[]> {
  try {
    let q = supabase
      .from('pricing_rule_changes')
      .select('*')
      .order('changed_at', { ascending: false });
    if (ruleId && !isDemoId(ruleId)) q = q.eq('rule_id', ruleId);
    const { data, error } = await q;
    if (!error && data && data.length > 0) return data as PricingRuleChange[];
  } catch {
    /* fall through */
  }
  return CHANGES.filter((c) => !ruleId || c.rule_id === ruleId).map((c) => ({ ...c }));
}

export interface RuleChangeInput {
  base_price: number;
  min_price: number | null;
  effective_from: string;
  reason: string;
}

function validateRule(base: number, min: number | null): void {
  if (!Number.isFinite(base) || base <= 0) throw new Error('السعر الأساسي يجب أن يكون أكبر من صفر');
  if (min != null && (min < 0 || min > base)) throw new Error('الحد الأدنى بين صفر والسعر الأساسي');
}

/**
 * Change a rule's price. Only FUTURE calculations use it — existing quotes and
 * contracts keep their stored snapshot/amounts. Reason + effective date are
 * mandatory and recorded (pricing_rule_changes).
 */
export async function updatePricingRule(
  id: string,
  patch: RuleChangeInput,
  actor: string,
): Promise<void> {
  validateRule(patch.base_price, patch.min_price);
  if (patch.reason.trim().length < 5) throw new Error('سبب التعديل مطلوب (5 أحرف على الأقل)');
  const cur = FALLBACK.find((r) => r.id === id);
  const now = new Date().toISOString();
  if (!isDemoId(id)) {
    const { error } = await supabase.rpc('change_pricing_rule', {
      p_rule_id: id,
      p_base: patch.base_price,
      p_min: patch.min_price,
      p_effective_from: patch.effective_from,
      p_reason: patch.reason.trim(),
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  if (!cur) throw new Error('القاعدة غير موجودة');
  CHANGES.unshift({
    id: `rc-${Date.now()}`,
    rule_id: id,
    old_base: cur.base_price,
    new_base: patch.base_price,
    old_min: cur.min_price,
    new_min: patch.min_price,
    effective_from: patch.effective_from,
    reason: patch.reason.trim(),
    changed_by: actor,
    changed_at: now,
  });
  cur.base_price = patch.base_price;
  cur.min_price = patch.min_price;
  cur.updated_at = now;
  cur.updated_by = actor;
}

export interface NewRuleInput {
  service_code: string;
  nationality: string | null;
  profession: string | null;
  duration_unit: string;
  base_price: number;
  min_price: number | null;
}

export async function createPricingRule(input: NewRuleInput, actor: string): Promise<PricingRule> {
  validateRule(input.base_price, input.min_price);
  const dup = FALLBACK.find(
    (r) =>
      r.is_active &&
      r.service_code === input.service_code &&
      (r.nationality ?? null) === (input.nationality ?? null) &&
      (r.profession ?? null) === (input.profession ?? null),
  );
  if (dup) throw new Error('توجد قاعدة نشطة لنفس الخدمة والجنسية/المهنة — عدّلها بدل التكرار');
  const now = new Date().toISOString();
  const row: PricingRule = {
    id: `pr-new-${Date.now()}`,
    ...input,
    is_active: true,
    updated_at: now,
    updated_by: actor,
  };
  try {
    const { data, error } = await supabase
      .from('pricing_rules')
      .insert({ ...input, is_active: true })
      .select('id')
      .single();
    if (!error && data) return { ...row, id: (data as { id: string }).id };
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (!isIgnorableWriteError(msg)) throw e;
  }
  FALLBACK.push(row);
  return row;
}

/** Disable / re-enable (soft delete — history and old quotes stay intact). */
export async function setPricingRuleActive(
  id: string,
  active: boolean,
  actor: string,
): Promise<void> {
  if (!isDemoId(id)) {
    const { error } = await supabase
      .from('pricing_rules')
      .update({ is_active: active })
      .eq('id', id);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  const r = FALLBACK.find((x) => x.id === id);
  if (r) {
    r.is_active = active;
    r.updated_at = new Date().toISOString();
    r.updated_by = actor;
  }
}

// ---------------------------- pricing_config --------------------------------
let CONFIG: PricingConfig = { ...DEFAULT_PRICING_CONFIG };
let CONFIG_META: ConfigMeta = { updated_at: null, updated_by: null };

export async function getPricingConfigMeta(): Promise<ConfigMeta> {
  try {
    const { data, error } = await supabase
      .from('pricing_config')
      .select('updated_at, updated_by_name')
      .eq('id', 1)
      .single();
    if (!error && data)
      return {
        updated_at: (data as { updated_at: string | null }).updated_at,
        updated_by: (data as { updated_by_name: string | null }).updated_by_name,
      };
  } catch {
    /* fall through */
  }
  return { ...CONFIG_META };
}

export async function getPricingConfig(): Promise<PricingConfig> {
  try {
    const { data, error } = await supabase
      .from('pricing_config')
      .select(
        'vat_rate, late_grace_days, late_daily_pct, late_max_pct, cancellation_pct, absence_compensation_rule',
      )
      .eq('id', 1)
      .single();
    if (!error && data) {
      const rule = (data.absence_compensation_rule ?? {}) as {
        per_day?: number;
        max_days?: number;
      };
      return {
        vat_rate: Number(data.vat_rate),
        late_grace_days: Number(data.late_grace_days),
        late_daily_pct: Number(data.late_daily_pct),
        late_max_pct: Number(data.late_max_pct),
        cancellation_pct: Number(data.cancellation_pct),
        absence_per_day: Number(rule.per_day ?? DEFAULT_PRICING_CONFIG.absence_per_day),
        absence_max_days: Number(rule.max_days ?? DEFAULT_PRICING_CONFIG.absence_max_days),
      };
    }
  } catch {
    /* fall through to local config */
  }
  return { ...CONFIG };
}

export async function updatePricingConfig(
  next: PricingConfig,
  actor = 'المستخدم الحالي',
): Promise<void> {
  CONFIG = { ...next }; // local source of truth for demo mode
  CONFIG_META = { updated_at: new Date().toISOString(), updated_by: actor };
  const { error } = await supabase
    .from('pricing_config')
    .update({
      vat_rate: next.vat_rate,
      late_grace_days: next.late_grace_days,
      late_daily_pct: next.late_daily_pct,
      late_max_pct: next.late_max_pct,
      cancellation_pct: next.cancellation_pct,
      absence_compensation_rule: { per_day: next.absence_per_day, max_days: next.absence_max_days },
    })
    .eq('id', 1);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

// ---------------------------- pricing_log -----------------------------------
const LOG: PricingLogEntry[] = [
  {
    id: 'pl1',
    service_code: 'recruitment',
    params: { nationality: 'الفلبين', quantity: 1 },
    result: { base: 16000, discounts: 0, penalties: 0, net: 16000, vat: 2400, total: 18400 },
    created_at: '2026-06-14T09:10:00Z',
  },
  {
    id: 'pl2',
    service_code: 'monthly_rental',
    params: { nationality: 'إندونيسيا', quantity: 3 },
    result: { base: 6600, discounts: 660, penalties: 0, net: 5940, vat: 891, total: 6831 },
    created_at: '2026-06-14T10:30:00Z',
  },
];

export async function listPricingLog(): Promise<PricingLogEntry[]> {
  try {
    const { data, error } = await supabase
      .from('pricing_log')
      .select('id, service_code, params, result, created_at, op_type, reference, user_name')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data && data.length > 0) return data as unknown as PricingLogEntry[];
  } catch {
    /* fall through */
  }
  return LOG.map((l) => ({ ...l }));
}

/** Demo-mode logging: calc_price() logs on the backend; mirror it locally. */
export function recordPricingLog(
  service_code: string,
  params: Record<string, unknown>,
  result: PriceDetail,
  meta: { op_type?: PricingOp; reference?: string | null; user_name?: string | null } = {},
): void {
  LOG.unshift({
    id: `pl-${Date.now()}-${LOG.length}`,
    service_code,
    params,
    result,
    created_at: new Date().toISOString(),
    op_type: meta.op_type ?? 'calculation',
    reference: meta.reference ?? null,
    user_name: meta.user_name ?? null,
  });
}
