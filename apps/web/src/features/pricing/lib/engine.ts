import {
  evaluatePromotion,
  fallbackBase,
  priceFromBase,
  type PriceArgs,
  type PriceDetail,
  type PricingConfig,
  type Promotion,
} from '@/shared/lib/pricing';
import type { ServiceCode } from '@/lib/funnel';
import type { PricingRule } from '@/features/pricing/types';

/**
 * Pricing calculator engine (UI layer). It NEVER re-implements the formula:
 * totals come from `priceFromBase` (the tested mirror of backend calc_price);
 * this module only resolves the base from the managed rules (same selection as
 * calc_price), explains each component for the summary, validates inputs, and
 * builds the immutable snapshot stored with a quote.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Most specific ACTIVE rule — identical ordering to calc_price (0056). */
export function resolveRule(
  rules: PricingRule[],
  service: string,
  args: PriceArgs,
): PricingRule | null {
  const match = rules
    .filter(
      (r) =>
        r.is_active &&
        r.service_code === service &&
        (r.nationality == null || r.nationality === args.nationality) &&
        (r.profession == null || r.profession === args.profession),
    )
    .sort(
      (a, b) =>
        Number(b.nationality != null) +
        Number(b.profession != null) -
        (Number(a.nationality != null) + Number(a.profession != null)),
    )[0];
  return match ?? null;
}

/**
 * List base for an order from the managed price list (unit price × quantity).
 * The single base used by the calculator, contracts, CRM and the call center;
 * the seed mirror is used only when no managed rule exists.
 */
export function managedBase(rules: PricingRule[], service: ServiceCode, args: PriceArgs): number {
  const q = Math.max(args.quantity, 1);
  const rule = resolveRule(rules, service, args);
  const unit = rule ? rule.base_price : fallbackBase(service, { ...args, quantity: 1 });
  return round2(unit * q);
}

export interface CalcInput {
  service: ServiceCode;
  nationality: string;
  profession: string; // daily rental task
  quantity: number;
  lateDays: number;
  absenceDays: number;
  cancelled: boolean;
  promotion: Promotion | null;
  couponCode: string | null;
}

export const EMPTY_CALC: CalcInput = {
  service: 'recruitment',
  nationality: 'الفلبين',
  profession: 'تنظيف',
  quantity: 1,
  lateDays: 0,
  absenceDays: 0,
  cancelled: false,
  promotion: null,
  couponCode: null,
};

export function priceArgsOf(i: CalcInput): PriceArgs {
  return i.service === 'daily_rental'
    ? { profession: i.profession, quantity: Math.max(i.quantity, 1) }
    : { nationality: i.nationality, quantity: Math.max(i.quantity, 1) };
}

export type FieldErrors = Partial<Record<'quantity' | 'lateDays' | 'absenceDays', string>>;

export function validateCalc(i: CalcInput): FieldErrors {
  const e: FieldErrors = {};
  const int = (v: number) => Number.isFinite(v) && Number.isInteger(v);
  if (!int(i.quantity) || i.quantity < 1) e.quantity = 'أدخل عددًا صحيحًا لا يقل عن 1';
  else if (i.quantity > 120) e.quantity = 'المدة كبيرة جدًا — تحقق من القيمة';
  if (!int(i.lateDays) || i.lateDays < 0) e.lateDays = 'عدد أيام صحيح غير سالب';
  if (!int(i.absenceDays) || i.absenceDays < 0) e.absenceDays = 'عدد أيام صحيح غير سالب';
  return e;
}

export interface SummaryLine {
  key: string;
  label: string;
  amount: number; // signed effect on the net (− discount, + fee)
  hint?: string;
  taxable: boolean; // part of the VAT base?
}

export interface CalcResult {
  rule: PricingRule | null;
  unitPrice: number;
  base: number;
  floor: number;
  detail: PriceDetail;
  lines: SummaryLine[];
  promotion: {
    id: string;
    name: string;
    isCoupon: boolean;
    ok: boolean;
    amount: number;
    reason: string | null;
  } | null;
  floorApplied: boolean;
  /** reasons the quote cannot be created (empty = allowed) */
  blockers: string[];
}

export function calculate(
  i: CalcInput,
  rules: PricingRule[],
  cfg: PricingConfig,
  now = new Date(),
): CalcResult {
  const args = priceArgsOf(i);
  const rule = resolveRule(rules, i.service, args);
  // demo fallback only when no managed rule exists (pre-migration seed mirror)
  const unitPrice = rule
    ? rule.base_price
    : round2(fallbackBase(i.service, { ...args, quantity: 1 }));
  const base = managedBase(rules, i.service, args);
  const floor = round2((rule?.min_price ?? 0) * args.quantity);
  const errs = validateCalc(i);
  const safe = Object.keys(errs).length === 0;

  const detail = priceFromBase(
    i.service,
    base,
    {
      promotion: i.promotion,
      promotionCode: i.couponCode,
      lateDays: safe ? i.lateDays : 0,
      absenceDays: safe ? i.absenceDays : 0,
      cancelled: i.cancelled,
      floor,
    },
    cfg,
  );

  const check = i.promotion
    ? evaluatePromotion(i.promotion, i.service, base, now, i.couponCode)
    : null;
  const promoAmt = check?.ok ? check.amount : 0;
  const absenceDays = safe ? Math.min(i.absenceDays, cfg.absence_max_days) : 0;
  const absenceAmt = round2(cfg.absence_per_day * absenceDays);
  const rawDiscounts = round2(promoAmt + absenceAmt);
  const floorCut = round2(rawDiscounts - detail.discounts); // amount withheld by the floor
  const late = safe ? i.lateDays : 0;
  const latePct =
    late > cfg.late_grace_days ? Math.min(late * cfg.late_daily_pct, cfg.late_max_pct) : 0;
  const lateAmt = round2((base * latePct) / 100);
  const cancelAmt = round2(detail.penalties - lateAmt);
  const isCoupon = !!i.promotion && (i.promotion.requires_code || !!i.couponCode);

  const lines: SummaryLine[] = [
    {
      key: 'base',
      label: 'السعر الأساسي',
      amount: base,
      hint: `${unitPrice.toLocaleString('en-US')} × ${args.quantity}`,
      taxable: true,
    },
  ];
  if (i.promotion)
    lines.push({
      key: 'promo',
      label: isCoupon
        ? `خصم الكوبون${i.couponCode ? ` (${i.couponCode.toUpperCase()})` : ''}`
        : `الخصم المعتمد — ${i.promotion.name}`,
      amount: -promoAmt,
      ...(check && !check.ok ? { hint: check.reason ?? 'غير مؤهل' } : {}),
      taxable: true,
    });
  if (absenceAmt > 0)
    lines.push({
      key: 'absence',
      label: 'تعويض غياب العاملة',
      amount: -absenceAmt,
      hint: `${absenceDays} يوم × ${cfg.absence_per_day}`,
      taxable: true,
    });
  if (floorCut > 0)
    lines.push({
      key: 'floor',
      label: 'تقييد بالحد الأدنى للسعر',
      amount: floorCut,
      hint: `الحد الأدنى ${floor.toLocaleString('en-US')}`,
      taxable: true,
    });
  if (lateAmt > 0)
    lines.push({
      key: 'late',
      label: 'غرامة تأخر السداد',
      amount: lateAmt,
      hint: `${late} يوم — ${latePct}٪ (بعد مهلة ${cfg.late_grace_days} أيام)`,
      taxable: true,
    });
  if (cancelAmt > 0)
    lines.push({
      key: 'cancel',
      label: 'رسوم الإلغاء بعد المباشرة',
      amount: cancelAmt,
      hint: `${cfg.cancellation_pct}٪ من الأساسي`,
      taxable: true,
    });

  const blockers: string[] = [];
  if (!safe) blockers.push('صحّح الحقول المظللة');
  if (!rule) blockers.push('لا توجد قاعدة سعر نشطة لهذه الخدمة/الجنسية');
  if (check && !check.ok) blockers.push(`الخصم غير قابل للتطبيق: ${check.reason ?? ''}`.trim());
  if (detail.total <= 0) blockers.push('الإجمالي صفر');

  return {
    rule,
    unitPrice,
    base,
    floor,
    detail,
    lines,
    promotion: i.promotion
      ? {
          id: i.promotion.id,
          name: i.promotion.name,
          isCoupon,
          ok: !!check?.ok,
          amount: promoAmt,
          reason: check?.reason ?? null,
        }
      : null,
    floorApplied: floorCut > 0,
    blockers,
  };
}

/* -------------------------------- snapshot ------------------------------- */
/** Immutable copy stored with a quote: later rule/config changes never alter it. */
export interface PriceSnapshot {
  version: 1;
  computed_at: string;
  inputs: Omit<CalcInput, 'promotion'> & { promotion_id: string | null };
  rule: {
    id: string;
    base_price: number;
    min_price: number | null;
    duration_unit: string | null;
  } | null;
  config: PricingConfig;
  promotion: CalcResult['promotion'];
  lines: SummaryLine[];
  detail: PriceDetail;
}

export function buildSnapshot(
  i: CalcInput,
  r: CalcResult,
  cfg: PricingConfig,
  now = new Date(),
): PriceSnapshot {
  const { promotion: _p, ...rest } = i;
  void _p;
  return JSON.parse(
    JSON.stringify({
      version: 1,
      computed_at: now.toISOString(),
      inputs: { ...rest, promotion_id: i.promotion?.id ?? null },
      rule: r.rule
        ? {
            id: r.rule.id,
            base_price: r.rule.base_price,
            min_price: r.rule.min_price,
            duration_unit: r.rule.duration_unit,
          }
        : null,
      config: cfg,
      promotion: r.promotion,
      lines: r.lines,
      detail: r.detail,
    }),
  ) as PriceSnapshot;
}
