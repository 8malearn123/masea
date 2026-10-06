import { sar } from '@/shared/lib/format';
import { SERVICE_LABEL, type ContractListItem } from '@/features/contracts/types';
import { CONTRACT_STATUS_LABEL } from '@/features/contracts/lib/contractState';
import { contractTermLabel, contractTermUnit } from '@/features/contracts/lib/contractTerm';

/**
 * Builds the RTL Arabic contract document.
 *
 * Browser path: rendered with the user's Chromium via print → Save as PDF
 * (Alexandria loaded from Google Fonts).
 *
 * Server path (see docs/contract-pdf-serverless.md): the SAME HTML is rendered
 * by Playwright/Chromium in a serverless function with Alexandria embedded as
 * base64 (no network), producing a pixel-accurate Arabic PDF. ZATCA e-invoice
 * is a SEPARATE document — do not merge it into the contract.
 */
export function buildContractHtml(contract: ContractListItem, clauses: string[]): string {
  const rows = clauses
    .map((c, i) => `<li><span class="n">${i + 1}.</span> ${escapeHtml(c)}</li>`)
    .join('');
  // نقل الكفالة بلا مدة؛ غيره يُطبع تاريخ نهايته ومدته (أو «غير محدّد» لعقد قديم بلا نهاية).
  const hasTerm = contractTermUnit(contract.service_code) !== null;
  const termLabel = contractTermLabel(contract);
  const endRow = hasTerm
    ? `<tr><td class="k">تاريخ النهاية</td><td class="num">${escapeHtml(contract.end_date ?? 'غير محدّد')}</td></tr>`
    : '';
  const termRow = termLabel
    ? `<tr><td class="k">مدة العقد</td><td>${escapeHtml(termLabel)}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(contract.contract_no ?? 'عقد')}</title>
<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@300;400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Alexandria', sans-serif; color: #120E45; margin: 0; padding: 40px; }
  .num { font-family: 'JetBrains Mono', monospace; direction: ltr; unicode-bidi: embed; }
  header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1B1564; padding-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 700; color: #1B1564; }
  .sub { color: #564E85; font-size: 12px; }
  h1 { font-size: 18px; color: #1B1564; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  td { padding: 8px; border-bottom: 1px solid #E3E1ED; }
  td.k { color: #564E85; width: 35%; }
  ol { padding: 0; list-style: none; font-size: 13px; line-height: 1.9; }
  ol li { margin-bottom: 6px; }
  .n { color: #C8970A; font-weight: 700; }
  .totals { margin-top: 12px; font-size: 14px; }
  .totals .t { font-weight: 700; color: #C8970A; }
  .sign { display: flex; justify-content: space-between; margin-top: 56px; }
  .sign div { width: 40%; text-align: center; border-top: 1px solid #120E45; padding-top: 8px; font-size: 12px; }
  footer { margin-top: 48px; border-top: 1px solid #E3E1ED; padding-top: 12px; color: #564E85; font-size: 11px; text-align: center; }
  @media print { body { padding: 24px; } }
</style>
</head>
<body>
  <header>
    <div>
      <div class="brand">ماسية الشرق للاستقدام</div>
      <div class="sub">نظام إدارة الموارد — عقد خدمة</div>
    </div>
    <div class="num" style="font-weight:700;color:#1B1564">${escapeHtml(contract.contract_no ?? '')}</div>
  </header>

  <h1>عقد ${escapeHtml(contract.service_code ? SERVICE_LABEL[contract.service_code] : '')}</h1>
  <table>
    <tr><td class="k">العميل</td><td>${escapeHtml(contract.customer_name ?? '—')}</td></tr>
    <tr><td class="k">الفرع</td><td>${escapeHtml(contract.branch_id ?? '—')}</td></tr>
    <tr><td class="k">تاريخ البداية</td><td class="num">${escapeHtml(contract.start_date ?? '—')}</td></tr>
    ${endRow}
    ${termRow}
    <tr><td class="k">الحالة</td><td>${CONTRACT_STATUS_LABEL[contract.status]}</td></tr>
  </table>

  <h1>البنود</h1>
  <ol>${rows || '<li>لا توجد بنود.</li>'}</ol>

  <div class="totals">
    <div>المبلغ الأساسي: <span class="num">${sar(contract.base_amount)}</span> ر.س</div>
    <div>ضريبة القيمة المضافة (15%): <span class="num">${sar(contract.vat_amount)}</span> ر.س</div>
    <div class="t">الإجمالي: <span class="num">${sar(contract.total_amount)}</span> ر.س</div>
  </div>

  <div class="sign">
    <div>توقيع الطرف الثاني (العميل)</div>
    <div>توقيع الطرف الأول (ماسية الشرق)</div>
  </div>

  <footer>ماسية الشرق للاستقدام · من تطوير قمة كود · QUO-000105</footer>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Open the contract in a new tab; the embedded script triggers print → PDF. */
export function openContractPrint(html: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
