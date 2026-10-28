import type { QuoteRecord } from '@/shared/lib/quotesLedger';
import type { PriceSnapshot } from '@/features/pricing/lib/engine';
import { PRICING_SERVICE_LABEL } from '@/features/pricing/types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function isSnapshot(v: unknown): v is PriceSnapshot {
  return !!v && typeof v === 'object' && (v as { version?: unknown }).version === 1;
}

/**
 * Official quote document (preview + print/PDF). Every figure comes from the
 * quote's stored snapshot — never recomputed — so it matches what was offered.
 */
export function buildQuoteHtml(q: QuoteRecord, opts: { autoPrint?: boolean } = {}): string {
  const snap = isSnapshot(q.snapshot) ? q.snapshot : null;
  const lines = snap
    ? snap.lines
        .map(
          (l) =>
            `<tr><td>${esc(l.label)}${l.hint ? `<div class="h">${esc(l.hint)}</div>` : ''}</td><td class="num">${money(l.amount)}</td></tr>`,
        )
        .join('')
    : `<tr><td>قيمة الخدمة قبل الضريبة</td><td class="num">${money(q.base_amount)}</td></tr>`;
  const vatPct = snap ? Math.round(snap.config.vat_rate * 100) : null;
  const subject = [
    PRICING_SERVICE_LABEL[q.service_code] ?? q.service_code,
    q.nationality ?? q.profession,
    q.quantity > 1 ? `× ${q.quantity}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>عرض سعر QT-${q.quote_no}</title>
<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@300;400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet" />
<style>
*{box-sizing:border-box}body{font-family:Alexandria,Tahoma,sans-serif;color:#0e1a2b;margin:0;padding:36px;font-size:13px}
.num{font-family:'JetBrains Mono',monospace;direction:ltr;text-align:left;white-space:nowrap}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1f58a8;padding-bottom:14px}
.logo{display:flex;align-items:center;gap:10px}.mark{width:44px;height:44px;border-radius:50%;background:#c9a24a;color:#fff;display:grid;place-items:center;font-weight:700;font-size:20px}
.brand{font-size:19px;font-weight:700;color:#1f58a8}.sub{color:#65738c;font-size:11px}
h1{font-size:17px;color:#1f58a8;margin:22px 0 6px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin:10px 0 16px}
.meta div span{color:#65738c}table{width:100%;border-collapse:collapse}td{padding:8px 6px;border-bottom:1px solid #e3e9f2}
.h{color:#65738c;font-size:11px}.tot td{font-weight:700;font-size:15px;color:#1f58a8;border-top:2px solid #1f58a8}
.box{margin-top:18px;background:#f3f6fb;border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.9}
footer{margin-top:40px;border-top:1px solid #e3e9f2;padding-top:10px;color:#65738c;font-size:10px;text-align:center}
@media print{body{padding:20px}}
</style></head><body>
<header><div class="logo"><div class="mark">م</div><div><div class="brand">ماسية الشرق للاستقدام</div><div class="sub">نجران · جازان · شرورة · حبونا</div></div></div>
<div style="text-align:left"><div style="font-weight:700">عرض سعر</div><div class="num">QT-${q.quote_no}</div></div></header>
<h1>${esc(subject)}</h1>
<div class="meta">
<div><span>العميل: </span>${esc(q.customer_name ?? '—')}</div>
<div><span>الجوال: </span><span class="num">${esc(q.customer_phone ?? '—')}</span></div>
<div><span>تاريخ العرض: </span><span class="num">${q.created_at.slice(0, 10)}</span></div>
<div><span>صالح حتى: </span><span class="num">${esc(q.valid_until ?? '—')}</span></div>
</div>
<table><tbody>${lines}
<tr><td>المبلغ الخاضع للضريبة</td><td class="num">${money(q.base_amount)}</td></tr>
<tr><td>ضريبة القيمة المضافة${vatPct != null ? ` (${vatPct}٪)` : ''}</td><td class="num">${money(q.vat_amount)}</td></tr>
<tr class="tot"><td>الإجمالي شامل الضريبة (ر.س)</td><td class="num">${money(q.total_amount)}</td></tr>
</tbody></table>
<div class="box">
• الأسعار بالريال السعودي${vatPct != null ? ` وتشمل ضريبة القيمة المضافة ${vatPct}٪` : ' وتشمل ضريبة القيمة المضافة'}.<br/>
• السعر ثابت حتى تاريخ الصلاحية المذكور، ويخضع التعاقد لإبرام عقد رسمي.<br/>
${q.notes ? `• ${esc(q.notes)}<br/>` : ''}
</div>
<footer>هذا عرض سعر وليس فاتورة ضريبية · أُعدّ بواسطة ${esc(q.assigned_to ?? 'فريق المبيعات')}</footer>
${opts.autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}
</body></html>`;
}

/** WhatsApp share text (summary only — the link opening is all we can record). */
export function quoteShareText(q: QuoteRecord): string {
  return [
    `عرض سعر QT-${q.quote_no} — ماسية الشرق للاستقدام`,
    `الخدمة: ${PRICING_SERVICE_LABEL[q.service_code] ?? q.service_code}${q.nationality ? ` — ${q.nationality}` : q.profession ? ` — ${q.profession}` : ''}`,
    `الإجمالي شامل الضريبة: ${money(q.total_amount)} ر.س`,
    q.valid_until ? `صالح حتى: ${q.valid_until}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function toWaNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('966')) return digits;
  if (digits.startsWith('0')) return `966${digits.slice(1)}`;
  return digits;
}
