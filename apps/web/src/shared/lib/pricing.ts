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

/** Inputs from loyalty (٠٧) and operations that adjust the base price. */
export interface PriceModifiers {
  discountAmount?: number;
  discountPct?: number;
  walletRedeem?: number;
  lateDays?: number;
  cancelled?: boolean;
  absenceDays?: number;
}

export function calcPriceDetail(
  service: ServiceCode,
  args: PriceArgs,
  mods: PriceModifiers = {},
  cfg: PricingConfig = DEFAULT_PRICING_CONFIG,
): PriceDetail {
  const base = round2(fallbackBase(service, args));

  // (2) discounts: explicit + wallet + absence compensation, capped at base
  let discounts =
    (mods.discountAmount ?? 0) + (base * (mods.discountPct ?? 0)) / 100 + (mods.walletRedeem ?? 0);
  if (mods.absenceDays && mods.absenceDays > 0) {
    discounts += cfg.absence_per_day * Math.min(mods.absenceDays, cfg.absence_max_days);
  }
  discounts = Math.min(round2(discounts), base);

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
