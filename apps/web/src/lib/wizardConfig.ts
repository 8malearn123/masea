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

/** First step of every flow — who the service is for (منزل، منشأة، مناسبة…). */
const BENEFICIARY_STEP: WizardStepDef = { key: 'beneficiary', title: 'نوع المستفيد' };

export const SERVICE_FLOWS: Record<ServiceCode, WizardStepDef[]> = {
  recruitment: [
    BENEFICIARY_STEP,
    { key: 'nationality_profession', title: 'الجنسية والمهنة' },
    { key: 'package', title: 'تفاصيل الباقة' },
    { key: 'cv', title: 'اختيار السيرة' },
    { key: 'employer', title: 'بيانات صاحب العمل' },
    { key: 'pricing', title: 'التسعير' },
    { key: 'contract', title: 'العقد' },
    { key: 'payment', title: 'الدفع' },
    { key: 'confirm', title: 'التأكيد' },
  ],
  monthly_rental: [
    BENEFICIARY_STEP,
    { key: 'select_worker', title: 'اختيار العاملة' },
    { key: 'duration', title: 'مدة الإيجار' },
    { key: 'customer', title: 'بيانات العميل' },
    { key: 'pricing', title: 'التسعير' },
    { key: 'contract', title: 'العقد' },
    { key: 'payment', title: 'الدفع' },
    { key: 'confirm', title: 'التأكيد' },
  ],
  daily_rental: [
    BENEFICIARY_STEP,
    { key: 'dates', title: 'التواريخ والأيام' },
    { key: 'task', title: 'نوع المهمة' },
    { key: 'customer', title: 'العنوان والبيانات' },
    { key: 'pricing', title: 'التسعير' },
    { key: 'payment', title: 'الدفع' },
    { key: 'confirm', title: 'التأكيد' },
  ],
  sponsorship_transfer: [
    BENEFICIARY_STEP,
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
