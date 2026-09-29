/** Order draft model + shared option lists for the customer wizard. */
import type { ServiceCode } from '@/lib/funnel';

export interface OrderDraft {
  service: ServiceCode;
  // beneficiary (managed lists: settings → أنواع المستفيد / أنواع المناسبات)
  beneficiaryType: string;
  beneficiaryLabel: string;
  eventType: string;
  eventLabel: string; // for the "other" event type this is the name the customer typed
  // recruitment
  nationality: string;
  profession: string;
  monthlySalary: number;
  contractMonths: number;
  // rental
  months: number;
  days: number;
  startDate: string;
  taskType: string;
  workerProfileId: string | null;
  // sponsorship transfer
  currentIqama: string;
  currentNationality: string;
  currentProfession: string;
  currentSponsor: string;
  newSponsor: string;
  documents: string[];
  // customer / employer (shared)
  customerName: string;
  nationalId: string;
  phone: string;
  address: string;
  city: string;
  branch: string;
  // contract + payment
  agreeTerms: boolean;
  paymentMethod: string;
}

/** Beneficiary type code that reveals the event-type list. */
export const BENEFICIARY_EVENT_CODE = 'event';
/** Event type code that lets the customer type the event's name. */
export const EVENT_OTHER_CODE = 'other';

/** "مناسبة أو فعالية — حفل زواج" style label for summaries. */
export function beneficiarySummary(d: OrderDraft): string {
  if (!d.beneficiaryLabel) return '—';
  return d.beneficiaryType === BENEFICIARY_EVENT_CODE && d.eventLabel
    ? `${d.beneficiaryLabel} — ${d.eventLabel}`
    : d.beneficiaryLabel;
}

export const NATIONALITIES = [
  'الفلبين',
  'إندونيسيا',
  'كينيا',
  'أوغندا',
  'بنغلاديش',
  'سريلانكا',
] as const;
export const PROFESSIONS = ['عاملة منزلية', 'طباخة', 'مربية أطفال', 'سائق'] as const;
export const TASK_TYPES = ['تنظيف', 'طبخ', 'رعاية'] as const;

export interface PaymentMethodOpt {
  key: string;
  label: string;
  icon: string;
}
export const PAYMENT_METHODS: PaymentMethodOpt[] = [
  { key: 'mada', label: 'مدى / Moyasar', icon: '💳' },
  { key: 'apple_pay', label: 'Apple Pay', icon: '' },
  { key: 'stc_pay', label: 'STC Pay', icon: '📱' },
  { key: 'tamara', label: 'تابي / تمارا (تقسيط)', icon: '🟣' },
];

/** Post-order tracking stages, per service. */
export const TRACKING_STAGES: Record<ServiceCode, string[]> = {
  recruitment: ['إصدار التأشيرة', 'الإجراءات', 'السفر', 'الوصول'],
  monthly_rental: ['تأكيد الطلب', 'تجهيز العاملة', 'المباشرة'],
  daily_rental: ['تأكيد الطلب', 'في الطريق', 'الحضور'],
  sponsorship_transfer: ['تقديم الطلب', 'مراجعة الجهات', 'الموافقة', 'إصدار الإقامة'],
};

export function emptyDraft(service: ServiceCode): OrderDraft {
  return {
    service,
    beneficiaryType: '',
    beneficiaryLabel: '',
    eventType: '',
    eventLabel: '',
    nationality: '',
    profession: '',
    monthlySalary: 1500,
    contractMonths: 24,
    months: 3,
    days: 1,
    startDate: '',
    taskType: '',
    workerProfileId: null,
    currentIqama: '',
    currentNationality: '',
    currentProfession: '',
    currentSponsor: '',
    newSponsor: '',
    documents: [],
    customerName: '',
    nationalId: '',
    phone: '',
    address: '',
    city: '',
    branch: '',
    agreeTerms: false,
    paymentMethod: 'mada',
  };
}

/** Pricing params passed to calc_price / fallback. quantity scales by duration. */
export function priceParams(d: OrderDraft): {
  nationality?: string;
  profession?: string;
  quantity: number;
} {
  switch (d.service) {
    case 'recruitment':
      return { nationality: d.nationality, profession: d.profession, quantity: 1 };
    case 'monthly_rental':
      return { nationality: d.nationality, quantity: Math.max(d.months, 1) };
    case 'daily_rental':
      return { profession: d.taskType, quantity: Math.max(d.days, 1) };
    case 'sponsorship_transfer':
      return { quantity: 1 };
    default:
      return { quantity: 1 };
  }
}
