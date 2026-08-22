import { account } from '@/features/accounting/data/chart';
import { trialBalance } from '@/features/accounting/data/engine';
import type { AccountType, JournalEntry, JournalLine } from '@/features/accounting/types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ReportLine {
  code: string;
  name: string;
  amount: number;
}
export interface ReportFilter {
  period?: string; // 'YYYY-MM' — omit for cumulative
  branch?: string; // omit / 'all' for all cost centers
}

function applyFilter(entries: JournalEntry[], f: ReportFilter): JournalEntry[] {
  return entries.filter(
    (e) =>
      e.status === 'posted' &&
      (!f.period || e.entry_date.startsWith(f.period)) &&
      (!f.branch || f.branch === 'all' || e.branch === f.branch),
  );
}

function linesByType(entries: JournalEntry[], type: AccountType): ReportLine[] {
  return trialBalance(entries)
    .filter((r) => r.type === type && r.balance !== 0)
    .map((r) => ({ code: r.code, name: r.name_ar, amount: r.balance }));
}
const sum = (rows: ReportLine[]): number => round2(rows.reduce((s, r) => s + r.amount, 0));

/* ----------------------------- income statement -------------------------- */
export interface IncomeStatement {
  revenue: ReportLine[];
  expenses: ReportLine[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}
export function incomeStatement(entries: JournalEntry[], f: ReportFilter = {}): IncomeStatement {
  const scoped = applyFilter(entries, f);
  const revenue = linesByType(scoped, 'revenue');
  const expenses = linesByType(scoped, 'expense');
  const totalRevenue = sum(revenue);
  const totalExpenses = sum(expenses);
  return {
    revenue,
    expenses,
    totalRevenue,
    totalExpenses,
    netProfit: round2(totalRevenue - totalExpenses),
  };
}

/* ------------------------------ balance sheet ---------------------------- */
export interface BalanceSheet {
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number; // includes current-period net profit
  netProfit: number;
  balanced: boolean;
}
export function balanceSheet(entries: JournalEntry[], f: ReportFilter = {}): BalanceSheet {
  const scoped = applyFilter(entries, f);
  const assets = linesByType(scoped, 'asset');
  const liabilities = linesByType(scoped, 'liability');
  const equity = linesByType(scoped, 'equity');
  const totalRevenue = sum(linesByType(scoped, 'revenue'));
  const totalExpenses = sum(linesByType(scoped, 'expense'));
  const netProfit = round2(totalRevenue - totalExpenses);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = round2(sum(equity) + netProfit); // unclosed profit sits in equity
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    netProfit,
    balanced: Math.round(totalAssets * 100) === Math.round((totalLiabilities + totalEquity) * 100),
  };
}

/* ------------------------------- cash flow ------------------------------- */
const CASH_CODES = ['1111', '1112', '1113', '1131', '1132'];
export interface CashFlow {
  inflow: number;
  outflow: number;
  net: number;
  byAccount: ReportLine[];
}
export function cashFlow(entries: JournalEntry[], f: ReportFilter = {}): CashFlow {
  const scoped = applyFilter(entries, f);
  let inflow = 0;
  let outflow = 0;
  const per = new Map<string, number>();
  for (const e of scoped)
    for (const l of e.lines)
      if (CASH_CODES.includes(l.account_code)) {
        inflow += l.debit;
        outflow += l.credit;
        per.set(l.account_code, (per.get(l.account_code) ?? 0) + l.debit - l.credit);
      }
  const byAccount = [...per.entries()].map(([code, amount]) => ({
    code,
    name: account(code)?.name_ar ?? code,
    amount: round2(amount),
  }));
  return {
    inflow: round2(inflow),
    outflow: round2(outflow),
    net: round2(inflow - outflow),
    byAccount,
  };
}

/* --------------------------- cost-center report -------------------------- */
export interface CostCenterRow {
  branch: string;
  revenue: number;
  expenses: number;
  net: number;
}
export function costCenters(
  entries: JournalEntry[],
  branches: readonly string[],
  f: ReportFilter = {},
): CostCenterRow[] {
  return branches.map((b) => {
    const opts: ReportFilter = f.period ? { period: f.period, branch: b } : { branch: b };
    const is = incomeStatement(entries, opts);
    return { branch: b, revenue: is.totalRevenue, expenses: is.totalExpenses, net: is.netProfit };
  });
}

/* ------------------------------ period close ----------------------------- */
/** Closing entry: zero revenue & expense into retained earnings (3200). */
export function buildClosingEntry(entries: JournalEntry[], period: string): JournalEntry {
  const is = incomeStatement(entries, { period });
  const lines: JournalLine[] = [];
  // revenue accounts carry credit balances → debit them to close
  for (const r of is.revenue)
    if (r.amount > 0)
      lines.push({ account_code: r.code, debit: r.amount, credit: 0, description: 'إقفال إيراد' });
  // expense accounts carry debit balances → credit them to close
  for (const e of is.expenses)
    if (e.amount > 0)
      lines.push({ account_code: e.code, debit: 0, credit: e.amount, description: 'إقفال مصروف' });
  // net profit/loss → retained earnings (3200)
  if (is.netProfit > 0)
    lines.push({
      account_code: '3200',
      debit: 0,
      credit: is.netProfit,
      description: 'صافي الربح للأرباح المحتجزة',
    });
  else if (is.netProfit < 0)
    lines.push({
      account_code: '3200',
      debit: -is.netProfit,
      credit: 0,
      description: 'صافي الخسارة من الأرباح المحتجزة',
    });
  return {
    id: `je-close-${period}`,
    entry_no: 8000 + (Number(period.slice(5, 7)) || 0),
    entry_date: `${period}-28`,
    branch: null,
    description: `قيد إقفال الفترة ${period}`,
    reference: `CLOSE-${period}`,
    source_type: 'manual',
    status: 'posted',
    lines,
  };
}
