/**
 * الفاتورة الضريبية للعقد وإشعاراتها (0097). العقد ليس فاتورة: تُصدر فاتورة
 * واحدة عند التوقيع (تلقائياً في الخادم)، والتصحيح بإشعار دائن/مدين — لا تعديل.
 * الوضع التجريبي: مخزن في الذاكرة بالقواعد نفسها، والـ QR من بيانات الطرف الأول.
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { zatcaQr } from '@/features/accounting/data/zatca';
import { getContract } from '@/features/contracts/api/contracts.api';
import { getCompanyProfile } from '@/features/contracts/api/rentalContract.api';
import type { ContractListItem } from '@/features/contracts/types';

export type TaxDocKind = 'invoice' | 'credit_note' | 'debit_note';
export const TAX_DOC_LABEL: Record<TaxDocKind, string> = {
  invoice: 'فاتورة ضريبية',
  credit_note: 'إشعار دائن',
  debit_note: 'إشعار مدين',
};
export const INVOICE_STATUS_LABEL: Record<string, string> = {
  issued: 'مُصدرة',
  partial: 'مدفوعة جزئياً',
  paid: 'مدفوعة',
  void: 'ملغاة',
  draft: 'مسودة',
};

export interface TaxDocument {
  id: string;
  kind: TaxDocKind;
  doc_no: string;
  doc_date: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  status: string;
  /** standard (منشأة بسجل ضريبي) | simplified (فرد) */
  invoice_type: 'standard' | 'simplified' | null;
  reason: string | null;
  zatca_qr: string | null;
  issued_at: string;
}

const SIGNED = ['signed', 'musaned_signed', 'active', 'completed'];
const DEMO: Record<string, TaxDocument[]> = {};
let demoSeq = 0;
export function resetContractInvoicesDemo(): void {
  for (const k of Object.keys(DEMO)) delete DEMO[k];
  demoSeq = 0;
}
const demo = (id: string) => isDemoMode() || isDemoId(id);
const r2 = (n: number) => Math.round(n * 100) / 100;

async function demoQr(at: string, total: number, vat: number): Promise<string | null> {
  const co = await getCompanyProfile().catch(() => null);
  if (!co?.vat_number) return null;
  return zatcaQr({ sellerName: co.name, vatNumber: co.vat_number, timestamp: at, total, vat });
}

function invoiceStatus(c: ContractListItem): string {
  return c.amount_paid >= c.total_amount ? 'paid' : c.amount_paid > 0 ? 'partial' : 'issued';
}

async function demoIssue(c: ContractListItem): Promise<TaxDocument> {
  const docs = (DEMO[c.id] ??= []);
  const existing = docs.find((d) => d.kind === 'invoice' && d.status !== 'void');
  if (existing) return existing;
  const at = new Date().toISOString();
  demoSeq += 1;
  const doc: TaxDocument = {
    id: `inv-${c.id}`,
    kind: 'invoice',
    doc_no: `INV-${String(demoSeq).padStart(6, '0')}`,
    doc_date: at.slice(0, 10),
    subtotal: c.base_amount,
    vat_amount: c.vat_amount,
    total: c.total_amount,
    status: invoiceStatus(c),
    invoice_type: 'simplified',
    reason: null,
    zatca_qr: await demoQr(at, c.total_amount, c.vat_amount),
    issued_at: at,
  };
  docs.unshift(doc);
  return doc;
}

export async function listTaxDocuments(contractId: string): Promise<TaxDocument[]> {
  if (demo(contractId)) {
    const c = await getContract(contractId);
    if (!c) return [];
    // الوضع التجريبي يحاكي الإصدار التلقائي عند التوقيع
    if (SIGNED.includes(c.status) && c.total_amount > 0) await demoIssue(c);
    for (const d of DEMO[contractId] ?? []) if (d.kind === 'invoice') d.status = invoiceStatus(c);
    return (DEMO[contractId] ?? []).map((d) => ({ ...d }));
  }
  const { data, error } = await supabase.rpc('contract_tax_documents', { p_contract: contractId });
  if (error) throw new Error(`تعذّر جلب الفواتير: ${error.message}`);
  return ((data ?? []) as TaxDocument[]).map((d) => ({
    ...d,
    subtotal: Number(d.subtotal),
    vat_amount: Number(d.vat_amount),
    total: Number(d.total),
  }));
}

export async function issueContractInvoice(contractId: string): Promise<void> {
  const c = await getContract(contractId);
  if (!c) throw new Error('العقد غير موجود');
  if (!SIGNED.includes(c.status)) throw new Error('تُصدر الفاتورة الضريبية بعد توقيع العقد فقط');
  if (demo(contractId)) {
    await demoIssue(c);
    return;
  }
  const { error } = await supabase.rpc('issue_contract_invoice', { p_contract: contractId });
  if (error) throw new Error(error.message);
}

/** صافي الفاتورة بعد الإشعارات — الحد الأقصى للإشعار الدائن. */
export function invoiceNet(docs: TaxDocument[]): number {
  const inv = docs.find((d) => d.kind === 'invoice' && d.status !== 'void');
  if (!inv) return 0;
  return r2(
    docs.reduce(
      (s, d) => s + (d.kind === 'credit_note' ? -d.total : d.kind === 'debit_note' ? d.total : 0),
      inv.total,
    ),
  );
}

export const taxNoteSchema = z.object({
  kind: z.enum(['credit', 'debit']),
  total: z.number().positive({ message: 'مبلغ الإشعار يجب أن يكون أكبر من صفر' }),
  reason: z.string().trim().min(5, { message: 'سبب الإشعار مطلوب (5 أحرف على الأقل)' }),
});
export type TaxNoteInput = z.infer<typeof taxNoteSchema>;

export async function issueContractNote(contractId: string, input: TaxNoteInput): Promise<void> {
  const n = taxNoteSchema.parse(input);
  if (demo(contractId)) {
    const docs = await listTaxDocuments(contractId);
    const inv = docs.find((d) => d.kind === 'invoice' && d.status !== 'void');
    if (!inv) throw new Error('لا فاتورة ضريبية لهذا العقد — أصدرها أولاً');
    if (n.kind === 'credit' && n.total > invoiceNet(docs))
      throw new Error(`الإشعار الدائن يتجاوز صافي الفاتورة (${invoiceNet(docs)})`);
    const rate = inv.subtotal > 0 ? inv.vat_amount / inv.subtotal : 0;
    const net = r2(n.total / (1 + rate));
    const at = new Date().toISOString();
    demoSeq += 1;
    (DEMO[contractId] ??= []).push({
      id: `note-${Date.now()}-${demoSeq}`,
      kind: n.kind === 'credit' ? 'credit_note' : 'debit_note',
      doc_no: `${n.kind === 'credit' ? 'CN' : 'DN'}-${String(demoSeq).padStart(6, '0')}`,
      doc_date: at.slice(0, 10),
      subtotal: net,
      vat_amount: r2(n.total - net),
      total: r2(n.total),
      status: 'issued',
      invoice_type: null,
      reason: n.reason.trim(),
      zatca_qr: await demoQr(at, r2(n.total), r2(n.total - net)),
      issued_at: at,
    });
    return;
  }
  const { error } = await supabase.rpc('issue_contract_note', {
    p_contract: contractId,
    p_kind: n.kind,
    p_total: n.total,
    p_reason: n.reason.trim(),
  });
  if (error) throw new Error(error.message);
}
