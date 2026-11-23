/**
 * عمليات العقد بعد التوقيع: «إلغاء العقد وتسويته» · «إرجاع العاملة» · الاسترداد.
 * - مع قاعدة البيانات: دوال الخادم في 0090 (الحساب والصلاحيات والأربع أعين
 *   والقيود كلها في الـ backend؛ الواجهة لا تحسب مبلغاً نهائياً).
 * - الوضع التجريبي: مخزن في الذاكرة يطبّق نفس القواعد (lib/settlement.ts).
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { useAuth } from '@/store/auth';
import {
  demoCancelBySettlement,
  getContract,
  getHistory,
} from '@/features/contracts/api/contracts.api';
import { listRentalTemplates } from '@/features/contracts/api/rentalContract.api';
import {
  computeSettlement,
  type SettlementFee,
  type SettlementPreview,
  type SettlementTerms,
} from '@/features/contracts/lib/settlement';
import type { ContractListItem } from '@/features/contracts/types';

/* --------------------------------- types ---------------------------------- */

export const LOOKUP_KINDS = [
  'cancel_reason',
  'return_reason',
  'worker_condition',
  'replacement_reason',
  'trial_requirement',
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

export const lookupSchema = z.object({
  kind: z.enum(LOOKUP_KINDS),
  code: z.string().min(1),
  name_ar: z.string().trim().min(1, { message: 'اكتب الاسم' }).max(80),
  flag: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
});
export type ContractLookup = z.infer<typeof lookupSchema>;

export const LOOKUP_KIND_LABEL: Record<LookupKind, string> = {
  cancel_reason: 'أسباب إلغاء العقد',
  return_reason: 'أسباب إرجاع العاملة',
  worker_condition: 'حالة العاملة عند الاستلام',
  replacement_reason: 'أسباب الاستبدال',
  trial_requirement: 'متطلبات التسليم في تجربة نقل الخدمات',
};
/** معنى العلامة في كل قائمة (تظهر في شاشة الإدارة). */
export const LOOKUP_FLAG_LABEL: Partial<Record<LookupKind, string>> = {
  worker_condition: 'تحتاج متابعة طبية قبل الإتاحة',
  replacement_reason: 'استثناء تعاقدي (البند الثاني/4) لا يُحتسب من الحد',
  trial_requirement: 'إلزامي قبل التسليم',
};

export type SettlementStatus =
  | 'draft'
  | 'pending_review'
  | 'pending_finance'
  | 'approved'
  | 'settled'
  | 'rejected'
  | 'cancelled';

export interface Settlement extends SettlementPreview {
  id: string;
  settlement_no: string;
  contract_id: string;
  reason_code: string | null;
  reason_note: string | null;
  effective_date: string;
  fees: SettlementFee[];
  status: SettlementStatus;
  return_id: string | null;
  prepared_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  settled_at: string | null;
  refund_due_by: string | null;
  journal_entry_id: string | null;
  posting_note: string | null;
  created_at: string;
}

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  draft: 'مسودة',
  pending_review: 'بانتظار المراجعة',
  pending_finance: 'بانتظار الاعتماد المالي',
  approved: 'معتمدة — بانتظار التنفيذ',
  settled: 'منفّذة',
  rejected: 'مرفوضة',
  cancelled: 'مسحوبة',
};

export type ReturnStatus = 'requested' | 'scheduled' | 'received' | 'ready' | 'cancelled';
export interface WorkerReturn {
  id: string;
  return_no: string;
  contract_id: string;
  worker_profile_id: string;
  requested_date: string;
  actual_date: string | null;
  reason_code: string;
  reason_note: string | null;
  condition_code: string | null;
  condition_note: string | null;
  responsible_employee_id: string | null;
  driver_id: string | null;
  notes: string | null;
  replacement_id: string | null;
  status: ReturnStatus;
  created_at: string;
}
export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'مطلوب',
  scheduled: 'مجدول للاستلام',
  received: 'استُلمت — بانتظار الجاهزية',
  ready: 'جاهزة ومتاحة',
  cancelled: 'ملغى',
};

export type RefundStatus =
  | 'draft'
  | 'pending_review'
  | 'pending_finance'
  | 'approved'
  | 'pending_payout'
  | 'partially_refunded'
  | 'refunded'
  | 'rejected';
export type RefundMethod = 'transfer' | 'cash' | 'card_reversal';
export interface Refund {
  id: string;
  refund_no: string;
  settlement_id: string;
  contract_id: string;
  customer_id: string;
  amount: number;
  paid_total: number;
  method: RefundMethod | null;
  beneficiary_name: string | null;
  customer_iban: string | null;
  bank_name: string | null;
  due_by: string | null;
  status: RefundStatus;
  note: string | null;
  submitted_by: string | null;
  created_at: string;
}
export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  draft: 'مسودة',
  pending_review: 'بانتظار المراجعة',
  pending_finance: 'بانتظار الاعتماد المالي',
  approved: 'معتمد',
  pending_payout: 'بانتظار الصرف',
  partially_refunded: 'مسترد جزئياً',
  refunded: 'مسترد بالكامل',
  rejected: 'مرفوض',
};
export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  transfer: 'تحويل بنكي',
  cash: 'نقداً من الصندوق',
  card_reversal: 'عكس عملية البطاقة',
};

export interface RefundPayout {
  id: string;
  refund_id: string;
  amount: number;
  transfer_ref: string;
  paid_on: string;
  bank_code: string;
  journal_entry_id: string | null;
  created_at: string;
}

export interface OpsEvent {
  id: string;
  contract_id: string;
  entity: 'settlement' | 'return' | 'refund' | 'replacement' | 'trial';
  entity_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  actor: string | null;
  actor_name?: string | null;
  created_at: string;
}

export const OPS_ACTION_LABEL: Record<string, string> = {
  prepare: 'إعداد',
  manual_due: 'تحديد المستحق يدوياً',
  submit: 'إرسال للمراجعة',
  review: 'مراجعة واعتماد تشغيلي',
  approve: 'اعتماد مالي',
  reject: 'رفض',
  withdraw: 'سحب',
  settle: 'تنفيذ التسوية',
  request: 'طلب',
  schedule: 'جدولة',
  receive: 'استلام فعلي',
  ready: 'تأكيد الجاهزية',
  cancel: 'إلغاء',
  create: 'إنشاء',
  details: 'تحديث بيانات الاسترداد',
  queue: 'إرسال للصرف',
  payout: 'صرف',
};

/* ------------------------------ demo stores ------------------------------- */

const LOOKUP_SEED: ContractLookup[] = [
  ['cancel_reason', 'customer_request', 'رغبة العميل', false],
  ['cancel_reason', 'customer_travel', 'سفر العميل', false],
  ['cancel_reason', 'worker_refused', 'رفض العاملة العمل', false],
  ['cancel_reason', 'worker_sick', 'مرض العاملة', false],
  ['cancel_reason', 'contract_breach', 'إخلال بشروط العقد', false],
  ['cancel_reason', 'company_unable', 'تعذّر توفير العاملة من الشركة', false],
  ['return_reason', 'contract_end', 'نهاية مدة العقد', false],
  ['return_reason', 'early_cancel', 'إلغاء العقد قبل نهايته', false],
  ['return_reason', 'replacement', 'استبدال العاملة', false],
  ['return_reason', 'worker_refused', 'رفض العاملة العمل', false],
  ['return_reason', 'worker_sick', 'مرض العاملة', false],
  ['return_reason', 'customer_complaint', 'شكوى العميل من الأداء', false],
  ['worker_condition', 'good', 'سليمة وجاهزة', false],
  ['worker_condition', 'tired', 'مرهقة — تحتاج راحة', false],
  ['worker_condition', 'sick', 'مريضة — تحتاج متابعة طبية', true],
  ['worker_condition', 'injured', 'مصابة — تحتاج متابعة طبية', true],
  ['worker_condition', 'complaint', 'لديها شكوى ضد صاحب العمل', false],
  ['replacement_reason', 'worker_refused', 'رفض العاملة العمل', true],
  ['replacement_reason', 'worker_sick', 'مرض العاملة', true],
  ['replacement_reason', 'performance', 'عدم ملاءمة الأداء', false],
  ['replacement_reason', 'customer_preference', 'رغبة العميل', false],
  ['replacement_reason', 'compatibility', 'عدم التوافق مع الأسرة', false],
  ['trial_requirement', 'iqama_valid', 'إقامة العاملة سارية', true],
  ['trial_requirement', 'not_absent', 'العاملة غير مسجّلة كمتغيبة', true],
  ['trial_requirement', 'worker_consent', 'موافقة العاملة على التجربة', true],
  [
    'trial_requirement',
    'employer_eligible',
    'أهلية العميل على مساند (القدرة المالية والحد الأقصى)',
    true,
  ],
].map(([kind, code, name_ar, flag], i) => ({
  kind: kind as LookupKind,
  code: code as string,
  name_ar: name_ar as string,
  flag: flag as boolean,
  is_active: true,
  sort_order: i,
}));

interface DemoTerm {
  template_code: string;
  template_version: number;
  term_key:
    | 'cancel_daily_deduction'
    | 'refund_within_days'
    | 'late_return_daily'
    | 'delivery_fee_min';
  value: number;
  clause_ref: string;
  label_ar: string;
  is_active: boolean;
  note: string | null;
}
export type SettlementTermRow = DemoTerm & { id: string };

const TERM_SEED: SettlementTermRow[] = [
  {
    id: 'st-1',
    template_code: 'rental_labor_services',
    template_version: 1,
    term_key: 'cancel_daily_deduction',
    value: 200,
    clause_ref: 'البند الثالث/10',
    label_ar: 'خصم عن كل يوم عملت العمالة عند الإلغاء قبل انتهاء المدة',
    is_active: true,
    note: null,
  },
  {
    id: 'st-2',
    template_code: 'rental_labor_services',
    template_version: 1,
    term_key: 'refund_within_days',
    value: 7,
    clause_ref: 'البند الثالث/12',
    label_ar: 'مهلة استرجاع المبلغ عند الإلغاء والإرجاع دون استبدال',
    is_active: true,
    note: null,
  },
  {
    id: 'st-3',
    template_code: 'rental_labor_services',
    template_version: 1,
    term_key: 'delivery_fee_min',
    value: 50,
    clause_ref: 'البند الثالث/11',
    label_ar: 'رسوم التوصيل (حد أدنى) عند عدم تسليم العاملة في مقر الشركة',
    is_active: false,
    note: 'تُضاف يدوياً عند انطباقها — تُقدَّر حسب الموقع ووقت التسليم',
  },
  {
    id: 'st-4',
    template_code: 'rental_labor_services',
    template_version: 1,
    term_key: 'late_return_daily',
    value: 300,
    clause_ref: 'البند الثالث/11',
    label_ar: 'مبلغ عن كل يوم تأخير في إرجاع العاملة',
    is_active: false,
    note: 'غير مفعّل: النص يُلزم «الطرف الأول» بالدفع — بانتظار المراجعة القانونية',
  },
];

let lookups: ContractLookup[] = LOOKUP_SEED.map((l) => ({ ...l }));
let terms: SettlementTermRow[] = TERM_SEED.map((t) => ({ ...t }));
let settlements: Settlement[] = [];
let returns: WorkerReturn[] = [];
let refunds: Refund[] = [];
let payouts: RefundPayout[] = [];
let events: OpsEvent[] = [];
let seq = 0;

/** Tests + demo reset. */
export function resetContractOpsDemo(): void {
  lookups = LOOKUP_SEED.map((l) => ({ ...l }));
  terms = TERM_SEED.map((t) => ({ ...t }));
  settlements = [];
  returns = [];
  refunds = [];
  payouts = [];
  events = [];
  seq = 0;
}

function me(): { id: string; name: string } {
  const p = useAuth.getState().profile;
  return { id: p?.id ?? 'demo-user', name: p?.full_name ?? 'مستخدم تجريبي' };
}
function nowIso(): string {
  return new Date().toISOString();
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function nextNo(prefix: string): string {
  seq += 1;
  return `${prefix}-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
}
function addDaysIso(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function log(
  contract_id: string,
  entity: OpsEvent['entity'],
  entity_id: string,
  action: string,
  from: string | null,
  to: string | null,
  note?: string | null,
): void {
  const u = me();
  events.push({
    id: `ev-${events.length + 1}`,
    contract_id,
    entity,
    entity_id,
    action,
    from_status: from,
    to_status: to,
    note: note?.trim() || null,
    actor: u.id,
    actor_name: u.name,
    created_at: nowIso(),
  });
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
const live = (contractId: string) => !isDemoMode() && !isDemoId(contractId);

/* ------------------------------- lookups ---------------------------------- */

export async function listLookups(kind?: LookupKind): Promise<ContractLookup[]> {
  if (isDemoMode()) {
    return lookups
      .filter((l) => !kind || l.kind === kind)
      .sort((a, b) => a.sort_order - b.sort_order);
  }
  let q = supabase.from('contract_lookups').select('*').order('sort_order');
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) throw new Error(`تعذّر جلب القوائم المرجعية: ${error.message}`);
  return (data ?? []) as ContractLookup[];
}

export async function saveLookup(item: ContractLookup, isNew: boolean): Promise<void> {
  const parsed = lookupSchema.parse(item);
  if (isDemoMode()) {
    const i = lookups.findIndex((l) => l.kind === parsed.kind && l.code === parsed.code);
    if (isNew && i !== -1) fail('الرمز مستخدم في هذه القائمة');
    if (i === -1) lookups.push(parsed);
    else lookups[i] = parsed;
    return;
  }
  const { error } = isNew
    ? await supabase.from('contract_lookups').insert(parsed)
    : await supabase
        .from('contract_lookups')
        .update({ ...parsed, updated_at: nowIso() })
        .eq('kind', parsed.kind)
        .eq('code', parsed.code);
  if (error) throw new Error(`تعذّر الحفظ: ${error.message}`);
}

/* ------------------------- settlement terms (config) ---------------------- */

export async function listSettlementTerms(): Promise<SettlementTermRow[]> {
  if (isDemoMode()) return terms.map((t) => ({ ...t }));
  const { data, error } = await supabase
    .from('contract_settlement_terms')
    .select('*')
    .order('template_code')
    .order('template_version')
    .order('term_key');
  if (error) throw new Error(`تعذّر جلب شروط التسوية: ${error.message}`);
  return (data ?? []) as SettlementTermRow[];
}

export const settlementTermSchema = z.object({
  id: z.string(),
  value: z.number().min(0, { message: 'القيمة لا تكون سالبة' }),
  clause_ref: z.string().trim().min(1, { message: 'اذكر رقم البند' }),
  is_active: z.boolean(),
  note: z.string().nullable(),
});

export async function updateSettlementTerm(
  patch: z.infer<typeof settlementTermSchema>,
): Promise<void> {
  const p = settlementTermSchema.parse(patch);
  if (isDemoMode()) {
    const t = terms.find((x) => x.id === p.id);
    if (t) Object.assign(t, p);
    return;
  }
  const { error } = await supabase
    .from('contract_settlement_terms')
    .update({
      value: p.value,
      clause_ref: p.clause_ref,
      is_active: p.is_active,
      note: p.note,
      updated_at: nowIso(),
    })
    .eq('id', p.id);
  if (error) throw new Error(`تعذّر الحفظ: ${error.message}`);
}

/** The template terms that apply to a demo contract (its pinned rental template). */
async function demoTermsFor(c: ContractListItem): Promise<SettlementTerms> {
  if (!c.template_id) return {};
  const tpl = (await listRentalTemplates()).find((t) => t.id === c.template_id);
  if (!tpl) return {};
  const pick = (key: DemoTerm['term_key']) => {
    const t = terms.find(
      (x) =>
        x.template_code === 'rental_labor_services' &&
        x.template_version === tpl.version &&
        x.term_key === key &&
        x.is_active,
    );
    return t ? { value: t.value, clause_ref: t.clause_ref } : null;
  };
  return {
    cancelDailyDeduction: pick('cancel_daily_deduction'),
    refundWithinDays: pick('refund_within_days'),
  };
}

async function demoDelivered(c: ContractListItem): Promise<boolean> {
  if (c.status === 'active' || c.status === 'completed') return true;
  return (await getHistory(c.id)).some((h) => h.to_status === 'active');
}

/* ------------------------------ settlements ------------------------------- */

export async function previewSettlement(
  contractId: string,
  effectiveDate: string,
  fees: SettlementFee[] = [],
): Promise<SettlementPreview> {
  if (live(contractId)) {
    return rpc<SettlementPreview>('compute_contract_settlement', {
      p_contract: contractId,
      p_effective: effectiveDate,
      p_fees: fees,
    });
  }
  const c = (await getContract(contractId)) ?? fail('العقد غير موجود');
  return computeSettlement({
    contract: c,
    delivered: await demoDelivered(c),
    effectiveDate,
    fees,
    terms: await demoTermsFor(c),
  });
}

export async function listSettlements(contractId?: string): Promise<Settlement[]> {
  if (isDemoMode() || (contractId && isDemoId(contractId))) {
    return settlements
      .filter((s) => !contractId || s.contract_id === contractId)
      .map((s) => ({ ...s }));
  }
  let q = supabase
    .from('contract_settlements')
    .select('*')
    .order('created_at', { ascending: false });
  if (contractId) q = q.eq('contract_id', contractId);
  const { data, error } = await q;
  if (error) throw new Error(`تعذّر جلب التسويات: ${error.message}`);
  return (data ?? []) as Settlement[];
}

export interface PrepareSettlementInput {
  contractId: string;
  effectiveDate: string;
  reasonCode: string;
  reasonNote?: string;
  fees?: SettlementFee[];
  returnId?: string | null;
}

export async function prepareSettlement(input: PrepareSettlementInput): Promise<Settlement> {
  if (!input.reasonCode) fail('اختر سبب الإلغاء');
  if (!input.effectiveDate) fail('حدّد تاريخ الإلغاء الفعلي');
  if (live(input.contractId)) {
    return rpc<Settlement>('prepare_contract_settlement', {
      p_contract: input.contractId,
      p_effective: input.effectiveDate,
      p_reason_code: input.reasonCode,
      p_reason_note: input.reasonNote ?? null,
      p_fees: input.fees ?? [],
      p_return_id: input.returnId ?? null,
    });
  }
  const c = (await getContract(input.contractId)) ?? fail('العقد غير موجود');
  if (c.status === 'draft') fail('المسودة تُلغى مباشرة — لا تحتاج تسوية');
  if (c.status === 'cancelled' && !input.returnId) fail('العقد ملغى مسبقاً');
  if (
    settlements.some((s) => s.contract_id === c.id && !['rejected', 'cancelled'].includes(s.status))
  ) {
    fail('توجد تسوية قائمة لهذا العقد');
  }
  const p = await previewSettlement(c.id, input.effectiveDate, input.fees ?? []);
  const row: Settlement = {
    ...p,
    kind: input.returnId ? 'return' : p.kind,
    id: `stl-${Date.now()}-${settlements.length}`,
    settlement_no: nextNo('ST'),
    contract_id: c.id,
    reason_code: input.reasonCode,
    reason_note: input.reasonNote?.trim() || null,
    effective_date: input.effectiveDate,
    fees: input.fees ?? [],
    status: 'draft',
    return_id: input.returnId ?? null,
    prepared_by: me().id,
    reviewed_by: null,
    approved_by: null,
    settled_at: null,
    refund_due_by: null,
    journal_entry_id: null,
    posting_note: null,
    created_at: nowIso(),
  };
  settlements.unshift(row);
  log(c.id, 'settlement', row.id, 'prepare', null, 'draft', row.reason_note);
  return { ...row };
}

export type SettlementAction = 'submit' | 'review' | 'approve' | 'reject' | 'withdraw';

export async function settlementStep(
  s: Pick<Settlement, 'id' | 'contract_id'>,
  action: SettlementAction,
  note?: string,
): Promise<void> {
  if (live(s.contract_id)) {
    await rpc('settlement_step', { p_id: s.id, p_action: action, p_note: note ?? null });
    return;
  }
  const row = settlements.find((x) => x.id === s.id) ?? fail('التسوية غير موجودة');
  const from = row.status;
  const u = me().id;
  const to: SettlementStatus = (() => {
    switch (action) {
      case 'submit':
        if (from !== 'draft') fail('تُرسل المسودة فقط للمراجعة');
        return 'pending_review';
      case 'review':
        if (from !== 'pending_review') fail('التسوية ليست بانتظار المراجعة');
        if (row.prepared_by === u)
          fail('لا يراجع المُعِدّ تسويته (أربع أعين) — سجّل دخولك بحساب آخر');
        row.reviewed_by = u;
        return 'pending_finance';
      case 'approve':
        if (from !== 'pending_finance') fail('التسوية ليست بانتظار الاعتماد المالي');
        if (row.prepared_by === u)
          fail('لا يعتمد المُعِدّ تسويته (أربع أعين) — سجّل دخولك بحساب آخر');
        row.approved_by = u;
        return 'approved';
      case 'reject':
        if (!['pending_review', 'pending_finance'].includes(from))
          fail('لا يمكن رفض التسوية في حالتها الحالية');
        if (!note?.trim()) fail('اكتب سبب الرفض');
        return 'rejected';
      case 'withdraw':
        if (!['draft', 'pending_review'].includes(from)) fail('لا تُسحب التسوية بعد مراجعتها');
        return 'cancelled';
    }
  })();
  row.status = to;
  log(row.contract_id, 'settlement', row.id, action, from, to, note);
}

export async function setSettlementManualDue(
  s: Pick<Settlement, 'id' | 'contract_id'>,
  due: number,
  ref: string,
): Promise<void> {
  if (live(s.contract_id)) {
    await rpc('set_settlement_manual_due', { p_id: s.id, p_due: due, p_ref: ref });
    return;
  }
  const row = settlements.find((x) => x.id === s.id) ?? fail('التسوية غير موجودة');
  if (row.status !== 'draft') fail('تُعدَّل التسوية في المسودة فقط');
  if (due < 0 || due > row.contract_value) fail('القيمة المستحقة بين صفر وقيمة العقد');
  if (!ref.trim()) fail('اذكر البند أو السياسة المعتمدة');
  Object.assign(row, {
    service_due: due,
    due_basis: 'manual',
    due_basis_ref: ref.trim(),
    balance: Math.round((row.amount_paid - due - row.fees_total) * 100) / 100,
  });
  log(row.contract_id, 'settlement', row.id, 'manual_due', 'draft', 'draft', ref);
}

export async function settleSettlement(s: Pick<Settlement, 'id' | 'contract_id'>): Promise<void> {
  if (live(s.contract_id)) {
    await rpc('settle_contract_settlement', { p_id: s.id });
    return;
  }
  const row = settlements.find((x) => x.id === s.id) ?? fail('التسوية غير موجودة');
  if (row.status !== 'approved') fail('تُنفَّذ التسوية بعد اعتمادها مالياً فقط');
  const c = (await getContract(row.contract_id)) ?? fail('العقد غير موجود');
  row.amount_paid = c.amount_paid;
  row.balance = Math.round((c.amount_paid - row.service_due - row.fees_total) * 100) / 100;
  demoCancelBySettlement(c.id);
  if (row.balance > 0) {
    const due = row.refund_within_days ? addDaysIso(today(), row.refund_within_days) : null;
    const rf: Refund = {
      id: `rf-${Date.now()}-${refunds.length}`,
      refund_no: nextNo('RF'),
      settlement_id: row.id,
      contract_id: c.id,
      customer_id: c.customer_id,
      amount: row.balance,
      paid_total: 0,
      method: null,
      beneficiary_name: c.customer_name,
      customer_iban: null,
      bank_name: null,
      due_by: due,
      status: 'draft',
      note: null,
      submitted_by: null,
      created_at: nowIso(),
    };
    refunds.unshift(rf);
    row.refund_due_by = due;
    log(c.id, 'refund', rf.id, 'create', null, 'draft', `من التسوية ${row.settlement_no}`);
  }
  row.status = 'settled';
  row.settled_at = nowIso();
  row.posting_note = 'الوضع التجريبي — يُرحَّل الإشعار الدائن عند ربط قاعدة البيانات';
  log(c.id, 'settlement', row.id, 'settle', 'approved', 'settled', null);
}

/* -------------------------------- returns --------------------------------- */

export async function listReturns(contractId?: string): Promise<WorkerReturn[]> {
  if (isDemoMode() || (contractId && isDemoId(contractId))) {
    return returns
      .filter((r) => !contractId || r.contract_id === contractId)
      .map((r) => ({ ...r }));
  }
  let q = supabase.from('worker_returns').select('*').order('created_at', { ascending: false });
  if (contractId) q = q.eq('contract_id', contractId);
  const { data, error } = await q;
  if (error) throw new Error(`تعذّر جلب طلبات الإرجاع: ${error.message}`);
  return (data ?? []) as WorkerReturn[];
}

export const returnRequestSchema = z.object({
  contractId: z.string().min(1),
  requestedDate: z.string().min(1, { message: 'حدّد تاريخ الإرجاع المطلوب' }),
  reasonCode: z.string().min(1, { message: 'اختر سبب الإرجاع' }),
  reasonNote: z.string().optional(),
  responsibleEmployeeId: z.string().nullable().optional(),
  driverId: z.string().nullable().optional(),
  notes: z.string().optional(),
});
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;

export async function requestReturn(input: ReturnRequestInput): Promise<WorkerReturn> {
  const p = returnRequestSchema.parse(input);
  if (live(p.contractId)) {
    return rpc<WorkerReturn>('request_worker_return', {
      p_contract: p.contractId,
      p_requested: p.requestedDate,
      p_reason_code: p.reasonCode,
      p_reason_note: p.reasonNote ?? null,
      p_responsible: p.responsibleEmployeeId ?? null,
      p_driver: p.driverId ?? null,
      p_notes: p.notes ?? null,
    });
  }
  const c = (await getContract(p.contractId)) ?? fail('العقد غير موجود');
  if (!c.worker_profile_id && !c.worker_name) fail('لا توجد عاملة مرتبطة بهذا العقد');
  if (!(await demoDelivered(c))) fail('العاملة ليست لدى العميل — لا يوجد ما يُرجَع');
  if (
    returns.some(
      (r) => r.contract_id === c.id && ['requested', 'scheduled', 'received'].includes(r.status),
    )
  ) {
    fail('يوجد طلب إرجاع قائم لهذه العاملة على هذا العقد');
  }
  const row: WorkerReturn = {
    id: `wr-${Date.now()}-${returns.length}`,
    return_no: nextNo('WR'),
    contract_id: c.id,
    worker_profile_id: c.worker_profile_id ?? `demo-worker-${c.id}`,
    requested_date: p.requestedDate,
    actual_date: null,
    reason_code: p.reasonCode,
    reason_note: p.reasonNote?.trim() || null,
    condition_code: null,
    condition_note: null,
    responsible_employee_id: p.responsibleEmployeeId ?? null,
    driver_id: p.driverId ?? null,
    notes: p.notes?.trim() || null,
    replacement_id: null,
    status: 'requested',
    created_at: nowIso(),
  };
  returns.unshift(row);
  log(c.id, 'return', row.id, 'request', null, 'requested', row.reason_note);
  return { ...row };
}

export type ReturnAction = 'schedule' | 'receive' | 'ready' | 'cancel';
export interface ReturnStepInput {
  date?: string;
  condition?: string;
  note?: string;
  driverId?: string | null;
}

export async function returnStep(
  r: Pick<WorkerReturn, 'id' | 'contract_id'>,
  action: ReturnAction,
  input: ReturnStepInput = {},
): Promise<void> {
  if (live(r.contract_id)) {
    await rpc('worker_return_step', {
      p_id: r.id,
      p_action: action,
      p_date: input.date ?? null,
      p_condition: input.condition ?? null,
      p_note: input.note ?? null,
      p_driver: input.driverId ?? null,
    });
    return;
  }
  const row = returns.find((x) => x.id === r.id) ?? fail('طلب الإرجاع غير موجود');
  const from = row.status;
  let to: ReturnStatus;
  if (action === 'schedule') {
    if (!['requested', 'scheduled'].includes(from)) fail('لا تُجدول الإرجاع بعد الاستلام');
    if (input.date) row.requested_date = input.date;
    if (input.driverId) row.driver_id = input.driverId;
    to = 'scheduled';
  } else if (action === 'receive') {
    if (!['requested', 'scheduled'].includes(from)) fail('سبق استلام العاملة');
    if (!input.date) fail('حدّد تاريخ الإرجاع الفعلي');
    if (input.date > today()) fail('تاريخ الاستلام الفعلي لا يكون في المستقبل');
    if (!input.condition) fail('حدّد حالة العاملة عند الاستلام');
    row.actual_date = input.date;
    row.condition_code = input.condition;
    row.condition_note = input.note?.trim() || null;
    to = 'received';
  } else if (action === 'ready') {
    if (from !== 'received') fail('تُؤكَّد الجاهزية بعد الاستلام');
    const c = await getContract(row.contract_id);
    if (!row.replacement_id && c && ['active', 'signed', 'musaned_signed'].includes(c.status)) {
      fail('سوِّ العقد أولاً (إلغاء وتسوية) — العاملة ما زالت مخصّصة لعقد نشط');
    }
    to = 'ready';
  } else {
    if (!['requested', 'scheduled'].includes(from)) fail('لا يُلغى طلب إرجاع بعد الاستلام');
    to = 'cancelled';
  }
  row.status = to;
  log(row.contract_id, 'return', row.id, action, from, to, input.note);
}

/* -------------------------------- refunds --------------------------------- */

export async function listRefunds(contractId?: string): Promise<Refund[]> {
  if (isDemoMode() || (contractId && isDemoId(contractId))) {
    return refunds
      .filter((r) => !contractId || r.contract_id === contractId)
      .map((r) => ({ ...r }));
  }
  let q = supabase.from('refunds').select('*').order('created_at', { ascending: false });
  if (contractId) q = q.eq('contract_id', contractId);
  const { data, error } = await q;
  if (error) throw new Error(`تعذّر جلب طلبات الاسترداد: ${error.message}`);
  return (data ?? []) as Refund[];
}

export async function listPayouts(refundId: string, contractId: string): Promise<RefundPayout[]> {
  if (!live(contractId))
    return payouts.filter((p) => p.refund_id === refundId).map((p) => ({ ...p }));
  const { data, error } = await supabase
    .from('refund_payouts')
    .select('*')
    .eq('refund_id', refundId)
    .order('created_at');
  if (error) throw new Error(`تعذّر جلب عمليات الصرف: ${error.message}`);
  return (data ?? []) as RefundPayout[];
}

export const IBAN_RE = /^SA[0-9]{22}$/;
export const refundDetailsSchema = z
  .object({
    method: z.enum(['transfer', 'cash', 'card_reversal'], { message: 'اختر وسيلة الاسترداد' }),
    beneficiary: z.string().trim().min(1, { message: 'اكتب اسم المستفيد' }),
    iban: z.string().transform((v) => v.replace(/\s+/g, '').toUpperCase()),
    bank: z.string().trim(),
    note: z.string().optional(),
  })
  .refine((d) => d.method !== 'transfer' || IBAN_RE.test(d.iban), {
    message: 'رقم الآيبان غير صحيح — يبدأ بـ SA ويتكون من 24 خانة',
    path: ['iban'],
  });
export type RefundDetailsInput = z.input<typeof refundDetailsSchema>;

export async function updateRefundDetails(
  r: Pick<Refund, 'id' | 'contract_id'>,
  input: RefundDetailsInput,
): Promise<void> {
  const d = refundDetailsSchema.parse(input);
  if (live(r.contract_id)) {
    await rpc('update_refund_details', {
      p_id: r.id,
      p_method: d.method,
      p_beneficiary: d.beneficiary,
      p_iban: d.iban || null,
      p_bank: d.bank || null,
      p_note: d.note ?? null,
    });
    return;
  }
  const row = refunds.find((x) => x.id === r.id) ?? fail('طلب الاسترداد غير موجود');
  if (row.status !== 'draft') fail('تُعدَّل بيانات الاسترداد في المسودة فقط');
  Object.assign(row, {
    method: d.method,
    beneficiary_name: d.beneficiary,
    customer_iban: d.method === 'transfer' ? d.iban : null,
    bank_name: d.bank || null,
    note: d.note?.trim() || null,
  });
  log(row.contract_id, 'refund', row.id, 'details', 'draft', 'draft', null);
}

export type RefundAction = 'submit' | 'review' | 'approve' | 'queue' | 'reject';

export async function refundStep(
  r: Pick<Refund, 'id' | 'contract_id'>,
  action: RefundAction,
  note?: string,
): Promise<void> {
  if (live(r.contract_id)) {
    await rpc('refund_step', { p_id: r.id, p_action: action, p_note: note ?? null });
    return;
  }
  const row = refunds.find((x) => x.id === r.id) ?? fail('طلب الاسترداد غير موجود');
  const from = row.status;
  const u = me().id;
  const to: RefundStatus = (() => {
    switch (action) {
      case 'submit':
        if (from !== 'draft') fail('يُرسل الاسترداد من المسودة فقط');
        if (!row.method) fail('حدّد وسيلة الاسترداد أولاً');
        row.submitted_by = u;
        return 'pending_review';
      case 'review':
        if (from !== 'pending_review') fail('الاسترداد ليس بانتظار المراجعة');
        if (row.submitted_by === u)
          fail('لا يراجع مقدّم الطلب طلبه (أربع أعين) — سجّل دخولك بحساب آخر');
        return 'pending_finance';
      case 'approve':
        if (from !== 'pending_finance') fail('الاسترداد ليس بانتظار الاعتماد المالي');
        if (row.submitted_by === u)
          fail('لا يعتمد مقدّم الطلب طلبه (أربع أعين) — سجّل دخولك بحساب آخر');
        return 'approved';
      case 'queue':
        if (from !== 'approved') fail('يُرسل للصرف بعد الاعتماد المالي');
        return 'pending_payout';
      case 'reject':
        if (!['pending_review', 'pending_finance', 'approved'].includes(from)) {
          fail('لا يمكن رفض الاسترداد في حالته الحالية');
        }
        if (!note?.trim()) fail('اكتب سبب الرفض');
        return 'rejected';
    }
  })();
  row.status = to;
  log(row.contract_id, 'refund', row.id, action, from, to, note);
}

export const payoutSchema = z.object({
  amount: z.number().positive({ message: 'مبلغ الصرف يجب أن يكون أكبر من صفر' }),
  transferRef: z.string().trim().min(1, { message: 'اكتب رقم مرجع التحويل' }),
  paidOn: z.string().min(1, { message: 'حدّد تاريخ الصرف' }),
  bankCode: z.string().regex(/^111\d$/, { message: 'اختر حساب الصرف' }),
});
export type PayoutInput = z.infer<typeof payoutSchema>;

export async function recordPayout(
  r: Pick<Refund, 'id' | 'contract_id'>,
  input: PayoutInput,
): Promise<void> {
  const p = payoutSchema.parse(input);
  if (live(r.contract_id)) {
    await rpc('record_refund_payout', {
      p_id: r.id,
      p_amount: p.amount,
      p_transfer_ref: p.transferRef,
      p_paid_on: p.paidOn,
      p_bank_code: p.bankCode,
    });
    return;
  }
  const row = refunds.find((x) => x.id === r.id) ?? fail('طلب الاسترداد غير موجود');
  if (!['pending_payout', 'partially_refunded'].includes(row.status)) {
    fail('لا يُصرف إلا استرداد معتمد ومُرسَل للصرف');
  }
  const left = Math.round((row.amount - row.paid_total) * 100) / 100;
  if (p.amount > left) fail(`المبلغ يتجاوز المتبقي من الاسترداد (${left})`);
  if (p.paidOn > today()) fail('تاريخ الصرف غير صحيح');
  const ref = p.transferRef.trim().toLowerCase();
  if (payouts.some((x) => x.transfer_ref.trim().toLowerCase() === ref)) {
    fail('رقم مرجع التحويل مسجّل مسبقاً — لا صرف مكرر');
  }
  payouts.push({
    id: `po-${payouts.length + 1}`,
    refund_id: row.id,
    amount: p.amount,
    transfer_ref: p.transferRef.trim(),
    paid_on: p.paidOn,
    bank_code: p.bankCode,
    journal_entry_id: null,
    created_at: nowIso(),
  });
  const from = row.status;
  row.paid_total = Math.round((row.paid_total + p.amount) * 100) / 100;
  row.status = row.paid_total >= row.amount ? 'refunded' : 'partially_refunded';
  log(
    row.contract_id,
    'refund',
    row.id,
    'payout',
    from,
    row.status,
    `${p.amount} ﷼ — مرجع ${p.transferRef.trim()}`,
  );
}

/* ------------------------------ operations log ---------------------------- */

export async function listOpsEvents(contractId: string): Promise<OpsEvent[]> {
  if (!live(contractId)) {
    return events.filter((e) => e.contract_id === contractId).map((e) => ({ ...e }));
  }
  const { data, error } = await supabase
    .from('contract_ops_events')
    .select('*')
    .eq('contract_id', contractId)
    .order('created_at');
  if (error) throw new Error(`تعذّر جلب سجل العمليات: ${error.message}`);
  return (data ?? []) as OpsEvent[];
}

/** Demo-only hook used by other modules (replacement, trial) to record into the same log. */
export function demoLogOp(
  contractId: string,
  entity: OpsEvent['entity'],
  entityId: string,
  action: string,
  from: string | null,
  to: string | null,
  note?: string | null,
): void {
  log(contractId, entity, entityId, action, from, to, note);
}
