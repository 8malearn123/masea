import report from './compliance.v1.json';
import type { RentalTemplateDoc } from './template';

/**
 * فحوص المطابقة مع العقد الأصلي (بنود العقد.pdf). البصمة المتوقعة والترتيب
 * والترقيم مأخوذة من الأصل كما هو — أي تعديل على نص القالب يُسقط الفحص.
 */
export const COMPLIANCE_REPORT = report;

/** بصمة النص القانوني للنسخة 1 المطابقة للأصل (مطابقة لـ migration 0085). */
export const V1_FINGERPRINT = '2c17375e788419775a8cca949f6d139fcb110c216bad981b899c9739446c1243';

/** ترتيب الأقسام في الأصل. */
export const ORIGINAL_SECTION_ORDER = [
  'title',
  'first_party',
  'second_party',
  'preamble',
  'worker_term',
  'clause_1',
  'clause_2',
  'clause_3',
  'clause_4',
  'clause_5',
  'clause_6',
  'signatures',
] as const;

/** ترقيم الفقرات كما ورد في الأصل (null = فقرة بلا رقم في الأصل). */
export const ORIGINAL_NUMBERING: Record<string, (string | null)[]> = {
  clause_1: ['1', '2', '3'],
  clause_2: ['1', '2', '3', '4'],
  clause_3: ['1', '2', '3', '4', '5', '6', null, '8', '9', '10', '11', '12'],
  clause_4: ['1'],
  clause_5: ['1'],
};

export interface ComplianceCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export function complianceChecks(
  doc: RentalTemplateDoc,
  fingerprint: string | null,
): ComplianceCheck[] {
  const ids = doc.sections.map((s) => s.id);
  const orderOk =
    ids.length === ORIGINAL_SECTION_ORDER.length &&
    ORIGINAL_SECTION_ORDER.every((id, i) => ids[i] === id);
  const numbering = Object.entries(ORIGINAL_NUMBERING).map(([sid, expected]) => {
    const got = (doc.sections.find((s) => s.id === sid)?.blocks ?? [])
      .filter((b) => b.t === 'clause')
      .map((b) => (b.t === 'clause' ? b.no : null));
    return { sid, ok: JSON.stringify(got) === JSON.stringify(expected) };
  });
  const fullText = doc.sections
    .flatMap((s) => s.blocks)
    .map((b) => ('text' in b ? b.text : ''))
    .join('\n');
  const terms = COMPLIANCE_REPORT.legal_terms.map((t) => ({ ...t, ok: fullText.includes(t.text) }));
  const clauses = doc.sections.flatMap((s) => s.blocks).filter((b) => b.t === 'clause').length;
  const s = COMPLIANCE_REPORT.stats;

  return [
    {
      label: 'الأقسام الاثنا عشر بترتيب الأصل',
      ok: orderOk,
      detail: orderOk ? `${ids.length} قسماً بنفس الترتيب` : `الترتيب الحالي: ${ids.join('، ')}`,
    },
    {
      label: 'ترقيم الفقرات مطابق للأصل',
      ok: numbering.every((n) => n.ok),
      detail: numbering.every((n) => n.ok)
        ? `${clauses} فقرة — الترقيم كما في الأصل (بما فيه الفقرة غير المرقّمة في البند الثالث)`
        : `اختلاف في: ${numbering
            .filter((n) => !n.ok)
            .map((n) => n.sid)
            .join('، ')}`,
    },
    {
      label: 'المبالغ والمدد والالتزامات دون تغيير',
      ok: terms.every((t) => t.ok),
      detail: terms.every((t) => t.ok)
        ? `${terms.length} قيمة/مدة موجودة بنصها الأصلي`
        : `مفقود: ${terms
            .filter((t) => !t.ok)
            .map((t) => t.label)
            .join('، ')}`,
    },
    {
      label: 'مطابقة الحروف وعلامات الترقيم مع ملف الأصل',
      ok: s.character_differences === 0 && s.characters_original === s.characters_template,
      detail: `${s.characters_template} حرفاً مقابل ${s.characters_original} في الأصل — ${s.character_differences} اختلاف`,
    },
    {
      label: 'مطابقة الكلمات بالترتيب (النصوص والبنود)',
      ok: s.narrative_word_differences === 0,
      detail: `${s.narrative_word_differences} اختلاف في المتن`,
    },
    {
      label: 'جداول البيانات مطابقة سطراً بسطر',
      ok: s.table_rows === s.table_rows_matched,
      detail: `${s.table_rows_matched} من ${s.table_rows} صفاً`,
    },
    {
      label: 'بصمة النص القانوني (SHA-256)',
      ok: fingerprint === V1_FINGERPRINT,
      detail: fingerprint ? `${fingerprint.slice(0, 16)}…` : 'لم تُحسب بعد',
    },
  ];
}
