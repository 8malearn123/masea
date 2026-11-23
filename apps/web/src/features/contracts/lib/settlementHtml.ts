import { sar } from '@/shared/lib/format';
import { branchLabel, SERVICE_LABEL, type ContractListItem } from '@/features/contracts/types';
import {
  creditNoteAmount,
  DUE_BASIS_LABEL,
  SETTLEMENT_KIND_LABEL,
} from '@/features/contracts/lib/settlement';
import {
  OPS_ACTION_LABEL,
  REFUND_STATUS_LABEL,
  SETTLEMENT_STATUS_LABEL,
  type OpsEvent,
  type Refund,
  type Settlement,
} from '@/features/contracts/api/contractOps.api';

function esc(s: string | number | null | undefined): string {
  return String(s ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const money = (n: number) => `<span class="num">${sar(n)}</span> ر.س`;

/**
 * مستند «تسوية وإلغاء عقد» — مرتبط بالعقد الأصلي (رقمه وتاريخه) ولا يعدّل نصه.
 * يُطبع من المتصفح (حفظ PDF) بنفس هوية مستند العقد.
 */
export function buildSettlementHtml(
  contract: ContractListItem,
  s: Settlement,
  opts: { reason: string; refund?: Refund | null; events?: OpsEvent[] },
): string {
  const fees = s.fees.length
    ? s.fees
        .map(
          (f) =>
            `<tr><td>${esc(f.label)}</td><td>${esc(f.clause_ref)}</td><td>${money(f.amount)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="3">لا رسوم أو تعويضات</td></tr>';
  const cn = creditNoteAmount(s);
  const trail = (opts.events ?? [])
    .filter((e) => e.entity === 'settlement' || e.entity === 'refund')
    .map(
      (e) =>
        `<tr><td class="num">${esc(e.created_at.slice(0, 16).replace('T', ' '))}</td><td>${esc(OPS_ACTION_LABEL[e.action] ?? e.action)}</td><td>${esc(e.actor_name ?? '')}</td><td>${esc(e.note ?? '')}</td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(s.settlement_no)}</title>
<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@300;400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Alexandria', sans-serif; color: #120E45; margin: 0; padding: 40px; }
  .num { font-family: 'JetBrains Mono', monospace; direction: ltr; unicode-bidi: embed; }
  header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1B1564; padding-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 700; color: #1B1564; }
  .sub { color: #564E85; font-size: 12px; }
  h1 { font-size: 18px; color: #1B1564; margin: 24px 0 8px; }
  h2 { font-size: 14px; color: #1B1564; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
  td, th { padding: 7px 8px; border-bottom: 1px solid #E3E1ED; text-align: right; }
  th { color: #564E85; font-weight: 600; }
  td.k { color: #564E85; width: 38%; }
  .total td { font-weight: 700; color: #1B1564; border-top: 2px solid #1B1564; }
  .note { font-size: 11px; color: #564E85; margin-top: 6px; }
  .sign { display: flex; justify-content: space-between; margin-top: 48px; }
  .sign div { width: 30%; text-align: center; border-top: 1px solid #120E45; padding-top: 8px; font-size: 12px; }
  footer { margin-top: 40px; border-top: 1px solid #E3E1ED; padding-top: 12px; color: #564E85; font-size: 11px; text-align: center; }
  @media print { body { padding: 24px; } }
</style>
</head>
<body>
  <header>
    <div>
      <div class="brand">ماسية الشرق للاستقدام</div>
      <div class="sub">مستند تسوية وإلغاء عقد — مرتبط بالعقد الأصلي ولا يعدّل نصه</div>
    </div>
    <div class="num" style="font-weight:700;color:#1B1564">${esc(s.settlement_no)}</div>
  </header>

  <h1>${esc(SETTLEMENT_KIND_LABEL[s.kind])}</h1>
  <table>
    <tr><td class="k">العقد الأصلي</td><td class="num">${esc(contract.contract_no)}</td></tr>
    <tr><td class="k">نوع الخدمة</td><td>${esc(contract.service_code ? SERVICE_LABEL[contract.service_code] : '')}</td></tr>
    <tr><td class="k">العميل</td><td>${esc(contract.customer_name)}</td></tr>
    <tr><td class="k">العاملة</td><td>${esc(contract.worker_name)}</td></tr>
    <tr><td class="k">الفرع</td><td>${esc(branchLabel(contract))}</td></tr>
    <tr><td class="k">مدة العقد</td><td><span class="num">${esc(contract.start_date)}</span> ← <span class="num">${esc(contract.end_date)}</span></td></tr>
    <tr><td class="k">سبب الإلغاء</td><td>${esc(opts.reason)}${s.reason_note ? ` — ${esc(s.reason_note)}` : ''}</td></tr>
    <tr><td class="k">تاريخ الإلغاء الفعلي</td><td class="num">${esc(s.effective_date)}</td></tr>
    <tr><td class="k">حالة التسوية</td><td>${esc(SETTLEMENT_STATUS_LABEL[s.status])}</td></tr>
  </table>

  <h2>المدة</h2>
  <table>
    <tr><td class="k">مدة العقد</td><td><span class="num">${esc(s.days_total)}</span> يوم</td></tr>
    <tr><td class="k">المدة المستهلكة</td><td><span class="num">${esc(s.days_used)}</span> يوم</td></tr>
    <tr><td class="k">المدة المتبقية</td><td><span class="num">${esc(s.days_remaining)}</span> يوم</td></tr>
  </table>

  <h2>التسوية المالية</h2>
  <table>
    <tr><td class="k">قيمة العقد (شاملة الضريبة)</td><td>${money(s.contract_value)}</td></tr>
    <tr><td class="k">المبالغ المحصّلة</td><td>${money(s.amount_paid)}</td></tr>
    <tr><td class="k">قيمة الخدمة المستحقة</td><td>${money(s.service_due)} <span class="note">(${esc(DUE_BASIS_LABEL[s.due_basis])}${s.due_basis_ref ? ` — ${esc(s.due_basis_ref)}` : ''})</span></td></tr>
    <tr><td class="k">الرسوم والتعويضات</td><td>${money(s.fees_total)}</td></tr>
    <tr class="total"><td class="k">${s.balance >= 0 ? 'المبلغ المسترد للعميل' : 'المبلغ المتبقي على العميل'}</td><td>${money(Math.abs(s.balance))}</td></tr>
  </table>
  ${cn > 0 ? `<p class="note">يصدر إشعار دائن بمبلغ ${money(cn)} يخفّض ذمة العميل والإيراد والضريبة.</p>` : ''}
  ${s.refund_due_by ? `<p class="note">يُسترد المبلغ في موعد أقصاه <span class="num">${esc(s.refund_due_by)}</span> ${s.refund_within_ref ? `(${esc(s.refund_within_ref)})` : ''}.</p>` : ''}

  <h2>الرسوم والتعويضات (كل بند مستند إلى نص العقد)</h2>
  <table><tr><th>البيان</th><th>البند</th><th>المبلغ</th></tr>${fees}</table>

  ${
    opts.refund
      ? `<h2>الاسترداد</h2><table>
    <tr><td class="k">رقم الطلب</td><td class="num">${esc(opts.refund.refund_no)}</td></tr>
    <tr><td class="k">الحالة</td><td>${esc(REFUND_STATUS_LABEL[opts.refund.status])}</td></tr>
    <tr><td class="k">المسترد حتى الآن</td><td>${money(opts.refund.paid_total)} من ${money(opts.refund.amount)}</td></tr>
  </table>`
      : ''
  }

  ${trail ? `<h2>سجل الموافقات والإجراءات</h2><table><tr><th>التاريخ</th><th>الإجراء</th><th>المستخدم</th><th>ملاحظة</th></tr>${trail}</table>` : ''}

  <div class="sign">
    <div>العميل</div>
    <div>المراجع</div>
    <div>الاعتماد المالي</div>
  </div>
  <footer>ماسية الشرق للاستقدام · نجران · جازان · شرورة · حبونا</footer>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}
