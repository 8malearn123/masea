import type { BadgeTone } from '@/shared/ui/Badge';

export type LeadStageCode = 'new' | 'contacted' | 'quoted' | 'negotiation' | 'won' | 'lost';
export type LeadSourceCode = 'website' | 'call_center' | 'referral' | 'walk_in' | 'campaign';
export type ServiceCode =
  | 'recruitment'
  | 'monthly_rental'
  | 'daily_rental'
  | 'sponsorship_transfer';
export type ActivityKind = 'call' | 'whatsapp' | 'sms' | 'visit' | 'note';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface Lead {
  id: string;
  full_name: string;
  phone: string | null;
  source_code: LeadSourceCode | null;
  service_code: ServiceCode | null;
  stage_code: LeadStageCode;
  est_value: number;
  notes: string | null;
  customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  kind: ActivityKind;
  note: string | null;
  follow_up_at: string | null;
  done: boolean;
  created_at: string;
}

export interface Quote {
  id: string;
  lead_id: string | null;
  customer_name: string | null;
  service_code: ServiceCode;
  base_amount: number;
  vat_amount: number;
  total_amount: number;
  status: QuoteStatus;
  valid_until: string | null;
  contract_id: string | null;
  created_at: string;
}

/** My monthly sales target + leaderboard standing (from targets/13). */
export interface SalesTarget {
  month: number;
  year: number;
  contracts_target: number;
  contracts_achieved: number;
  collection_target: number;
  collection_achieved: number;
  commission_earned: number;
  rank: number;
  rank_total: number;
}

export const STAGE_ORDER: LeadStageCode[] = [
  'new',
  'contacted',
  'quoted',
  'negotiation',
  'won',
  'lost',
];

export const STAGE_LABEL: Record<LeadStageCode, string> = {
  new: 'جديد',
  contacted: 'تم التواصل',
  quoted: 'عرض سعر مُرسل',
  negotiation: 'تفاوض',
  won: 'مكسوب',
  lost: 'مفقود',
};

export const STAGE_TONE: Record<LeadStageCode, BadgeTone> = {
  new: 'neutral',
  contacted: 'teal',
  quoted: 'gold',
  negotiation: 'navy',
  won: 'success',
  lost: 'danger',
};

export const SOURCE_LABEL: Record<LeadSourceCode, string> = {
  website: 'الموقع الإلكتروني',
  call_center: 'مركز الاتصال',
  referral: 'إحالة',
  walk_in: 'زيارة للفرع',
  campaign: 'حملة تسويقية',
};

export const SERVICE_LABEL: Record<ServiceCode, string> = {
  recruitment: 'استقدام',
  monthly_rental: 'تأجير شهري',
  daily_rental: 'تأجير يومي',
  sponsorship_transfer: 'نقل كفالة',
};

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  call: 'اتصال',
  whatsapp: 'واتساب',
  sms: 'رسالة',
  visit: 'زيارة',
  note: 'ملاحظة',
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'مسودة',
  sent: 'مُرسل',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  expired: 'منتهٍ',
};

export const QUOTE_STATUS_TONE: Record<QuoteStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'gold',
  accepted: 'success',
  rejected: 'danger',
  expired: 'neutral',
};
