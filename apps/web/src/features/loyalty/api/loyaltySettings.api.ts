import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { LOYALTY_CONFIG, PACKAGES, TIERS } from '@/features/loyalty/data/engine';
import type {
  LoyaltyConfig,
  LoyaltyPackage,
  LoyaltyPackageInput,
  LoyaltyTier,
  TierInfo,
} from '@/features/loyalty/types';

/**
 * Managed loyalty settings — supabase `loyalty_config` (singleton),
 * `customer_tiers` and `packages` (0020; writable with loyalty.manage, 0054).
 * Demo mode edits the engine's live objects in place (so points, tiers and the
 * customer view use the new values immediately) and persists them locally.
 */

const LS_KEY = 'masea_loyalty_settings';

function persistDemo(): void {
  try {
    localStorage?.setItem(
      LS_KEY,
      JSON.stringify({ config: LOYALTY_CONFIG, tiers: TIERS, packages: PACKAGES }),
    );
  } catch {
    // storage blocked → keep the in-memory edit
  }
}

/** Restore demo edits once at load (the engine seeds stay the defaults). */
(function restoreDemo() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return;
    const saved = JSON.parse(raw) as {
      config?: LoyaltyConfig;
      tiers?: TierInfo[];
      packages?: LoyaltyPackage[];
    };
    if (saved.config) Object.assign(LOYALTY_CONFIG, saved.config);
    if (Array.isArray(saved.tiers) && saved.tiers.length === TIERS.length) {
      TIERS.splice(0, TIERS.length, ...saved.tiers);
    }
    if (Array.isArray(saved.packages)) PACKAGES.splice(0, PACKAGES.length, ...saved.packages);
  } catch {
    // corrupt storage → defaults
  }
})();

// ------------------------------ validation --------------------------------
export const loyaltyConfigSchema = z.object({
  points_per_riyal: z.number().positive({ message: 'أكبر من صفر' }),
  redeem_points_per_riyal: z.number().positive({ message: 'أكبر من صفر' }),
  referral_commission_pct: z.number().min(0).max(100, { message: 'النسبة بين 0 و100' }),
  first_order_discount_pct: z.number().min(0).max(100, { message: 'النسبة بين 0 و100' }),
  wheel_spins_per_customer: z.number().int({ message: 'عدد صحيح' }).min(0),
});

export const tierSchema = z.object({
  label: z.string().trim().min(2, { message: 'اسم الفئة مطلوب' }),
  min_spend: z.number().min(0, { message: 'لا يقل عن صفر' }),
  multiplier: z.number().min(1, { message: 'المضاعف 1 على الأقل' }).max(10),
});

/** Tiers must climb: each tier needs a higher spend threshold than the previous one. */
export function tiersOrdered(tiers: Pick<TierInfo, 'min_spend'>[]): boolean {
  return tiers.every((t, i) => i === 0 || t.min_spend > (tiers[i - 1]?.min_spend ?? -1));
}

export const packageSchema = z.object({
  name: z.string().trim().min(3, { message: 'اسم الباقة مطلوب' }),
  included: z.array(z.string().trim().min(1)).min(1, { message: 'أضف خدمة واحدة على الأقل' }),
  special_price: z.number().positive({ message: 'السعر أكبر من صفر' }),
  is_active: z.boolean(),
});

// -------------------------------- config ----------------------------------
export async function getLoyaltyConfig(): Promise<LoyaltyConfig> {
  try {
    const { data, error } = await supabase
      .from('loyalty_config')
      .select(
        'points_per_riyal, redeem_points_per_riyal, referral_commission_pct, first_order_discount_pct, wheel_spins_per_customer',
      )
      .eq('id', 1)
      .single();
    if (!error && data) {
      const row = data as Record<keyof LoyaltyConfig, unknown>;
      const cfg: LoyaltyConfig = {
        points_per_riyal: Number(row.points_per_riyal),
        redeem_points_per_riyal: Number(row.redeem_points_per_riyal),
        referral_commission_pct: Number(row.referral_commission_pct),
        first_order_discount_pct: Number(row.first_order_discount_pct),
        wheel_spins_per_customer: Number(row.wheel_spins_per_customer),
      };
      Object.assign(LOYALTY_CONFIG, cfg); // engine uses the live values
      return cfg;
    }
  } catch {
    /* fall through */
  }
  return { ...LOYALTY_CONFIG };
}

export async function updateLoyaltyConfig(next: LoyaltyConfig): Promise<void> {
  const parsed = loyaltyConfigSchema.parse(next);
  Object.assign(LOYALTY_CONFIG, parsed);
  persistDemo();
  const { error } = await supabase
    .from('loyalty_config')
    .update({ ...parsed, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

// -------------------------------- tiers -----------------------------------
export async function listTiers(): Promise<TierInfo[]> {
  try {
    const { data, error } = await supabase
      .from('customer_tiers')
      .select('tier, label, min_spend, benefits')
      .order('min_spend', { ascending: true });
    if (!error && data && data.length > 0) {
      const rows = (
        data as {
          tier: LoyaltyTier;
          label: string;
          min_spend: number;
          benefits: { points_multiplier?: number } | null;
        }[]
      ).map((r) => ({
        tier: r.tier,
        label: r.label,
        min_spend: Number(r.min_spend),
        multiplier: Number(r.benefits?.points_multiplier ?? 1),
      }));
      TIERS.splice(0, TIERS.length, ...rows);
      return rows;
    }
  } catch {
    /* fall through */
  }
  return TIERS.map((t) => ({ ...t }));
}

export async function updateTier(
  tier: LoyaltyTier,
  patch: Pick<TierInfo, 'label' | 'min_spend' | 'multiplier'>,
): Promise<void> {
  const parsed = tierSchema.parse(patch);
  const next = TIERS.map((t) => (t.tier === tier ? { ...t, ...parsed } : t));
  if (!tiersOrdered(next)) {
    throw new Error('حد الإنفاق يجب أن يكون أعلى من الفئة السابقة وأقل من التالية');
  }
  const { data: current } = await supabase
    .from('customer_tiers')
    .select('benefits')
    .eq('tier', tier)
    .maybeSingle()
    .then(
      (r) => r,
      () => ({ data: null }),
    );
  const benefits = {
    ...((current as { benefits?: Record<string, unknown> } | null)?.benefits ?? {}),
    points_multiplier: parsed.multiplier,
  };
  const { error } = await supabase
    .from('customer_tiers')
    .update({ label: parsed.label, min_spend: parsed.min_spend, benefits })
    .eq('tier', tier);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  TIERS.splice(0, TIERS.length, ...next);
  persistDemo();
}

// ------------------------------- packages ---------------------------------
export async function listPackages(): Promise<LoyaltyPackage[]> {
  try {
    const { data, error } = await supabase
      .from('packages')
      .select('id, name, included_services, special_price, is_active')
      .order('created_at', { ascending: true });
    if (!error && data && data.length > 0) {
      return (
        data as {
          id: string;
          name: string;
          included_services: string[] | null;
          special_price: number;
          is_active: boolean;
        }[]
      ).map((r) => ({
        id: r.id,
        name: r.name,
        included: r.included_services ?? [],
        special_price: Number(r.special_price),
        is_active: r.is_active,
      }));
    }
  } catch {
    /* fall through */
  }
  return PACKAGES.map((p) => ({ ...p, included: [...p.included] }));
}

export async function savePackage(id: string | null, input: LoyaltyPackageInput): Promise<void> {
  const parsed = packageSchema.parse(input);
  const row = {
    name: parsed.name,
    included_services: parsed.included,
    special_price: parsed.special_price,
    is_active: parsed.is_active,
  };
  if (id && !isDemoId(id)) {
    const { error } = await supabase.from('packages').update(row).eq('id', id);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  } else if (!id) {
    const { error } = await supabase.from('packages').insert(row);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  const local = id ? PACKAGES.find((p) => p.id === id) : undefined;
  if (local) Object.assign(local, parsed);
  else if (!id) PACKAGES.push({ ...parsed, id: `pk-${Date.now()}` });
  persistDemo();
}
