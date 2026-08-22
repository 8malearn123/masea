import type { DriverStatus } from '@/features/orders/schemas/order.schema';

export interface DriverLocation {
  id: string;
  full_name: string;
  status: DriverStatus;
  vehicle_no: string | null;
  branch: string | null;
  lat: number;
  lng: number;
  updated_at: string;
}

export interface ScanEvent {
  id: string;
  scan_type: string;
  subject: string;
  lat: number;
  lng: number;
  scanned_at: string;
}

export const SCAN_TYPE_LABEL: Record<string, string> = {
  warehouse_out: 'خروج من المستودع',
  customer_arrived: 'وصول للعميل',
  service_end: 'انتهاء الخدمة',
  warehouse_in: 'عودة للمستودع',
};
