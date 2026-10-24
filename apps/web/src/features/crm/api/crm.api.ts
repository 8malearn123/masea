import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
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

const DEMO_QUOTES: Quote[] = [
  {
    id: 'quote-1',
    lead_id: 'lead-3',
    customer_name: 'سعد الوادعي',
    service_code: 'recruitment',
    base_amount: 15500,
    vat_amount: 2325,
    total_amount: 17825,
    status: 'sent',
    valid_until: iso(7).slice(0, 10),
    contract_id: null,
    created_at: iso(-2),
  },
];

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
  try {
    const { data, error } = await supabase
      .from('leads')
      .select(
        'id, full_name, phone, source_code, service_code, stage_code, est_value, notes, customer_id, created_at, updated_at',
      )
      .order('updated_at', { ascending: false });
    if (!error && data && data.length > 0) return data as Lead[];
  } catch {
    /* fall through */
  }
  return [...DEMO_LEADS].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function listActivities(leadId?: string): Promise<LeadActivity[]> {
  const rows = leadId ? DEMO_ACTIVITIES.filter((a) => a.lead_id === leadId) : DEMO_ACTIVITIES;
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listQuotes(leadId?: string): Promise<Quote[]> {
  const rows = leadId ? DEMO_QUOTES.filter((q) => q.lead_id === leadId) : DEMO_QUOTES;
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getMyTarget(): Promise<SalesTarget> {
  return DEMO_TARGET;
}

export interface Renewal {
  id: string;
  customer_name: string;
  service_code: string;
  end_date: string;
  total_amount: number;
}

/** My contracts nearing expiry (renewal opportunities). */
export async function listRenewals(): Promise<Renewal[]> {
  return [
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
}

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
  const row: Lead = {
    id: `lead-${++seq}`,
    ...input,
    customer_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase.from('leads').insert(input).select().single();
    if (!error && data) return data as Lead;
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  } catch {
    /* demo */
  }
  DEMO_LEADS.unshift(row);
  return row;
}

export async function updateLead(id: string, patch: Partial<LeadInput>): Promise<void> {
  if (!isDemoId(id)) {
    const { error } = await supabase.from('leads').update(patch).eq('id', id);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  const row = DEMO_LEADS.find((l) => l.id === id);
  if (row) Object.assign(row, patch, { updated_at: new Date().toISOString() });
}

export async function setLeadStage(id: string, stage: LeadStageCode): Promise<void> {
  if (!isDemoId(id)) {
    const { error } = await supabase.from('leads').update({ stage_code: stage }).eq('id', id);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
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
  if (!isDemoId(input.lead_id)) {
    const { error } = await supabase.from('lead_activities').insert(input);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  DEMO_ACTIVITIES.unshift({
    id: `act-${++seq}`,
    ...input,
    done: false,
    created_at: new Date().toISOString(),
  });
}

export async function toggleActivityDone(id: string, done: boolean): Promise<void> {
  if (!isDemoId(id)) {
    const { error } = await supabase.from('lead_activities').update({ done }).eq('id', id);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  const row = DEMO_ACTIVITIES.find((a) => a.id === id);
  if (row) row.done = done;
}

/* ---------------------------- quotes + conversion ------------------------- */
export interface QuoteInput {
  lead_id: string | null;
  customer_name: string | null;
  service_code: Quote['service_code'];
  base_amount: number;
  vat_amount: number;
  total_amount: number;
  valid_until: string | null;
}

export async function createQuote(input: QuoteInput): Promise<Quote> {
  const row: Quote = {
    id: `quote-${++seq}`,
    ...input,
    status: 'sent',
    contract_id: null,
    created_at: new Date().toISOString(),
  };
  if (input.lead_id && !isDemoId(input.lead_id)) {
    const { error } = await supabase.from('quotes').insert({ ...input, status: 'sent' });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  }
  DEMO_QUOTES.unshift(row);
  // sending a quote moves the lead to the "quoted" stage
  if (input.lead_id) {
    const lead = DEMO_LEADS.find((l) => l.id === input.lead_id);
    if (lead && (lead.stage_code === 'new' || lead.stage_code === 'contacted')) {
      lead.stage_code = 'quoted';
      lead.updated_at = new Date().toISOString();
    }
  }
  return row;
}

export async function setQuoteStatus(id: string, status: Quote['status']): Promise<void> {
  if (!isDemoId(id)) {
    const { error } = await supabase.from('quotes').update({ status }).eq('id', id);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  const row = DEMO_QUOTES.find((q) => q.id === id);
  if (row) row.status = status;
}

/** Convert a lead to a customer (reuses the customers table via the RPC). */
export async function convertLead(leadId: string): Promise<void> {
  if (!isDemoId(leadId)) {
    const { error } = await supabase.rpc('convert_lead_to_customer', { p_lead_id: leadId });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  const lead = DEMO_LEADS.find((l) => l.id === leadId);
  if (lead) {
    lead.customer_id = lead.customer_id ?? `cust-${++seq}`;
    lead.updated_at = new Date().toISOString();
  }
}

/** Accept a quote and mark it converted to a contract (lead → won). */
export async function convertQuoteToContract(quoteId: string): Promise<void> {
  const q = DEMO_QUOTES.find((x) => x.id === quoteId);
  if (q) {
    q.status = 'accepted';
    q.contract_id = q.contract_id ?? `contract-${++seq}`;
    if (q.lead_id) {
      const lead = DEMO_LEADS.find((l) => l.id === q.lead_id);
      if (lead) {
        lead.stage_code = 'won';
        lead.updated_at = new Date().toISOString();
      }
    }
  }
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

/** Commission rate (placeholder for a managed settings value). */
export const COMMISSION_RATE = 0.025;
