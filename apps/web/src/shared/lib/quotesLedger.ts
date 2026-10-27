/**
 * Shared quotes ledger — ONE demo store for the `quotes` table, used by both
 * Pricing (calculator quotes) and Sales CRM (lead quotes), so a quote created
 * anywhere is the same record everywhere. With Supabase connected this maps to
 * `quotes` + `quote_events` (0044 / 0058).
 *
 * `base_amount` keeps its existing meaning (amount BEFORE VAT, i.e. the net);
 * the full breakdown lives in the immutable `snapshot`.
 */
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
export type QuoteEventType =
  | 'created'
  | 'whatsapp_opened'
  | 'marked_sent'
  | 'pdf_generated'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'version_created'
  | 'converted';

export interface QuoteEvent {
  id: string;
  quote_id: string;
  type: QuoteEventType;
  at: string;
  actor: string;
  note?: string;
}

export interface QuoteRecord {
  id: string;
  quote_no: number;
  lead_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  service_code: string;
  nationality: string | null;
  profession: string | null;
  quantity: number;
  base_amount: number; // before VAT (net)
  vat_amount: number;
  total_amount: number;
  status: QuoteStatus;
  valid_until: string | null;
  notes: string | null;
  contract_id: string | null;
  assigned_to: string | null; // employee name
  created_at: string;
  sent_at: string | null;
  decided_at: string | null;
  parent_id: string | null; // new version of …
  snapshot: unknown | null; // PriceSnapshot (pricing) — null for legacy rows
}

const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

let quoteNo = 1000;
const SEED: Omit<QuoteRecord, 'quote_no'>[] = [
  {
    id: 'quote-1',
    lead_id: 'lead-3',
    customer_name: 'سعد الوادعي',
    customer_phone: '0555100203',
    service_code: 'recruitment',
    nationality: 'إندونيسيا',
    profession: null,
    quantity: 1,
    base_amount: 15500,
    vat_amount: 2325,
    total_amount: 17825,
    status: 'sent',
    valid_until: iso(7).slice(0, 10),
    notes: 'عرض استقدام — بانتظار الرد',
    contract_id: null,
    assigned_to: 'نورة العتيبي',
    created_at: iso(-2),
    sent_at: iso(-2),
    decided_at: null,
    parent_id: null,
    snapshot: null,
  },
  {
    id: 'q-2',
    lead_id: null,
    customer_name: 'منيرة اليامي',
    customer_phone: '0555100202',
    service_code: 'monthly_rental',
    nationality: 'إندونيسيا',
    profession: null,
    quantity: 3,
    base_amount: 6600,
    vat_amount: 990,
    total_amount: 7590,
    status: 'accepted',
    valid_until: iso(3).slice(0, 10),
    notes: 'تأجير شهري — ٣ أشهر',
    contract_id: null,
    assigned_to: 'نورة العتيبي',
    created_at: iso(-6),
    sent_at: iso(-6),
    decided_at: iso(-4),
    parent_id: null,
    snapshot: null,
  },
  {
    id: 'q-3',
    lead_id: null,
    customer_name: 'حصة آل سالم',
    customer_phone: '0555100204',
    service_code: 'daily_rental',
    nationality: null,
    profession: 'تنظيف',
    quantity: 5,
    base_amount: 900,
    vat_amount: 135,
    total_amount: 1035,
    status: 'draft',
    valid_until: iso(5).slice(0, 10),
    notes: null,
    contract_id: null,
    assigned_to: 'فهد الشهري',
    created_at: iso(-1),
    sent_at: null,
    decided_at: null,
    parent_id: null,
    snapshot: null,
  },
];
const QUOTES: QuoteRecord[] = SEED.map((q) => ({ ...q, quote_no: ++quoteNo }));
const EVENTS: QuoteEvent[] = QUOTES.flatMap((q) => [
  {
    id: `ev-${q.id}-c`,
    quote_id: q.id,
    type: 'created' as const,
    at: q.created_at,
    actor: q.assigned_to ?? 'النظام',
  },
  ...(q.sent_at
    ? [
        {
          id: `ev-${q.id}-s`,
          quote_id: q.id,
          type: 'marked_sent' as const,
          at: q.sent_at,
          actor: q.assigned_to ?? 'النظام',
        },
      ]
    : []),
  ...(q.decided_at
    ? [
        {
          id: `ev-${q.id}-d`,
          quote_id: q.id,
          type: q.status === 'accepted' ? ('accepted' as const) : ('rejected' as const),
          at: q.decided_at,
          actor: q.assigned_to ?? 'النظام',
        },
      ]
    : []),
]);
let evSeq = 0;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Effective status: an open quote past its validity is shown (and stored) as expired. */
export function effectiveStatus(
  q: Pick<QuoteRecord, 'status' | 'valid_until'>,
  today = new Date().toISOString().slice(0, 10),
): QuoteStatus {
  if ((q.status === 'draft' || q.status === 'sent') && q.valid_until && q.valid_until < today)
    return 'expired';
  return q.status;
}

export function listQuoteRecords(): QuoteRecord[] {
  const today = new Date().toISOString().slice(0, 10);
  for (const q of QUOTES) {
    const eff = effectiveStatus(q, today);
    if (eff !== q.status) {
      q.status = eff;
      addEvent(q.id, 'expired', 'النظام', `انتهت الصلاحية ${q.valid_until}`);
    }
  }
  return clone(QUOTES).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getQuoteRecord(id: string): QuoteRecord | null {
  const q = QUOTES.find((x) => x.id === id);
  return q ? clone(q) : null;
}

export type NewQuoteRecord = Omit<
  QuoteRecord,
  'id' | 'quote_no' | 'created_at' | 'sent_at' | 'decided_at' | 'contract_id' | 'status'
> & { id?: string; status?: QuoteStatus };

export function addQuoteRecord(input: NewQuoteRecord, actor: string): QuoteRecord {
  const now = new Date().toISOString();
  const status = input.status ?? 'draft';
  const row: QuoteRecord = {
    ...input,
    id: input.id ?? `q-${Date.now()}-${++evSeq}`,
    quote_no: ++quoteNo,
    status,
    created_at: now,
    sent_at: status === 'sent' ? now : null,
    decided_at: null,
    contract_id: null,
  };
  QUOTES.unshift(clone(row));
  addEvent(
    row.id,
    input.parent_id ? 'version_created' : 'created',
    actor,
    input.parent_id ? `نسخة جديدة من عرض سابق` : undefined,
  );
  if (status === 'sent') addEvent(row.id, 'marked_sent', actor);
  return clone(row);
}

const ALLOWED: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['sent', 'accepted', 'rejected'],
  sent: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
  expired: [],
};
export function canMoveTo(from: QuoteStatus, to: QuoteStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Status change with lifecycle guard + event. */
export function setQuoteRecordStatus(
  id: string,
  to: QuoteStatus,
  actor: string,
  note?: string,
): QuoteRecord {
  const q = QUOTES.find((x) => x.id === id);
  if (!q) throw new Error('العرض غير موجود');
  const from = effectiveStatus(q);
  if (from === to) return clone(q);
  if (!canMoveTo(from, to)) throw new Error(`لا يمكن نقل العرض من «${from}» إلى «${to}»`);
  q.status = to;
  const now = new Date().toISOString();
  if (to === 'sent') q.sent_at = now;
  if (to === 'accepted' || to === 'rejected') q.decided_at = now;
  addEvent(
    id,
    to === 'sent' ? 'marked_sent' : to === 'accepted' ? 'accepted' : 'rejected',
    actor,
    note,
  );
  return clone(q);
}

export function linkQuoteContract(id: string, contractId: string, actor: string): void {
  const q = QUOTES.find((x) => x.id === id);
  if (!q) return;
  q.contract_id = contractId;
  addEvent(id, 'converted', actor, contractId);
}

/**
 * Contract-wizard link for a quote (service, nationality/task, quantity,
 * coupon) — the one path from Pricing and Sales into a real contract.
 */
export function quoteContractPath(
  q: Pick<QuoteRecord, 'id' | 'service_code' | 'nationality' | 'profession' | 'quantity'>,
  coupon?: string | null,
): string {
  const p = new URLSearchParams({ service: q.service_code, quote: q.id });
  if (q.nationality) p.set('nationality', q.nationality);
  if (q.profession) p.set('task', q.profession);
  if (q.quantity > 1) p.set('quantity', String(q.quantity));
  if (coupon) p.set('coupon', coupon);
  return `/contracts/new?${p.toString()}`;
}

/** Coupon code frozen in a quote's snapshot (null for legacy quotes). */
export function quoteCoupon(q: Pick<QuoteRecord, 'snapshot'>): string | null {
  const s = q.snapshot as { inputs?: { couponCode?: string | null } } | null;
  return s?.inputs?.couponCode ?? null;
}

export function addEvent(
  quoteId: string,
  type: QuoteEventType,
  actor: string,
  note?: string,
): QuoteEvent {
  const ev: QuoteEvent = {
    id: `ev-${++evSeq}-${Date.now()}`,
    quote_id: quoteId,
    type,
    at: new Date().toISOString(),
    actor,
    ...(note ? { note } : {}),
  };
  EVENTS.push(ev);
  return clone(ev);
}

export function listQuoteEvents(quoteId: string): QuoteEvent[] {
  return clone(EVENTS.filter((e) => e.quote_id === quoteId)).sort((a, b) =>
    a.at.localeCompare(b.at),
  );
}
