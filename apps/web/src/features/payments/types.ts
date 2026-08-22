import { Banknote, CreditCard, Smartphone, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BadgeTone } from '@/shared/ui/Badge';

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid';

export interface Invoice {
  id: string;
  contract_no: string;
  customer_name: string;
  base: number;
  vat: number;
  total: number;
  status: InvoiceStatus;
  method: string | null;
  reference_no: string | null;
  created_at: string;
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'غير مدفوعة',
  partial: 'مدفوعة جزئيًا',
  paid: 'مدفوعة',
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  unpaid: 'danger',
  partial: 'gold',
  paid: 'success',
};

export interface PaymentMethodOption {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const PAYMENT_METHODS: PaymentMethodOption[] = [
  { key: 'mada', label: 'مدى / Moyasar', icon: CreditCard },
  { key: 'apple_pay', label: 'Apple Pay', icon: Smartphone },
  { key: 'stc_pay', label: 'STC Pay', icon: Wallet },
  { key: 'tamara', label: 'تابي / تمارا (تقسيط)', icon: Banknote },
];

export const METHOD_LABEL: Record<string, string> = {
  mada: 'مدى',
  apple_pay: 'Apple Pay',
  stc_pay: 'STC Pay',
  tamara: 'تمارا',
};
