import type { BadgeTone } from '@/shared/ui/Badge';

export type CallStatus = 'new' | 'in_progress' | 'callback' | 'resolved';
export type CallType = 'inquiry' | 'complaint' | 'follow_up' | 'request' | 'sale';
export type CallPriority = 'low' | 'medium' | 'high';
export type CallChannel = 'phone' | 'whatsapp' | 'walk_in';

export interface CallLog {
  id: string;
  customer_name: string;
  phone: string;
  topic: string;
  type: CallType;
  priority: CallPriority;
  channel: CallChannel;
  status: CallStatus;
  agent: string;
  notes: string;
  amount?: number;
  ticket_no?: string | null;
  callback_at: string | null;
  created_at: string;
}

export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  new: 'جديدة',
  in_progress: 'قيد المعالجة',
  callback: 'معاودة اتصال',
  resolved: 'مغلقة',
};

export const CALL_STATUS_TONE: Record<CallStatus, BadgeTone> = {
  new: 'gold',
  in_progress: 'navy',
  callback: 'teal',
  resolved: 'success',
};

export const CALL_STATUSES: CallStatus[] = ['new', 'in_progress', 'callback', 'resolved'];

export const CALL_TYPE_LABEL: Record<CallType, string> = {
  inquiry: 'استفسار',
  complaint: 'شكوى',
  follow_up: 'متابعة',
  request: 'طلب خدمة',
  sale: 'صفقة بيع',
};

export const CALL_TYPE_TONE: Record<CallType, BadgeTone> = {
  inquiry: 'navy',
  complaint: 'danger',
  follow_up: 'teal',
  request: 'gold',
  sale: 'success',
};

export const CALL_TYPES: CallType[] = ['inquiry', 'complaint', 'follow_up', 'request'];

export const PRIORITY_LABEL: Record<CallPriority, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عاجلة',
};

export const PRIORITY_TONE: Record<CallPriority, BadgeTone> = {
  low: 'neutral',
  medium: 'gold',
  high: 'danger',
};

export const PRIORITIES: CallPriority[] = ['high', 'medium', 'low'];

export const CHANNEL_LABEL: Record<CallChannel, string> = {
  phone: 'هاتف',
  whatsapp: 'واتساب',
  walk_in: 'زيارة',
};

export const CHANNELS: CallChannel[] = ['phone', 'whatsapp', 'walk_in'];

/** Payload for logging a new call. */
export interface NewCallInput {
  customer_name: string;
  phone: string;
  topic: string;
  type: CallType;
  priority: CallPriority;
  channel: CallChannel;
  agent: string;
  notes: string;
  status?: CallStatus;
  amount?: number;
  ticket_no?: string | null;
  callback_at?: string | null;
}
