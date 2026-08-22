import { supabase } from '@/shared/lib/supabase';
import { isIgnorableWriteError } from '@/shared/lib/demoBackend';
import type { PricingQuote } from '@/features/pricing/types';

/** Input for a quote generated straight from the pricing calculator. */
export interface CreateQuoteInput {
  service_code: string;
  customer_name: string | null;
  customer_phone: string | null;
  base_amount: number;
  vat_amount: number;
  total_amount: number;
  valid_until: string | null;
  notes: string | null;
}

/** Demo quotes — mirrors the sales `quotes` table when Supabase is offline. */
const FALLBACK: PricingQuote[] = [
  {
    id: 'q-1',
    service_code: 'recruitment',
    customer_name: 'سعد الوادعي',
    customer_phone: '0555100203',
    base_amount: 15500,
    vat_amount: 2325,
    total_amount: 17825,
    status: 'sent',
    valid_until: '2026-08-05',
    notes: 'عرض استقدام — بانتظار الرد',
    created_at: '2026-07-20T09:00:00Z',
  },
  {
    id: 'q-2',
    service_code: 'monthly_rental',
    customer_name: 'منيرة اليامي',
    customer_phone: '0555100202',
    base_amount: 7500,
    vat_amount: 1125,
    total_amount: 8625,
    status: 'accepted',
    valid_until: '2026-07-30',
    notes: 'تأجير شهري — ٣ أشهر',
    created_at: '2026-07-18T11:30:00Z',
  },
  {
    id: 'q-3',
    service_code: 'daily_rental',
    customer_name: 'حصة آل سالم',
    customer_phone: '0555100204',
    base_amount: 900,
    vat_amount: 135,
    total_amount: 1035,
    status: 'draft',
    valid_until: '2026-07-28',
    notes: null,
    created_at: '2026-07-22T14:10:00Z',
  },
];

/** Local demo store so newly created quotes persist within the session. */
const LOCAL: PricingQuote[] = [];

export async function listQuotes(): Promise<PricingQuote[]> {
  try {
    const { data, error } = await supabase
      .from('quotes')
      .select(
        'id, service_code, base_amount, vat_amount, total_amount, status, valid_until, notes, created_at, customers(full_name, phone)',
      )
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data && data.length > 0) {
      return (data as unknown as RawQuote[]).map((q) => ({
        id: q.id,
        service_code: q.service_code,
        customer_name: q.customers?.full_name ?? null,
        customer_phone: q.customers?.phone ?? null,
        base_amount: Number(q.base_amount),
        vat_amount: Number(q.vat_amount),
        total_amount: Number(q.total_amount),
        status: q.status,
        valid_until: q.valid_until,
        notes: q.notes,
        created_at: q.created_at,
      }));
    }
  } catch {
    /* fall through */
  }
  return [...LOCAL, ...FALLBACK];
}

interface RawQuote {
  id: string;
  service_code: string;
  base_amount: number | string;
  vat_amount: number | string;
  total_amount: number | string;
  status: PricingQuote['status'];
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  customers: { full_name: string | null; phone: string | null } | null;
}

export async function createQuote(input: CreateQuoteInput): Promise<PricingQuote> {
  const optimistic: PricingQuote = {
    id: `q-${Date.now()}`,
    service_code: input.service_code,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone,
    base_amount: input.base_amount,
    vat_amount: input.vat_amount,
    total_amount: input.total_amount,
    status: 'draft',
    valid_until: input.valid_until,
    notes: input.notes,
    created_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase
      .from('quotes')
      .insert({
        service_code: input.service_code,
        base_amount: input.base_amount,
        vat_amount: input.vat_amount,
        total_amount: input.total_amount,
        status: 'draft',
        valid_until: input.valid_until,
        notes: input.notes,
      })
      .select('id')
      .single();
    if (!error && data) return { ...optimistic, id: (data as { id: string }).id };
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (!isIgnorableWriteError(msg)) throw e;
  }
  LOCAL.unshift(optimistic); // offline demo → keep it visible in the session
  return optimistic;
}

export async function markQuoteSent(id: string): Promise<void> {
  const local = LOCAL.find((q) => q.id === id);
  if (local) local.status = 'sent';
  try {
    const { error } = await supabase.from('quotes').update({ status: 'sent' }).eq('id', id);
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  } catch {
    /* offline demo — local status change is the truth */
  }
}
