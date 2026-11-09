import { supabase } from '@/shared/lib/supabase';
import {
  getQuoteRecord,
  linkQuoteContract,
  quoteCoupon,
  setQuoteRecordStatus,
  type QuoteApprovalPolicy,
  type QuoteRecord,
} from '@/shared/lib/quotesLedger';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { useAuth } from '@/store/auth';
import { listEmployees } from '@/features/hr/api/hr.api';
import { targetBoard } from '@/features/hr/api/performance.api';
import { createContractFromQuote, listContracts } from '@/features/contracts/api/contracts.api';
import {
  contractInsight,
  EXPIRY_WINDOW_KEY,
  RENEWAL_WINDOW_DAYS,
} from '@/features/contracts/lib/contractInsights';
import { configValue, listConfig } from '@/features/settings/api/settings.api';
import { parseLeadInput, parseLeadPatch } from '@/features/crm/lib/leadInput';
import { scopeToViewerBranch, viewerScope } from '@/lib/branchScope';
import { recordAudit } from '@/shared/lib/auditTrail';
import { addLocalOrder } from '@/features/orders/api/orders.api';
import { demoBookingForQuote } from '@/features/hourly/api/hourly.api';
import type { PricingConfig } from '@/shared/lib/pricing';
import type { CalcInput } from '@/features/pricing/lib/engine';
import type { PricingRule } from '@/features/pricing/types';
import {
  createQuote as createPricingQuote,
  listQuotes as listPricingQuotes,
  setQuoteStatus as setPricingQuoteStatus,
  type QuoteExtra,
} from '@/features/pricing/api/quotes.api';
import type {
  ActivityKind,
  Lead,
  LeadActivity,
  LeadStageCode,
  Quote,
  SalesTarget,
} from '@/features/crm/types';

/* --------------------------- demo fallback (شرورة) ------------------------ */
let seq = 1000;
const now = Date.now();
const iso = (offsetDays: number) => new Date(now + offsetDays * 86_400_000).toISOString();

const DEMO_LEADS: Lead[] = [
  {
    id: 'lead-1',
    branch: 'شرورة',
    city: 'شرورة',
    full_name: 'عبدالله آل مفرح',
    phone: '0555100201',
    source_code: 'website',
    service_code: 'recruitment',
    stage_code: 'new',
    est_value: 16000,
    notes: 'مهتم باستقدام عاملة منزلية فلبينية',
    customer_id: null,
    created_at: iso(-1),
    updated_at: iso(-1),
  },
  {
    id: 'lead-2',
    branch: 'جازان',
    city: 'جازان',
    full_name: 'منيرة اليامي',
    phone: '0555100202',
    source_code: 'call_center',
    service_code: 'monthly_rental',
    stage_code: 'contacted',
    est_value: 7500,
    notes: 'طلبت تأجير شهري لسائق',
    customer_id: null,
    created_at: iso(-3),
    updated_at: iso(-1),
  },
  {
    id: 'lead-3',
    branch: 'شرورة',
    city: 'شرورة',
    full_name: 'سعد الوادعي',
    phone: '0555100203',
    source_code: 'referral',
    service_code: 'recruitment',
    stage_code: 'quoted',
    est_value: 15500,
    notes: 'أُرسل عرض سعر — بانتظار الرد',
    customer_id: null,
    created_at: iso(-5),
    updated_at: iso(-2),
  },
  {
    id: 'lead-4',
    branch: 'جازان',
    city: 'جازان',
    full_name: 'حصة آل سالم',
    phone: '0555100204',
    source_code: 'walk_in',
    service_code: 'daily_rental',
    stage_code: 'negotiation',
    est_value: 900,
    notes: 'تفاوض على سعر التأجير اليومي',
    customer_id: null,
    created_at: iso(-6),
    updated_at: iso(0),
  },
  {
    id: 'lead-5',
    branch: 'نجران',
    city: 'نجران',
    full_name: 'فيصل القحطاني',
    phone: '0555100205',
    source_code: 'campaign',
    service_code: 'sponsorship_transfer',
    stage_code: 'contacted',
    est_value: 5000,
    notes: 'نقل كفالة سائق خاص',
    customer_id: null,
    created_at: iso(-2),
    updated_at: iso(-1),
  },
  {
    id: 'lead-6',
    branch: 'شرورة',
    city: 'شرورة',
    full_name: 'نوف آل حمدان',
    phone: '0555100206',
    source_code: 'website',
    service_code: 'recruitment',
    stage_code: 'won',
    est_value: 17000,
    notes: 'تم التعاقد',
    customer_id: null,
    created_at: iso(-12),
    updated_at: iso(-4),
  },
  {
    id: 'lead-7',
    branch: 'حبونا',
    city: 'حبونا',
    full_name: 'بدر الفيفي',
    phone: '0555100207',
    source_code: 'referral',
    service_code: 'monthly_rental',
    stage_code: 'lost',
    est_value: 6800,
    notes: 'اختار مكتباً آخر',
    customer_id: null,
    created_at: iso(-14),
    updated_at: iso(-7),
  },
];

const DEMO_ACTIVITIES: LeadActivity[] = [
  {
    id: 'act-1',
    lead_id: 'lead-4',
    kind: 'call',
    note: 'اتصلت وشرحت العرض',
    follow_up_at: iso(-1),
    done: true,
    created_at: iso(-1),
  },
  {
    id: 'act-2',
    lead_id: 'lead-4',
    kind: 'whatsapp',
    note: 'متابعة عرض التأجير اليومي',
    follow_up_at: iso(0),
    done: false,
    created_at: iso(0),
  },
  {
    id: 'act-3',
    lead_id: 'lead-2',
    kind: 'call',
    note: 'تأكيد موعد لزيارة الفرع',
    follow_up_at: iso(0),
    done: false,
    created_at: iso(-1),
  },
  {
    id: 'act-4',
    lead_id: 'lead-3',
    kind: 'note',
    note: 'العميل يقارن مع مكتب آخر',
    follow_up_at: iso(1),
    done: false,
    created_at: iso(-2),
  },
];

// Quotes live in the SHARED ledger (shared/lib/quotesLedger) — the Pricing
// module reads/writes the same records.
const toCrmQuote = (q: QuoteRecord): Quote => ({
  id: q.id,
  lead_id: q.lead_id,
  customer_name: q.customer_name,
  service_code: q.service_code as Quote['service_code'],
  nationality: q.nationality,
  profession: q.profession,
  quantity: q.quantity,
  coupon_code: quoteCoupon(q),
  base_amount: q.base_amount,
  vat_amount: q.vat_amount,
  total_amount: q.total_amount,
  status: q.status,
  valid_until: q.valid_until,
  contract_id: q.contract_id,
  created_at: q.created_at,
});

const DEMO_TARGET: SalesTarget = {
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  contracts_target: 12,
  contracts_achieved: 7,
  collection_target: 90000,
  collection_achieved: 61500,
  commission_earned: 4350,
  rank: 2,
  rank_total: 5,
};

/* ------------------------------- queries --------------------------------- */
export async function listLeads(): Promise<Lead[]> {
  if (isDemoMode())
    return scopeToViewerBranch([...DEMO_LEADS], (l) => l.branch).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
  // خادم حقيقي: لا عملاء = قائمة فارغة، والخطأ يظهر للمستخدم (لا بيانات تجريبية)
  const { data, error } = await supabase
    .from('leads')
    .select(
      'id, full_name, phone, source_code, service_code, stage_code, est_value, notes, customer_id, created_at, updated_at, city, email, branches(city)',
    )
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`تعذّر تحميل العملاء المحتملين: ${error.message}`);
  return ((data ?? []) as unknown as (Lead & { branches: { city: string | null } | null })[]).map(
    ({ branches, ...l }) => ({
      ...l,
      est_value: Number(l.est_value ?? 0),
      branch: branches?.city ?? null,
    }),
  );
}

export async function getLead(id: string): Promise<Lead | null> {
  return (await listLeads()).find((l) => l.id === id) ?? null;
}

export async function listActivities(leadId?: string): Promise<LeadActivity[]> {
  if (!isDemoMode()) {
    let q = supabase
      .from('lead_activities')
      .select('id, lead_id, kind, note, follow_up_at, done, created_at')
      .not('lead_id', 'is', null)
      .order('created_at', { ascending: false });
    if (leadId) q = q.eq('lead_id', leadId);
    const { data, error } = await q;
    if (error) throw new Error(`تعذّر تحميل المتابعات: ${error.message}`);
    return (data ?? []) as LeadActivity[];
  }
  const rows = leadId ? DEMO_ACTIVITIES.filter((a) => a.lead_id === leadId) : DEMO_ACTIVITIES;
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listQuotes(leadId?: string): Promise<Quote[]> {
  // نفس مصدر عروض التسعير (الخادم مع قاعدة حقيقية، الدفتر في وضع العرض)
  const all = await listPricingQuotes();
  const rows = leadId ? all.filter((q) => q.lead_id === leadId) : all.filter((q) => q.lead_id);
  return rows.map(toCrmQuote).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * «هدفي هذا الشهر»: الهدف المُسند للموظف في الأداء والأهداف (performance_targets)
 * والمحقَّق محسوب من مبيعاته الفعلية. `null` = لا هدف لهذا الشهر (لا أرقام افتراضية).
 */
export async function getMyTarget(): Promise<SalesTarget | null> {
  if (isDemoMode()) return DEMO_TARGET;
  const uid = useAuth.getState().profile?.id;
  const me = (await listEmployees()).find((e) => e.user_id === uid);
  if (!me) return null;
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const board = await targetBoard(period);
  const mine = board.find((r) => r.employee_id === me.id);
  if (!mine) return null;
  const ranked = [...board].sort(
    (a, b) => b.contracts_achieved - a.contracts_achieved || b.sales_achieved - a.sales_achieved,
  );
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    contracts_target: mine.contracts_target,
    contracts_achieved: mine.contracts_achieved,
    collection_target: mine.sales_target,
    collection_achieved: mine.sales_achieved,
    commission_earned: 0,
    rank: ranked.findIndex((r) => r.employee_id === me.id) + 1,
    rank_total: ranked.length,
  };
}

export interface Renewal {
  id: string;
  customer_name: string;
  service_code: string;
  end_date: string;
  total_amount: number;
}

/**
 * فرص التجديد: عقودي السارية التي تقترب من نهايتها ضمن مهلة التنبيه المُدارة
 * (contract_expiry_alert_days) — من العقود الفعلية لا من قائمة ثابتة.
 */
export async function listRenewals(): Promise<Renewal[]> {
  if (isDemoMode()) return DEMO_RENEWALS;
  const [contracts, config] = await Promise.all([
    listContracts({ status: 'all', service: 'all', branch: 'all', search: '' }),
    listConfig(),
  ]);
  const windowDays = configValue(config, EXPIRY_WINDOW_KEY, RENEWAL_WINDOW_DAYS);
  const now = new Date();
  return contracts
    .filter((c) => c.status === 'active' && contractInsight(c, now, windowDays).nearExpiry)
    .map((c) => ({
      id: c.id,
      customer_name: c.customer_name ?? '—',
      service_code: c.service_code ?? '',
      end_date: c.end_date ?? '',
      total_amount: c.total_amount,
    }))
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
}

const DEMO_RENEWALS: Renewal[] = [
  {
    id: 'rnw-1',
    customer_name: 'سلطان آل غانم',
    service_code: 'monthly_rental',
    end_date: iso(9).slice(0, 10),
    total_amount: 7500,
  },
  {
    id: 'rnw-2',
    customer_name: 'ريم الوادعي',
    service_code: 'recruitment',
    end_date: iso(21).slice(0, 10),
    total_amount: 16500,
  },
  {
    id: 'rnw-3',
    customer_name: 'ماجد آل سالم',
    service_code: 'monthly_rental',
    end_date: iso(28).slice(0, 10),
    total_amount: 6800,
  },
];

/* ------------------------------ mutations -------------------------------- */
export interface LeadInput {
  full_name: string;
  phone: string | null;
  source_code: Lead['source_code'];
  service_code: Lead['service_code'];
  stage_code: LeadStageCode;
  est_value: number;
  notes: string | null;
}

export async function createLead(input: LeadInput): Promise<Lead> {
  const clean = parseLeadInput(input);
  if (!isDemoMode()) {
    // الفرع والإسناد للمنشئ يُضبطان في الخادم (trg_default_branch، guard_lead — 0085)
    const { data, error } = await supabase
      .from('leads')
      .insert(clean)
      .select(
        'id, full_name, phone, source_code, service_code, stage_code, est_value, notes, customer_id, created_at, updated_at, city, email, branches(city)',
      )
      .single();
    if (error) throw new Error(leadError(error.message));
    const { branches, ...l } = data as unknown as Lead & {
      branches: { city: string | null } | null;
    };
    return { ...l, est_value: Number(l.est_value ?? 0), branch: branches?.city ?? null };
  }
  const row: Lead = {
    id: `lead-${++seq}`,
    ...clean,
    branch: viewerScope().branch,
    customer_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  DEMO_LEADS.unshift(row);
  return row;
}

/** رسائل الخادم بصياغة المستخدم. */
function leadError(message: string): string {
  if (message.includes('leads_phone_chk')) return 'الجوال بصيغة 05xxxxxxxx';
  if (message.includes('leads_est_value_chk')) return 'القيمة المتوقعة لا تكون سالبة';
  if (message.includes('leads_name_chk')) return 'اسم العميل مطلوب';
  return message;
}

export async function updateLead(id: string, patch: Partial<LeadInput>): Promise<void> {
  const clean = parseLeadPatch(patch);
  if (!isDemoMode()) {
    const { data, error } = await supabase.from('leads').update(clean).eq('id', id).select('id');
    if (error) throw new Error(leadError(error.message));
    if (!data?.length) throw new Error('لا تملك صلاحية تعديل هذا العميل المحتمل');
    return;
  }
  const row = DEMO_LEADS.find((l) => l.id === id);
  if (row) Object.assign(row, clean, { updated_at: new Date().toISOString() });
}

export async function setLeadStage(id: string, stage: LeadStageCode): Promise<void> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('leads')
      .update({ stage_code: stage })
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('لا تملك صلاحية تعديل هذا العميل المحتمل');
    return;
  }
  const row = DEMO_LEADS.find((l) => l.id === id);
  if (row) {
    row.stage_code = stage;
    row.updated_at = new Date().toISOString();
  }
}

export async function addActivity(input: {
  lead_id: string;
  kind: ActivityKind;
  note: string | null;
  follow_up_at: string | null;
}): Promise<void> {
  if (!isDemoMode()) {
    const { error } = await supabase.from('lead_activities').insert(input);
    if (error) throw new Error(error.message);
    return;
  }
  DEMO_ACTIVITIES.unshift({
    id: `act-${++seq}`,
    ...input,
    done: false,
    created_at: new Date().toISOString(),
  });
}

export async function toggleActivityDone(id: string, done: boolean): Promise<void> {
  if (!isDemoMode()) {
    const { error } = await supabase.from('lead_activities').update({ done }).eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  const row = DEMO_ACTIVITIES.find((a) => a.id === id);
  if (row) row.done = done;
}

/* ---------------------------- quotes + conversion ------------------------- */
export interface QuoteInput {
  lead_id: string;
  calc: CalcInput;
  valid_days: number;
}

/**
 * Quick quote from a lead — the same pricing path as the calculator
 * (managed rules, validation, frozen snapshot), linked to the lead.
 */
export async function createQuote(
  input: QuoteInput,
  ctx: { rules: PricingRule[]; cfg: PricingConfig; actor: string },
): Promise<Quote> {
  const lead = DEMO_LEADS.find((l) => l.id === input.lead_id);
  const rec = await createPricingQuote(
    {
      calc: input.calc,
      customer_name: lead?.full_name ?? '',
      customer_phone: lead?.phone ?? null,
      valid_days: input.valid_days,
      notes: null,
      lead_id: input.lead_id,
    },
    ctx,
  );
  // a quote on the lead moves it to the "quoted" stage
  if (lead && (lead.stage_code === 'new' || lead.stage_code === 'contacted')) {
    lead.stage_code = 'quoted';
    lead.updated_at = new Date().toISOString();
  }
  return toCrmQuote(rec);
}

/** Lifecycle-guarded status change — same path as Pricing (set_quote_status). */
export async function setQuoteStatus(
  id: string,
  status: Quote['status'],
  actor: string,
  policy?: QuoteApprovalPolicy,
): Promise<void> {
  await setPricingQuoteStatus(id, status, actor, undefined, policy);
}

/** Convert a lead to a customer (reuses the customers table via the RPC). */
export async function convertLead(leadId: string): Promise<void> {
  if (!isDemoMode()) {
    const { error } = await supabase.rpc('convert_lead_to_customer', { p_lead_id: leadId });
    if (error) throw new Error(error.message);
    return;
  }
  const lead = DEMO_LEADS.find((l) => l.id === leadId);
  if (lead) {
    lead.customer_id = lead.customer_id ?? `cust-${++seq}`;
    lead.updated_at = new Date().toISOString();
  }
}

/**
 * After the contract wizard created a REAL contract from a quote: accept the
 * quote, link it to the contract and mark the lead won. Refuses a quote that
 * is already linked (one quote → one contract).
 */
export async function convertQuoteToContract(quoteId: string, contractRef: string): Promise<void> {
  const q = getQuoteRecord(quoteId);
  if (!q) return;
  if (q.contract_id) throw new Error('هذا العرض مرتبط بعقد مسبقًا');
  if (q.status !== 'accepted') setQuoteRecordStatus(quoteId, 'accepted', 'معالج العقود');
  linkQuoteContract(quoteId, contractRef, 'معالج العقود');
  if (q.lead_id) {
    const lead = DEMO_LEADS.find((l) => l.id === q.lead_id);
    if (lead) {
      lead.stage_code = 'won';
      lead.updated_at = new Date().toISOString();
    }
  }
}

/* ---------------------- lead file: quotes → contract (0062) ---------------------- */
/** All quotes of a lead (newest first) — the full records, as the lead file shows them. */
export async function listLeadQuotes(leadId: string): Promise<QuoteRecord[]> {
  return (await listPricingQuotes()).filter((q) => q.lead_id === leadId);
}

export interface LeadQuoteInput {
  lead: Lead;
  calc: CalcInput;
  valid_days: number;
  notes: string | null;
  extra: QuoteExtra;
  /** editing a quote = a new version of it (the priced snapshot is immutable) */
  parent_id?: string | null;
}

/** Quote from the lead file — same pricing path as the calculator, with the deal details. */
export async function createLeadQuote(
  input: LeadQuoteInput,
  ctx: { rules: PricingRule[]; cfg: PricingConfig; actor: string },
): Promise<QuoteRecord> {
  const rec = await createPricingQuote(
    {
      calc: input.calc,
      customer_name: input.lead.full_name,
      customer_phone: input.lead.phone,
      valid_days: input.valid_days,
      notes: input.notes,
      lead_id: input.lead.id,
      parent_id: input.parent_id ?? null,
      extra: {
        ...input.extra,
        customer_id: input.extra.customer_id ?? input.lead.customer_id,
        branch: input.lead.branch ?? viewerScope().branch,
      },
    },
    ctx,
  );
  const lead = DEMO_LEADS.find((l) => l.id === input.lead.id);
  if (lead && (lead.stage_code === 'new' || lead.stage_code === 'contacted')) {
    lead.stage_code = 'quoted';
    lead.updated_at = new Date().toISOString();
  }
  return rec;
}

/** Lifecycle + approval policy (set_quote_status, 0062). */
export async function setLeadQuoteStatus(
  id: string,
  status: QuoteRecord['status'],
  actor: string,
  policy: QuoteApprovalPolicy,
  note?: string,
): Promise<QuoteRecord> {
  return setPricingQuoteStatus(id, status, actor, note, policy);
}

/**
 * Accepted quote → customer → contract (frozen amounts, quote terms as clauses)
 * → operational order, all linked; the lead is won. One quote = one contract.
 * Backend: convert_quote_to_contract does it in one transaction.
 */
export async function convertQuote(
  q: QuoteRecord,
  actor: string,
): Promise<{ contract_id: string; contract_no: string | null }> {
  if (q.contract_id) throw new Error('هذا العرض مرتبط بعقد مسبقًا');
  if (q.status !== 'accepted') throw new Error('لا يُحوَّل إلى عقد إلا العرض المقبول من العميل');
  const lead = q.lead_id ? DEMO_LEADS.find((l) => l.id === q.lead_id) : undefined;
  const demo = isDemoMode() || isDemoId(q.id);
  // hourly: the worker must still be free — checked before anything is created
  if (demo && q.service_code === 'hourly_rental') await demoBookingForQuote(q, null);
  const contract = await createContractFromQuote(q, {
    branch: q.branch ?? lead?.branch ?? viewerScope().branch,
    customer_name: q.customer_name ?? lead?.full_name ?? 'عميل',
  });
  if (demo) {
    if (q.service_code === 'hourly_rental')
      await demoBookingForQuote(q, {
        id: contract.id,
        contract_no: contract.contract_no,
        branch: contract.branch_id,
      });
    const requestNo = `REQ-${Date.now().toString(36).toUpperCase().slice(-8)}`;
    addLocalOrder({
      request_no: requestNo,
      customer_name: contract.customer_name,
      service_code: q.service_code as Parameters<typeof addLocalOrder>[0]['service_code'],
      branch: contract.branch_id,
      total_amount: q.total_amount,
      contract: { id: contract.id, contract_no: contract.contract_no },
      status: 'new',
    });
    linkQuoteContract(q.id, contract.id, actor, {
      customer_id: contract.customer_id,
      request_id: requestNo,
      contract_no: contract.contract_no,
    });
    if (lead) {
      lead.stage_code = 'won';
      lead.customer_id = contract.customer_id;
      lead.updated_at = new Date().toISOString();
    }
    recordAudit({
      action: 'quote.convert',
      entity: 'contracts',
      record_ref: contract.contract_no,
      old_data: null,
      new_data: { quote_no: `QT-${q.quote_no}`, contract_no: contract.contract_no },
      branch: contract.branch_id,
    });
  }
  return { contract_id: contract.id, contract_no: contract.contract_no };
}

/**
 * Auto-capture a lead from an external touch point (landing page / call-center).
 * Reuses the leads pipeline — no separate inbox.
 */
export function captureLead(input: {
  full_name: string;
  phone: string | null;
  source_code: Lead['source_code'];
  service_code: Lead['service_code'];
  est_value: number;
  stage_code?: LeadStageCode;
}): void {
  DEMO_LEADS.unshift({
    id: `lead-${++seq}`,
    full_name: input.full_name,
    phone: input.phone,
    source_code: input.source_code,
    service_code: input.service_code,
    stage_code: input.stage_code ?? 'new',
    est_value: input.est_value,
    notes: 'التُقط تلقائياً',
    customer_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
