import {
  ESIG_CSS,
  fingerprintLine,
  signerCaption,
  type SignedPartyView,
} from '@/features/contracts/lib/signedParties';
import type { CoverBlock, RentalTemplateDoc, TemplateBlock } from './template';
import type { RentalContractData } from './fields';

/**
 * يبني مستند العقد (HTML بمقاس A4، RTL) من القالب + بيانات العقد.
 * النص القانوني يُطبع من القالب حرفياً؛ لا يُعاد ترتيبه ولا يُختصر. الحقول
 * وحدها تُستبدل. يُفتح في تبويب ويُطبع أو يُحفظ PDF (نفس مسار openContractPrint)،
 * ويُعرض بنفسه للخادم (docs/contract-pdf-serverless.md).
 */
export interface RenderOptions {
  logoUrl: string;
  /** صورة QR (data URL) — اختيارية. */
  qrDataUrl?: string | null;
  /** صور التوقيع إن وُجدت (contract_signatures). */
  signatures?: { employee?: string | null; customer?: string | null };
  /** بيانات الموقّعين (الاسم، الصفة، الوقت، البصمة) تحت أماكن التوقيع — 0107 */
  signers?: { employee?: SignedPartyView | null; customer?: SignedPartyView | null };
  /** علامة مائية للمعاينة قبل اعتماد القالب أو قبل توقيع العقد. */
  watermark?: string | null;
  autoPrint?: boolean;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** يستبدل {{key}} بالقيمة (مُهرَّبة). الحقل الفارغ يبقى فارغاً كما في الأصل. */
export function fillText(template: string, fields: Record<string, string>): string {
  return escapeHtml(template).replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = fields[k] ?? '';
    return v ? `<span class="f" data-field="${k}">${escapeHtml(v)}</span>` : '';
  });
}

function block(b: TemplateBlock, fields: Record<string, string>): string {
  switch (b.t) {
    case 'title':
      return `<h1 class="doc-title">${fillText(b.text, fields)}</h1>`;
    case 'line':
      return `<p class="line">${fillText(b.text, fields)}</p>`;
    case 'heading':
      return `<h2 class="sec">${fillText(b.text, fields)}</h2>`;
    case 'para':
      return `<p class="para">${fillText(b.text, fields)}</p>`;
    case 'clause':
      return `<p class="clause" data-no="${b.no ?? ''}">${b.no ? `<span class="cn">${escapeHtml(b.no)}</span> ` : ''}${fillText(b.text, fields)}</p>`;
    case 'grid':
      return `<table class="grid cols-${b.rows[0]?.length ?? 2}">${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${fillText(c, fields)}</td>`).join('')}</tr>`)
        .join('')}</table>`;
    case 'signatures':
      return '';
  }
}

function cover(b: CoverBlock, data: RentalContractData, opts: RenderOptions): string {
  const f = data.fields;
  switch (b.t) {
    case 'brand':
      return `<header class="brand">
  <div class="brand-ar">${b.ar.map((l) => `<div>${fillText(l, f)}</div>`).join('')}</div>
  <img class="logo" src="${escapeHtml(opts.logoUrl)}" alt="شعار ماسية الشرق للاستقدام" />
  <div class="brand-en" dir="ltr">${b.en.map((l) => `<div>${fillText(l, f)}</div>`).join('')}</div>
</header>`;
    case 'kv':
      return `<table class="kv">${b.rows
        .map(
          (r) =>
            `<tr><th>${escapeHtml(r[0] ?? '')}</th><td>${fillText(r[1] ?? '', f)}</td><th>${escapeHtml(r[2] ?? '')}</th><td>${fillText(r[3] ?? '', f)}</td></tr>`,
        )
        .join('')}</table>`;
    case 'items':
      return `<table class="list"><thead><tr>${b.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${data.items
        .map(
          (i) =>
            `<tr><td>${escapeHtml(i.service)}</td><td>${escapeHtml(i.unit)}</td><td class="num">${i.qty}</td><td class="num">${escapeHtml(i.amount)}</td><td class="num">${escapeHtml(i.vat)}</td><td class="num">${escapeHtml(i.net)}</td></tr>`,
        )
        .join('')}</tbody></table>`;
    case 'payments':
      return `<p class="pay-title">${escapeHtml(b.title)}</p><table class="list"><thead><tr>${b.headers
        .map((h) => `<th>${escapeHtml(h)}</th>`)
        .join('')}</tr></thead><tbody>${
        data.payments.length
          ? data.payments
              .map(
                (p) =>
                  `<tr><td class="num">${escapeHtml(p.date)}</td><td class="num">${escapeHtml(p.amount)}</td><td>${escapeHtml(p.method)}</td></tr>`,
              )
              .join('')
          : '<tr><td colspan="3" class="muted">—</td></tr>'
      }</tbody></table>`;
    case 'qr':
      return opts.qrDataUrl
        ? `<img class="qr" src="${escapeHtml(opts.qrDataUrl)}" alt="رمز الاستجابة السريعة" />`
        : '';
    case 'welcome':
      return `<p class="welcome">${escapeHtml(b.text)}</p>`;
  }
}

function signatures(items: string[], opts: RenderOptions): string {
  const imgs = [opts.signatures?.employee, opts.signatures?.customer];
  const metas = [opts.signers?.employee ?? null, opts.signers?.customer ?? null];
  return `<section class="signs">${items
    .map(
      (label, i) =>
        `<div class="sign"><div class="sign-box">${imgs[i] ? `<img src="${escapeHtml(imgs[i] ?? '')}" alt="${escapeHtml(label)}" />` : ''}</div><div class="sign-label">${escapeHtml(label)}</div>${signerCaption(metas[i] ?? null)}</div>`,
    )
    .join('')}</section>${fingerprintLine(metas)}`;
}

export function buildRentalContractHtml(
  doc: RentalTemplateDoc,
  data: RentalContractData,
  opts: RenderOptions,
): string {
  const f = data.fields;
  const coverHtml = doc.cover
    .filter((b) => b.t !== 'qr' && b.t !== 'welcome')
    .map((b) => cover(b, data, opts))
    .join('\n');
  const tail = doc.cover
    .filter((b) => b.t === 'qr' || b.t === 'welcome')
    .map((b) => cover(b, data, opts))
    .join('');
  const signBlock = doc.sections
    .flatMap((s) => s.blocks)
    .find((b): b is Extract<TemplateBlock, { t: 'signatures' }> => b.t === 'signatures');
  const body = doc.sections
    .map(
      (s) =>
        `<section class="part" data-section="${escapeHtml(s.id)}">${s.blocks.map((b) => block(b, f)).join('\n')}</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(`${doc.title} ${f.contract_no ?? ''}`.trim())}</title>
<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<style>
  :root { --navy:#1B1564; --ink:#120E45; --muted:#564E85; --gold:#C8970A; --line:#E3E1ED; --zebra:#F1F0F6; }
  * { box-sizing: border-box; }
  html, body { background:#EEF0F4; }
  body { font-family:'Alexandria',sans-serif; color:var(--ink); margin:0; font-size:12.5px; line-height:1.85; }
  .num, .f[data-field$="_no"], .f[data-field*="phone"], .f[data-field*="mobile"] { font-family:'JetBrains Mono','Alexandria',monospace; }
  .sheet { width:210mm; margin:12px auto; background:#fff; padding:14mm 13mm; box-shadow:0 2px 10px rgba(18,14,69,.08); position:relative; }
  .bar { position:sticky; top:0; z-index:5; display:flex; gap:8px; justify-content:center; padding:10px; background:var(--navy); }
  .bar button { font:600 13px 'Alexandria',sans-serif; border:0; border-radius:8px; padding:8px 18px; cursor:pointer; background:#fff; color:var(--navy); }
  .bar button.gold { background:var(--gold); color:#fff; }
  /* ---- cover (page 1) ---- */
  .brand { display:grid; grid-template-columns:1fr auto 1fr; align-items:start; gap:12px; padding-bottom:10px; border-bottom:3px solid var(--navy); }
  .brand-ar { font-weight:700; font-size:12.5px; color:var(--navy); line-height:1.9; }
  .brand-en { font-weight:700; font-size:11.5px; color:var(--navy); text-align:left; align-self:end; line-height:1.9; }
  .logo { width:44mm; height:44mm; object-fit:contain; }
  .kv { width:100%; border-collapse:collapse; margin:16px 0 14px; }
  .kv th, .kv td { border:1px solid var(--line); padding:9px 12px; text-align:right; font-weight:400; }
  .kv th { color:var(--muted); width:16%; background:#FAFAFC; }
  .list { width:100%; border-collapse:collapse; margin:6px 0 12px; }
  .list th { text-align:right; font-weight:700; padding:9px 12px; border-bottom:2px solid var(--navy); color:var(--navy); }
  .list td { padding:9px 12px; }
  .list tbody tr:nth-child(odd) td { background:var(--zebra); }
  .pay-title { margin:10px 0 0; font-weight:600; }
  .cover-tail { display:grid; grid-template-columns:1fr 1fr 1fr; align-items:end; margin-top:18px; }
  .qr { width:34mm; height:34mm; grid-column:3; grid-row:1; justify-self:end; }
  .welcome { font-weight:700; font-size:15px; color:var(--navy); margin:0; grid-column:2; grid-row:1; text-align:center; }
  .muted { color:var(--muted); text-align:center; }
  /* ---- contract body ---- */
  .doc-title { font-size:24px; font-weight:700; color:var(--navy); margin:0 0 8px; padding-bottom:8px; border-bottom:3px solid var(--gold); }
  .line { margin:6px 0; }
  .sec { font-size:17px; font-weight:700; color:var(--navy); margin:16px 0 6px; break-after:avoid; page-break-after:avoid; }
  .grid { width:100%; border-collapse:collapse; margin:4px 0 8px; }
  .grid td { border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:8px 10px; vertical-align:top; }
  .grid tr { break-inside:avoid; page-break-inside:avoid; }
  .para { margin:6px 0; text-align:justify; }
  .clause { margin:8px 0; text-align:justify; break-inside:avoid; page-break-inside:avoid; }
  .cn { font-weight:700; color:var(--gold); }
  .signs { display:flex; justify-content:space-around; gap:24px; margin-top:28px; break-inside:avoid; page-break-inside:avoid; }
  .sign { width:42%; text-align:center; }
  .sign-box { height:26mm; border-bottom:1.5px solid var(--ink); display:flex; align-items:flex-end; justify-content:center; }
  .sign-box img { max-height:24mm; max-width:100%; }
  .sign-label { margin-top:6px; font-weight:600; color:var(--navy); }
  ${ESIG_CSS}
  .wm { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:3; }
  .wm span { transform:rotate(-30deg); font-size:40px; font-weight:700; color:rgba(200,151,10,.16); white-space:nowrap; }
  .page-break { break-after:page; page-break-after:always; }
  @page { size:A4; margin:12mm 11mm 14mm; @bottom-center { content:counter(page) " / " counter(pages); font:9px 'JetBrains Mono',monospace; color:#564E85; } }
  @media print {
    html, body { background:#fff; }
    .bar { display:none; }
    .sheet { width:auto; margin:0; padding:0; box-shadow:none; }
  }
</style>
</head>
<body>
  <nav class="bar"><button class="gold" onclick="window.print()">طباعة / تنزيل PDF</button></nav>
  ${opts.watermark ? `<div class="wm"><span>${escapeHtml(opts.watermark)}</span></div>` : ''}
  <main>
    <div class="sheet page-break" data-page="cover">
      ${coverHtml}
      <div class="cover-tail">${tail}</div>
    </div>
    <div class="sheet" data-page="contract">
      ${body}
      ${signBlock ? signatures(signBlock.items, opts) : ''}
    </div>
  </main>
  ${opts.autoPrint ? '<script>window.onload = function () { setTimeout(function(){ window.print(); }, 400); };</script>' : ''}
</body>
</html>`;
}
