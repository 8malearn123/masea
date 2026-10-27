import type { PriceDetail } from '@/shared/lib/pricing';

export interface PricingRule {
  id: string;
  service_code: string;
  nationality: string | null;
  profession: string | null;
  duration_unit: string | null;
  base_price: number;
  /** Floor price — the base may never be quoted below this after discounts. */
  min_price: number | null;
  is_active: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** A price change (pricing_rule_changes, 0058) — old → new with reason & effective date. */
export interface PricingRuleChange {
  id: string;
  rule_id: string;
  old_base: number | null;
  new_base: number;
  old_min: number | null;
  new_min: number | null;
  effective_from: string;
  reason: string;
  changed_by: string;
  changed_at: string;
}

export type { QuoteRecord as PricingQuote, QuoteStatus } from '@/shared/lib/quotesLedger';
import type { QuoteStatus } from '@/shared/lib/quotesLedger';

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'مسودة',
  sent: 'مُرسل',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  expired: 'منتهٍ',
};

export type PricingOp = 'calculation' | 'quote' | 'contract';
export const PRICING_OP_LABEL: Record<PricingOp, string> = {
  calculation: 'حساب',
  quote: 'عرض سعر',
  contract: 'عقد',
};

export interface PricingLogEntry {
  id: string;
  service_code: string;
  params: Record<string, unknown>;
  result: PriceDetail;
  created_at: string;
  /** recorded from 0058 onward — null on historical rows (never back-filled) */
  op_type?: PricingOp | null;
  reference?: string | null;
  user_name?: string | null;
}

export interface ConfigMeta {
  updated_at: string | null;
  updated_by: string | null;
}

export const PRICING_SERVICE_LABEL: Record<string, string> = {
  recruitment: 'استقدام',
  monthly_rental: 'تأجير شهري',
  daily_rental: 'تأجير يومي',
  sponsorship_transfer: 'نقل كفالة',
};

export const UNIT_LABEL: Record<string, string> = {
  fixed: 'مقطوع',
  month: 'شهري',
  day: 'يومي',
};
