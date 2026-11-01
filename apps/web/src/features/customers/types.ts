import type { BadgeTone } from '@/shared/ui/Badge';

/** One row of `customer_insights` (0064) — every figure comes from real operations. */
export interface CustomerInsight {
  id: string;
  full_name: string;
  phone: string | null;
  city: string | null;
  branch: string | null;
  created_at: string;
  is_active: boolean;
  contracts_count: number;
  purchases: number; // sold contracts
  first_purchase_at: string | null;
  last_purchase_at: string | null;
  sales_value: number; // net value of everything bought (before VAT)
  total_paid: number;
  active_contracts: number; // running contracts = a worker with the customer now
  next_end_date: string | null;
  last_end_date: string | null;
  last_contact_at: string | null;
  days_since_purchase: number | null;
  days_since_contact: number | null;
}

/** Managed thresholds (app_config crm_*) — editable from الإعدادات. */
export interface CrmThresholds {
  newDays: number;
  inactiveDays: number;
  followupDays: number;
  returnWindowDays: number;
}

export const DEFAULT_CRM_THRESHOLDS: CrmThresholds = {
  newDays: 30,
  inactiveDays: 90,
  followupDays: 45,
  returnWindowDays: 30,
};

export type CustomerSegment =
  | 'active'
  | 'inactive'
  | 'new'
  | 'repeat'
  | 'with_worker'
  | 'without_worker'
  | 'served_before'
  | 'expected_return'
  | 'needs_followup'
  | 'ended_no_worker';

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  active: 'نشط',
  inactive: 'خامل',
  new: 'جديد',
  repeat: 'متكرر',
  with_worker: 'لديه عاملة حاليًا',
  without_worker: 'بدون عاملة حاليًا',
  served_before: 'استفاد من الخدمة سابقًا',
  expected_return: 'متوقع عودته',
  needs_followup: 'يحتاج متابعة تسويقية',
  ended_no_worker: 'انتهت خدمته ولا عاملة لديه',
};

export const SEGMENT_TONE: Record<CustomerSegment, BadgeTone> = {
  active: 'success',
  inactive: 'neutral',
  new: 'teal',
  repeat: 'gold',
  with_worker: 'navy',
  without_worker: 'neutral',
  served_before: 'navy',
  expected_return: 'teal',
  needs_followup: 'danger',
  ended_no_worker: 'gold',
};

export interface CustomerInput {
  full_name: string;
  phone: string;
  national_id: string | null;
  city: string | null;
  email: string | null;
  vat_number: string | null;
  address: string | null;
  branch: string | null;
}

export interface CustomerRecord extends CustomerInput {
  id: string;
  is_active: boolean;
  created_at: string;
}

export type InteractionKind = 'call' | 'whatsapp' | 'sms' | 'visit' | 'note';

export interface CustomerInteraction {
  id: string;
  customer_id: string;
  kind: InteractionKind;
  note: string | null;
  follow_up_at: string | null;
  done: boolean;
  created_at: string;
  created_by_name: string | null;
}
