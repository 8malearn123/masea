import type { ServiceCode } from '@/lib/funnel';
import { sar } from '@/lib/format';
import { draftPeriod, type OrderDraft } from '@/lib/orderTypes';
import { periodLabel } from '@/features/requests/lib/period';

/**
 * The contract terms shown to the customer in the order wizard («ملخص بنود
 * العقد»). The exact lines the customer accepted are stored with the order, and
 * become the clauses of the contract created from that acceptance (0060).
 */
export function contractTerms(
  service: ServiceCode,
  d: OrderDraft,
  serviceName: string,
  total: number,
): string[] {
  const period = draftPeriod(d);
  const base = [
    `نوع الخدمة: ${serviceName}.`,
    ...(period
      ? [`مدة الطلب: من ${period.startDate} إلى ${period.endDate} (${periodLabel(period)}).`]
      : []),
    `الفرع: ${d.branch || '—'}.`,
    `إجمالي القيمة شاملة الضريبة: ${sar(total)} ر.س.`,
    'العقد موثّق ومتوافق مع أنظمة وزارة الموارد البشرية ومنصة مساند.',
  ];
  if (service === 'recruitment')
    base.splice(
      1,
      0,
      `الجنسية والمهنة: ${d.nationality} — ${d.profession}.`,
      `مدة العقد: ${d.contractMonths} شهرًا.`,
    );
  if (service === 'monthly_rental')
    base.splice(1, 0, `مدة الإيجار: ${d.months} شهرًا، تجدد تلقائيًا.`);
  if (service === 'daily_rental' && period)
    base.splice(1, 0, `المهمة: ${d.taskType} لمدة ${periodLabel(period)}.`);
  if (service === 'sponsorship_transfer') base.splice(1, 0, 'يشمل إجراءات النقل عبر مساند وأبشر.');
  return base;
}

/** What the order stores about the acceptance (null when not accepted). */
export function acceptedTerms(
  d: OrderDraft,
  serviceName: string,
  total: number,
  now = new Date(),
): { accepted_terms: string[]; terms_accepted_at: string } | null {
  if (!d.agreeTerms || !d.service) return null;
  return {
    accepted_terms: contractTerms(d.service as ServiceCode, d, serviceName, total),
    terms_accepted_at: now.toISOString(),
  };
}
