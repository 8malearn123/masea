/** Arabic display labels for enum values (RTL native). */
import type {
  WorkerStatus, ContractStatus, ServiceType, PaymentMethod,
  CustomerSegment, AppRole,
} from './database.types';

export const workerStatusLabel: Record<WorkerStatus, string> = {
  available: 'متاح',
  on_service: 'في خدمة',
  absent: 'غائب',
  medical: 'إجازة مرضية',
  terminated: 'منتهي',
};

export const contractStatusLabel: Record<ContractStatus, string> = {
  draft: 'مسودة',
  active: 'نشط',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

export const serviceTypeLabel: Record<ServiceType, string> = {
  monthly: 'شهري',
  daily: 'يومي',
  hourly_8: 'بالساعة (8)',
  hourly_5: 'بالساعة (5)',
  direct: 'تنازل',
  cleaning: 'نظافة',
  kafala: 'كفالة',
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: 'نقدي',
  mada: 'مدى',
  apple_pay: 'Apple Pay',
  tamara: 'تمارا',
  transfer: 'تحويل بنكي',
};

export const segmentLabel: Record<CustomerSegment, string> = {
  bronze: 'برونزي',
  silver: 'فضي',
  gold: 'ذهبي',
};

export const roleLabel: Record<AppRole, string> = {
  admin: 'مدير النظام',
  operations_manager: 'مدير العمليات',
  branch_manager: 'مدير الفرع',
  sales: 'مبيعات',
  call_center: 'مركز الاتصال',
  driver: 'سائق',
  housing_supervisor: 'مشرف السكن',
  hr: 'الموارد البشرية',
  accountant: 'محاسب',
  external_office: 'مكتب خارجي',
};
