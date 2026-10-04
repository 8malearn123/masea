/**
 * Step definitions for the customer order wizard, keyed by service code.
 * A single <StepWizard> renders these — adding a new service type later
 * only means adding an entry here (and its step components).
 */
import type { ServiceCode } from '@/lib/funnel';

export interface WizardStepDef {
  key: string;
  title: string;
}

export const SERVICE_FLOWS: Record<ServiceCode, WizardStepDef[]> = {
  recruitment: [
    { key: 'nationality_profession', title: 'الجنسية والمهنة' },
    { key: 'beneficiary', title: 'نوع المستفيد' },
    { key: 'place', title: 'بيانات مكان الخدمة' },
    { key: 'package', title: 'الباقة والمدة' },
    { key: 'cv', title: 'السير المرشّحة' },
    { key: 'employer', title: 'بيانات صاحب العمل' },
    { key: 'pricing', title: 'التسعير' },
    { key: 'contract', title: 'العقد' },
    { key: 'payment', title: 'الدفع' },
    { key: 'confirm', title: 'التأكيد' },
  ],
  monthly_rental: [
    { key: 'beneficiary', title: 'نوع المستفيد' },
    { key: 'place', title: 'بيانات مكان الخدمة' },
    { key: 'duration', title: 'مدة الطلب والتواريخ' },
    { key: 'select_worker', title: 'ترشيح العاملة' },
    { key: 'customer', title: 'بيانات العميل' },
    { key: 'pricing', title: 'التسعير' },
    { key: 'contract', title: 'العقد' },
    { key: 'payment', title: 'الدفع' },
    { key: 'confirm', title: 'التأكيد' },
  ],
  daily_rental: [
    { key: 'beneficiary', title: 'نوع المستفيد' },
    { key: 'place', title: 'بيانات مكان الخدمة' },
    { key: 'dates', title: 'مدة الطلب والتواريخ' },
    { key: 'task', title: 'نوع المهمة' },
    { key: 'select_worker', title: 'ترشيح العاملة' },
    { key: 'customer', title: 'العنوان والبيانات' },
    { key: 'pricing', title: 'التسعير' },
    { key: 'payment', title: 'الدفع' },
    { key: 'confirm', title: 'التأكيد' },
  ],
  sponsorship_transfer: [
    { key: 'worker', title: 'بيانات العاملة' },
    { key: 'sponsors', title: 'الكفيل الحالي والجديد' },
    { key: 'documents', title: 'رفع المستندات' },
    { key: 'pricing', title: 'الرسوم' },
    { key: 'contract', title: 'الربط والعقد' },
    { key: 'payment', title: 'الدفع' },
    { key: 'confirm', title: 'تتبّع النقل' },
  ],
};

export const SERVICE_CODES = Object.keys(SERVICE_FLOWS) as ServiceCode[];

export function isServiceCode(v: string): v is ServiceCode {
  return (SERVICE_CODES as string[]).includes(v);
}
