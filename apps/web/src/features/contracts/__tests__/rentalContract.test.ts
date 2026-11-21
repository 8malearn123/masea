/**
 * «عقد تأجير خدمات عمالية» — القالب الإلكتروني المطابق لعقد ماسية الشرق الأصلي.
 * يحرس: النص الحرفي (بصمة + مقتطفات)، الترتيب والترقيم، تطابق بذرة 0085 مع
 * الملف، العرض الكامل لكل البنود، وثبات البنود مهما تغيّرت الباقة/المدة/الجنسية.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import templateJson from '@/features/contracts/lib/rentalContract/template.v1.json';
import {
  RENTAL_TEMPLATE_V1,
  legalClausesOf,
  templateFieldKeys,
  templateFingerprint,
} from '@/features/contracts/lib/rentalContract/template';
import {
  buildRentalContractData,
  dmy,
  durationLabel,
  placeholderData,
  weekdayAr,
  type RentalContractSource,
} from '@/features/contracts/lib/rentalContract/fields';
import {
  buildRentalContractHtml,
  escapeHtml,
} from '@/features/contracts/lib/rentalContract/render';
import {
  ORIGINAL_SECTION_ORDER,
  V1_FINGERPRINT,
  complianceChecks,
} from '@/features/contracts/lib/rentalContract/compliance';
import {
  approveRentalTemplate,
  approvedTemplateFor,
  listRentalTemplates,
  loadRentalDocument,
  resetRentalDemoStore,
  setContractDocFields,
} from '@/features/contracts/api/rentalContract.api';
import type { ContractListItem } from '@/features/contracts/types';

const doc = RENTAL_TEMPLATE_V1;

const company = {
  name: 'شركة ماسية الشرق للاستقدام',
  name_en: 'Masiat Alsharq For Recruitment Company',
  vat_number: '311499536700003',
  cr_number: '5950115029',
  mol_license_no: '4018961',
  phone: '0175444404',
  mobile: '0539344414',
  address: 'نجران- حي دحضه – شارع الملك عبدالعزيز',
  email: 'm.alshrq.recruitment@gmail.com',
};

function source(
  over: Partial<RentalContractSource['contract']> = {},
  nationality = 'الفلبين',
): RentalContractSource {
  return {
    contract: {
      contract_no: 'MAS-2026-05312',
      issued_on: '2026-11-16T10:14:16',
      service_code: 'daily_rental',
      start_date: '2026-11-16',
      end_date: '2026-11-18',
      base_amount: 521.74,
      vat_amount: 78.26,
      total_amount: 600,
      amount_paid: 400,
      notes: null,
      work_location: 'نجران - حي الفيصلية',
      ...over,
    },
    customer: {
      full_name: 'نورة سعد آل منصور',
      national_id: '1048823571',
      phone: '0551234870',
      city: 'نجران',
    },
    worker: { full_name: 'MARIA LOURDES SANTOS', nationality, iqama_no: '2471183390' },
    company,
    employee_mobile: '0503318820',
    payments: [{ paid_at: '2026-11-16T10:20:00', amount: 400, method: 'مدى' }],
    service_label: 'تأجير يومي — 3 يوم',
  };
}

const render = (src: RentalContractSource) =>
  buildRentalContractHtml(doc, buildRentalContractData(src), { logoUrl: 'logo.jpg' });

/** النص القانوني المطبوع (عناوين/فقرات/بنود) بترتيبه من HTML. */
function printedLegal(html: string): string[] {
  const out: string[] = [];
  const re = /<(h1|h2|p) class="(doc-title|sec|para|clause)"[^>]*>([\s\S]*?)<\/\1>/g;
  for (const m of html.matchAll(re)) out.push((m[3] ?? '').replace(/<[^>]+>/g, ''));
  return out;
}

describe('القالب — النص الحرفي للأصل', () => {
  it('بصمة النص القانوني ثابتة (أي تعديل على البنود يُسقط الاختبار)', async () => {
    expect(await templateFingerprint(doc)).toBe(V1_FINGERPRINT);
  });

  it('الأقسام الاثنا عشر بترتيب الأصل', () => {
    expect(doc.sections.map((s) => s.id)).toEqual([...ORIGINAL_SECTION_ORDER]);
    expect(doc.title).toBe('عقد تأجير خدمات عمالية');
  });

  it('مقتطفات حرفية من الأصل — دون تصحيح', () => {
    const all = JSON.stringify(doc.sections);
    for (const t of [
      'البند الأول/ قيمه العقد ومده س ر يان العقد:',
      'البند ال را بع/ المنازعات والخلافات:',
      'البند الثالث / التزامات الطرف الثاني:',
      'البند السادس/ نسخ العقد',
      'يلتزم الطرف الأول توفير البديل للطرف الثاني في حال رفض العاملة العمل او مرضها.',
      'لأي سبب كان )استبدال- نهاية عقد...- إلخ( أن يقوم بتسليم العمالة الي مقر شركه الطرف الأول.',
      'فأن الطرف الأول يلتزم بدفع مبلغ وقدره 300 ﷼ عن كل يوم تأخير',
      'يتم استرجاع المبلغ في مده أقصاها 7 ايام',
      'واذا لم يحل خلال ) (15 خمسة عشر يوما',
      'وهما بكامل أهليتهما المعتبة شرعا ونظاما ،على أن يقوم',
      'فإنه سيتم تطبق ما هو وارد في الفقرة رقم (11) من البند الثالث.',
      'وبموافقتهما الصريحة على كل ما ورد فيه. وجري التوقيع على ذلك.',
    ])
      expect(all).toContain(t);
  });

  it('الفقرة غير المرقّمة في البند الثالث تبقى بلا رقم ولا يُعاد الترقيم', () => {
    const nos = doc.sections
      .find((s) => s.id === 'clause_3')
      ?.blocks.flatMap((b) => (b.t === 'clause' ? [b.no] : []));
    expect(nos).toEqual(['1', '2', '3', '4', '5', '6', null, '8', '9', '10', '11', '12']);
  });

  it('فحوص المطابقة كلها ناجحة', async () => {
    const checks = complianceChecks(doc, await templateFingerprint(doc));
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(7);
  });

  it('بذرة migration 0085 هي نفس ملف القالب حرفياً وبنفس البصمة', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../../../../supabase/migrations/0085_rental_contract_template.sql'),
      'utf8',
    );
    const seeded = /\$tpl\$([\s\S]*?)\$tpl\$/.exec(sql)?.[1] ?? '';
    expect(JSON.parse(seeded)).toEqual(templateJson);
    expect(sql).toContain(`'${V1_FINGERPRINT}'`);
    expect(sql).toContain("'pending_review'"); // لا اعتماد تلقائي
  });
});

describe('التعبئة التلقائية — الحقول فقط تتغيّر', () => {
  it('صيغ التاريخ واليوم والمدة كما في الأصل', () => {
    expect(dmy('2026-11-16')).toBe('16-11-2026');
    expect(weekdayAr('2026-11-16')).toBe('الاثنين');
    expect(durationLabel('daily_rental', '2026-11-16', '2026-11-16')).toBe('1 يوم');
    expect(durationLabel('monthly_rental', '2026-11-01', '2027-01-31')).toBe('3 شهر');
  });

  it('المدفوع والمتبقي من العقد، والجنسية ورقم الإقامة من العاملة', () => {
    const f = buildRentalContractData(source()).fields;
    expect(f.total).toBe('600.00');
    expect(f.paid).toBe('400.00');
    expect(f.remaining).toBe('200.00');
    expect(f.worker_nationality).toBe('الفلبين');
    expect(f.worker_doc_no).toBe('2471183390');
    expect(f.contract_weekday).toBe('الاثنين');
    expect(f.duration).toBe('3 يوم');
  });

  it('كل حقل في القالب له قيمة أو اسم معاينة', () => {
    const keys = templateFieldKeys(doc);
    const f = buildRentalContractData(source()).fields;
    for (const k of keys) expect(Object.keys(f)).toContain(k);
    expect(Object.keys(placeholderData(keys).fields).sort()).toEqual(keys);
  });
});

describe('المستند المطبوع', () => {
  it('يطبع كل البنود والفقرات بنصها وترتيبها دون أي حقل غير معبّأ', () => {
    const html = render(source());
    expect(html).not.toContain('{{');
    const expected = doc.sections.flatMap((s) =>
      s.blocks.flatMap((b) =>
        b.t === 'title' || b.t === 'heading' || b.t === 'para'
          ? [b.text]
          : b.t === 'clause'
            ? [b.no ? `${b.no} ${b.text}` : b.text]
            : [],
      ),
    );
    expect(printedLegal(html)).toEqual(expected.map((t) => escapeHtml(t)));
    expect(html).toContain('توقيع الموظف');
    expect(html).toContain('توقيع العميل');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('size:A4');
  });

  it('البنود القانونية لا تتغيّر بتغيّر الباقة أو المدة أو الجنسية', () => {
    const a = render(source());
    const b = render(
      source(
        {
          service_code: 'monthly_rental',
          start_date: '2026-12-01',
          end_date: '2027-05-31',
          total_amount: 9000,
          base_amount: 7826.09,
          vat_amount: 1173.91,
        },
        'إندونيسيا',
      ),
    );
    const legal = (h: string) =>
      printedLegal(h).filter((t) => !t.startsWith('رقم العقد') && !t.startsWith('إنه في يوم'));
    expect(legal(a)).toEqual(legal(b));
    expect(legal(a).length).toBe(legalClausesOf(doc).length + 1); // + العنوان
  });

  it('الحقل الفارغ يبقى فارغاً كما في الأصل (لا نص بديل داخل العقد)', () => {
    const src = source({ work_location: null });
    const html = render({ ...src, employee_mobile: null });
    expect(html).toContain('مكان العمل : </td>');
    expect(html).toContain('رقم جوال الموظف المسؤول : </td>');
  });
});

describe('الاعتماد والربط (الوضع التجريبي)', () => {
  afterEach(() => resetRentalDemoStore());

  it('القالب بانتظار الاعتماد ولا يُستخدم قبل اعتماده', async () => {
    const rows = await listRentalTemplates();
    expect(rows.map((r) => r.status)).toEqual(['pending_review', 'pending_review']);
    expect(approvedTemplateFor(rows, 'daily_rental')).toBeNull();
    await approveRentalTemplate(1);
    const after = await listRentalTemplates();
    expect(approvedTemplateFor(after, 'daily_rental')?.version).toBe(1);
    expect(approvedTemplateFor(after, 'monthly_rental')?.version).toBe(1);
  });

  it('عقد صادر على القالب يُحمَّل ببيانات الأطراف المثبّتة؛ القديم يبقى بقالبه', async () => {
    const rows = await listRentalTemplates();
    const tpl = rows.find((r) => r.service_code === 'daily_rental');
    const base = {
      id: 'local-rt-1',
      contract_no: 'MAS-2026-05312',
      service_code: 'daily_rental',
      customer_id: 'cust-1',
      worker_id: null,
      branch_id: 'نجران',
      created_by: null,
      start_date: '2026-11-16',
      end_date: '2026-11-18',
      base_amount: 521.74,
      vat_amount: 78.26,
      total_amount: 600,
      gross_amount: 521.74,
      discount_amount: 0,
      promotion_id: null,
      amount_paid: 400,
      status: 'draft',
      version: 1,
      parent_contract_id: null,
      signed_at: null,
      created_at: '2026-11-16T10:14:16Z',
      musaned_contract_no: null,
      assigned_office_id: null,
      assigned_at: null,
      recruitment_stage: null,
      visa_number: null,
      expected_arrival_date: null,
      flight_no: null,
      terms_accepted_at: null,
      source_request_no: null,
      customer_name: 'نورة سعد آل منصور',
      worker_name: null,
    } as const;
    const s = source();
    await setContractDocFields('local-rt-1', {
      customer: s.customer,
      worker: s.worker,
      company,
      employee_mobile: '0503318820',
      work_location: 'نجران - حي الفيصلية',
      service_label: s.service_label,
    });
    const loaded = await loadRentalDocument({
      ...base,
      template_id: tpl?.id ?? null,
    } as ContractListItem);
    expect(loaded?.template.doc.title).toBe('عقد تأجير خدمات عمالية');
    expect(loaded?.source.customer.national_id).toBe('1048823571');
    expect(loaded?.source.contract.amount_paid).toBe(400);
    expect(await loadRentalDocument({ ...base, template_id: null } as ContractListItem)).toBeNull();
  });
});
