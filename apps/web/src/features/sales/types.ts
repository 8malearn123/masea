import type { BadgeTone } from '@/shared/ui/Badge';

export type SaleStatus = 'confirmed' | 'completed' | 'cancelled';

/** One sale per contract (supabase `sales`, 0063) — never entered by hand. */
export interface Sale {
  id: string;
  sale_no: number;
  contract_id: string;
  contract_no: string | null;
  quote_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  branch: string | null;
  service_code: string | null;
  worker_name: string | null;
  gross_amount: number; // contract value before the discount
  discount_amount: number;
  net_amount: number; // net sale before VAT
  vat_amount: number;
  total_amount: number;
  collected: number; // paid against the contract so far
  coupon_code: string | null;
  is_renewal: boolean;
  sold_at: string;
  sold_by_name: string | null;
  status: SaleStatus;
}

export interface SaleNote {
  id: string;
  sale_id: string;
  note: string;
  created_by_name: string | null;
  created_at: string;
}

export interface SalesFilters {
  from: string; // yyyy-mm-dd ('' = بلا حد)
  to: string;
  branch: string | 'all';
  employee: string | 'all';
  service: string | 'all';
  status: SaleStatus | 'all';
  search: string;
}

export const EMPTY_SALES_FILTERS: SalesFilters = {
  from: '',
  to: '',
  branch: 'all',
  employee: 'all',
  service: 'all',
  status: 'all',
  search: '',
};

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  confirmed: 'مؤكدة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export const SALE_STATUS_TONE: Record<SaleStatus, BadgeTone> = {
  confirmed: 'navy',
  completed: 'success',
  cancelled: 'danger',
};
