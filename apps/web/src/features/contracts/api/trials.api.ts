/**
 * «تجربة عاملة بغرض نقل الخدمات» — مسار مستقل (0092).
 * - مع قاعدة البيانات: دوال الخادم (الرمز يُحفظ مُجزّأً، التحقق والقبول في الـ backend).
 * - الوضع التجريبي: مخزن في الذاكرة بنفس القواعد.
 * القبول هنا لا يُعد عقد نقل خدمات ولا يغني عن إجراءات منصة مساند.
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { useAuth } from '@/store/auth';
import { configValue, listConfig } from '@/features/settings/api/settings.api';
import { demoLogOp, listLookups } from '@/features/contracts/api/contractOps.api';
import { createTrialContract, demoMutateContract } from '@/features/contracts/api/contracts.api';
import {
  TRIAL_CONTRACT_V1,
  isTrialContractDoc,
  type TrialDocFields,
  type TrialTemplateDoc,
} from '@/features/contracts/lib/trialContract/template';

export type TrialStatus =
  | 'draft'
  | 'awaiting_acceptance'
  | 'accepted'
  | 'awaiting_handover'
  | 'in_trial'
  | 'completed'
  | 'wants_transfer'
  | 'declined'
  | 'cancelled';

export const TRIAL_STATUS_LABEL: Record<TrialStatus, string> = {
  draft: 'مسودة',
  awaiting_acceptance: 'بانتظار قبول العميل',
  accepted: 'مقبول',
  awaiting_handover: 'بانتظار استكمال متطلبات التسليم',
  in_trial: 'تجربة جارية',
  completed: 'تجربة مكتملة',
  wants_transfer: 'العميل يرغب في نقل الخدمات',
  declined: 'العميل لا يرغب في الاستمرار',
  cancelled: 'ملغى',
};

export interface ChecklistItem {
  done: boolean;
  note: string | null;
  by?: string | null;
  at?: string | null;
}

export interface TrialTerms {
  id: string;
  version: number;
  title: string;
  clauses: string[];
  status: 'draft' | 'pending_review' | 'approved' | 'retired';
  content_sha256: string | null;
  approved_at: string | null;
  /** القالب الكامل (عقد التجربة الرسمي — 0106) */
  doc?: TrialTemplateDoc | undefined;
}

export interface Trial {
  id: string;
  trial_no: string;
  contract_id: string;
  customer_id: string;
  customer_name?: string | null;
  worker_profile_id: string;
  worker_name?: string | null;
  branch_id: string | null;
  price: number;
  vat_amount: number;
  total_amount: number;
  trial_days: number;
  receipt_date: string;
  end_date: string;
  terms_snapshot: { title: string; version: number; clauses: string[] } | TrialTemplateDoc;
  /** بيانات عقد التجربة غير الموجودة في الجداول (0106) */
  document_fields?: Partial<TrialDocFields> | undefined;
  regulatory_checklist: Record<string, ChecklistItem>;
  status: TrialStatus;
  accepted_at: string | null;
  transfer_contract_id: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface TrialDocument {
  trial_no: string;
  customer_name: string;
  worker_name: string;
  nationality: string;
  profession: string;
  price: number;
  vat_amount: number;
  total_amount: number;
  trial_days: number;
  receipt_date: string;
  end_date: string;
  terms_title: string;
  terms_version: number;
  terms: string[];
  notice: string;
  /** 0106 — عقد التجربة الرسمي */
  contract_no?: string | null;
  issued_on?: string | null;
  customer_national_id?: string | null;
  customer_phone?: string | null;
  template?: unknown;
  fields?: Partial<TrialDocFields> | null;
}
export interface TrialPublicView extends TrialDocument {
  status: TrialStatus;
  link_state: 'open' | 'used' | 'revoked' | 'expired' | 'locked';
  otp_required: boolean;
  accepted_at: string | null;
}
export interface TrialAcceptance {
  accepted_at: string;
  verified_by: string;
  national_id_last4: string;
  phone_masked: string | null;
  ip_address: string | null;
  document_sha256: string;
}
export interface AcceptResult {
  ok: boolean;
  error?: string;
  attempts_left?: number;
  reference?: string;
  accepted_at?: string;
  document?: TrialDocument;
}

/* ------------------------------ demo store ------------------------------- */

interface DemoLink {
  token: string;
  trial_id: string;
  expires_at: number;
  attempts: number;
  used_at: string | null;
  revoked_at: string | null;
}
interface DemoCustomer {
  name: string;
  national_id: string;
  phone: string;
  /** رقم عقد التجربة وجنسية العاملة (العرض التجريبي) */
  contract_no?: string;
  worker_nationality?: string;
}

let termsVersions: TrialTerms[] = [];
let trials: Trial[] = [];
let links: DemoLink[] = [];
let acceptances: Record<string, TrialAcceptance> = {};
let demoCustomers: Record<string, DemoCustomer> = {};
let seq = 0;

const DEMO_KEY = 'masea.demo.trials.v1';

/**
 * The customer opens the acceptance link in another tab/device, so the demo store is
 * mirrored to localStorage (same browser only). Live mode never touches it.
 */
function load(): void {
  if (!demo()) return;
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as {
      termsVersions: TrialTerms[];
      trials: Trial[];
      links: DemoLink[];
      acceptances: Record<string, TrialAcceptance>;
      demoCustomers: Record<string, DemoCustomer>;
      seq: number;
    };
    ({ termsVersions, trials, links, acceptances, demoCustomers, seq } = d);
  } catch {
    /* storage unavailable — keep the in-memory store */
  } finally {
    ensureOfficialTemplate();
  }
}
function save(): void {
  if (!demo()) return;
  try {
    window.localStorage.setItem(
      DEMO_KEY,
      JSON.stringify({ termsVersions, trials, links, acceptances, demoCustomers, seq }),
    );
  } catch {
    /* storage unavailable — the in-memory store still works in this tab */
  }
}

/** مرآة 0106: ملف الشركة هو النسخة المعتمدة من شروط التجربة (السابقة تُوقف). */
function ensureOfficialTemplate(): void {
  if (termsVersions.some((t) => isTrialContractDoc(t.doc))) return;
  for (const t of termsVersions) if (t.status === 'approved') t.status = 'retired';
  const version = Math.max(0, ...termsVersions.map((t) => t.version)) + 1;
  termsVersions.unshift({
    id: `tt-${version}`,
    version,
    title: TRIAL_CONTRACT_V1.title,
    clauses: [...TRIAL_CONTRACT_V1.clauses],
    status: 'approved',
    content_sha256: null,
    approved_at: nowIso(),
    doc: { ...TRIAL_CONTRACT_V1, version },
  });
}

export function resetTrialsDemo(): void {
  termsVersions = [];
  trials = [];
  links = [];
  acceptances = {};
  demoCustomers = {};
  seq = 0;
  try {
    window.localStorage.removeItem(DEMO_KEY);
  } catch {
    /* ignore */
  }
}

function fail(message: string): never {
  throw new Error(message);
}
function rpcErr(message: string): Error {
  return new Error(message.replace(/^.*?\bERROR:\s*/, '').trim() || 'تعذّر تنفيذ العملية');
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw rpcErr(error.message);
  return data as T;
}
const demo = () => isDemoMode();
const nowIso = () => new Date().toISOString();
const todayIso = () => nowIso().slice(0, 10);
function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function randomToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
const digits = (s: string) => s.replace(/\D/g, '');

/* --------------------------------- terms --------------------------------- */

export async function listTrialTerms(): Promise<TrialTerms[]> {
  load();
  if (demo()) return termsVersions.map((t) => ({ ...t, clauses: [...t.clauses] }));
  const { data, error } = await supabase
    .from('contract_templates')
    .select('id, version, name, doc, status, content_sha256, approved_at')
    .eq('template_code', 'transfer_trial_terms')
    .order('version', { ascending: false });
  if (error) throw new Error(`تعذّر جلب شروط التجربة: ${error.message}`);
  return (data ?? []).map((r) => {
    const doc = (r.doc ?? {}) as { title?: string; clauses?: string[] };
    return {
      ...(isTrialContractDoc(r.doc) ? { doc: r.doc } : {}),
      id: r.id as string,
      version: r.version as number,
      title: doc.title ?? (r.name as string),
      clauses: doc.clauses ?? [],
      status: r.status as TrialTerms['status'],
      content_sha256: (r.content_sha256 as string | null) ?? null,
      approved_at: (r.approved_at as string | null) ?? null,
    };
  });
}

export const trialTermsSchema = z.object({
  title: z.string().trim().min(1, { message: 'اكتب عنوان الشروط' }),
  clauses: z
    .array(z.string().trim().min(1, { message: 'لا بنود فارغة' }))
    .min(1, { message: 'اكتب بنداً واحداً على الأقل' }),
});

export async function saveTrialTermsDraft(input: z.infer<typeof trialTermsSchema>): Promise<void> {
  load();
  const p = trialTermsSchema.parse(input);
  if (!demo()) {
    await rpc('save_trial_terms_draft', { p_title: p.title, p_clauses: p.clauses });
    return;
  }
  const open = termsVersions.find((t) => t.status !== 'approved' && t.status !== 'retired');
  const version = open?.version ?? Math.max(0, ...termsVersions.map((t) => t.version)) + 1;
  const row: TrialTerms = {
    id: open?.id ?? `tt-${version}`,
    version,
    title: p.title,
    clauses: p.clauses,
    status: 'pending_review',
    content_sha256: await sha256Hex(JSON.stringify(p)),
    approved_at: null,
  };
  termsVersions = [row, ...termsVersions.filter((t) => t.id !== row.id)];
  save();
}

export async function approveTrialTerms(id: string): Promise<void> {
  load();
  if (!demo()) {
    await rpc('approve_contract_template', { p_template_id: id });
    return;
  }
  const t = termsVersions.find((x) => x.id === id) ?? fail('النسخة غير موجودة');
  if (t.status !== 'pending_review' && t.status !== 'draft') fail('النسخة معتمدة مسبقاً أو موقوفة');
  for (const o of termsVersions) if (o.status === 'approved') o.status = 'retired';
  t.status = 'approved';
  t.approved_at = nowIso();
  save();
}

/* --------------------------------- trials -------------------------------- */

export async function listTrials(): Promise<Trial[]> {
  load();
  if (demo()) return trials.map((t) => ({ ...t }));
  const { data, error } = await supabase
    .from('trial_agreements')
    .select('*, customers(full_name), worker_profiles(full_name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`تعذّر جلب التجارب: ${error.message}`);
  return (data ?? []).map(({ customers, worker_profiles, ...t }) => ({
    ...(t as Trial),
    customer_name: (customers as { full_name: string } | null)?.full_name ?? null,
    worker_name: (worker_profiles as { full_name: string } | null)?.full_name ?? null,
  }));
}

export async function getTrialByContract(contractId: string): Promise<Trial | null> {
  load();
  if (demo() || isDemoId(contractId))
    return trials.find((t) => t.contract_id === contractId) ?? null;
  const { data, error } = await supabase
    .from('trial_agreements')
    .select('*, customers(full_name), worker_profiles(full_name)')
    .eq('contract_id', contractId)
    .maybeSingle();
  if (error) throw new Error(`تعذّر جلب التجربة: ${error.message}`);
  if (!data) return null;
  const { customers, worker_profiles, ...t } = data;
  return {
    ...(t as Trial),
    customer_name: (customers as { full_name: string } | null)?.full_name ?? null,
    worker_name: (worker_profiles as { full_name: string } | null)?.full_name ?? null,
  };
}

export async function getAcceptance(trialId: string): Promise<TrialAcceptance | null> {
  load();
  if (demo()) return acceptances[trialId] ?? null;
  const { data, error } = await supabase
    .from('trial_acceptances')
    .select(
      'accepted_at, verified_by, national_id_last4, phone_masked, ip_address, document_sha256',
    )
    .eq('trial_id', trialId)
    .maybeSingle();
  if (error) throw new Error(`تعذّر جلب سجل القبول: ${error.message}`);
  return (data as TrialAcceptance | null) ?? null;
}

export const createTrialSchema = z.object({
  customerId: z.string().min(1, { message: 'اختر العميل' }),
  customerName: z.string().nullable().optional(),
  customerNationalId: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  workerId: z.string().min(1, { message: 'اختر العاملة' }),
  workerName: z.string().nullable().optional(),
  /** جنسية العاملة/السائق (العرض التجريبي فقط — مع قاعدة البيانات من ملفها) */
  workerNationality: z.string().nullable().optional(),
  branch: z.string().min(1, { message: 'اختر الفرع' }),
  price: z.number().positive({ message: 'حدّد سعر التجربة المتفق عليه' }),
  days: z.number().int().positive({ message: 'حدّد عدد أيام التجربة' }),
  receiptDate: z.string().min(1, { message: 'حدّد تاريخ استلام العاملة' }),
  /** بيانات عقد التجربة الرسمي (نقل كفالة من «عقد جديد» — 0106) */
  fields: z
    .object({
      customer_nationality: z.string().trim().min(1, { message: 'حدّد جنسية العميل' }),
      id_kind: z.enum(['بطاقة', 'إقامة']),
      id_number: z
        .string()
        .trim()
        .regex(/^[12]\d{9}$/, { message: 'رقم الهوية/الإقامة 10 أرقام يبدأ بـ 1 أو 2' }),
      id_issue_date: z.string().trim().min(1, { message: 'حدّد تاريخ إصدار الهوية' }),
      id_issue_place: z.string().trim().min(1, { message: 'حدّد جهة إصدار الهوية' }),
      worker_kind: z.enum(['العاملة', 'السائق']),
      sponsor_name: z.string().trim().min(3, { message: 'اكتب اسم الكفيل الحالي' }),
      city: z.string().trim().min(2, { message: 'حدّد مدينة العمل' }),
      daily_wage: z.number().positive({ message: 'حدّد أجر اليوم أثناء التجربة' }),
      paid_amount: z.number().min(0, { message: 'المبلغ المدفوع لا يكون سالباً' }),
      address: z.string().trim().min(3, { message: 'اكتب عنوان العميل' }),
      job: z.string().trim().min(2, { message: 'اكتب عمل العميل' }),
      mobile: z
        .string()
        .trim()
        .regex(/^05\d{8}$/, { message: 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام' }),
      customer_no: z.string().trim().nullable().optional(),
    })
    .optional(),
});
export type CreateTrialInput = z.infer<typeof createTrialSchema>;
export type TrialFieldsInput = NonNullable<CreateTrialInput['fields']>;

export async function createTrial(input: CreateTrialInput): Promise<Trial> {
  load();
  const p = createTrialSchema.parse(input);
  if (!demo()) {
    return rpc<Trial>('create_trial_agreement', {
      p_customer: p.customerId,
      p_worker: p.workerId,
      p_branch: p.branch,
      p_price: p.price,
      p_days: p.days,
      p_receipt: p.receiptDate,
      ...(p.fields ? { p_fields: p.fields } : {}),
    });
  }
  const cfg = await listConfig();
  const max = configValue(cfg, 'trial_max_days', 90);
  if (p.days > max)
    fail(`مدة التجربة بين يوم و${max} يوماً (لائحة العمالة المنزلية — المادة التاسعة)`);
  const terms = termsVersions.find((t) => t.status === 'approved');
  if (!terms) fail('لا توجد شروط تجربة معتمدة — تكتبها الشركة وتعتمدها من الإعدادات أولاً');
  const priorCustomer = Object.entries(demoCustomers).find(
    ([id]) => trials.find((x) => x.id === id)?.customer_id === p.customerId,
  )?.[1];
  if (p.fields && priorCustomer?.national_id && priorCustomer.national_id !== p.fields.id_number)
    fail('رقم الهوية يختلف عن ملف العميل — صحّحه من ملف العميل');
  const end = addDays(p.receiptDate, p.days - 1);
  const contract = createTrialContract({
    customer_id: p.customerId,
    customer_name: p.customerName ?? null,
    worker_profile_id: p.workerId,
    worker_name: p.workerName ?? null,
    branch: p.branch,
    start_date: p.receiptDate,
    end_date: end,
    base_amount: p.price,
  });
  seq += 1;
  const row: Trial = {
    id: `trial-${Date.now()}-${seq}`,
    trial_no: `TR-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
    contract_id: contract.id,
    customer_id: p.customerId,
    customer_name: p.customerName ?? null,
    worker_profile_id: p.workerId,
    worker_name: p.workerName ?? null,
    branch_id: p.branch,
    price: p.price,
    vat_amount: contract.vat_amount,
    total_amount: contract.total_amount,
    trial_days: p.days,
    receipt_date: p.receiptDate,
    end_date: end,
    terms_snapshot: terms.doc
      ? { ...terms.doc }
      : { title: terms.title, version: terms.version, clauses: [...terms.clauses] },
    ...(p.fields
      ? {
          document_fields: {
            customer_nationality: p.fields.customer_nationality,
            id_kind: p.fields.id_kind,
            id_issue_date: p.fields.id_issue_date,
            id_issue_place: p.fields.id_issue_place,
            worker_kind: p.fields.worker_kind,
            sponsor_name: p.fields.sponsor_name,
            city: p.fields.city,
            daily_wage: p.fields.daily_wage,
            paid_amount: p.fields.paid_amount,
            address: p.fields.address,
            job: p.fields.job,
            customer_no: p.fields.customer_no || null,
          },
        }
      : {}),
    regulatory_checklist: {},
    status: 'draft',
    accepted_at: null,
    transfer_contract_id: null,
    decision_note: null,
    created_at: nowIso(),
  };
  trials.unshift(row);
  if (p.fields && p.fields.paid_amount > contract.total_amount) {
    trials.shift();
    fail('المبلغ المدفوع أكبر من المبلغ الإجمالي');
  }
  demoCustomers[row.id] = {
    name: p.customerName ?? '',
    national_id: p.fields?.id_number ?? p.customerNationalId ?? '',
    phone: p.fields?.mobile ?? p.customerPhone ?? '',
    contract_no: contract.contract_no ?? '',
    worker_nationality: p.workerNationality ?? '',
  };
  demoLogOp(contract.id, 'trial', row.id, 'create', null, 'draft', null);
  save();
  return { ...row };
}

function setStatus(t: Trial, to: TrialStatus, note?: string | null): void {
  demoLogOp(t.contract_id, 'trial', t.id, 'status', t.status, to, note ?? null);
  t.status = to;
}

/** Issue (or re-issue) the link. The raw token is returned ONCE — share it with the customer. */
export async function issueTrialLink(
  t: Pick<Trial, 'id'>,
): Promise<{ token: string; expires_at: string }> {
  load();
  if (!demo()) return rpc('issue_trial_link', { p_trial: t.id });
  const row = trials.find((x) => x.id === t.id) ?? fail('التجربة غير موجودة');
  if (!['draft', 'awaiting_acceptance'].includes(row.status))
    fail('قُبلت التجربة أو انتهت — لا رابط جديد');
  for (const l of links)
    if (l.trial_id === row.id && !l.used_at && !l.revoked_at) l.revoked_at = nowIso();
  const cfg = await listConfig();
  const hours = configValue(cfg, 'trial_link_valid_hours', 72);
  const link: DemoLink = {
    token: randomToken(),
    trial_id: row.id,
    expires_at: Date.now() + hours * 3_600_000,
    attempts: 0,
    used_at: null,
    revoked_at: null,
  };
  links.push(link);
  if (row.status === 'draft') {
    demoMutateContract(row.contract_id, { status: 'awaiting_signature' });
    setStatus(row, 'awaiting_acceptance');
  }
  save();
  return { token: link.token, expires_at: new Date(link.expires_at).toISOString() };
}

/** العرض التجريبي: توقيع الطرفين حضورياً على عقد التجربة يكافئ القبول (مرآة 0107). */
export function demoTrialSignedInPerson(contractId: string, hash: string): void {
  load();
  const t = trials.find((x) => x.contract_id === contractId);
  if (!t || !['draft', 'awaiting_acceptance'].includes(t.status)) return;
  for (const l of links)
    if (l.trial_id === t.id && !l.used_at && !l.revoked_at) l.revoked_at = nowIso();
  t.accepted_at = nowIso();
  setStatus(t, 'accepted', `توقيع حضوري — بصمة ${hash.slice(0, 12)}`);
  setStatus(t, 'awaiting_handover', 'بانتظار استكمال متطلبات التسليم');
  save();
}

export function trialLinkUrl(token: string): string {
  return `${window.location.origin}/t/${token}`;
}

function demoDocument(t: Trial): TrialDocument {
  return {
    trial_no: t.trial_no,
    customer_name: t.customer_name ?? '',
    worker_name: t.worker_name ?? '',
    nationality: demoCustomers[t.id]?.worker_nationality ?? '',
    profession: '',
    price: t.price,
    vat_amount: t.vat_amount,
    total_amount: t.total_amount,
    trial_days: t.trial_days,
    receipt_date: t.receipt_date,
    end_date: t.end_date,
    terms_title: t.terms_snapshot.title,
    terms_version: t.terms_snapshot.version,
    terms: t.terms_snapshot.clauses,
    notice: 'قبول هذه التجربة لا يُعد عقد نقل خدمات ولا يغني عن إجراءات منصة مساند الرسمية.',
    contract_no: demoCustomers[t.id]?.contract_no ?? null,
    issued_on: t.created_at,
    customer_national_id: demoCustomers[t.id]?.national_id ?? null,
    customer_phone: demoCustomers[t.id]?.phone ?? null,
    template: t.terms_snapshot,
    fields: t.document_fields ?? null,
  };
}

/** يُخفي إلا آخر 4 أرقام (الصفحة العامة — مرآة trial_public_view). */
const maskTail = (v: string | null | undefined) =>
  v && v.length > 4 ? '•'.repeat(v.length - 4) + v.slice(-4) : (v ?? null);

/** مستند عقد التجربة كاملاً للموظف (معاينة/طباعة) — trial_document_for. */
export async function getTrialDocument(trialId: string): Promise<TrialDocument> {
  load();
  if (!demo() && !isDemoId(trialId))
    return rpc<TrialDocument>('trial_document_for', { p_trial: trialId });
  const t = trials.find((x) => x.id === trialId) ?? fail('التجربة غير موجودة');
  return demoDocument(t);
}

/** PUBLIC — opening the link only reads; it never accepts. */
export async function viewTrialByToken(token: string): Promise<TrialPublicView> {
  load();
  if (!demo()) return rpc<TrialPublicView>('trial_public_view', { p_token: token });
  const l = links.find((x) => x.token === token) ?? fail('الرابط غير صحيح');
  const t = trials.find((x) => x.id === l.trial_id) ?? fail('الرابط غير صحيح');
  const cfg = await listConfig();
  const maxAttempts = configValue(cfg, 'trial_link_max_attempts', 5);
  const docView = demoDocument(t);
  return {
    ...docView,
    customer_national_id: maskTail(docView.customer_national_id),
    customer_phone: maskTail(docView.customer_phone),
    status: t.status,
    link_state: l.used_at
      ? 'used'
      : l.revoked_at
        ? 'revoked'
        : l.expires_at < Date.now()
          ? 'expired'
          : l.attempts >= maxAttempts
            ? 'locked'
            : 'open',
    otp_required: configValue(cfg, 'trial_otp_required', 0) === 1,
    accepted_at: t.accepted_at,
  };
}

/** PUBLIC — identity check (last 4 of ID + mobile) + explicit consent. */
export async function acceptTrial(input: {
  token: string;
  idLast4: string;
  phoneLast4: string;
  otp?: string | undefined;
}): Promise<AcceptResult> {
  if (!demo()) {
    return rpc<AcceptResult>('trial_accept', {
      p_token: input.token,
      p_id_last4: input.idLast4,
      p_phone_last4: input.phoneLast4,
      p_otp: input.otp ?? null,
      p_user_agent: navigator.userAgent,
    });
  }
  const view = await viewTrialByToken(input.token);
  if (view.link_state === 'used') fail('سبق قبول هذه التجربة من هذا الرابط');
  if (view.link_state === 'revoked') fail('هذا الرابط أُلغي — اطلب رابطاً جديداً من الفرع');
  if (view.link_state === 'expired') fail('انتهت صلاحية الرابط — اطلب رابطاً جديداً من الفرع');
  if (view.link_state === 'locked') fail('تجاوزت عدد المحاولات — تواصل مع الفرع');
  const l = links.find((x) => x.token === input.token) ?? fail('الرابط غير صحيح');
  const t = trials.find((x) => x.id === l.trial_id) ?? fail('الرابط غير صحيح');
  if (t.status !== 'awaiting_acceptance') fail('التجربة ليست بانتظار القبول');
  const c = demoCustomers[t.id] ?? { name: '', national_id: '', phone: '' };
  const ok =
    c.national_id.length >= 4 &&
    digits(c.phone).length >= 4 &&
    c.national_id.slice(-4) === input.idLast4.trim() &&
    digits(c.phone).slice(-4) === input.phoneLast4.trim();
  if (!ok) {
    l.attempts += 1;
    save();
    const cfg = await listConfig();
    return {
      ok: false,
      error: 'بيانات التحقق غير مطابقة لبيانات العميل المسجّلة',
      attempts_left: Math.max(configValue(cfg, 'trial_link_max_attempts', 5) - l.attempts, 0),
    };
  }
  const doc = demoDocument(t);
  const hash = await sha256Hex(JSON.stringify(doc));
  acceptances[t.id] = {
    accepted_at: nowIso(),
    verified_by: 'id_last4+phone_last4',
    national_id_last4: c.national_id.slice(-4),
    phone_masked: `******${digits(c.phone).slice(-4)}`,
    ip_address: null,
    document_sha256: hash,
  };
  l.used_at = nowIso();
  t.accepted_at = nowIso();
  demoMutateContract(t.contract_id, { status: 'signed', signed_at: nowIso() });
  setStatus(t, 'accepted', `قبول إلكتروني — بصمة ${hash.slice(0, 12)}`);
  setStatus(t, 'awaiting_handover', 'بانتظار استكمال متطلبات التسليم');
  save();
  return { ok: true, reference: hash.slice(0, 12), accepted_at: t.accepted_at, document: doc };
}

export async function setTrialRequirement(
  t: Pick<Trial, 'id'>,
  code: string,
  done: boolean,
  note?: string,
): Promise<void> {
  load();
  if (!demo()) {
    await rpc('set_trial_requirement', {
      p_trial: t.id,
      p_code: code,
      p_done: done,
      p_note: note ?? null,
    });
    return;
  }
  const row = trials.find((x) => x.id === t.id) ?? fail('التجربة غير موجودة');
  if (!['draft', 'awaiting_acceptance', 'accepted', 'awaiting_handover'].includes(row.status)) {
    fail('تُستكمل المتطلبات قبل التسليم');
  }
  row.regulatory_checklist = {
    ...row.regulatory_checklist,
    [code]: {
      done,
      note: note?.trim() || null,
      by: useAuth.getState().profile?.full_name ?? null,
      at: nowIso(),
    },
  };
  demoLogOp(
    row.contract_id,
    'trial',
    row.id,
    done ? 'requirement_done' : 'requirement_open',
    null,
    null,
    code,
  );
  save();
}

export async function missingRequirements(t: Trial): Promise<string[]> {
  const reqs = (await listLookups('trial_requirement')).filter((l) => l.is_active && l.flag);
  return reqs.filter((r) => !t.regulatory_checklist[r.code]?.done).map((r) => r.name_ar);
}

export type TrialAction = 'start' | 'complete' | 'transfer' | 'decline' | 'cancel';

export async function trialStep(
  t: Pick<Trial, 'id'>,
  action: TrialAction,
  note?: string,
): Promise<void> {
  load();
  if (!demo()) {
    await rpc('trial_step', {
      p_trial: t.id,
      p_action: action,
      p_date: null,
      p_note: note ?? null,
    });
    return;
  }
  const row = trials.find((x) => x.id === t.id) ?? fail('التجربة غير موجودة');
  if (action === 'start') {
    if (!['accepted', 'awaiting_handover'].includes(row.status))
      fail('تبدأ التجربة بعد قبول العميل');
    const missing = await missingRequirements(row);
    if (missing.length) fail(`لا تسليم قبل استكمال المتطلبات النظامية: ${missing.join('، ')}`);
    demoMutateContract(row.contract_id, { status: 'active' });
    setStatus(row, 'in_trial', note);
  } else if (action === 'complete') {
    if (row.status !== 'in_trial') fail('التجربة ليست جارية');
    setStatus(row, 'completed', note);
  } else if (action === 'transfer') {
    if (!['in_trial', 'completed'].includes(row.status)) fail('القرار بعد بدء التجربة');
    const transfer = createTrialContract({
      service_code: 'sponsorship_transfer',
      customer_id: row.customer_id,
      customer_name: row.customer_name ?? null,
      worker_profile_id: row.worker_profile_id,
      worker_name: row.worker_name ?? null,
      branch: row.branch_id ?? '',
      start_date: addDays(todayIso(), 1),
      end_date: null,
      base_amount: 0,
    });
    row.transfer_contract_id = transfer.id;
    row.decision_note = note ?? null;
    setStatus(row, 'wants_transfer', note ?? 'العميل يرغب في نقل الخدمات');
    demoMutateContract(row.contract_id, { status: 'completed' });
  } else if (action === 'decline') {
    if (!['in_trial', 'completed'].includes(row.status)) fail('القرار بعد بدء التجربة');
    row.decision_note = note ?? null;
    setStatus(row, 'declined', note ?? 'العميل لا يرغب في الاستمرار');
  } else {
    if (!['draft', 'awaiting_acceptance', 'accepted', 'awaiting_handover'].includes(row.status)) {
      fail('بعد التسليم تُنهى التجربة بالإرجاع والتسوية');
    }
    for (const l of links)
      if (l.trial_id === row.id && !l.used_at && !l.revoked_at) l.revoked_at = nowIso();
    demoMutateContract(row.contract_id, { status: 'cancelled' });
    setStatus(row, 'cancelled', note);
  }
  save();
}
