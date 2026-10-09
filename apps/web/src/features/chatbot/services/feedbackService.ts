/**
 * ملاحظات العملاء من المساعد (عرض تجريبي في الذاكرة — لا يُرسل لجهة حقيقية).
 * تُربط الملاحظة برقم الطلب فقط إذا كان الطلب موجودًا فعلًا؛ وإلا تُسجّل
 * «ملاحظة عامة» — لا يُختلق رقم طلب.
 */
import { getRequestFile } from '@/features/requests/api/requests.api';
import {
  listCustomerNotes,
  saveCustomerNote,
  setCustomerNoteStatus,
  type CustomerNote,
  type FeedbackStatus,
} from '@/features/chatbot/api/chatbot.api';

export const FEEDBACK_MAX = 1000;
const REQUEST_NO_RE = /REQ-[0-9A-F]{8}/i;

/** رقم طلب مكتوب داخل نص الملاحظة (إن وُجد). */
export function requestNoIn(text: string): string | null {
  const m = REQUEST_NO_RE.exec(text);
  return m ? m[0].toUpperCase() : null;
}

export interface SubmittedFeedback {
  note: CustomerNote;
  /** رقم طلب ذكره العميل أو سياق الصفحة لكنه غير موجود — سُجّلت عامة. */
  unknownRequestNo: string | null;
}

export async function submitFeedback(input: {
  kind: CustomerNote['kind'];
  body: string;
  /** سياق الطلب من الصفحة الحالية (ملف الطلب/التتبّع) إن وُجد. */
  contextRequestNo?: string | null;
}): Promise<SubmittedFeedback> {
  const body = input.body.trim();
  if (!body) throw new Error('اكتب ملاحظتك أولًا.');
  if (body.length > FEEDBACK_MAX) throw new Error(`الملاحظة لا تتجاوز ${FEEDBACK_MAX} حرف.`);
  // الرقم المكتوب في النص يقدَّم على سياق الصفحة
  const candidate = requestNoIn(body) ?? input.contextRequestNo?.trim().toUpperCase() ?? null;
  let requestNo: string | null = null;
  let unknownRequestNo: string | null = null;
  if (candidate) {
    if (await getRequestFile(candidate)) requestNo = candidate;
    else unknownRequestNo = candidate;
  }
  return { note: saveCustomerNote(input.kind, body, requestNo), unknownRequestNo };
}

export async function listFeedback(): Promise<CustomerNote[]> {
  // الأحدث أولًا؛ عند تساوي الوقت فالرقم المرجعي الأكبر (أُنشئ لاحقًا) — ترتيب ثابت
  return listCustomerNotes().sort(
    (a, b) =>
      (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

export async function updateFeedbackStatus(
  id: string,
  status: FeedbackStatus,
): Promise<CustomerNote> {
  return setCustomerNoteStatus(id, status);
}

/** نص تأكيد دقيق للعرض التجريبي — لا ادعاء بالإرسال لفريق حقيقي. */
export function feedbackConfirmation({ note, unknownRequestNo }: SubmittedFeedback): string {
  const ref = `سُجّلت ملاحظتك برقم مرجعي ${note.id}`;
  const link = note.request_no
    ? `ومرتبطة بالطلب ${note.request_no}.`
    : unknownRequestNo
      ? `كملاحظة عامة — لم نعثر على الطلب ${unknownRequestNo}.`
      : 'كملاحظة عامة غير مرتبطة بطلب.';
  return `${ref} ${link} (عرض تجريبي: تُحفظ في صندوق ملاحظات العرض ولا تُرسل لفريق خدمة عملاء حقيقي.)`;
}
