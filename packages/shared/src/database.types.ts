/**
 * Domain enums + row types for the Masiat Alsharq ERP.
 * Hand-maintained to mirror supabase/migrations. Regenerate richer types
 * with: `supabase gen types typescript --local > database.gen.ts`
 */

export type WorkerStatus = 'available' | 'on_service' | 'absent' | 'medical' | 'terminated';
export type CustomerSegment = 'bronze' | 'silver' | 'gold';
export type DriverStatus = 'available' | 'on_route' | 'off_duty';
export type ServiceType =
  | 'monthly' | 'daily' | 'hourly_8' | 'hourly_5' | 'direct' | 'cleaning' | 'kafala';
export type ContractStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type PaymentMethod = 'cash' | 'mada' | 'apple_pay' | 'tamara' | 'transfer';
export type ScanType = 'warehouse_out' | 'customer_arrived' | 'service_end' | 'warehouse_in';
export type PenaltyType = 'late_return' | 'false_report' | 'other';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';
export type PayrollStatus = 'draft' | 'approved' | 'transferred';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type LoyaltyTxnType = 'earn' | 'redeem' | 'cashback' | 'referral';
export type CampaignType =
  | 'hourly_offer' | 'first_order' | 'lucky_wheel' | 'referral' | 'general';
export type HousingStatus = 'present' | 'absent' | 'on_service' | 'medical';
export type AppRole =
  | 'admin' | 'operations_manager' | 'branch_manager' | 'sales' | 'call_center'
  | 'driver' | 'housing_supervisor' | 'hr' | 'accountant' | 'external_office';

export interface Branch {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Worker {
  id: string;
  full_name: string;
  nationality: string | null;
  passport_no: string | null;
  iqama_no: string | null;
  phone: string | null;
  branch_id: string | null;
  status: WorkerStatus;
  profession: string | null;
  daily_rate: number;
  monthly_rate: number;
  barcode: string | null;
  photo_url: string | null;
  rating: number;
  notes: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  full_name: string;
  national_id: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  branch_id: string | null;
  email: string | null;
  loyalty_points: number;
  wallet_balance: number;
  segment: CustomerSegment;
  created_at: string;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string | null;
  branch_id: string | null;
  status: DriverStatus;
  vehicle_no: string | null;
  rating: number;
  created_at: string;
}

export interface Contract {
  id: string;
  contract_number: number;
  customer_id: string;
  worker_id: string | null;
  branch_id: string | null;
  driver_id: string | null;
  service_type: ServiceType;
  start_date: string | null;
  end_date: string | null;
  base_amount: number;
  vat_amount: number;
  total_amount: number;
  amount_paid: number;
  status: ContractStatus;
  late_return_days: number;
  payment_method: PaymentMethod | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  full_name: string | null;
  role: AppRole;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
}
