/**
 * «عقد تجربة» — القالب الرسمي لنقل الكفالة (ملف الشركة contract_final_black.pdf).
 * النص كله حرفي من الملف: الترويسة، الأسطر، البنود العشرة، الإقرار، التذييل. الفراغات
 * فقط حقول `{{key}}`؛ `{{key:أ / ب}}` خيار يُبرز المختار دون تغيير النص.
 * مع قاعدة البيانات يُقرأ من contract_templates (migration 0106)؛ هذه نسخة العرض التجريبي.
 */
export const TRIAL_LAYOUT = 'trial_contract_black_v1';

export interface TrialTemplateDoc {
  code: 'transfer_trial_terms';
  version: number;
  title: string;
  layout: typeof TRIAL_LAYOUT;
  source_file: string;
  letterhead_ar: string[];
  letterhead_en: string[];
  footer: string[];
  lines: string[];
  amounts: string[];
  clauses: string[];
  declaration: string;
  signature: string[];
}

export const TRIAL_CONTRACT_V1: TrialTemplateDoc = {
  code: 'transfer_trial_terms',
  version: 1,
  title: 'عقد تجربة',
  layout: TRIAL_LAYOUT,
  source_file: 'contract_final_black.pdf',
  letterhead_ar: ['شركة ماسية الشرق للاستقدام', 'ت: 0175444404 - ج: 0539344414', 'س.ت: 5950115029'],
  letterhead_en: [
    'MASIAT AL SHARQ RECRUITMENT CO.',
    'TEL: 0175444404 - MOB: 0539344414',
    'm.alshrq.recruitment@gmail.com',
    'C.R : 5950115029',
  ],
  footer: [
    'المملكة العربية السعودية - نجران - حي دحضة - شارع الملك عبد العزيز - ت: 0175444404 - ج: 0539344414',
    'Kingdom of Saudi Arabia - Najran - Dahda District - King Abdelaziz Road - Tel: 0175444404 - Mob: 0539344414',
  ],
  lines: [
    'أنا السيد/ {{customer_name}} ( {{customer_nationality}} ) الجنسية بموجب {{id_kind:بطاقة / إقامة}}',
    'رقم ( {{id_number}} ) بتاريخ {{id_issue_date}} صادر من {{id_issue_place}}',
    'قد استلمت {{worker_kind:العاملة / السائق}} والتي تحت كفالة السيد / {{sponsor_name}}',
    'باسم {{worker_name}} الجنسية {{worker_nationality}}',
    'وذلك للتجربة ونقل الكفالة بعد الصلاحية لدي في مدة التجربة المحددة وذلك وفقاً للشروط التالية:',
  ],
  amounts: ['المبلغ الإجمالي', 'المبلغ المدفوع', 'المبلغ المتبقي'],
  clauses: [
    'يكون العمل لدي في المدينة ( {{city}} ) وسوف تكون التجربة ( {{trial_period}} ) فقط',
    'أتعهد بالمعاملة الحسنة وحسب تعاليم الدين الإسلامي الحنيف',
    'أكون مسؤول عن العاملة مسؤولية كاملة أمام الله ثم أمام النظام في فترة التجربة',
    'أقوم بتوفير السكن الملائم للعاملة والراحة الكافية',
    'في حالة عدم الصلاحية أتعهد بإعادة العاملة للمكتب قبل انتهاء مدة التجربة',
    'في حالة انتهاء مدة التجربة على الكفيل الجديد مراجعة المكتب لاستلام الجواز والإقامة خلال شهر من تاريخه والمكتب غير مسؤول عن أي جواز أو الإقامة بعد شهر من تاريخه',
    'يكون أجر العاملة في حال عدم الصلاحية أثناء فترة التجربة ( {{daily_wage}} ) ريال عن كل يوم عمل لدي',
    'في حالة انتهت فترة التجربة ولم يلتزم بتسليم الخادمة للمكتب لا يحق له المطالبة بأي مبلغ تم دفعه لأنه سوف يتم تحويل المبلغ للكفيل الأول',
    'في حالة هروب الخادمة أثناء فترة التجربة يلزم إثبات في محضر بالشرطة ويتم التفاوض مع الكفيل الأول حول التعويض بواسطة المكتب',
    'أقر بعدم وجود خادمة على اسمي وفي حال وجود أكثر من خادمة يدفع رسوم إضافية للمعقب',
  ],
  declaration:
    'بهذا أقر بأنني قد قرأت الشروط أعلاه وعلى ما جاء فيها من بنود وموافق عليها موافقة غير مشروطة',
  signature: ['الاسم :', 'التوقيع :', 'العنوان :', 'العمل :', 'الجوال :'],
};

export function isTrialContractDoc(doc: unknown): doc is TrialTemplateDoc {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    (doc as { layout?: unknown }).layout === TRIAL_LAYOUT &&
    Array.isArray((doc as { clauses?: unknown }).clauses)
  );
}

/** بيانات المستند غير الموجودة في الجداول (trial_agreements.document_fields). */
export interface TrialDocFields {
  customer_nationality: string;
  id_kind: 'بطاقة' | 'إقامة';
  id_issue_date: string;
  id_issue_place: string;
  worker_kind: 'العاملة' | 'السائق';
  sponsor_name: string;
  city: string;
  daily_wage: number;
  paid_amount: number;
  address: string;
  job: string;
  customer_no?: string | null;
}

/** كل ما يملأ الفراغات (من الجداول + document_fields). */
export interface TrialContractData {
  contract_no: string;
  customer_no: string;
  issued_on: string;
  customer_name: string;
  customer_nationality: string;
  id_kind: string;
  id_number: string;
  id_issue_date: string;
  id_issue_place: string;
  worker_kind: string;
  sponsor_name: string;
  worker_name: string;
  worker_nationality: string;
  total: number | null;
  paid: number | null;
  remaining: number | null;
  city: string;
  trial_period: string;
  daily_wage: number | null;
  address: string;
  job: string;
  mobile: string;
}

export function trialPeriodLabel(days: number): string {
  if (!(days > 0)) return '';
  if (days === 1) return 'يوم واحد';
  if (days === 2) return 'يومان';
  return days <= 10 ? `${days} أيام` : `${days} يوماً`;
}
