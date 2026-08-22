import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { listCustomerSales, settleCustomerSale, type CustomerSale } from '@/shared/lib/salesLedger';
import type { Invoice } from '@/features/payments/types';

/** Shared customer-sales ledger → the Payments invoice view (same data as Accounting). */
function saleToPaymentInvoice(s: CustomerSale): Invoice {
  return {
    id: s.id,
    contract_no: `MAS-2026-${String(s.invoice_no).padStart(5, '0')}`,
    customer_name: s.customer_name,
    base: s.subtotal,
    vat: s.vat,
    total: s.total,
    status: s.status === 'paid' ? 'paid' : s.status === 'partial' ? 'partial' : 'unpaid',
    method: null,
    reference_no: null,
    created_at: `${s.issue_date}T08:00:00Z`,
  };
}

function genRef(): string {
  return `PMT-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

export async function listInvoices(): Promise<Invoice[]> {
  // Single source of truth: the shared customer-sales ledger (same as Accounting).
  return listCustomerSales()
    .filter((s) => s.status !== 'void')
    .map(saleToPaymentInvoice);
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const s = listCustomerSales().find((x) => x.id === id);
  return s ? saleToPaymentInvoice(s) : null;
}

/** Stub payment — settles the shared ledger so Accounting reflects it instantly. */
export async function recordPayment(
  invoiceId: string,
  method: string,
  amount: number,
): Promise<{ reference_no: string }> {
  const reference_no = genRef();
  settleCustomerSale(invoiceId, amount); // reflect collection in the shared ledger
  // Demo invoice → no backend round-trip needed.
  if (isDemoId(invoiceId)) return { reference_no };
  const { error } = await supabase.from('payments').insert({
    contract_id: invoiceId,
    amount,
    method,
    reference_no,
  });
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  return { reference_no };
}
