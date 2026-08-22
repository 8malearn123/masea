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
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

/** A price quote generated from the calculator (supabase `quotes`). */
export interface PricingQuote {
  id: string;
  service_code: string;
  customer_name: string | null;
  customer_phone: string | null;
  base_amount: number;
  vat_amount: number;
  total_amount: number;
  status: QuoteStatus;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'مسودة',
  sent: 'مُرسل',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  expired: 'منتهٍ',
};

export interface PricingLogEntry {
  id: string;
  service_code: string;
  params: Record<string, unknown>;
  result: PriceDetail;
  created_at: string;
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
