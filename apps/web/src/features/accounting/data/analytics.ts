import {
  balances,
  cashCodes,
  dayBefore,
  indexChart,
  isClosingEntry,
  monthEnd,
  monthsBetween,
  naturalAmount,
  scopedLines,
  trialBalancePro,
  type LedgerFilter,
} from '@/features/accounting/data/ledger';
import { fromHalala, pctChange, sumMoney, toHalala } from '@/features/accounting/data/money';
import {
  balanceSheetPro,
  cashFlowPro,
  incomeStatementPro,
} from '@/features/accounting/data/statements';
import { agingOf, apOpenItems, arOpenItems } from '@/features/accounting/data/receivables';
import type {
  Account,
  AgingReport,
  Bill,
  Invoice,
  JournalEntry,
} from '@/features/accounting/types';

/**
 * Financial dashboard analytics — every figure is computed from the posted
 * journal (and the AR/AP documents for counts), so the dashboard always agrees
 * with the statements. Nothing here is a hand-entered number.
 */

export interface DashboardFilter {
  from: string;
  to: string;
  branch?: string; // 'all' | branch | 'head'
  costCenter?: string; // 'all' | project/department code
}

export interface DocStat {
  count: number;
  amount: number;
}

export interface DashboardKpis {
  revenue: number;
  expenses: number;
  netProfit: number;
  vatPayable: number;
  receivables: number; // GL 1120
  cash: number;
  ledgerDebit: number;
  ledgerCredit: number;
  balanced: boolean;
  totalAR: number; // sub-ledger open
  totalAP: number;
  invoicesDue: DocStat; // open, not yet overdue
  invoicesOverdue: DocStat;
  invoicesUnpaid: DocStat; // nothing collected yet
  collections: number;
  payments: number;
  netCashFlow: number;
  grossMargin: number | null;
  netMargin: number | null;
  revenueGrowth: number | null; // vs the previous period of equal length
  expenseChange: number | null;
  totalAssets: number;
  totalLiabilities: number;
}

const ledgerFilter = (f: DashboardFilter): LedgerFilter => ({
  from: f.from,
  to: f.to,
  branch: f.branch,
  costCenter: f.costCenter,
});

/** The same-length window right before [from, to]. */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  const len = Math.round((b - a) / 86400000);
  const prevTo = dayBefore(from);
  const d = new Date(`${prevTo}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - len);
  return { from: d.toISOString().slice(0, 10), to: prevTo };
}

function docStats(items: { outstanding: number }[]): DocStat {
  return { count: items.length, amount: sumMoney(items.map((i) => i.outstanding)) };
}

export function dashboardKpis(
  entries: JournalEntry[],
  chart: Account[],
  invoices: Invoice[],
  bills: Bill[],
  f: DashboardFilter,
): DashboardKpis {
  const lf = ledgerFilter(f);
  const is = incomeStatementPro(entries, chart, lf);
  const prev = previousWindow(f.from, f.to);
  const isPrev = incomeStatementPro(entries, chart, { ...lf, ...prev });
  const bs = balanceSheetPro(entries, chart, {
    to: f.to,
    branch: f.branch,
    costCenter: f.costCenter,
  });
  const cf = cashFlowPro(entries, chart, lf);
  const asOf = balances(entries, chart, { to: f.to, branch: f.branch, costCenter: f.costCenter });
  const cashSet = new Set(cashCodes(chart));
  const cash = sumMoney([...asOf.entries()].filter(([c]) => cashSet.has(c)).map(([, v]) => v));
  const vatPayable = fromHalala(toHalala(asOf.get('2120') ?? 0) - toHalala(asOf.get('1140') ?? 0));
  const tb = trialBalancePro(entries, chart, {});

  const branchOk = (b: string | null) =>
    !f.branch || f.branch === 'all' || (f.branch === 'head' ? b === null : b === f.branch);
  const ar = arOpenItems(
    invoices.filter((i) => branchOk(i.branch)),
    f.to,
  );
  const ap = apOpenItems(
    bills.filter((b) => branchOk(b.branch)),
    f.to,
  );

  // collections: cash debits in entries that settle customer receivables
  let coll = 0;
  let pay = 0;
  const byEntry = new Map<string, ReturnType<typeof scopedLines>>();
  for (const s of scopedLines(entries, lf)) {
    const arr = byEntry.get(s.entry.id) ?? [];
    arr.push(s);
    byEntry.set(s.entry.id, arr);
  }
  for (const lines of byEntry.values()) {
    const settlesAr = lines.some((s) => s.line.account_code === '1120' && s.line.credit > 0);
    const internal = lines.every((s) => cashSet.has(s.line.account_code));
    if (internal) continue; // transfers between banks are neither
    for (const s of lines) {
      if (!cashSet.has(s.line.account_code)) continue;
      if (settlesAr) coll += toHalala(s.line.debit);
      pay += toHalala(s.line.credit);
    }
  }
  const expenses = sumMoney([
    is.costOfSales.total,
    is.operatingExpenses.total,
    is.otherExpenses.total,
  ]);
  const prevExpenses = sumMoney([
    isPrev.costOfSales.total,
    isPrev.operatingExpenses.total,
    isPrev.otherExpenses.total,
  ]);
  const revenue = sumMoney([is.revenue.total, is.otherIncome.total]);
  const prevRevenue = sumMoney([isPrev.revenue.total, isPrev.otherIncome.total]);
  return {
    revenue,
    expenses,
    netProfit: is.netProfit,
    vatPayable,
    receivables: asOf.get('1120') ?? 0,
    cash,
    ledgerDebit: tb.totals.periodDebit,
    ledgerCredit: tb.totals.periodCredit,
    balanced: toHalala(tb.totals.periodDebit) === toHalala(tb.totals.periodCredit),
    totalAR: sumMoney(ar.map((i) => i.outstanding)),
    totalAP: sumMoney(ap.map((i) => i.outstanding)),
    invoicesDue: docStats(ar.filter((i) => i.days_overdue === 0)),
    invoicesOverdue: docStats(ar.filter((i) => i.days_overdue > 0)),
    invoicesUnpaid: docStats(ar.filter((i) => toHalala(i.paid) === 0)),
    collections: fromHalala(coll),
    payments: fromHalala(pay),
    netCashFlow: cf.netChange,
    grossMargin: is.grossMargin,
    netMargin: is.netMargin,
    revenueGrowth: pctChange(revenue, prevRevenue),
    expenseChange: pctChange(expenses, prevExpenses),
    totalAssets: bs.totalAssets,
    totalLiabilities: bs.totalLiabilities,
  };
}

/* -------------------------------- series --------------------------------- */
export interface MonthPoint {
  month: string; // YYYY-MM
  revenue: number;
  expenses: number;
  profit: number;
  inflow: number;
  outflow: number;
  netCash: number;
}

/** Month-by-month P&L and cash movement (last N months ending at `to`). */
export function monthlySeries(
  entries: JournalEntry[],
  chart: Account[],
  f: DashboardFilter,
  months = 12,
): MonthPoint[] {
  const end = f.to.slice(0, 7);
  const y = Number(end.slice(0, 4));
  const m = Number(end.slice(5, 7));
  const startDate = new Date(Date.UTC(y, m - months, 1)).toISOString().slice(0, 7);
  const idx = indexChart(chart);
  const cash = new Set(cashCodes(chart));
  return monthsBetween(`${startDate}-01`, `${end}-01`).map((month) => {
    const lines = scopedLines(entries, {
      from: `${month}-01`,
      to: monthEnd(month),
      branch: f.branch,
      costCenter: f.costCenter,
    });
    let rev = 0;
    let exp = 0;
    let inflow = 0;
    let outflow = 0;
    const touchedInternal = new Map<string, boolean>();
    for (const s of lines) {
      const id = s.entry.id;
      if (!touchedInternal.has(id))
        touchedInternal.set(
          id,
          s.entry.lines.every((l) => cash.has(l.account_code)),
        );
    }
    for (const s of lines) {
      const t = idx.get(s.line.account_code)?.type;
      if (!isClosingEntry(s.entry)) {
        if (t === 'revenue') rev += toHalala(naturalAmount('revenue', s.line.debit, s.line.credit));
        else if (t === 'expense')
          exp += toHalala(naturalAmount('expense', s.line.debit, s.line.credit));
      }
      if (cash.has(s.line.account_code) && !touchedInternal.get(s.entry.id)) {
        inflow += toHalala(s.line.debit);
        outflow += toHalala(s.line.credit);
      }
    }
    return {
      month,
      revenue: fromHalala(rev),
      expenses: fromHalala(exp),
      profit: fromHalala(rev - exp),
      inflow: fromHalala(inflow),
      outflow: fromHalala(outflow),
      netCash: fromHalala(inflow - outflow),
    };
  });
}

export interface NamedValue {
  code: string;
  name: string;
  value: number;
}

/** Expense distribution by account in scope (largest first). */
export function expenseDistribution(
  entries: JournalEntry[],
  chart: Account[],
  f: DashboardFilter,
): NamedValue[] {
  const idx = indexChart(chart);
  const bal = balances(entries, chart, ledgerFilter(f), { excludeClosing: true });
  return [...bal.entries()]
    .filter(([c, v]) => idx.get(c)?.type === 'expense' && toHalala(v) > 0)
    .map(([code, value]) => ({ code, name: idx.get(code)?.name_ar ?? code, value }))
    .sort((a, b) => b.value - a.value);
}

export interface BranchPoint {
  branch: string;
  revenue: number;
  expenses: number;
  profit: number;
}
export function byBranch(
  entries: JournalEntry[],
  chart: Account[],
  f: DashboardFilter,
  branches: readonly string[],
): BranchPoint[] {
  const withHead = [...branches, 'head'];
  return withHead
    .map((b) => {
      const is = incomeStatementPro(entries, chart, { ...ledgerFilter(f), branch: b });
      const revenue = sumMoney([is.revenue.total, is.otherIncome.total]);
      return {
        branch: b === 'head' ? 'المركز الرئيسي' : b,
        revenue,
        expenses: fromHalala(toHalala(revenue) - toHalala(is.netProfit)),
        profit: is.netProfit,
      };
    })
    .filter((p) => p.branch !== 'المركز الرئيسي' || p.revenue !== 0 || p.expenses !== 0);
}

export function agingPair(
  invoices: Invoice[],
  bills: Bill[],
  asOf: string,
): { ar: AgingReport; ap: AgingReport } {
  return {
    ar: agingOf(arOpenItems(invoices, asOf), asOf),
    ap: agingOf(apOpenItems(bills, asOf), asOf),
  };
}
