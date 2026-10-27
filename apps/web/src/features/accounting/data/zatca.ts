import { fromHalala, mulMoney, sumMoney, toHalala } from '@/features/accounting/data/money';
import type { Bill, Invoice } from '@/features/accounting/types';

/**
 * Saudi VAT & e-invoicing (ZATCA / FATOORA) helpers.
 *
 * STATUS — be explicit about what is and isn't compliant:
 *  ✔ Phase 1 (Generation): TLV QR (tags 1–5, Base64) per the ZATCA e-invoicing
 *    resolution; mandatory-field validation; no editing of issued invoices
 *    (corrections by credit/debit notes).
 *  ◐ Phase 2 (Integration): UBL 2.1 invoice payload, invoice counter (ICV),
 *    previous-invoice-hash chain (PIH) and SHA-256 hash are GENERATED here, but
 *    the XML is not C14N-canonicalised, not XAdES-signed and not submitted.
 *    Production use needs: onboarding on FATOORA, a CSID from ZATCA's
 *    compliance API, cryptographic stamp, compliance-check run, then the
 *    clearance (B2B standard) / reporting (B2C simplified, ≤ 24h) APIs.
 * Nothing here claims official compliance — see zatca.gov.sa for the current
 * technical specifications (XML implementation standard, security features).
 */

/* ----------------------------- tax categories ---------------------------- */
export type TaxCategory = 'S' | 'Z' | 'E' | 'O';
export const TAX_CATEGORY_LABEL: Record<TaxCategory, string> = {
  S: 'خاضع للنسبة الأساسية',
  Z: 'خاضع للنسبة الصفرية',
  E: 'معفى',
  O: 'خارج نطاق الضريبة',
};

export function isValidVatNumber(v: string): boolean {
  return /^3\d{13}3$/.test(v.trim());
}

/* ------------------------------ Phase 1 QR ------------------------------- */
function tlv(tag: number, value: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > 255) throw new Error('قيمة QR أطول من المسموح');
  return [tag, bytes.length, ...bytes];
}

function toBase64(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface QrInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO 8601
  total: number; // incl. VAT
  vat: number;
}

/** ZATCA Phase-1 QR payload: Base64(TLV(1 seller, 2 VAT no., 3 time, 4 total, 5 VAT)). */
export function zatcaQr(i: QrInput): string {
  return toBase64([
    ...tlv(1, i.sellerName),
    ...tlv(2, i.vatNumber),
    ...tlv(3, i.timestamp),
    ...tlv(4, fromHalala(toHalala(i.total)).toFixed(2)),
    ...tlv(5, fromHalala(toHalala(i.vat)).toFixed(2)),
  ]);
}

/** Decode a TLV QR back into its fields (used by tests and the verification view). */
export function decodeQr(b64: string): Record<number, string> {
  const bin = atob(b64);
  const bytes = Array.from(bin, (c) => c.charCodeAt(0));
  const out: Record<number, string> = {};
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i] as number;
    const len = bytes[i + 1] as number;
    out[tag] = new TextDecoder().decode(new Uint8Array(bytes.slice(i + 2, i + 2 + len)));
    i += 2 + len;
  }
  return out;
}

export interface SellerProfile {
  name: string;
  vat_number: string;
  cr_number: string;
  address: string;
  city: string;
}

/** Mandatory-field validation (Phase 1 + Phase 2 data readiness). */
export function invoiceComplianceErrors(
  inv: Invoice,
  seller: SellerProfile,
  buyer: { vat_number?: string | null } = {},
): string[] {
  const e: string[] = [];
  if (!seller.name.trim()) e.push('اسم البائع مطلوب');
  if (!isValidVatNumber(seller.vat_number))
    e.push('الرقم الضريبي للبائع غير صالح (15 رقمًا يبدأ وينتهي بـ 3)');
  if (inv.type === 'standard') {
    if (!seller.address.trim()) e.push('عنوان البائع مطلوب للفاتورة الضريبية المعيارية');
    if (buyer.vat_number && !isValidVatNumber(buyer.vat_number))
      e.push('الرقم الضريبي للمشتري غير صالح');
  }
  if (inv.lines.length === 0) e.push('الفاتورة بلا بنود');
  const sub = sumMoney(inv.lines.map((l) => l.line_subtotal));
  const vat = sumMoney(inv.lines.map((l) => l.line_vat));
  if (toHalala(sub) !== toHalala(inv.subtotal))
    e.push('مجموع البنود لا يطابق الإجمالي قبل الضريبة');
  if (toHalala(vat) !== toHalala(inv.vat_amount))
    e.push('مجموع ضريبة البنود لا يطابق ضريبة الفاتورة');
  if (toHalala(inv.subtotal + inv.vat_amount) !== toHalala(inv.total))
    e.push('الإجمالي ≠ قبل الضريبة + الضريبة');
  return e;
}

/* --------------------------- Phase 2 (readiness) ------------------------- */
export type EInvoiceStatus =
  | 'not_generated'
  | 'generated' // XML + hash + QR built locally
  | 'pending_submission'
  | 'cleared'
  | 'reported'
  | 'rejected'
  | 'error';
export const EINV_STATUS_LABEL: Record<EInvoiceStatus, string> = {
  not_generated: 'لم تُولَّد',
  generated: 'مولّدة محليًا',
  pending_submission: 'بانتظار الإرسال',
  cleared: 'مُجازة (Clearance)',
  reported: 'مُبلَّغ عنها (Reporting)',
  rejected: 'مرفوضة',
  error: 'خطأ تكامل',
};

export interface EInvoiceRecord {
  invoice_id: string;
  uuid: string;
  icv: number; // invoice counter value
  pih: string; // previous invoice hash (Base64)
  hash: string; // this invoice hash (Base64, SHA-256)
  qr: string;
  xml: string;
  status: EInvoiceStatus;
  messages: string[];
  generated_at: string;
}

/** Spec seed for the first PIH: Base64 of the hex SHA-256 digest of "0". */
export const FIRST_PIH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** UBL 2.1 invoice payload (unsigned) — structure per the ZATCA XML standard. */
export function buildUblXml(
  inv: Invoice,
  seller: SellerProfile,
  meta: { uuid: string; icv: number; pih: string; issueTime: string },
): string {
  const typeName = inv.type === 'standard' ? '0100000' : '0200000';
  const cur = 'SAR';
  const f = (n: number) => fromHalala(toHalala(n)).toFixed(2);
  const lines = inv.lines
    .map(
      (l, i) => `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${f(l.line_subtotal)}</cbc:LineExtensionAmount>
    <cac:TaxTotal><cbc:TaxAmount currencyID="${cur}">${f(l.line_vat)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="${cur}">${f(l.line_total)}</cbc:RoundingAmount></cac:TaxTotal>
    <cac:Item><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${f(l.vat_rate * 100)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${cur}">${f(l.unit_price)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${inv.invoice_no}</cbc:ID>
  <cbc:UUID>${meta.uuid}</cbc:UUID>
  <cbc:IssueDate>${inv.issue_date}</cbc:IssueDate>
  <cbc:IssueTime>${meta.issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeName}">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${cur}</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${meta.icv}</cbc:UUID></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${meta.pih}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="CRN">${esc(seller.cr_number)}</cbc:ID></cac:PartyIdentification>
    <cac:PostalAddress><cbc:StreetName>${esc(seller.address)}</cbc:StreetName><cbc:CityName>${esc(seller.city)}</cbc:CityName><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${esc(seller.vat_number)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(seller.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>${esc(inv.customer_name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="${cur}">${f(inv.vat_amount)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${f(inv.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${f(inv.subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${f(inv.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${cur}">${f(inv.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

export async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toBase64(Array.from(new Uint8Array(digest)));
}

/**
 * Generate the Phase-2 data package for an invoice, chained to the previous
 * one. Result status is `generated` — NOT cleared/reported: submission needs a
 * production CSID that this deployment does not have.
 */
export async function generateEInvoice(
  inv: Invoice,
  seller: SellerProfile,
  prev: { icv: number; hash: string } | null,
  uuid: string,
  now = new Date().toISOString(),
): Promise<EInvoiceRecord> {
  const errors = invoiceComplianceErrors(inv, seller);
  const icv = (prev?.icv ?? 0) + 1;
  const pih = prev?.hash ?? FIRST_PIH;
  const issueTime = now.slice(11, 19);
  const xml = buildUblXml(inv, seller, { uuid, icv, pih, issueTime });
  const hash = await sha256Base64(xml);
  const qr = zatcaQr({
    sellerName: seller.name,
    vatNumber: seller.vat_number,
    timestamp: `${inv.issue_date}T${issueTime}Z`,
    total: inv.total,
    vat: inv.vat_amount,
  });
  return {
    invoice_id: inv.id,
    uuid,
    icv,
    pih,
    hash,
    qr,
    xml,
    status: errors.length ? 'error' : 'generated',
    messages: errors,
    generated_at: now,
  };
}

/** Which Phase-2 flow an invoice follows. */
export function submissionFlow(inv: Invoice): 'clearance' | 'reporting' {
  return inv.type === 'standard' ? 'clearance' : 'reporting';
}

/** Readiness checklist (what's done in-system vs. needs official integration). */
export const PHASE2_CHECKLIST: { item: string; done: boolean; note: string }[] = [
  { item: 'رمز QR بصيغة TLV (المرحلة الأولى)', done: true, note: 'مولّد لكل فاتورة' },
  { item: 'منع تعديل الفاتورة المُصدرة والتصحيح بإشعار دائن/مدين', done: true, note: 'مطبّق' },
  { item: 'هيكل XML وفق UBL 2.1', done: true, note: 'مولّد — يحتاج تحقق المطابقة الرسمي' },
  { item: 'عدّاد الفواتير ICV وسلسلة التجزئة PIH', done: true, note: 'مولّد محليًا' },
  { item: 'التطبيع C14N والتوقيع الرقمي XAdES', done: false, note: 'يتطلب شهادة CSID' },
  { item: 'التسجيل في منصة فاتورة والحصول على CSID', done: false, note: 'إجراء رسمي من المنشأة' },
  { item: 'اجتياز فحص المطابقة (Compliance Check)', done: false, note: 'بعد التوقيع' },
  {
    item: 'واجهات الإجازة Clearance والإبلاغ Reporting',
    done: false,
    note: 'بنية الحالات جاهزة؛ الاتصال غير مفعّل',
  },
];

/* ---------------------------- VAT return form --------------------------- */
export interface VatReturnBox {
  box: number;
  label: string;
  amount: number; // taxable base
  vat: number;
  adjustment?: number;
}
export interface VatReturnForm {
  period: string;
  boxes: VatReturnBox[];
  totalSalesVat: number;
  totalPurchasesVat: number;
  netVat: number;
  notes: string[];
}

export interface SalesCreditNote {
  id: string;
  note_no: number;
  invoice_id: string | null;
  customer_name: string;
  branch: string | null;
  note_date: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  reason: string;
}

/**
 * VAT return in the ZATCA form layout, from documents of the period.
 * Imported services from foreign recruitment offices are shown under the
 * reverse-charge box (self-assessed output = input → net zero) as a REVIEW
 * item: the current postings book them without VAT.
 */
export function vatReturnForm(
  period: string,
  rate: number,
  invoices: Invoice[],
  creditNotes: SalesCreditNote[],
  bills: Bill[],
  cashExpenses: { expense_date: string; subtotal: number; vat_amount: number }[],
  corrections = 0,
): VatReturnForm {
  const inP = (d: string) => d.startsWith(period);
  const sales = invoices.filter((i) => i.status !== 'void' && inP(i.issue_date));
  const std = sales.filter((i) => toHalala(i.vat_amount) > 0);
  const zero = sales.filter((i) => toHalala(i.vat_amount) === 0);
  const cns = creditNotes.filter((n) => inP(n.note_date));
  const pb = bills.filter((b) => b.status !== 'void' && inP(b.issue_date));
  const domestic = pb.filter((b) => toHalala(b.vat_amount) > 0);
  const imported = pb.filter(
    (b) => toHalala(b.vat_amount) === 0 && b.vendor_type === 'external_office',
  );
  const exempt = pb.filter(
    (b) => toHalala(b.vat_amount) === 0 && b.vendor_type !== 'external_office',
  );
  const ce = cashExpenses.filter((e) => inP(e.expense_date));
  const s = (xs: number[]) => sumMoney(xs);

  const b1Base = s(std.map((i) => i.subtotal));
  const b1Vat = s(std.map((i) => i.vat_amount));
  const cnBase = s(cns.map((n) => n.subtotal));
  const cnVat = s(cns.map((n) => n.vat_amount));
  const rcBase = s(imported.map((b) => b.subtotal));
  const rcVat = mulMoney(rcBase, rate);
  const b7Base = s([
    ...domestic.map((b) => b.subtotal),
    ...ce.filter((e) => e.vat_amount > 0).map((e) => e.subtotal),
  ]);
  const b7Vat = s([...domestic.map((b) => b.vat_amount), ...ce.map((e) => e.vat_amount)]);

  const boxes: VatReturnBox[] = [
    {
      box: 1,
      label: 'المبيعات الخاضعة للنسبة الأساسية',
      amount: b1Base,
      vat: b1Vat,
      adjustment: -cnVat,
    },
    {
      box: 3,
      label: 'المبيعات المحلية الخاضعة للنسبة الصفرية',
      amount: s(zero.map((i) => i.subtotal)),
      vat: 0,
    },
    { box: 4, label: 'الصادرات', amount: 0, vat: 0 },
    { box: 5, label: 'المبيعات المعفاة', amount: 0, vat: 0 },
    {
      box: 6,
      label: 'إجمالي المبيعات',
      amount: fromHalala(
        toHalala(b1Base) - toHalala(cnBase) + toHalala(s(zero.map((i) => i.subtotal))),
      ),
      vat: fromHalala(toHalala(b1Vat) - toHalala(cnVat)),
    },
    { box: 7, label: 'المشتريات الخاضعة للنسبة الأساسية', amount: b7Base, vat: b7Vat },
    { box: 8, label: 'الاستيرادات الخاضعة للضريبة المدفوعة في الجمارك', amount: 0, vat: 0 },
    { box: 9, label: 'الاستيرادات الخاضعة لآلية الاحتساب العكسي', amount: rcBase, vat: rcVat },
    {
      box: 11,
      label: 'المشتريات المعفاة/غير الخاضعة',
      amount: s(exempt.map((b) => b.subtotal)),
      vat: 0,
    },
    {
      box: 12,
      label: 'إجمالي المشتريات',
      amount: s([b7Base, rcBase, s(exempt.map((b) => b.subtotal))]),
      vat: s([b7Vat, rcVat]),
    },
  ];
  // reverse charge: self-assessed output (box 9) is also due on the sales side
  const totalSalesVat = s([fromHalala(toHalala(b1Vat) - toHalala(cnVat)), rcVat]);
  const totalPurchasesVat = s([b7Vat, rcVat]);
  const netVat = s([totalSalesVat, -totalPurchasesVat, corrections]);
  const notes: string[] = [];
  if (imported.length)
    notes.push(
      `${imported.length} فاتورة من مكاتب خارجية بلا ضريبة — تخضع غالبًا للاحتساب العكسي (أُدرجت في البند 9، صافي أثرها صفر عند قابلية الخصم الكاملة). يُنصح بمراجعة مستشار ضريبي وتعديل قيد الترحيل.`,
    );
  if (corrections) notes.push('يشمل تصحيحات فترات سابقة مدخلة يدويًا (البند 14).');
  return { period, boxes, totalSalesVat, totalPurchasesVat, netVat, notes };
}
