import { balances, monthEnd } from '@/features/accounting/data/ledger';
import { fromHalala, toHalala } from '@/features/accounting/data/money';
import type { Account, JournalEntry, JournalLine, Period } from '@/features/accounting/types';

/**
 * Fiscal years & period close — mirror of close_period / reopen_period /
 * close_fiscal_year (0057). The ledger is continuous: balance-sheet balances
 * carry forward automatically, so year-end posts ONE closing entry (P&L →
 * الأرباح المحتجزة 3200) and the new year's opening balances are the prior
 * year-end position (shown for verification, never double-posted).
 */

export interface FiscalYear {
  year: number;
  start: string;
  end: string;
  status: 'open' | 'closed';
  closed_at?: string;
}

export function buildFiscalYear(year: number): { fy: FiscalYear; periods: Period[] } {
  return {
    fy: { year, start: `${year}-01-01`, end: `${year}-12-31`, status: 'open' },
    periods: Array.from({ length: 12 }, (_, i) => ({
      id: `${year}-${String(i + 1).padStart(2, '0')}`,
      year,
      month: i + 1,
      status: 'open' as const,
    })),
  };
}

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail?: string;
}

export interface CloseContext {
  period: string; // YYYY-MM
  pendingEntries: JournalEntry[]; // draft/pending/approved — not yet posted
  depreciationPosted: boolean;
  hasActiveAssets: boolean;
  vatFiled: boolean;
  bankReconciled: boolean;
  ledgerBalanced: boolean;
}

/** Month-end checklist. Blocking items must pass before the period locks. */
export function closeChecklist(c: CloseContext): ChecklistItem[] {
  const inPeriod = c.pendingEntries.filter((e) => e.entry_date.startsWith(c.period));
  return [
    {
      key: 'balanced',
      label: 'الدفتر متوازن (مدين = دائن)',
      ok: c.ledgerBalanced,
      blocking: true,
    },
    {
      key: 'pending',
      label: 'لا قيود معلّقة (مسودة/بانتظار الاعتماد) في الفترة',
      ok: inPeriod.length === 0,
      blocking: true,
      ...(inPeriod.length ? { detail: `${inPeriod.length} قيد معلّق` } : {}),
    },
    {
      key: 'depreciation',
      label: 'ترحيل إهلاك الأصول الثابتة',
      ok: !c.hasActiveAssets || c.depreciationPosted,
      blocking: false,
    },
    {
      key: 'bank',
      label: 'إتمام التسوية البنكية',
      ok: c.bankReconciled,
      blocking: false,
    },
    {
      key: 'vat',
      label: 'احتساب/تقديم إقرار ضريبة القيمة المضافة',
      ok: c.vatFiled,
      blocking: false,
    },
  ];
}

export function canClose(items: ChecklistItem[]): boolean {
  return items.every((i) => i.ok || !i.blocking);
}

/** Year-end closing lines: zero every remaining revenue/expense balance into 3200. */
export function yearClosingLines(
  entries: JournalEntry[],
  chart: Account[],
  year: number,
  retainedCode = '3200',
): JournalLine[] {
  const idx = new Map(chart.map((a) => [a.code, a]));
  // includes earlier monthly closing entries → only the still-open P&L remains
  const bal = balances(entries, chart, { from: `${year}-01-01`, to: `${year}-12-31` });
  const lines: JournalLine[] = [];
  let profit = 0;
  for (const [code, amt] of [...bal.entries()].sort()) {
    const t = idx.get(code)?.type;
    const h = toHalala(amt);
    if (h === 0) continue;
    if (t === 'revenue') {
      profit += h;
      lines.push(
        h > 0
          ? { account_code: code, debit: fromHalala(h), credit: 0, description: 'إقفال إيراد' }
          : {
              account_code: code,
              debit: 0,
              credit: fromHalala(-h),
              description: 'إقفال حساب مقابل',
            },
      );
    } else if (t === 'expense') {
      profit -= h;
      lines.push(
        h > 0
          ? { account_code: code, debit: 0, credit: fromHalala(h), description: 'إقفال مصروف' }
          : {
              account_code: code,
              debit: fromHalala(-h),
              credit: 0,
              description: 'إقفال حساب مقابل',
            },
      );
    }
  }
  if (profit > 0)
    lines.push({
      account_code: retainedCode,
      debit: 0,
      credit: fromHalala(profit),
      description: 'صافي ربح السنة',
    });
  else if (profit < 0)
    lines.push({
      account_code: retainedCode,
      debit: fromHalala(-profit),
      credit: 0,
      description: 'صافي خسارة السنة',
    });
  return lines;
}

export function yearClosingEntry(
  entries: JournalEntry[],
  chart: Account[],
  year: number,
  ids: { id: string; entry_no: number },
): JournalEntry | null {
  const lines = yearClosingLines(entries, chart, year);
  if (lines.length === 0) return null;
  return {
    id: ids.id,
    entry_no: ids.entry_no,
    entry_date: monthEnd(`${year}-12`),
    branch: null,
    description: `قيد إقفال السنة المالية ${year}`,
    reference: `CLOSE-FY${year}`,
    source_type: 'adjustment',
    status: 'posted',
    kind: 'closing',
    lines,
  };
}

/** Opening balances of `year` = balance-sheet position at the prior year-end. */
export function openingBalances(
  entries: JournalEntry[],
  chart: Account[],
  year: number,
): { code: string; name: string; amount: number }[] {
  const idx = new Map(chart.map((a) => [a.code, a]));
  const bal = balances(entries, chart, { to: `${year - 1}-12-31` });
  return [...bal.entries()]
    .filter(([c, v]) => {
      const t = idx.get(c)?.type;
      return (t === 'asset' || t === 'liability' || t === 'equity') && toHalala(v) !== 0;
    })
    .map(([code, amount]) => ({ code, name: idx.get(code)?.name_ar ?? code, amount }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Past periods still open (should be closed) as of a date. */
export function periodsNeedingClose(periods: Period[], today: string): Period[] {
  const cur = today.slice(0, 7);
  return periods.filter((p) => p.status === 'open' && p.id < cur);
}
