import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { PAYMENT_METHODS } from '@/lib/orderTypes';
import {
  RENTAL_TEMPLATE_SERVICES,
  RENTAL_TEMPLATE_V1,
  rentalTemplateDocSchema,
  type RentalTemplateDoc,
} from '@/features/contracts/lib/rentalContract/template';
import type {
  CompanyProfile,
  RentalContractSource,
} from '@/features/contracts/lib/rentalContract/fields';
import type { ContractListItem, ContractServiceCode } from '@/features/contracts/types';

/**
 * قالب «عقد تأجير خدمات عمالية» وبياناته — فوق جداول العقود القائمة (0085):
 * contract_templates (doc + version + status) · company_tax_profile (الطرف الأول)
 * · contracts.doc_fields (لقطة بيانات الأطراف) · payments (المدفوعات).
 */
export const RENTAL_TEMPLATE_CODE = 'rental_labor_services';

export type TemplateStatus = 'draft' | 'pending_review' | 'approved' | 'retired';

export interface RentalTemplateRow {
  id: string;
  service_code: ContractServiceCode;
  name: string;
  version: number;
  status: TemplateStatus;
  content_sha256: string | null;
  approved_at: string | null;
  doc: RentalTemplateDoc;
}

export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  draft: 'مسودة',
  pending_review: 'بانتظار الاعتماد',
  approved: 'معتمد',
  retired: 'موقوف (نسخة سابقة)',
};

/** بيانات الأطراف المثبّتة مع العقد (contracts.doc_fields). */
export const docFieldsSchema = z.object({
  customer: z.object({
    full_name: z.string(),
    national_id: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    mobile: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
  }),
  worker: z
    .object({
      full_name: z.string(),
      nationality: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      passport_no: z.string().nullable().optional(),
      iqama_no: z.string().nullable().optional(),
    })
    .nullable(),
  company: z.object({
    name: z.string(),
    name_en: z.string(),
    vat_number: z.string(),
    cr_number: z.string(),
    mol_license_no: z.string(),
    phone: z.string(),
    mobile: z.string(),
    address: z.string(),
    email: z.string(),
  }),
  employee_mobile: z.string().nullable().optional(),
  work_location: z.string().nullable().optional(),
  service_label: z.string(),
});
export type DocFields = z.infer<typeof docFieldsSchema>;

export const companyProfileSchema = z.object({
  name: z.string().trim().min(3, { message: 'أدخل اسم الشركة' }),
  name_en: z.string().trim(),
  vat_number: z
    .string()
    .trim()
    .regex(/^3\d{13}3$/, { message: 'الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3' }),
  cr_number: z
    .string()
    .trim()
    .regex(/^\d{7,10}$/, { message: 'السجل التجاري أرقام فقط' }),
  mol_license_no: z.string().trim(),
  phone: z.string().trim(),
  mobile: z.string().trim(),
  address: z.string().trim(),
  email: z.union([z.literal(''), z.string().trim().email({ message: 'بريد إلكتروني غير صالح' })]),
});

/* ------------------------------ demo stores ------------------------------- */
/**
 * وضع العرض بلا Supabase: نفس بذرة 0085 (القالب بانتظار الاعتماد + بيانات
 * الطرف الأول من العقد الأصلي) في الذاكرة.
 */
const DEMO_TEMPLATES: RentalTemplateRow[] = RENTAL_TEMPLATE_SERVICES.map((s) => ({
  id: `demo-rtpl-${s}-v1`,
  service_code: s,
  name: 'عقد تأجير خدمات عمالية — النسخة 1',
  version: 1,
  status: 'pending_review',
  content_sha256: null,
  approved_at: null,
  doc: RENTAL_TEMPLATE_V1,
}));

let DEMO_COMPANY: CompanyProfile = {
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

const DEMO_DOC_FIELDS: Record<string, DocFields> = {};

/** للاختبارات فقط: يعيد مخزن العرض لبذرته. */
export function resetRentalDemoStore(): void {
  for (const t of DEMO_TEMPLATES) {
    t.status = 'pending_review';
    t.approved_at = null;
  }
  for (const k of Object.keys(DEMO_DOC_FIELDS)) delete DEMO_DOC_FIELDS[k];
}

/* -------------------------------- reads ----------------------------------- */
const rowSchema = z.object({
  id: z.string(),
  service_code: z.string(),
  name: z.string(),
  version: z.number(),
  status: z.enum(['draft', 'pending_review', 'approved', 'retired']),
  content_sha256: z.string().nullable(),
  approved_at: z.string().nullable(),
  doc: z.unknown(),
});

export async function listRentalTemplates(): Promise<RentalTemplateRow[]> {
  if (isDemoMode()) return DEMO_TEMPLATES.map((t) => ({ ...t }));
  const { data, error } = await supabase
    .from('contract_templates')
    .select('id, service_code, name, version, status, content_sha256, approved_at, doc')
    .eq('template_code', RENTAL_TEMPLATE_CODE)
    .order('version', { ascending: false });
  if (error) {
    if (isIgnorableWriteError(error.message)) return DEMO_TEMPLATES.map((t) => ({ ...t }));
    throw new Error(`تعذّر جلب قالب العقد: ${error.message}`);
  }
  return (data ?? []).map((raw) => {
    const r = rowSchema.parse(raw);
    return {
      ...r,
      service_code: r.service_code as ContractServiceCode,
      doc: rentalTemplateDocSchema.parse(r.doc),
    };
  });
}

/** القالب المعتمد الساري لخدمة (أعلى نسخة معتمدة)، أو null. */
export function approvedTemplateFor(
  rows: RentalTemplateRow[],
  service: ContractServiceCode | '' | null,
): RentalTemplateRow | null {
  return (
    rows
      .filter((r) => r.service_code === service && r.status === 'approved')
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

export async function getCompanyProfile(): Promise<CompanyProfile> {
  if (isDemoMode()) return { ...DEMO_COMPANY };
  const { data, error } = await supabase.rpc('contract_company_profile');
  if (error) {
    if (isIgnorableWriteError(error.message)) return { ...DEMO_COMPANY };
    throw new Error(`تعذّر جلب بيانات الطرف الأول: ${error.message}`);
  }
  if (!data) throw new Error('لا تملك صلاحية عرض بيانات الطرف الأول');
  return companyProfileSchema.parse(data);
}

/** رقم الجواز/الإقامة وجوال العاملة (من ملفها الخاص) — للعقد فقط. */
export async function getWorkerDoc(
  workerProfileId: string,
): Promise<{ passport_no: string | null; iqama_no: string | null; phone: string | null } | null> {
  if (isDemoMode() || isDemoId(workerProfileId)) return null;
  const { data, error } = await supabase.rpc('contract_worker_doc', { p_worker: workerProfileId });
  if (error || !data) return null;
  const d = data as Record<string, string | null>;
  return {
    passport_no: d.passport_no ?? null,
    iqama_no: d.iqama_no ?? null,
    phone: d.phone ?? null,
  };
}

/* ------------------------------- writes ----------------------------------- */
/** اعتماد نسخة القالب رسمياً (لكل خدمات التأجير) — contracts.approve. */
export async function approveRentalTemplate(version: number): Promise<void> {
  if (isDemoMode()) {
    for (const t of DEMO_TEMPLATES)
      if (t.version === version && t.status === 'pending_review') {
        t.status = 'approved';
        t.approved_at = new Date().toISOString();
      }
    return;
  }
  const rows = (await listRentalTemplates()).filter(
    (r) => r.version === version && (r.status === 'pending_review' || r.status === 'draft'),
  );
  for (const r of rows) {
    const { error } = await supabase.rpc('approve_contract_template', { p_template_id: r.id });
    if (error) throw new Error(error.message.replace(/^.*?\bERROR:\s*/, ''));
  }
}

export async function updateCompanyProfile(p: CompanyProfile): Promise<CompanyProfile> {
  const parsed = companyProfileSchema.parse(p);
  if (isDemoMode()) {
    DEMO_COMPANY = { ...parsed };
    return { ...DEMO_COMPANY };
  }
  const { data, error } = await supabase.rpc('update_contract_company_profile', { p: parsed });
  if (error) throw new Error(error.message.replace(/^.*?\bERROR:\s*/, ''));
  return companyProfileSchema.parse(data);
}

/** يثبّت بيانات الأطراف في مسودة العقد (set_contract_doc_fields). */
export async function setContractDocFields(contractId: string, fields: DocFields): Promise<void> {
  const parsed = docFieldsSchema.parse(fields);
  if (isDemoMode() || isDemoId(contractId)) {
    DEMO_DOC_FIELDS[contractId] = parsed;
    return;
  }
  const { error } = await supabase.rpc('set_contract_doc_fields', {
    p_contract_id: contractId,
    p_fields: parsed,
  });
  if (error)
    throw new Error(`تعذّر حفظ بيانات العقد: ${error.message.replace(/^.*?\bERROR:\s*/, '')}`);
}

/* ------------------------- document for printing -------------------------- */
export interface RentalDocument {
  template: RentalTemplateRow;
  source: RentalContractSource;
}

function methodLabel(m: string | null): string {
  if (!m) return '—';
  return PAYMENT_METHODS.find((x) => x.key === m)?.label ?? m;
}

async function contractExtras(id: string): Promise<{
  doc_fields: unknown;
  payments: { paid_at: string; amount: number; method: string }[];
}> {
  if (isDemoMode() || isDemoId(id))
    return { doc_fields: DEMO_DOC_FIELDS[id] ?? null, payments: [] };
  const [c, p] = await Promise.all([
    supabase.from('contracts').select('doc_fields').eq('id', id).maybeSingle(),
    supabase
      .from('payments')
      .select('paid_at, amount, method')
      .eq('contract_id', id)
      .order('paid_at'),
  ]);
  return {
    doc_fields: (c.data as { doc_fields?: unknown } | null)?.doc_fields ?? null,
    payments: ((p.data ?? []) as { paid_at: string; amount: number; method: string | null }[]).map(
      (x) => ({ paid_at: x.paid_at, amount: Number(x.amount), method: methodLabel(x.method) }),
    ),
  };
}

/**
 * مستند عقد تأجير صادر على القالب المنظَّم، أو null للعقود القديمة (تبقى
 * تُطبع بقالبها السابق دون أي تغيير).
 */
export async function loadRentalDocument(c: ContractListItem): Promise<RentalDocument | null> {
  if (!c.template_id) return null;
  const templates = await listRentalTemplates();
  const template = templates.find((t) => t.id === c.template_id);
  if (!template) return null;
  const extras = await contractExtras(c.id);
  const snap = docFieldsSchema.safeParse(extras.doc_fields);
  const company = snap.success ? snap.data.company : await getCompanyProfile();
  const f = snap.success ? snap.data : null;
  return {
    template,
    source: {
      contract: {
        contract_no: c.contract_no,
        issued_on: c.issue_date ?? c.created_at,
        service_code: c.service_code,
        start_date: c.start_date,
        end_date: c.end_date,
        base_amount: c.base_amount,
        vat_amount: c.vat_amount,
        total_amount: c.total_amount,
        amount_paid: c.amount_paid,
        notes: c.notes ?? null,
        work_location: f?.work_location ?? null,
      },
      customer: f?.customer ?? { full_name: c.customer_name ?? '' },
      worker: f?.worker ?? (c.worker_name ? { full_name: c.worker_name } : null),
      company,
      employee_mobile: f?.employee_mobile ?? null,
      payments: extras.payments,
      service_label: f?.service_label ?? '',
    },
  };
}
