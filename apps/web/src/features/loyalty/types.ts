import type { BadgeTone } from '@/shared/ui/Badge';

export type LoyaltyTxnType = 'earn' | 'redeem' | 'expire' | 'referral';
export type CampaignType = 'discount' | 'cashback' | 'seasonal' | 'referral';

export interface LoyaltyTxn {
  id: string;
  customer_name: string;
  type: LoyaltyTxnType;
  points: number;
  amount: number;
  description: string;
  created_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  discount_pct: number;
  start_at: string;
  end_at: string;
  is_active: boolean;
  usage_count: number;
  /** كود كوبون الحملة — يُبنى مباشرة من شاشة التسويق ويُمنح للعملاء. */
  coupon_code: string | null;
}

/** بيانات إنشاء/تعديل حملة (المعرّف وعدّاد الاستخدام يُدارَان تلقائياً). */
export type CampaignInput = Omit<Campaign, 'id' | 'usage_count'>;

export interface Referral {
  id: string;
  referrer_name: string;
  referee_name: string;
  commission_amount: number;
  is_paid: boolean;
  created_at: string;
}

export const TXN_TYPE_LABEL: Record<LoyaltyTxnType, string> = {
  earn: 'اكتساب',
  redeem: 'استبدال',
  expire: 'انتهاء',
  referral: 'إحالة',
};

export const TXN_TYPE_TONE: Record<LoyaltyTxnType, BadgeTone> = {
  earn: 'success',
  redeem: 'navy',
  expire: 'neutral',
  referral: 'gold',
};

export const CAMPAIGN_TYPE_LABEL: Record<CampaignType, string> = {
  discount: 'خصم',
  cashback: 'استرداد نقدي',
  seasonal: 'موسمية',
  referral: 'إحالة',
};

export const CAMPAIGN_TYPE_TONE: Record<CampaignType, BadgeTone> = {
  discount: 'navy',
  cashback: 'teal',
  seasonal: 'gold',
  referral: 'success',
};

// ---------------------------------------------------------------------------
// Loyalty account / engine types (module 07) — mirror the 0020 DB layer.
// ---------------------------------------------------------------------------
export type LoyaltyTier = 'bronze' | 'silver' | 'gold';

export const TIER_LABEL: Record<LoyaltyTier, string> = {
  bronze: 'برونز',
  silver: 'فضي',
  gold: 'ذهبي',
};

export const TIER_TONE: Record<LoyaltyTier, BadgeTone> = {
  bronze: 'gold',
  silver: 'navy',
  gold: 'success',
};

export interface TierInfo {
  tier: LoyaltyTier;
  label: string;
  min_spend: number;
  multiplier: number;
}

/** ملخّص عميل ولاء لعرضه في منتقي الاستعلام. */
export interface LoyaltyCustomerSummary {
  id: string;
  name: string;
  phone: string;
  tier: LoyaltyTier;
  tier_label: string;
  points_balance: number;
}

export type PrizeType = 'points' | 'wallet' | 'discount' | 'free_service' | 'none';

export const PRIZE_TYPE_LABEL: Record<PrizeType, string> = {
  points: 'نقاط',
  wallet: 'رصيد محفظة',
  discount: 'خصم نسبة',
  free_service: 'خدمة مجانية',
  none: 'حظ أوفر',
};

export interface WheelPrize {
  id: string;
  label: string;
  prize_type: PrizeType;
  value: number;
  probability: number;
  /** جائزة مفعّلة تظهر على العجلة وتدخل في السحب (تعطيلها = soft delete). */
  active: boolean;
  /** كود الكوبون المرتبط بالجائزة (للخصومات/الخدمات المجانية) — يُبنى مباشرة من شاشة الإدارة. */
  coupon_code: string | null;
}

/** بيانات إنشاء/تعديل جائزة (بدون المعرّف). */
export type WheelPrizeInput = Omit<WheelPrize, 'id'>;

export interface LoyaltyPackage {
  id: string;
  name: string;
  included: string[];
  special_price: number;
}

export interface PointsEntry {
  id: string;
  type: 'earn' | 'redeem' | 'prize';
  points: number;
  description: string;
  at: string;
}

export interface WalletEntry {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  source: string;
  description: string;
  at: string;
}

export interface LoyaltyConfig {
  points_per_riyal: number;
  redeem_points_per_riyal: number;
  referral_commission_pct: number;
  wheel_spins_per_customer: number;
  first_order_discount_pct: number;
}

export interface LoyaltyAccount {
  customer_id: string;
  customer_name: string;
  phone: string;
  referral_code: string;
  points_balance: number;
  wallet_balance: number;
  total_spend: number;
  tier: LoyaltyTier;
  tier_label: string;
  next_tier: TierInfo | null;
  progress_pct: number;
  multiplier: number;
  spins_left: number;
  points_ledger: PointsEntry[];
  wallet_ledger: WalletEntry[];
}
