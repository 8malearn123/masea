import type { SignedPartyView } from '@/features/contracts/lib/signedParties';
import logoAsset from '@/assets/brand/trial-contract-logo.png';
import { sar } from '@/shared/lib/format';
import type { TrialContractData, TrialTemplateDoc } from './template';

const esc = (s: string | number) =>
  String(s).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arDigits = (s: string) => s.replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)] ?? d);

/** «d / m / yyyy» بالتقويمين (هجري أم القرى + ميلادي) بأرقام عربية كما في القالب. */
export function trialDateParts(iso: string): { hijri: string; gregorian: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { hijri: '', gregorian: '' };
  const parts = (cal: string) => {
    const p = new Intl.DateTimeFormat(`en-u-ca-${cal}-nu-latn`, {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Riyadh',
    }).formatToParts(d);
    const v = (t: string) => p.find((x) => x.type === t)?.value.replace(/\D/g, '') ?? '';
    return arDigits(`${v('day')} / ${v('month')} / ${v('year')}`);
  };
  return { hijri: parts('islamic-umalqura'), gregorian: parts('gregory') };
}

/** أرقام تُعرض من اليسار لليمين (لا يُعاد ترتيبها داخل النص العربي). */
const LTR_KEYS = new Set(['id_number', 'id_issue_date', 'mobile', 'customer_no', 'daily_wage']);

function fieldValue(data: TrialContractData, key: string): string {
  const v = (data as unknown as Record<string, unknown>)[key];
  if (v == null || v === '') return '';
  if (key === 'daily_wage' && typeof v === 'number') return sar(v);
  return String(v);
}

/** يملأ `{{key}}` بحقل مسطّر، و`{{key:أ / ب}}` يُبقي النص ويُبرز المختار. */
function fill(text: string, data: TrialContractData): string {
  return text
    .split(/(\{\{[^}]+\}\})/)
    .map((part) => {
      const m = /^\{\{([a-z_]+)(?::(.+))?\}\}$/.exec(part);
      if (!m) return esc(part);
      const [, key = '', options] = m;
      const value = fieldValue(data, key);
      if (options) {
        return options
          .split(' / ')
          .map((o) => (o.trim() === value ? `<b class="pick">${esc(o)}</b>` : esc(o)))
          .join(' / ');
      }
      const dir = LTR_KEYS.has(key) ? ' dir="ltr"' : '';
      return `<span class="f${value ? '' : ' empty'}" data-field="${key}"${dir}>${esc(value)}</span>`;
    })
    .join('');
}

const box = (v: number | null) =>
  `<span class="box">${v == null ? '' : `<span class="amt">${esc(sar(v))}</span>`}</span>`;

export interface TrialRenderOptions {
  logoUrl?: string;
  watermark?: string | null;
  autoPrint?: boolean;
  /** ختم القبول الإلكتروني (خارج نص العقد) */
  acceptance?: { reference: string; at: string } | null;
  /** 0107: التوقيع الإلكتروني للطرفين (صورة العميل على سطر «التوقيع» + سجل الطرفين) */
  signers?: { customer: SignedPartyView | null; company: SignedPartyView | null } | null;
}

/** صفحة A4 بتصميم الملف الأصلي: الشعار، الترويسة، الحقول، البنود العشرة، التوقيع، التذييل. */
export function buildTrialContractHtml(
  doc: TrialTemplateDoc,
  data: TrialContractData,
  opts: TrialRenderOptions = {},
): string {
  const logo = opts.logoUrl ?? absoluteLogo();
  const dates = data.issued_on ? trialDateParts(data.issued_on) : { hijri: '', gregorian: '' };
  const [arName, ...arRest] = doc.letterhead_ar;
  const [enName, ...enRest] = doc.letterhead_en;
  const [sName, sSign, sAddr, sWork, sMobile] = doc.signature;
  const sig = (label: string | undefined, value: string, ltr = false) =>
    `<div class="sig"><span>${esc(label ?? '')}</span><span class="f sigf${value ? '' : ' empty'}"${ltr ? ' dir="ltr"' : ''}>${esc(value)}</span></div>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(doc.title)} ${esc(data.contract_no)}</title>
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap" rel="stylesheet" />
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#e9e9ef}
body{font-family:'Amiri',serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:9mm 12mm 8mm;display:flex;flex-direction:column;overflow:hidden}
.head{display:grid;grid-template-columns:1fr 46mm 1fr;align-items:start}
.lh-ar{text-align:center;font-size:12.5px;line-height:1.35}
.lh-ar .n{font-size:17px;font-weight:700}
.lh-en{text-align:center;font-family:'Times New Roman',serif;font-size:11px;line-height:1.45;direction:ltr}
.lh-en .n{font-weight:700;font-size:11.5px}
.mid{text-align:center}
.mid img{width:38mm;height:auto;display:block;margin:0 auto}
.title{font-size:27px;font-weight:700;display:inline-block;border-bottom:1.5px solid #000;padding:0 10px;line-height:1.3;margin-top:1mm}
.row2{display:grid;grid-template-columns:1fr 46mm 1fr;align-items:end;margin-top:2mm}
.dates{font-size:15px;line-height:1.55;padding-right:2mm}
.no{text-align:center;font-family:'Times New Roman',serif;font-size:19px;letter-spacing:1px;white-space:nowrap;direction:ltr}
.cust{text-align:left;font-size:14px}
.cust .lbl{display:block;text-align:center;width:36mm;margin-right:auto;margin-left:6mm}
.cust .box{display:block;width:36mm;height:8mm;border:1px solid #000;margin-left:0;margin-right:auto;text-align:center;line-height:8mm;font-size:13px}
.body{margin-top:7mm;font-size:15.5px;line-height:2.05}
.f{display:inline-block;min-width:34mm;border-bottom:1px solid #000;text-align:center;padding:0 4px;line-height:1.25;font-weight:700}
.f.empty{min-width:42mm}
.pick{text-decoration:underline;text-underline-offset:3px}
.amounts{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin:2mm 0 2mm;font-size:15px;align-items:center}
.amounts .it{display:flex;align-items:center;gap:3mm}
.amounts .box{flex:1;height:9mm;border:1px solid #000;display:flex;align-items:center;justify-content:center}
.amt{font-weight:700;direction:ltr;unicode-bidi:embed}
ol{list-style:none;margin:0;padding:0;font-size:15.5px;line-height:1.95}
ol li{display:flex;gap:4px}
ol li .k{font-weight:700;white-space:nowrap}
.decl{font-weight:700;font-size:15.5px;margin:5mm 0 6mm}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:0 12mm;font-size:15px;line-height:2.3}
.sig{display:flex;gap:3mm;align-items:baseline}
.sigf{min-width:48mm}
.foot{margin-top:auto;border-top:1.5px solid #000;padding-top:2mm;text-align:center;font-size:11.5px;line-height:1.5}
.foot .en{font-family:'Times New Roman',serif;direction:ltr}
.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.wm span{transform:rotate(-30deg);font-size:46px;font-weight:700;color:rgba(27,21,100,.10);white-space:nowrap}
.stamp{margin-top:3mm;border:1px dashed #000;padding:1.5mm 3mm;font-size:12px;text-align:center}
.sigimg{min-width:48mm;height:13mm;vertical-align:bottom}.sigimg img{max-height:12mm;max-width:46mm}
.esig{margin-top:3mm;border:1px solid #000;padding:2mm 3mm;display:grid;grid-template-columns:1fr 1fr;gap:4mm;font-size:12px;break-inside:avoid}
.esig h4{grid-column:1/-1;margin:0;font-size:13px}.esig .p{display:flex;gap:3mm;align-items:center}.esig .p img{max-height:12mm;max-width:30mm}
.esig .fp{grid-column:1/-1;font-size:10px;color:#333}
@media screen{.page{box-shadow:0 2px 14px rgba(0,0,0,.12);margin:12px auto}}
@media print{html,body{background:#fff}.page{margin:0;box-shadow:none;zoom:1!important}}
</style></head><body>
<div class="page">
${opts.watermark ? `<div class="wm"><span>${esc(opts.watermark)}</span></div>` : ''}
<div class="head">
  <div class="lh-ar"><div class="n">${esc(arName ?? '')}</div>${arRest.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
  <div class="mid"><img src="${esc(logo)}" alt="" /><div class="title">${esc(doc.title)}</div></div>
  <div class="lh-en"><div class="n">${esc(enName ?? '')}</div>${enRest.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
</div>
<div class="row2">
  <div class="dates"><div>التاريخ&nbsp;&nbsp;${dates.hijri ? esc(dates.hijri) : '&nbsp;&nbsp; / &nbsp;&nbsp; / &nbsp;١٤'} هـ</div><div>الموافق&nbsp;&nbsp;${dates.gregorian ? esc(dates.gregorian) : '&nbsp;&nbsp; / &nbsp;&nbsp; / &nbsp;٢٠'} م</div></div>
  <div class="no">${esc(data.contract_no)}</div>
  <div class="cust"><span class="lbl">رقم العميل</span><span class="box" dir="ltr">${esc(data.customer_no)}</span></div>
</div>
<div class="body">
${doc.lines.map((l) => `<div>${fill(l, data)}</div>`).join('\n')}
</div>
<div class="amounts">
  ${doc.amounts.map((label, i) => `<div class="it"><span>${esc(label)}</span>${box([data.total, data.paid, data.remaining][i] ?? null)}</div>`).join('')}
</div>
<ol>
${doc.clauses.map((c, i) => `<li><span class="k">${arDigits(String(i + 1))}-</span><span>${fill(c, data)}</span></li>`).join('\n')}
</ol>
<div class="decl">${esc(doc.declaration)}</div>
<div class="sigs">
  <div>${sig(sName, data.customer_name)}${
    opts.signers?.customer?.image
      ? `<div class="sig"><span>${esc(sSign ?? '')}</span><span class="f sigf sigimg"><img src="${esc(opts.signers.customer.image)}" alt="" /></span></div>`
      : sig(sSign, '')
  }</div>
  <div>${sig(sAddr, data.address)}${sig(sWork, data.job)}${sig(sMobile, data.mobile, true)}</div>
</div>
${opts.signers && (opts.signers.customer || opts.signers.company) ? esigBlock(opts.signers) : ''}
${opts.acceptance ? `<div class="stamp">قُبل إلكترونياً في <span class="amt">${esc(opts.acceptance.at)}</span> — مرجع القبول <span class="amt">${esc(opts.acceptance.reference)}</span></div>` : ''}
<div class="foot">${doc.footer.map((l, i) => `<div class="${i === 1 ? 'en' : ''}">${esc(l)}</div>`).join('')}</div>
</div>
<script>(function(){function fit(){var p=document.querySelector('.page');if(!p)return;p.style.zoom='';var s=(document.documentElement.clientWidth-8)/p.offsetWidth;if(s<1)p.style.zoom=String(s);}window.addEventListener('resize',fit);fit();})()</script>
${opts.autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>' : ''}
</body></html>`;
}

/** سجل التوقيع الإلكتروني للطرفين (خارج نص القالب — مثل ختم القبول). */
function esigBlock(s: {
  customer: SignedPartyView | null;
  company: SignedPartyView | null;
}): string {
  const party = (title: string, p: SignedPartyView | null) =>
    `<div class="p">${p?.image ? `<img src="${esc(p.image)}" alt="" />` : ''}<div><b>${esc(title)}</b><br/>${
      p
        ? `${esc(p.name)} — ${esc(p.capacity)}<br/><span class="amt">${esc(p.at)}</span>`
        : 'لم يوقّع بعد'
    }</div></div>`;
  const fp = s.customer?.fingerprint ?? s.company?.fingerprint;
  return `<div class="esig"><h4>التوقيع الإلكتروني</h4>${party('الطرف الثاني (العميل)', s.customer)}${party('الطرف الأول (ماسية الشرق)', s.company)}${
    fp
      ? `<div class="fp">بصمة المستند SHA-256: <span class="amt">${esc(fp.slice(0, 16))}…</span></div>`
      : ''
  }</div>`;
}

function absoluteLogo(): string {
  return typeof window !== 'undefined' ? new URL(logoAsset, window.location.href).href : logoAsset;
}
