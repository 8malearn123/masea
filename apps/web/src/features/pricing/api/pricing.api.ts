import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { DEFAULT_PRICING_CONFIG, type PriceDetail, type PricingConfig } from '@/shared/lib/pricing';
import type { PricingLogEntry, PricingRule } from '@/features/pricing/types';

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

export async function listPricingRules(): Promise<PricingRule[]> {
  try {
    const { data, error } = await supabase
      .from('pricing_rules')
      .select(
        'id, service_code, nationality, profession, duration_unit, base_price, min_price, is_active',
      )
      .eq('is_active', true);
    if (!error && data && data.length > 0) return data as PricingRule[];
  } catch {
    /* fall through */
  }
  return FALLBACK;
}

export async function updatePricingRule(
  id: string,
  patch: { base_price: number; min_price: number },
): Promise<void> {
  if (isDemoId(id)) return; // demo rule — optimistic update is the truth
  const { error } = await supabase.from('pricing_rules').update(patch).eq('id', id);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

// ---------------------------- pricing_config --------------------------------
let CONFIG: PricingConfig = { ...DEFAULT_PRICING_CONFIG };

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

export async function updatePricingConfig(next: PricingConfig): Promise<void> {
  CONFIG = { ...next }; // local source of truth for demo mode
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
      .select('id, service_code, params, result, created_at')
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
): void {
  LOG.unshift({
    id: `pl-${Date.now()}`,
    service_code,
    params,
    result,
    created_at: new Date().toISOString(),
  });
}
