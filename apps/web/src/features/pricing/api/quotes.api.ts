import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import {
  addEvent,
  addQuoteRecord,
  getQuoteRecord,
  linkQuoteContract,
  listQuoteEvents,
  listQuoteRecords,
  setQuoteRecordStatus,
  type QuoteApprovalPolicy,
  type QuoteEvent,
  type QuoteRecord,
  type QuoteStatus,
} from '@/shared/lib/quotesLedger';
import type { PricingConfig } from '@/shared/lib/pricing';
import {
  buildSnapshot,
  calculate,
  type CalcInput,
  type PriceSnapshot,
} from '@/features/pricing/lib/engine';
import { recordPricingLog } from '@/features/pricing/api/pricing.api';
import type { PricingRule } from '@/features/pricing/types';

/**
 * Quotes over the shared ledger (same records as Sales CRM). Creation re-runs
 * the calculation and refuses anything that breaks the pricing rules; with
 * Supabase connected the same check runs in `create_quote_from_price` (0058),
 * which recomputes via calc_price and stores the snapshot server-side.
 */
export type PricingQuote = QuoteRecord;
export type { QuoteEvent, QuoteStatus };

/** A `quotes` row as the backend returns it (numerics may arrive as strings). */
type QuoteRow = Omit<QuoteRecord, 'snapshot' | 'assigned_to'> & { price_snapshot?: unknown };

function fromQuoteRow(q: QuoteRow, assignedTo: string | null = null): PricingQuote {
  const { price_snapshot, ...rest } = q;
  return {
    ...rest,
    base_amount: Number(q.base_amount),
    vat_amount: Number(q.vat_amount),
    total_amount: Number(q.total_amount),
    gross_amount: q.gross_amount == null ? null : Number(q.gross_amount),
    discount_amount: Number(q.discount_amount ?? 0),
    terms: Array.isArray(q.terms) ? q.terms : [],
    assigned_to: assignedTo,
    snapshot: price_snapshot ?? null,
  };
}

export async function listQuotes(): Promise<PricingQuote[]> {
  try {
    const { data, error } = await supabase
      .from('quotes')
      .select(
        'id, quote_no, lead_id, service_code, nationality, profession, quantity, base_amount, vat_amount, total_amount, status, valid_until, notes, contract_id, created_at, sent_at, decided_at, parent_id, price_snapshot, customer_name, customer_phone, customer_id, worker_profile_id, worker_name, start_date, duration_unit, duration_count, end_date, gross_amount, discount_amount, coupon_code, terms, request_id, approved_at, start_time, end_time',
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (!error && data && data.length > 0)
      return (data as unknown as QuoteRow[]).map((q) => fromQuoteRow(q));
  } catch {
    /* fall through */
  }
  return listQuoteRecords();
}

export async function listEvents(quoteId: string): Promise<QuoteEvent[]> {
  try {
    if (!isDemoId(quoteId)) {
      const { data, error } = await supabase
        .from('quote_events')
        .select('*')
        .eq('quote_id', quoteId)
        .order('at');
      if (!error && data && data.length > 0) return data as QuoteEvent[];
    }
  } catch {
    /* fall through */
  }
  return listQuoteEvents(quoteId);
}

export interface CreateQuoteInput {
  calc: CalcInput;
  customer_name: string;
  customer_phone: string | null;
  valid_days: number;
  notes: string | null;
  parent_id?: string | null;
  /** Sales lead the quote belongs to (shown in the lead file) */
  lead_id?: string | null;
  /** Lead-file quote details (customer, worker, duration, terms) — 0062 p_extra */
  extra?: QuoteExtra;
}

export interface QuoteExtra {
  customer_id?: string | null;
  worker_profile_id?: string | null;
  worker_name?: string | null;
  start_date?: string | null;
  duration_unit?: QuoteRecord['duration_unit'];
  duration_count?: number | null;
  end_date?: string | null;
  terms?: string[];
  branch?: string | null;
  /** hourly rental arrival / leave (HH:MM) */
  start_time?: string | null;
  end_time?: string | null;
}

export function validateQuoteMeta(
  i: Pick<CreateQuoteInput, 'customer_name' | 'customer_phone' | 'valid_days'>,
): string[] {
  const e: string[] = [];
  if (i.customer_name.trim().length < 3) e.push('اسم العميل مطلوب');
  if (
    i.customer_phone &&
    !/^(05\d{8}|9665\d{8}|\+9665\d{8})$/.test(i.customer_phone.replace(/\s/g, ''))
  )
    e.push('رقم الجوال بصيغة 05xxxxxxxx');
  if (!Number.isInteger(i.valid_days) || i.valid_days < 1 || i.valid_days > 90)
    e.push('صلاحية العرض بين 1 و90 يومًا');
  return e;
}

/** Create a quote from the calculator — rules re-checked, snapshot frozen. */
export async function createQuote(
  input: CreateQuoteInput,
  ctx: { rules: PricingRule[]; cfg: PricingConfig; actor: string },
): Promise<PricingQuote> {
  const metaErrors = validateQuoteMeta(input);
  if (metaErrors.length) throw new Error(metaErrors.join(' · '));
  const result = calculate(input.calc, ctx.rules, ctx.cfg);
  if (result.blockers.length) throw new Error(result.blockers.join(' · '));
  const snapshot: PriceSnapshot = buildSnapshot(input.calc, result, ctx.cfg);
  const valid_until = new Date(Date.now() + input.valid_days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const isDaily = input.calc.service === 'daily_rental';

  try {
    const { data, error } = await supabase.rpc('create_quote_from_price', {
      p_service_code: input.calc.service,
      p_params: {
        nationality: isDaily ? null : input.calc.nationality,
        profession: isDaily ? input.calc.profession : null,
        quantity: input.calc.quantity,
        late_days: input.calc.lateDays,
        absence_days: input.calc.absenceDays,
        cancelled: input.calc.cancelled,
        promotion_id: input.calc.promotion?.id ?? null,
        promotion_code: input.calc.couponCode,
      },
      p_customer_name: input.customer_name.trim(),
      p_customer_phone: input.customer_phone,
      p_valid_until: valid_until,
      p_notes: input.notes,
      p_parent_id: input.parent_id ?? null,
      p_snapshot: snapshot,
      p_extra: {
        lead_id: input.lead_id && !isDemoId(input.lead_id) ? input.lead_id : null,
        customer_id:
          input.extra?.customer_id && !isDemoId(input.extra.customer_id)
            ? input.extra.customer_id
            : null,
        worker_profile_id:
          input.extra?.worker_profile_id && !isDemoId(input.extra.worker_profile_id)
            ? input.extra.worker_profile_id
            : null,
        worker_name: input.extra?.worker_name ?? null,
        start_date: input.extra?.start_date ?? null,
        duration_unit: input.extra?.duration_unit ?? null,
        duration_count: input.extra?.duration_count ?? null,
        terms: input.extra?.terms ?? [],
        start_time: input.extra?.start_time ?? null,
        end_time: input.extra?.end_time ?? null,
      },
    });
    if (!error && data) {
      const q = fromQuoteRow(data as unknown as QuoteRow, ctx.actor);
      return { ...q, snapshot: q.snapshot ?? snapshot };
    }
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (!isIgnorableWriteError(msg)) throw e;
  }
  const rec = addQuoteRecord(
    {
      lead_id: input.lead_id ?? null,
      customer_name: input.customer_name.trim(),
      customer_phone: input.customer_phone?.trim() || null,
      service_code: input.calc.service,
      nationality: isDaily ? null : input.calc.nationality,
      profession: isDaily ? input.calc.profession : null,
      quantity: input.calc.quantity,
      base_amount: result.detail.net,
      vat_amount: result.detail.vat,
      total_amount: result.detail.total,
      valid_until,
      notes: input.notes,
      assigned_to: ctx.actor,
      parent_id: input.parent_id ?? null,
      snapshot,
      gross_amount: result.detail.base,
      discount_amount: result.detail.discounts,
      coupon_code: input.calc.couponCode?.trim().toUpperCase() || null,
      customer_id: input.extra?.customer_id ?? null,
      worker_profile_id: input.extra?.worker_profile_id ?? null,
      worker_name: input.extra?.worker_name ?? null,
      start_date: input.extra?.start_date ?? null,
      duration_unit: input.extra?.duration_unit ?? null,
      duration_count: input.extra?.duration_count ?? null,
      end_date: input.extra?.end_date ?? null,
      terms: input.extra?.terms ?? [],
      branch: input.extra?.branch ?? null,
      start_time: input.extra?.start_time ?? null,
      end_time: input.extra?.end_time ?? null,
    },
    ctx.actor,
  );
  recordPricingLog(
    input.calc.service,
    snapshot.inputs as unknown as Record<string, unknown>,
    result.detail,
    {
      op_type: 'quote',
      reference: `QT-${rec.quote_no}`,
      user_name: ctx.actor,
    },
  );
  return rec;
}

/** Accept / reject / mark-sent — lifecycle-guarded (no jump back from a decision). */
export async function setQuoteStatus(
  id: string,
  to: QuoteStatus,
  actor: string,
  note?: string,
  policy?: QuoteApprovalPolicy,
): Promise<PricingQuote> {
  if (!isDemoId(id) && !getQuoteRecord(id)) {
    const { data, error } = await supabase.rpc('set_quote_status', {
      p_quote_id: id,
      p_status: to,
      p_note: note ?? null,
    });
    // a real row: the backend is the record — never fall through to the demo ledger
    if (!error && data) return fromQuoteRow(data as unknown as QuoteRow, actor);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  }
  return setQuoteRecordStatus(id, to, actor, note, policy);
}

/**
 * WhatsApp: we can only know that the share link was OPENED — not that the
 * customer received it. Record that event; the status stays as it is until the
 * employee confirms the send.
 */
export function logWhatsappOpened(id: string, actor: string): void {
  addEvent(id, 'whatsapp_opened', actor, 'فُتح رابط واتساب — لا يُعدّ تأكيدًا للاستلام');
}

export function logPdf(id: string, actor: string): void {
  addEvent(id, 'pdf_generated', actor);
}

export function linkContract(id: string, contractRef: string, actor: string): void {
  linkQuoteContract(id, contractRef, actor);
}
