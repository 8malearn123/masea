/**
 * المبيعات الفعلية — مسحوبة من العقود، لا تُدخل يدويًا.
 * مع قاعدة البيانات: جدول `sales` (0063) يملؤه مشغّل العقود، صف لكل عقد، وRLS
 * تقصر مدير الفرع على فرعه وموظف المبيعات على مبيعاته. في الوضع التجريبي تُشتق
 * من مخزن العقود نفسه بنفس القاعدة (حالة البيع المعتمدة)، فلا تكرار للبيانات.
 */
import { riyadhDay } from '@/shared/lib/format';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { useAuth } from '@/store/auth';
import { recordAudit } from '@/shared/lib/auditTrail';
import { getQuoteRecord, quoteCoupon } from '@/shared/lib/quotesLedger';
import { listContracts } from '@/features/contracts/api/contracts.api';
import type { ContractListItem } from '@/features/contracts/types';
import type { Sale, SaleNote, SaleStatus, SalesFilters } from '@/features/sales/types';

/** The contract statuses that count as a sale — same set as contract_is_sold() (0063). */
export const SOLD_STATUSES = ['signed', 'active', 'musaned_signed', 'completed'] as const;

export function contractIsSold(status: string): boolean {
  return (SOLD_STATUSES as readonly string[]).includes(status);
}

// Demo: the responsible sales rep of each branch (realistic seed, matches demo accounts)
const DEMO_SELLER_BY_BRANCH: Record<string, string> = {
  نجران: 'نايف اليامي',
  جازان: 'ريم الشهري',
  شرورة: 'نورة العتيبي',
  حبونا: 'عبدالرحمن آل سالم',
};

function saleFromContract(c: ContractListItem): Sale | null {
  // a contract cancelled before it was ever signed was never a sale
  const status: SaleStatus | null = contractIsSold(c.status)
    ? c.status === 'completed'
      ? 'completed'
      : 'confirmed'
    : c.status === 'cancelled' && c.signed_at
      ? 'cancelled'
      : null;
  if (!status) return null;
  const quote = c.quote_id ? getQuoteRecord(c.quote_id) : null;
  // MAS-2026-00008 → 8 (the contract's running number)
  const seqPart = (c.contract_no ?? c.id).split('-').at(-1) ?? '';
  return {
    id: `sale-${c.id}`,
    sale_no: Number(seqPart.replace(/\D/g, '')) || 0,
    contract_id: c.id,
    contract_no: c.contract_no,
    quote_id: c.quote_id ?? null,
    customer_id: c.customer_id,
    customer_name: c.customer_name,
    branch: c.branch_name ?? c.branch_id,
    service_code: c.service_code,
    worker_name: quote?.worker_name ?? c.worker_name,
    gross_amount: c.gross_amount ?? c.base_amount,
    discount_amount: c.discount_amount,
    net_amount: c.base_amount,
    vat_amount: c.vat_amount,
    total_amount: c.total_amount,
    collected: c.amount_paid,
    coupon_code: quote ? (quote.coupon_code ?? quoteCoupon(quote)) : null,
    is_renewal: c.parent_contract_id !== null,
    sold_at: c.signed_at ?? (c.start_date ? `${c.start_date}T09:00:00Z` : c.created_at),
    sold_by_name: quote?.assigned_to ?? DEMO_SELLER_BY_BRANCH[c.branch_id ?? ''] ?? null,
    status,
  };
}

interface RawSale extends Omit<Sale, 'contract_no' | 'customer_name' | 'branch' | 'collected'> {
  customers: { full_name: string | null } | null;
  branches: { city: string | null } | null;
  contracts: { contract_no: string | null; amount_paid: number | null } | null;
}

export async function listSales(): Promise<Sale[]> {
  if (isDemoMode()) {
    const contracts = await listContracts({
      status: 'all',
      service: 'all',
      branch: 'all',
      search: '',
    });
    let rows = contracts.map(saleFromContract).filter((s): s is Sale => s !== null);
    // a sales rep sees their own sales only (same rule as can_view_sale)
    const profile = useAuth.getState().profile;
    if (profile?.role === 'sales') rows = rows.filter((s) => s.sold_by_name === profile.full_name);
    return rows.sort((a, b) => b.sold_at.localeCompare(a.sold_at));
  }
  const { data, error } = await supabase
    .from('sales')
    .select(
      'id, sale_no, contract_id, quote_id, customer_id, service_code, worker_name, gross_amount, discount_amount, net_amount, vat_amount, total_amount, coupon_code, is_renewal, sold_at, sold_by_name, status, customers(full_name), branches(city), contracts(contract_no, amount_paid)',
    )
    .order('sold_at', { ascending: false });
  if (error) throw new Error(`تعذّر جلب المبيعات: ${error.message}`);
  return ((data ?? []) as unknown as RawSale[]).map(({ customers, branches, contracts, ...s }) => ({
    ...s,
    gross_amount: Number(s.gross_amount),
    discount_amount: Number(s.discount_amount),
    net_amount: Number(s.net_amount),
    vat_amount: Number(s.vat_amount),
    total_amount: Number(s.total_amount),
    contract_no: contracts?.contract_no ?? null,
    collected: Number(contracts?.amount_paid ?? 0),
    customer_name: customers?.full_name ?? null,
    branch: branches?.city ?? null,
  }));
}

export function applySalesFilters(rows: Sale[], f: SalesFilters): Sale[] {
  const q = f.search.trim();
  return rows.filter((s) => {
    const day = riyadhDay(s.sold_at);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.branch !== 'all' && s.branch !== f.branch) return false;
    if (f.employee !== 'all' && s.sold_by_name !== f.employee) return false;
    if (f.service !== 'all' && s.service_code !== f.service) return false;
    if (f.status !== 'all' && s.status !== f.status) return false;
    if (q && !`${s.sale_no} ${s.contract_no ?? ''} ${s.customer_name ?? ''}`.includes(q))
      return false;
    return true;
  });
}

export interface SalesTotals {
  count: number;
  gross: number; // إجمالي المبيعات (قيمة العقود)
  discounts: number;
  net: number; // صافي المبيعات قبل الضريبة (الإيراد)
  total: number; // شامل الضريبة
  collected: number;
  cancelled: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cancelled sales are listed but never counted in the totals. */
export function salesTotals(rows: Sale[]): SalesTotals {
  const live = rows.filter((s) => s.status !== 'cancelled');
  const sum = (
    k: keyof Pick<
      Sale,
      'gross_amount' | 'discount_amount' | 'net_amount' | 'total_amount' | 'collected'
    >,
  ) => r2(live.reduce((acc, s) => acc + s[k], 0));
  return {
    count: live.length,
    gross: sum('gross_amount'),
    discounts: sum('discount_amount'),
    net: sum('net_amount'),
    total: sum('total_amount'),
    collected: sum('collected'),
    cancelled: rows.length - live.length,
  };
}

/* --------------------------------- notes ---------------------------------- */
const DEMO_NOTES: SaleNote[] = [];
let noteSeq = 0;

export async function listSaleNotes(saleId: string): Promise<SaleNote[]> {
  if (isDemoMode() || isDemoId(saleId)) {
    return DEMO_NOTES.filter((n) => n.sale_id === saleId).sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  }
  const { data, error } = await supabase
    .from('sale_notes')
    .select('id, sale_id, note, created_by_name, created_at')
    .eq('sale_id', saleId)
    .order('created_at');
  if (error) throw new Error(`تعذّر جلب الملاحظات: ${error.message}`);
  return (data ?? []) as SaleNote[];
}

export async function addSaleNote(
  sale: Pick<Sale, 'id' | 'contract_no' | 'branch'>,
  note: string,
): Promise<void> {
  const text = note.trim();
  if (text.length < 2) throw new Error('اكتب الملاحظة');
  if (isDemoMode() || isDemoId(sale.id)) {
    DEMO_NOTES.push({
      id: `sn-${++noteSeq}`,
      sale_id: sale.id,
      note: text,
      created_by_name: useAuth.getState().profile?.full_name ?? null,
      created_at: new Date().toISOString(),
    });
    recordAudit({
      action: 'insert',
      entity: 'sale_notes',
      record_ref: sale.contract_no,
      old_data: null,
      new_data: { note: text },
      branch: sale.branch,
    });
    return;
  }
  const { error } = await supabase.from('sale_notes').insert({ sale_id: sale.id, note: text });
  if (error) throw new Error(`تعذّر حفظ الملاحظة: ${error.message}`);
}
