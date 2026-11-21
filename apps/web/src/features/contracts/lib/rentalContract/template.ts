import { z } from 'zod';
import templateV1 from './template.v1.json';

/**
 * «عقد تأجير خدمات عمالية» — القالب الإلكتروني لعقد ماسية الشرق الأصلي.
 *
 * المصدر الوحيد للنص: `template.v1.json` (يُزرع نفسه في قاعدة البيانات عبر
 * migration 0085 ويُقارَن بالأصل في الاختبارات). النصوص القانونية ثابتة حرفياً؛
 * المتغيّر هو الحقول بين {{ }} فقط. أي تعديل على البنود = نسخة قالب جديدة
 * (version + 1) تُعتمد رسمياً — لا تعديل في المكان.
 */

const text = z.string().min(1);
const cell = z.string();

export const templateBlockSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('title'), text }),
  z.object({ t: z.literal('line'), text }),
  z.object({ t: z.literal('heading'), text }),
  z.object({ t: z.literal('para'), text }),
  /** فقرة مرقّمة — `no: null` لفقرة وردت في الأصل بلا رقم (تُنقل كما هي). */
  z.object({ t: z.literal('clause'), no: z.string().nullable(), text }),
  z.object({ t: z.literal('grid'), rows: z.array(z.array(cell).min(1)).min(1) }),
  z.object({ t: z.literal('signatures'), items: z.array(text).min(1) }),
]);
export type TemplateBlock = z.infer<typeof templateBlockSchema>;

export const coverBlockSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('brand'), ar: z.array(cell), en: z.array(cell) }),
  z.object({ t: z.literal('kv'), rows: z.array(z.array(cell).length(4)) }),
  z.object({ t: z.literal('items'), headers: z.array(text).length(6) }),
  z.object({ t: z.literal('payments'), title: text, headers: z.array(text).length(3) }),
  z.object({ t: z.literal('qr') }),
  z.object({ t: z.literal('welcome'), text }),
]);
export type CoverBlock = z.infer<typeof coverBlockSchema>;

export const templateSectionSchema = z.object({
  id: z.string().min(1),
  label: text,
  blocks: z.array(templateBlockSchema).min(1),
});
export type TemplateSection = z.infer<typeof templateSectionSchema>;

export const rentalTemplateDocSchema = z.object({
  code: z.string().min(1),
  version: z.number().int().positive(),
  title: text,
  source: z.object({ file: z.string(), pages: z.number().int(), note: z.string() }),
  cover: z.array(coverBlockSchema),
  sections: z.array(templateSectionSchema).min(1),
});
export type RentalTemplateDoc = z.infer<typeof rentalTemplateDocSchema>;

/** النسخة 1 المطابقة للأصل (مُتحقَّق منها عند التحميل — أي عطب في الملف يفشل مبكراً). */
export const RENTAL_TEMPLATE_V1: RentalTemplateDoc = rentalTemplateDocSchema.parse(templateV1);

/** الخدمات التي يُصدر لها هذا العقد (التأجير بأنواعه). */
export const RENTAL_TEMPLATE_SERVICES = ['monthly_rental', 'daily_rental'] as const;

/** كل الحقول المتغيّرة التي يستعملها القالب ({{key}}). */
export function templateFieldKeys(doc: RentalTemplateDoc): string[] {
  const keys = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(/\{\{(\w+)\}\}/g)) if (m[1]) keys.add(m[1]);
  };
  for (const b of doc.cover) {
    if (b.t === 'brand') [...b.ar, ...b.en].forEach(scan);
    if (b.t === 'kv') b.rows.flat().forEach(scan);
  }
  for (const s of doc.sections)
    for (const b of s.blocks) {
      if ('text' in b) scan(b.text);
      if (b.t === 'grid') b.rows.flat().forEach(scan);
    }
  return [...keys].sort();
}

/**
 * النص الثابت فقط (بلا قيم الحقول) بترتيبه — أساس البصمة والمقارنة. نفس
 * الترتيب الذي يُطبع به العقد.
 */
export function legalTextOf(doc: RentalTemplateDoc): string[] {
  const out: string[] = [];
  for (const s of doc.sections)
    for (const b of s.blocks) {
      if (b.t === 'clause') out.push(b.no ? `${b.no} ${b.text}` : b.text);
      else if (b.t === 'grid') b.rows.forEach((r) => out.push(r.join(' | ')));
      else if (b.t === 'signatures') out.push(b.items.join(' | '));
      else out.push(b.text);
    }
  return out;
}

/** بصمة SHA-256 للنص القانوني — تُخزَّن مع القالب ومع لقطة كل عقد. */
export async function templateFingerprint(doc: RentalTemplateDoc): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(doc.sections));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * البنود القانونية الخالصة (عناوين البنود + الفقرات + التمهيد) بلا أي حقل
 * متغيّر — تُحفظ في contract_clauses مع كل عقد كلقطة نصية.
 */
export function legalClausesOf(doc: RentalTemplateDoc): string[] {
  const out: string[] = [];
  for (const s of doc.sections)
    for (const b of s.blocks) {
      if (b.t === 'heading' || b.t === 'para') out.push(b.text);
      else if (b.t === 'clause') out.push(b.no ? `${b.no} ${b.text}` : b.text);
    }
  return out.filter((t) => !t.includes('{{'));
}
