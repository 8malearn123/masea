/**
 * Payroll documents from a frozen run: the WPS bank file (wage protection) and
 * the printed payslip. Pure builders (unit-tested); the download / print reuse
 * shared/lib/exportTable (BOM, CSV escaping) and the print-window pattern.
 */
import { BRAND } from '@masiat/shared';
import type { ExportTable } from '@/shared/lib/exportTable';
import { isValidSaudiIban } from '@/features/hr/lib/employeeValidation';
import type { Payslip, PayrollRunStatus } from '@/features/hr/types';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * WPS file: one row per employee with a valid IBAN. Employees without one are
 * returned in `missing` — a bank rejects the whole file on an invalid row, so
 * they are paid separately until HR completes their bank details.
 */
export function buildWpsTable(
  slips: Payslip[],
  period: string,
): { table: ExportTable; missing: string[] } {
  const ok = slips.filter((s) => s.iban && isValidSaudiIban(s.iban));
  const missing = slips.filter((s) => !ok.includes(s)).map((s) => s.employee_name);
  const otherEarnings = (s: Payslip) =>
    r2(s.transport_allowance + s.other_allowance + s.overtime_amount + s.additions);
  const rows = ok.map((s) => [
    s.employee_no ?? '',
    s.employee_name,
    s.id_number ?? '',
    s.bank_name ?? '',
    s.iban ?? '',
    s.basic,
    s.housing_allowance,
    otherEarnings(s),
    s.total_deductions,
    s.net,
  ]);
  const sum = (f: (s: Payslip) => number) => r2(ok.reduce((t, s) => t + f(s), 0));
  return {
    missing,
    table: {
      title: `ملف حماية الأجور ${period}`,
      subtitle: `${BRAND.client.nameAr} · ${ok.length} موظف`,
      headers: [
        'الرقم الوظيفي',
        'اسم الموظف',
        'رقم الهوية/الإقامة',
        'البنك',
        'الآيبان',
        'الراتب الأساسي',
        'بدل السكن',
        'بدلات أخرى',
        'الاستقطاعات',
        'صافي الراتب',
      ],
      rows,
      footer: [
        'الإجمالي',
        '',
        '',
        '',
        '',
        sum((s) => s.basic),
        sum((s) => s.housing_allowance),
        sum(otherEarnings),
        sum((s) => s.total_deductions),
        sum((s) => s.net),
      ],
    },
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Only the last 4 digits of the IBAN are printed. */
export const maskIban = (iban?: string) => (iban ? `•••• ${iban.slice(-4)}` : '—');

/** Official payslip (A5, RTL). A slip from an unapproved run is watermarked. */
export function buildPayslipHtml(
  s: Payslip,
  period: string,
  status: PayrollRunStatus,
  autoPrint = true,
): string {
  const row = (label: string, value: number, hint = '') =>
    value === 0 && hint === ''
      ? ''
      : `<tr><td>${esc(label)}${hint ? ` <small>(${esc(hint)})</small>` : ''}</td><td class="n">${money(value)}</td></tr>`;
  const earnings = [
    row(
      'الراتب الأساسي',
      s.basic,
      s.eligible_days && s.eligible_days < 28 ? `${s.eligible_days} يوم` : '',
    ),
    row('بدل السكن', s.housing_allowance),
    row('بدل النقل', s.transport_allowance),
    row('بدلات أخرى', s.other_allowance),
    row('العمل الإضافي', s.overtime_amount),
    row('مكافآت وبدلات معتمدة', s.additions),
  ].join('');
  const deductions = [
    row('التأمينات الاجتماعية (حصة الموظف)', s.gosi_employee),
    row('خصم الغياب', s.absence_deduction),
    row('خصم التأخير', s.late_deduction),
    row('خصم الإجازات', s.leave_deduction),
    row('استرداد سلفة', s.advance_deductions),
    row('جزاءات', s.penalty_deductions),
  ].join('');
  const draft = status === 'calculated';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>قسيمة راتب ${esc(s.employee_name)} ${esc(period)}</title>
<style>
@page{size:A5;margin:10mm}
body{font-family:Alexandria,Tahoma,sans-serif;color:#0e1a2b;font-size:12px;position:relative}
.org{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #c9a24a;padding-bottom:6px;margin-bottom:10px}
.org strong{color:#1f58a8;font-size:15px}
h1{font-size:16px;margin:0 0 8px;color:#14294a}
.info{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;background:#f3f6fb;padding:8px;border-radius:6px;margin-bottom:10px}
.info span{color:#65738c}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th{background:#e3e9f2;text-align:right;padding:5px;border:1px solid #cbd3df}
td{padding:4px 6px;border:1px solid #e3e9f2}
td.n,.net .n{font-family:'JetBrains Mono',monospace;direction:ltr;text-align:left}
small{color:#65738c}
.net{display:flex;justify-content:space-between;background:#fbf4e3;padding:8px;border-radius:6px;font-size:15px;font-weight:bold}
.foot{margin-top:14px;color:#65738c;font-size:10px;display:flex;justify-content:space-between}
.wm{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:42px;color:rgba(200,30,30,.12);transform:rotate(-20deg)}
</style></head><body>
${draft ? '<div class="wm">مسودة — غير معتمدة</div>' : ''}
<div class="org"><strong>${esc(BRAND.client.nameAr)}</strong><span>قسيمة راتب</span></div>
<h1>قسيمة راتب شهر ${esc(period)}</h1>
<div class="info">
<div><span>الموظف:</span> ${esc(s.employee_name)}</div>
<div><span>الرقم الوظيفي:</span> ${esc(s.employee_no ?? '—')}</div>
<div><span>رقم الهوية/الإقامة:</span> ${esc(s.id_number ?? '—')}</div>
<div><span>الجنسية:</span> ${esc(s.nationality)}</div>
<div><span>البنك:</span> ${esc(s.bank_name ?? '—')}</div>
<div><span>الآيبان:</span> ${esc(maskIban(s.iban))}</div>
<div><span>أيام الحضور:</span> ${s.present_days}</div>
<div><span>أيام الغياب:</span> ${s.absent_days}</div>
</div>
<table><thead><tr><th>المستحقات</th><th>المبلغ (ر.س)</th></tr></thead><tbody>${earnings}
<tr><td><b>إجمالي المستحقات</b></td><td class="n"><b>${money(s.gross)}</b></td></tr></tbody></table>
<table><thead><tr><th>الاستقطاعات</th><th>المبلغ (ر.س)</th></tr></thead><tbody>${deductions || '<tr><td>لا يوجد</td><td class="n">0.00</td></tr>'}
<tr><td><b>إجمالي الاستقطاعات</b></td><td class="n"><b>${money(s.total_deductions)}</b></td></tr></tbody></table>
<div class="net"><span>صافي الراتب</span><span class="n">${money(s.net)} ر.س</span></div>
<div class="foot"><span>${draft ? 'مسودة للمراجعة — لا تُعتمد قبل اعتماد المسير' : 'صادرة من مسير معتمد'}</span><span>${esc(new Date().toISOString().slice(0, 10))}</span></div>
${autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}
</body></html>`;
}

export function printPayslip(s: Payslip, period: string, status: PayrollRunStatus): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(buildPayslipHtml(s, period, status));
  w.document.close();
}
