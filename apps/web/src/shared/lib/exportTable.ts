/**
 * Table export — Excel (SpreadsheetML 2003, opens natively in Excel with RTL
 * and numeric cells) and PDF (print-ready RTL HTML → the browser's "Save as
 * PDF"). No third-party dependency; the builders are pure and unit-tested.
 */

export type Cell = string | number | null | undefined;
export interface ExportTable {
  title: string;
  subtitle?: string; // period / filters — always printed with the data
  headers: string[];
  rows: Cell[][];
  footer?: Cell[];
}

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function xmlCell(c: Cell, style?: string): string {
  const st = style ? ` ss:StyleID="${style}"` : '';
  if (typeof c === 'number' && Number.isFinite(c))
    return `<Cell${st}><Data ss:Type="Number">${c}</Data></Cell>`;
  return `<Cell${st}><Data ss:Type="String">${xmlEsc(String(c ?? ''))}</Data></Cell>`;
}

/** SpreadsheetML workbook (one RTL sheet). */
export function buildExcelXml(t: ExportTable): string {
  const row = (cells: Cell[], style?: string) =>
    `<Row>${cells.map((c) => xmlCell(c, style)).join('')}</Row>`;
  const sheet = t.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#E3E9F2" ss:Pattern="Solid"/></Style>
<Style ss:ID="t"><Font ss:Bold="1" ss:Size="14"/></Style>
<Style ss:ID="f"><Font ss:Bold="1"/></Style>
</Styles>
<Worksheet ss:Name="${xmlEsc(sheet)}" ss:RightToLeft="1"><Table>
${row([t.title], 't')}
${t.subtitle ? row([t.subtitle]) : ''}
${row(t.headers, 'h')}
${t.rows.map((r) => row(r)).join('\n')}
${t.footer ? row(t.footer, 'f') : ''}
</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions></Worksheet>
</Workbook>`;
}

/** UTF-8 CSV with BOM (Arabic-safe in Excel). */
export function buildCsv(t: ExportTable): string {
  const q = (c: Cell) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.headers, ...t.rows, ...(t.footer ? [t.footer] : [])].map((r) =>
    r.map(q).join(','),
  );
  return `﻿${lines.join('\n')}`;
}

const fmt = (c: Cell) =>
  typeof c === 'number'
    ? c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(c ?? '');

/** Print-ready RTL HTML document for PDF output. */
export function buildPrintHtml(t: ExportTable, org = 'ماسية الشرق للاستقدام'): string {
  const h = (s: string) => xmlEsc(s);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${h(t.title)}</title>
<style>
@page{size:A4;margin:14mm}
body{font-family:Alexandria,Tahoma,sans-serif;color:#0e1a2b;font-size:12px}
h1{color:#1f58a8;font-size:18px;margin:0}
.sub{color:#65738c;margin:4px 0 12px}
table{width:100%;border-collapse:collapse}
th{background:#e3e9f2;color:#14294a;text-align:right;padding:6px;border:1px solid #cbd3df}
td{padding:5px 6px;border:1px solid #e3e9f2}
td.n{font-family:'JetBrains Mono',monospace;direction:ltr;text-align:left}
tfoot td{font-weight:bold;background:#f3f6fb}
.org{display:flex;justify-content:space-between;border-bottom:2px solid #c9a24a;padding-bottom:6px;margin-bottom:10px}
</style></head><body>
<div class="org"><strong>${h(org)}</strong><span>${h(new Date().toISOString().slice(0, 16).replace('T', ' '))}</span></div>
<h1>${h(t.title)}</h1>${t.subtitle ? `<p class="sub">${h(t.subtitle)}</p>` : ''}
<table><thead><tr>${t.headers.map((x) => `<th>${h(x)}</th>`).join('')}</tr></thead>
<tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td${typeof c === 'number' ? ' class="n"' : ''}>${h(fmt(c))}</td>`).join('')}</tr>`).join('')}</tbody>
${t.footer ? `<tfoot><tr>${t.footer.map((c) => `<td${typeof c === 'number' ? ' class="n"' : ''}>${h(fmt(c))}</td>`).join('')}</tr></tfoot>` : ''}
</table><script>window.onload=function(){window.print()}</script></body></html>`;
}

function download(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportExcel(t: ExportTable, filename = t.title): void {
  download(buildExcelXml(t), `${filename}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}
export function exportCsv(t: ExportTable, filename = t.title): void {
  download(buildCsv(t), `${filename}.csv`, 'text/csv;charset=utf-8');
}
export function exportPdf(t: ExportTable): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(buildPrintHtml(t));
  w.document.close();
}
