import type { BadgeTone } from '@/shared/ui/Badge';
import type { DirectoryCustomer } from '@/features/call-center/data/directory';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RetentionOffer {
  id: string;
  label: string;
  detail: string;
}

export interface RetentionAssessment {
  risk: RiskLevel;
  score: number;
  reasons: string[];
  action: string;
  offers: RetentionOffer[];
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'منخفض',
  medium: 'متوسط',
  high: 'مرتفع',
};

export const RISK_TONE: Record<RiskLevel, BadgeTone> = {
  low: 'success',
  medium: 'gold',
  high: 'danger',
};

export const RETENTION_OFFERS: RetentionOffer[] = [
  { id: 'renew15', label: 'خصم تجديد ١٥٪', detail: 'خصم على تجديد العقد الحالي.' },
  { id: 'free_swap', label: 'استبدال مجاني', detail: 'استبدال العاملة دون رسوم خلال فترة الضمان.' },
  { id: 'upgrade', label: 'ترقية الخدمة', detail: 'ترقية الباقة مع نفس القيمة لمدة شهر.' },
  { id: 'loyalty_x2', label: 'مضاعفة نقاط الولاء', detail: 'مضاعفة النقاط على العملية القادمة.' },
  { id: 'priority', label: 'خدمة عملاء مخصّصة', detail: 'مدير حساب ومتابعة ذات أولوية.' },
];

function offer(...ids: string[]): RetentionOffer[] {
  return RETENTION_OFFERS.filter((o) => ids.includes(o.id));
}

/**
 * Churn-risk assessment from CRM signals. `openTickets` = count of unresolved
 * tickets for this customer. Returns a risk level, the reasons behind it, the
 * recommended next action, and suitable retention offers.
 */
export function assessCustomer(c: DirectoryCustomer, openTickets: number): RetentionAssessment {
  let score = 0;
  const reasons: string[] = [];

  if (openTickets > 0) {
    score += 40;
    reasons.push(`${openTickets} تذكرة مفتوحة دون حل`);
  }
  const complaints = c.history.filter(
    (h) => h.topic.includes('شكوى') || h.topic.includes('تأخر'),
  ).length;
  if (complaints > 0) {
    score += 20;
    reasons.push('سجلّ شكاوى/تأخر سابق');
  }
  if (c.worker?.status === 'بانتظار المباشرة') {
    score += 20;
    reasons.push('العاملة لم تباشر بعد');
  }
  if (c.open_contracts === 0) {
    score += 25;
    reasons.push('لا يوجد عقد نشط حالياً — احتمال فقد');
  }
  if (c.loyalty_points < 300) {
    score += 10;
    reasons.push('تفاعل وولاء منخفض');
  }
  if (reasons.length === 0) reasons.push('علاقة مستقرة دون مؤشرات خطر');

  const risk: RiskLevel = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';

  let action: string;
  let offers: RetentionOffer[];
  if (risk === 'high') {
    action =
      openTickets > 0
        ? 'تصعيد فوري لمدير العمليات + تعويض، ومتابعة خلال ٢٤ ساعة مع اتصال مدير الحساب.'
        : 'اتصال احتفاظ من مدير الحساب وعرض حافز للتجديد قبل أن يغادر العميل.';
    offers = offer('free_swap', 'renew15', 'priority');
  } else if (risk === 'medium') {
    action = 'متابعة استباقية خلال ٤٨ ساعة + استطلاع رضا، وجدولة معاودة مؤكدة.';
    offers = offer('renew15', 'upgrade', 'loyalty_x2');
  } else {
    action = 'علاقة جيدة — اعرض تجديداً مبكراً أو ترقية لزيادة الولاء.';
    offers = offer('loyalty_x2', 'upgrade');
  }

  return { risk, score: Math.min(score, 100), reasons, action, offers };
}
