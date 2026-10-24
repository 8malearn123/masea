import type { PriceBreakdown, ServiceCode } from '@/lib/funnel';

/** KSA VAT rate. Pricing is computed in the backend (calc_price); this pure
 *  mirror exists for the pre-migration fallback and is unit-tested. */
export const VAT_RATE = 0.15;

export interface PriceArgs {
  nationality?: string | undefined;
  profession?: string | undefined;
  quantity: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Apply 15% VAT to a base amount. */
export function applyVat(base: number): PriceBreakdown {
  const b = round2(base);
  const vat = round2(b * VAT_RATE);
  return { base: b, vat, total: round2(b + vat) };
}

export function fallbackBase(service: ServiceCode, args: PriceArgs): number {
  const q = Math.max(args.quantity, 1);
  if (service === 'recruitment') {
    const byNat: Record<string, number> = {
      الفلبين: 16000,
      إندونيسيا: 14000,
      كينيا: 13000,
      أوغندا: 12000,
      بنغلاديش: 11000,
      سريلانكا: 13500,
    };
    return (byNat[args.nationality ?? ''] ?? 14000) * q;
  }
  if (service === 'monthly_rental') {
    const byNat: Record<string, number> = {
      الفلبين: 2500,
      إندونيسيا: 2200,
      كينيا: 2000,
      أوغندا: 1900,
      سريلانكا: 2300,
    };
    return (byNat[args.nationality ?? ''] ?? 2200) * q;
  }
  if (service === 'daily_rental') {
    const byTask: Record<string, number> = { تنظيف: 180, طبخ: 220, رعاية: 200 };
    return (byTask[args.profession ?? ''] ?? 180) * q;
  }
  if (service === 'sponsorship_transfer') return 2000 * q;
  return 0;
}

export function fallbackPrice(service: ServiceCode, args: PriceArgs): PriceBreakdown {
  return applyVat(fallbackBase(service, args));
}

// ----------------------------------------------------------------------------
// Layered pricing (module 03): base − discounts + penalties = net; VAT on net.
// Pure mirror of the backend calc_price(); used for the demo fallback and unit
// tests. All tunables come from PricingConfig (never hard-coded downstream).
// ----------------------------------------------------------------------------

export interface PricingConfig {
  vat_rate: number;
  late_grace_days: number;
  late_daily_pct: number;
  late_max_pct: number;
  cancellation_pct: number;
  absence_per_day: number;
  absence_max_days: number;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  vat_rate: 0.15,
  late_grace_days: 3,
  late_daily_pct: 1,
  late_max_pct: 10,
  cancellation_pct: 25,
  absence_per_day: 50,
  absence_max_days: 5,
};

export interface PriceDetail {
  base: number;
  discounts: number;
  penalties: number;
  net: number;
  vat: number;
  total: number;
}

// ----------------------------------------------------------------------------
// Predefined discounts (0051). There is NO open discount: a discount can only
// come from a promotion defined by management (pct OR amount + conditions) and
// is re-validated by the backend (evaluate_promotion / calc_price).
// ----------------------------------------------------------------------------

/** A managed discount definition (supabase `promotions`). */
export interface Promotion {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  /** Exactly one of pct / amount is set. */
  discount_pct: number | null;
  discount_amount: number | null;
  /** Services the discount applies to — empty = all services. */
  service_codes: string[];
  min_base_amount: number | null;
  max_discount_amount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  usage_count: number;
  is_active: boolean;
}

export interface PromotionCheck {
  ok: boolean;
  amount: number;
  reason: string | null;
}

/** Pure mirror of the backend `evaluate_promotion()` — same rules, same order. */
export function evaluatePromotion(
  promo: Promotion,
  service: string,
  base: number,
  now: Date = new Date(),
): PromotionCheck {
  const fail = (reason: string): PromotionCheck => ({ ok: false, amount: 0, reason });
  if (!promo.is_active) return fail('الخصم معطّل');
  if (promo.starts_at && now < new Date(promo.starts_at)) return fail('الخصم لم يبدأ بعد');
  if (promo.ends_at && now > new Date(promo.ends_at)) return fail('انتهت صلاحية الخصم');
  if (promo.service_codes.length > 0 && !promo.service_codes.includes(service)) {
    return fail('الخصم لا يشمل هذه الخدمة');
  }
  if (promo.min_base_amount != null && base < promo.min_base_amount) {
    return fail('المبلغ أقل من الحد الأدنى لتطبيق الخصم');
  }
  if (promo.usage_limit != null && promo.usage_count >= promo.usage_limit) {
    return fail('استُنفد عدد مرات استخدام الخصم');
  }
  let amount =
    promo.discount_pct != null
      ? round2((base * promo.discount_pct) / 100)
      : round2(promo.discount_amount ?? 0);
  if (promo.max_discount_amount != null) amount = Math.min(amount, promo.max_discount_amount);
  return { ok: true, amount: Math.min(amount, base), reason: null };
}

/** Inputs from loyalty (٠٧) and operations that adjust the base price. */
export interface PriceModifiers {
  /** The selected predefined discount — applied only if eligible. */
  promotion?: Promotion | null;
  walletRedeem?: number;
  lateDays?: number;
  cancelled?: boolean;
  absenceDays?: number;
  /** Managed floor (pricing_rules.min_price × quantity) — discounts never go below it. */
  floor?: number;
}

/** Layered price from an already-resolved base (backend rule or fallback). */
export function priceFromBase(
  service: string,
  rawBase: number,
  mods: PriceModifiers = {},
  cfg: PricingConfig = DEFAULT_PRICING_CONFIG,
): PriceDetail {
  const base = round2(rawBase);

  // (2) discounts: predefined promotion + wallet + absence compensation,
  //     capped at the managed floor (and never below zero)
  let discounts = mods.walletRedeem ?? 0;
  if (mods.promotion) discounts += evaluatePromotion(mods.promotion, service, base).amount;
  if (mods.absenceDays && mods.absenceDays > 0) {
    discounts += cfg.absence_per_day * Math.min(mods.absenceDays, cfg.absence_max_days);
  }
  discounts = Math.min(round2(discounts), Math.max(base - (mods.floor ?? 0), 0));

  // (3) penalties: late payment (capped) + cancellation
  let penalties = 0;
  const late = mods.lateDays ?? 0;
  if (late > cfg.late_grace_days) {
    penalties += (base * Math.min(late * cfg.late_daily_pct, cfg.late_max_pct)) / 100;
  }
  if (mods.cancelled) penalties += (base * cfg.cancellation_pct) / 100;
  penalties = round2(penalties);

  // (4) net + VAT on the net
  const net = Math.max(round2(base - discounts + penalties), 0);
  const vat = round2(net * cfg.vat_rate);
  return { base, discounts, penalties, net, vat, total: round2(net + vat) };
}

export function calcPriceDetail(
  service: ServiceCode,
  args: PriceArgs,
  mods: PriceModifiers = {},
  cfg: PricingConfig = DEFAULT_PRICING_CONFIG,
): PriceDetail {
  return priceFromBase(service, fallbackBase(service, args), mods, cfg);
}
