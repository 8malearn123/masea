/**
 * قواعد تجديد العقد — نسخة جديدة مرتبطة بالأصل (parent_contract_id + version).
 * نفس القواعد تنفّذها دالة الخادم `renew_contract` (supabase 0051)؛ هذه النسخة
 * للواجهة (أهلية الزر، التواريخ المقترحة) وللوضع التجريبي.
 *
 * - يُجدَّد العقد الساري فقط، لخدمة لها مدة، وله تاريخ نهاية.
 * - النسخة الجديدة بنفس مدة الأصل (السعر مرتبط بالمدة؛ تغيير المدة يتطلب قرار تسعير).
 * - تبدأ بعد نهاية الأصل (لا تداخل)، وافتراضيًا في اليوم التالي لنهايته.
 * - تجديد قائم واحد فقط (غير ملغى) لكل عقد؛ والإصدار = أكبر إصدار في الأصل
 *   وتجديداته السابقة (ومنها الملغاة) + ١، فلا يتكرّر رقم إصدار.
 */
import { addDays, isValidDay } from '@/features/requests/lib/period';
import {
  contractEndDate,
  contractTermLabel,
  contractTermUnit,
  inferTermCount,
} from '@/features/contracts/lib/contractTerm';
import { contractInsight, needsRenewal } from '@/features/contracts/lib/contractInsights';
import type { ContractListItem } from '@/features/contracts/types';

/** التجديدات القائمة (غير الملغاة) لعقد ما من قائمة عقود. */
export function activeRenewalsOf(id: string, rows: ContractListItem[]): ContractListItem[] {
  return rows.filter((r) => r.parent_contract_id === id && r.status !== 'cancelled');
}

/**
 * سبب منع التجديد (للخادم والواجهة)، أو null إذا جاز التجديد.
 * لا يشمل مهلة التنبيه — تلك قاعدة عرض للزر (renewalBlocker).
 */
export function renewalRuleError(
  c: ContractListItem,
  existingRenewals: ContractListItem[],
): string | null {
  if (c.status !== 'active') return 'التجديد متاح للعقود السارية فقط';
  if (contractTermUnit(c.service_code) === null) return 'هذه الخدمة بلا مدة — لا تُجدَّد';
  if (!c.end_date || !c.start_date) return 'تاريخ نهاية العقد الأصلي غير محدد';
  if (inferTermCount(c.service_code, c.start_date, c.end_date) === null) {
    return 'تعذّر تحديد مدة العقد الأصلي من تاريخَي بدايته ونهايته';
  }
  const existing = existingRenewals[0];
  if (existing) return `يوجد تجديد قائم لهذا العقد: ${existing.contract_no ?? ''}`.trim();
  return null;
}

/**
 * سبب إخفاء زر «تجديد العقد»: قواعد التجديد + أن يكون العقد داخل مهلة التنبيه
 * أو منتهيًا (يحتاج تجديدًا). null = يُعرض الزر.
 */
export function renewalBlocker(
  c: ContractListItem,
  existingRenewals: ContractListItem[],
  windowDays: number,
  now: Date = new Date(),
): string | null {
  const rule = renewalRuleError(c, existingRenewals);
  if (rule) return rule;
  if (!needsRenewal(contractInsight(c, now, windowDays).expiry)) {
    return 'لم يدخل العقد مهلة التجديد بعد';
  }
  return null;
}

/** تاريخ البداية المقترح: اليوم التالي لنهاية العقد الأصلي. */
export function defaultRenewalStart(c: ContractListItem): string {
  return c.end_date ? addDays(c.end_date, 1) : '';
}

export interface RenewalTerm {
  start_date: string;
  end_date: string;
  /** «٣ أشهر» — نفس مدة الأصل. */
  label: string;
}

/** مدة النسخة الجديدة من تاريخ بدايتها (بنفس مدة الأصل)، أو رسالة خطأ. */
export function renewalTerm(
  c: ContractListItem,
  start: string,
): { term: RenewalTerm; error: null } | { term: null; error: string } {
  const count = inferTermCount(c.service_code, c.start_date, c.end_date);
  if (count === null || !c.end_date) {
    return { term: null, error: 'تعذّر تحديد مدة العقد الأصلي' };
  }
  if (!start) return { term: null, error: 'حدّد تاريخ بداية النسخة الجديدة' };
  if (!isValidDay(start)) return { term: null, error: 'تاريخ البداية غير صالح' };
  if (start <= c.end_date) {
    return { term: null, error: 'تبدأ النسخة الجديدة بعد نهاية العقد الأصلي' };
  }
  const end = contractEndDate(c.service_code, start, count);
  if (!end) return { term: null, error: 'تعذّر حساب تاريخ نهاية النسخة الجديدة' };
  const label =
    contractTermLabel({ service_code: c.service_code, start_date: start, end_date: end }) ?? '';
  return { term: { start_date: start, end_date: end, label }, error: null };
}

/** الإصدار التالي: أكبر إصدار في الأصل وكل تجديداته (ومنها الملغاة) + ١. */
export function nextVersion(parent: ContractListItem, allRenewals: ContractListItem[]): number {
  return Math.max(parent.version, ...allRenewals.map((r) => r.version)) + 1;
}

/** نص البند في النسخة الجديدة: تاريخ البداية القديم ← الجديد (المدة نفسها). */
export function renewClauseBody(body: string, oldStart: string | null, newStart: string): string {
  return oldStart ? body.split(oldStart).join(newStart) : body;
}
