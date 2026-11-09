import type { DriverStatus } from '@/features/orders/schemas/order.schema';

export interface DriverLocation {
  id: string;
  full_name: string;
  status: DriverStatus;
  vehicle_no: string | null;
  branch: string | null;
  /** آخر موقع مسجّل (من آخر مسح للسائق)؛ `null` = لم يُسجَّل موقع بعد */
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
}

export interface ScanEvent {
  id: string;
  scan_type: string;
  subject: string;
  /** `null` = سُجّل المسح دون موقع (الجهاز رفض تحديد الموقع) */
  lat: number | null;
  lng: number | null;
  scanned_at: string;
  /** فرع المسح (لنطاق مدير الفرع) */
  branch?: string | null;
  /** مسح رحلة مرتبط بطلب: رقم الطلب ونتيجة تطبيق الخطوة (المرفوض يبقى في السجل). */
  request_no?: string;
  outcome?: 'accepted' | 'rejected';
  reason?: string;
}

export const SCAN_TYPE_LABEL: Record<string, string> = {
  warehouse_out: 'خروج من المستودع',
  customer_arrived: 'وصول للعميل',
  service_end: 'انتهاء الخدمة',
  warehouse_in: 'عودة للمستودع',
};
