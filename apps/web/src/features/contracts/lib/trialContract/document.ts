import type { TrialDocument } from '@/features/contracts/api/trials.api';
import { buildTrialContractHtml, type TrialRenderOptions } from './render';
import {
  isTrialContractDoc,
  trialPeriodLabel,
  type TrialContractData,
  type TrialTemplateDoc,
} from './template';

/** بيانات العقد من مستند الخادم (trial_document) — نفس المصدر للمعاينة والطباعة والقبول. */
export function trialDataFromDocument(d: TrialDocument): TrialContractData {
  const f = d.fields ?? {};
  const paid = f.paid_amount ?? null;
  return {
    contract_no: d.contract_no ?? '',
    customer_no: f.customer_no ?? '',
    issued_on: d.issued_on ?? '',
    customer_name: d.customer_name ?? '',
    customer_nationality: f.customer_nationality ?? '',
    id_kind: f.id_kind ?? '',
    id_number: d.customer_national_id ?? '',
    id_issue_date: f.id_issue_date ?? '',
    id_issue_place: f.id_issue_place ?? '',
    worker_kind: f.worker_kind ?? '',
    sponsor_name: f.sponsor_name ?? '',
    worker_name: d.worker_name ?? '',
    worker_nationality: d.nationality ?? '',
    total: d.total_amount ?? null,
    paid,
    remaining: paid == null ? null : Math.round((d.total_amount - paid) * 100) / 100,
    city: f.city ?? '',
    trial_period: trialPeriodLabel(d.trial_days),
    daily_wage: f.daily_wage ?? null,
    address: f.address ?? '',
    job: f.job ?? '',
    mobile: d.customer_phone ?? '',
  };
}

/** القالب المحفوظ مع التجربة إن كان عقد التجربة الرسمي (التجارب الأقدم تبقى بعرضها). */
export function trialTemplateOf(d: Pick<TrialDocument, 'template'>): TrialTemplateDoc | null {
  return isTrialContractDoc(d.template) ? d.template : null;
}

export function trialDocumentHtml(d: TrialDocument, opts: TrialRenderOptions = {}): string | null {
  const tpl = trialTemplateOf(d);
  return tpl ? buildTrialContractHtml(tpl, trialDataFromDocument(d), opts) : null;
}
