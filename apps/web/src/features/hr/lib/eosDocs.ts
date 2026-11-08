/** Printed final settlement («مخالصة نهائية») — pure builder + print window. */
import { BRAND } from '@masiat/shared';
import { TERMINATION_REASON_LABEL, type EosSettlement } from '@/features/hr/types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildSettlementHtml(s: EosSettlement, autoPrint = true): string {
  const row = (label: string, v: number, hint = '') =>
    v === 0 && !hint
      ? ''
      : `<tr><td>${esc(label)}${hint ? ` <small>(${esc(hint)})</small>` : ''}</td><td class="n">${money(v)}</td></tr>`;
  const draft = s.status === 'draft';
  const ratio =
    s.award_ratio === 1
      ? 'كاملة'
      : s.award_ratio === 0
        ? 'لا تستحق'
        : `${Math.round(s.award_ratio * 100)}٪ من المكافأة`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>مخالصة نهائية ${esc(s.employee_name)}</title>
<style>
@page{size:A4;margin:14mm}body{font-family:Alexandria,Tahoma,sans-serif;color:#0e1a2b;font-size:12px;position:relative}
.org{display:flex;justify-content:space-between;border-bottom:2px solid #c9a24a;padding-bottom:6px;margin-bottom:12px}
.org strong{color:#1f58a8;font-size:16px}h1{font-size:18px;margin:0 0 10px;color:#14294a}
.info{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;background:#f3f6fb;padding:10px;border-radius:6px;margin-bottom:12px}
.info span{color:#65738c}table{width:100%;border-collapse:collapse;margin-bottom:10px}
th{background:#e3e9f2;text-align:right;padding:6px;border:1px solid #cbd3df}td{padding:5px 6px;border:1px solid #e3e9f2}
td.n,.net .n{font-family:'JetBrains Mono',monospace;direction:ltr;text-align:left}small{color:#65738c}
.net{display:flex;justify-content:space-between;background:#fbf4e3;padding:10px;border-radius:6px;font-size:16px;font-weight:bold}
.decl{margin-top:16px;line-height:1.9}.sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:40px;text-align:center}
.sign div{border-top:1px solid #65738c;padding-top:6px;color:#65738c}
.wm{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:48px;color:rgba(200,30,30,.12);transform:rotate(-20deg)}
</style></head><body>
${draft ? '<div class="wm">مسودة — غير معتمدة</div>' : ''}
<div class="org"><strong>${esc(BRAND.client.nameAr)}</strong><span>مخالصة نهائية</span></div>
<h1>مخالصة نهائية ومستحقات نهاية الخدمة</h1>
<div class="info">
<div><span>الموظف:</span> ${esc(s.employee_name)}</div>
<div><span>تاريخ انتهاء الخدمة:</span> ${esc(s.end_date)}</div>
<div><span>السبب:</span> ${esc(TERMINATION_REASON_LABEL[s.reason] ?? s.reason)}</div>
<div><span>مدة الخدمة:</span> ${s.service_years.toFixed(2)} سنة</div>
<div><span>أجر الاحتساب:</span> ${money(s.wage)} ر.س</div>
<div><span>استحقاق المكافأة:</span> ${esc(ratio)}</div>
</div>
<table><thead><tr><th>البند</th><th>المبلغ (ر.س)</th></tr></thead><tbody>
${row('مكافأة نهاية الخدمة (م84/85)', s.award, `أصل المكافأة ${money(s.award_full)}`)}
${row('بدل رصيد الإجازات (م111)', s.leave_amount, `${s.leave_days} يوم`)}
${row('تعويض الإنهاء (م77)', s.art77_amount)}
${row('مستحقات أخرى', s.other_additions)}
${s.other_deductions ? `<tr><td>يُخصم: مبالغ مستحقة على الموظف${s.note ? ` <small>(${esc(s.note)})</small>` : ''}</td><td class="n">(${money(s.other_deductions)})</td></tr>` : ''}
</tbody></table>
<div class="net"><span>صافي المستحق</span><span class="n">${money(s.net)} ر.س</span></div>
<p class="decl">أقرّ أنا الموقّع أدناه باستلامي كامل مستحقاتي المذكورة أعلاه، وأنه لا يوجد لي أي حقوق أخرى لدى المنشأة عن مدة خدمتي.</p>
<div class="sign"><div>توقيع الموظف</div><div>الموارد البشرية — ${esc(s.prepared_by_name)}</div><div>الاعتماد — ${esc(s.approved_by_name || '……')}</div></div>
${autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}
</body></html>`;
}

export function printSettlement(s: EosSettlement): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(buildSettlementHtml(s));
  w.document.close();
}
