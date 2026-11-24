import { sar, dateAr } from '@/shared/lib/format';
import { escapeHtml } from '@/features/contracts/lib/rentalContract/render';
import { SERVICE_LABEL, type ContractListItem } from '@/features/contracts/types';
import type { CompanyProfile } from '@/features/contracts/lib/rentalContract/fields';
import { TAX_DOC_LABEL, type TaxDocument } from '@/features/contracts/api/contractInvoices.api';

/**
 * مستند الفاتورة الضريبية / الإشعار للطباعة وحفظه PDF — منفصل عن مستند العقد.
 * الفاتورة المبسطة (للأفراد) أو الضريبية (لمنشأة برقم ضريبي)، مع QR المرحلة الأولى.
 */
export function taxDocumentHtml(
  doc: TaxDocument,
  contract: ContractListItem,
  company: CompanyProfile,
  qrDataUrl: string | null,
  invoiceNo: string | null,
): string {
  const title =
    doc.kind === 'invoice'
      ? doc.invoice_type === 'standard'
        ? 'فاتورة ضريبية'
        : 'فاتورة ضريبية مبسطة'
      : TAX_DOC_LABEL[doc.kind];
  const e = (s: string | null | undefined) => escapeHtml(s ?? '');
  const service = contract.service_code ? SERVICE_LABEL[contract.service_code] : 'خدمة';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${e(doc.doc_no)}</title>
<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
body{font-family:Alexandria,sans-serif;color:#0f2a5c;margin:32px;font-size:13px}
h1{font-size:20px;margin:0 0 4px}.num{font-family:'JetBrains Mono',monospace;direction:ltr;unicode-bidi:embed}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f2a5c;padding-bottom:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border:1px solid #d6deec;padding:8px;text-align:right}
th{background:#eef2fa}.tot td{font-weight:700}.muted{color:#5b6b8c;font-size:11px}img.qr{width:130px;height:130px}
@media print{body{margin:12mm}}
</style></head><body>
<div class="head"><div><h1>${e(title)}</h1>
<div>رقم المستند: <span class="num">${e(doc.doc_no)}</span></div>
${invoiceNo && doc.kind !== 'invoice' ? `<div>مرتبط بالفاتورة: <span class="num">${e(invoiceNo)}</span></div>` : ''}
<div>تاريخ الإصدار: <span class="num">${e(dateAr(doc.issued_at))}</span></div>
<div>العقد: <span class="num">${e(contract.contract_no ?? contract.id)}</span></div></div>
${qrDataUrl ? `<img class="qr" src="${qrDataUrl}" alt="QR">` : ''}</div>
<table><tr><th>البائع</th><td>${e(company.name)}<div class="muted">الرقم الضريبي <span class="num">${e(company.vat_number)}</span> · السجل التجاري <span class="num">${e(company.cr_number)}</span></div><div class="muted">${e(company.address)}</div></td></tr>
<tr><th>العميل</th><td>${e(contract.customer_name ?? '')}</td></tr></table>
<table><thead><tr><th>البيان</th><th>المبلغ قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
<tbody><tr><td>${e(doc.kind === 'invoice' ? `${service} — ${contract.start_date ?? ''}${contract.end_date ? ` إلى ${contract.end_date}` : ''}` : (doc.reason ?? ''))}</td>
<td class="num">${sar(doc.subtotal)}</td><td class="num">${sar(doc.vat_amount)}</td><td class="num">${sar(doc.total)}</td></tr>
<tr class="tot"><td>الإجمالي شامل ضريبة القيمة المضافة</td><td class="num">${sar(doc.subtotal)}</td><td class="num">${sar(doc.vat_amount)}</td><td class="num">${sar(doc.total)} ر.س</td></tr></tbody></table>
<p class="muted">${doc.kind === 'invoice' ? 'العقد ليس فاتورة؛ هذه الفاتورة الضريبية الصادرة عنه. أي تصحيح يكون بإشعار دائن أو مدين.' : 'إشعار صادر على الفاتورة المذكورة أعلاه.'}</p>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
}
