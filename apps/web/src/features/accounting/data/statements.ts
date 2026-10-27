import { fromHalala, pctOf, sumMoney, toHalala } from '@/features/accounting/data/money';
import {
  balances,
  cashCodes,
  cfClassOf,
  dayBefore,
  fsClassOf,
  indexChart,
  isClosingEntry,
  naturalAmount,
  scopedLines,
  type LedgerFilter,
} from '@/features/accounting/data/ledger';
import type { Account, CfClass, FsClass, JournalEntry } from '@/features/accounting/types';
import { FS_CLASS_LABEL } from '@/features/accounting/types';

/**
 * Classified financial statements (IFRS for SMEs layout as adopted by SOCPA).
 * Every line keeps its account codes so the UI can drill down to the GL.
 */

/** The accounting policies the statements are built on (shown with every report). */
export const ACCOUNTING_POLICIES: string[] = [
  'أساس الاستحقاق: تُثبت الإيرادات والمصروفات عند تحققها لا عند التحصيل أو الدفع.',
  'الإيراد يُثبت قبل الضريبة عند توقيع العقد أو إصدار الفاتورة؛ ضريبة القيمة المضافة التزام مستقل لا إيراد.',
  'المردودات والخصومات (4900) ومجمع الإهلاك (1290) حسابات مقابلة تُطرح من بنودها.',
  'الأصول الثابتة بالتكلفة ناقص مجمع الإهلاك؛ الإهلاك وفق الطريقة المحددة لكل أصل (القسط الثابت افتراضيًا).',
  'قائمة التدفقات النقدية بالطريقة المباشرة: تُصنَّف كل حركة نقدية حسب نشاط الحساب المقابل.',
  'قيود الإقفال لا تدخل في قائمة الدخل؛ ربح الفترة غير المُقفلة يظهر ضمن حقوق الملكية.',
  'تصنيف كل حساب في القوائم قابل للتعديل من دليل الحسابات.',
];

export interface StatementLine {
  code: string;
  name: string;
  amount: number;
}
export interface StatementSection {
  key: FsClass;
  label: string;
  lines: StatementLine[];
  total: number;
}

function section(
  key: FsClass,
  bal: Map<string, number>,
  idx: ReturnType<typeof indexChart>,
): StatementSection {
  const lines = [...bal.entries()]
    .filter(([code, amt]) => fsClassOf(code, idx) === key && toHalala(amt) !== 0)
    .map(([code, amount]) => ({ code, name: idx.get(code)?.name_ar ?? code, amount }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { key, label: FS_CLASS_LABEL[key], lines, total: sumMoney(lines.map((l) => l.amount)) };
}

/* ----------------------------- income statement -------------------------- */
export interface IncomeStatementPro {
  revenue: StatementSection;
  costOfSales: StatementSection;
  grossProfit: number;
  operatingExpenses: StatementSection;
  operatingProfit: number;
  otherIncome: StatementSection;
  otherExpenses: StatementSection;
  netProfit: number;
  grossMargin: number | null;
  netMargin: number | null;
}

export function incomeStatementPro(
  entries: JournalEntry[],
  chart: Account[],
  f: LedgerFilter = {},
): IncomeStatementPro {
  const idx = indexChart(chart);
  const bal = balances(entries, chart, f, { excludeClosing: true });
  const revenue = section('revenue', bal, idx);
  const costOfSales = section('cost_of_sales', bal, idx);
  const operatingExpenses = section('operating_expense', bal, idx);
  const otherIncome = section('other_income', bal, idx);
  const otherExpenses = section('other_expense', bal, idx);
  const gross = fromHalala(toHalala(revenue.total) - toHalala(costOfSales.total));
  const operating = fromHalala(toHalala(gross) - toHalala(operatingExpenses.total));
  const net = fromHalala(
    toHalala(operating) + toHalala(otherIncome.total) - toHalala(otherExpenses.total),
  );
  return {
    revenue,
    costOfSales,
    grossProfit: gross,
    operatingExpenses,
    operatingProfit: operating,
    otherIncome,
    otherExpenses,
    netProfit: net,
    grossMargin: pctOf(gross, revenue.total),
    netMargin: pctOf(net, revenue.total),
  };
}

/* ------------------------------ balance sheet ---------------------------- */
export interface BalanceSheetPro {
  asOf: string | undefined;
  currentAssets: StatementSection;
  nonCurrentAssets: StatementSection;
  totalAssets: number;
  currentLiabilities: StatementSection;
  nonCurrentLiabilities: StatementSection;
  totalLiabilities: number;
  equity: StatementSection;
  /** profit not yet closed into retained earnings (cumulative to asOf). */
  unclosedProfit: number;
  totalEquity: number;
  difference: number; // A − (L + E) — must be 0
  balanced: boolean;
}

/** Position as of a date: cumulative posted balances (incl. closing entries). */
export function balanceSheetPro(
  entries: JournalEntry[],
  chart: Account[],
  f: Omit<LedgerFilter, 'from'> = {},
): BalanceSheetPro {
  const idx = indexChart(chart);
  const bal = balances(entries, chart, { ...f, from: undefined });
  const currentAssets = section('current_asset', bal, idx);
  const nonCurrentAssets = section('non_current_asset', bal, idx);
  const currentLiabilities = section('current_liability', bal, idx);
  const nonCurrentLiabilities = section('non_current_liability', bal, idx);
  const equity = section('equity', bal, idx);
  // revenue/expense still open (closing entries already moved closed periods to 3200)
  let pl = 0;
  for (const [code, amt] of bal) {
    const t = idx.get(code)?.type;
    if (t === 'revenue') pl += toHalala(amt);
    else if (t === 'expense') pl -= toHalala(amt);
  }
  const unclosedProfit = fromHalala(pl);
  const totalAssets = sumMoney([currentAssets.total, nonCurrentAssets.total]);
  const totalLiabilities = sumMoney([currentLiabilities.total, nonCurrentLiabilities.total]);
  const totalEquity = sumMoney([equity.total, unclosedProfit]);
  const difference = fromHalala(
    toHalala(totalAssets) - toHalala(totalLiabilities) - toHalala(totalEquity),
  );
  return {
    asOf: f.to,
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities,
    equity,
    unclosedProfit,
    totalEquity,
    difference,
    balanced: toHalala(difference) === 0,
  };
}

/* ------------------------------- cash flow ------------------------------- */
export interface CashFlowSection {
  key: Exclude<CfClass, 'cash'>;
  label: string;
  lines: StatementLine[]; // by counter-account (drill-down)
  inflow: number;
  outflow: number;
  net: number;
}
export interface CashFlowPro {
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
  openingCash: number;
  closingCash: number;
  reconciles: boolean; // opening + net change = closing
}

const CF_LABEL: Record<Exclude<CfClass, 'cash'>, string> = {
  operating: 'الأنشطة التشغيلية',
  investing: 'الأنشطة الاستثمارية',
  financing: 'الأنشطة التمويلية',
};

/**
 * Direct-method cash flow. Each posted entry touching cash is split across its
 * NON-cash lines (by weight) and classified by the counter-account's activity.
 * Pure transfers between cash accounts net to zero and are skipped.
 */
export function cashFlowPro(
  entries: JournalEntry[],
  chart: Account[],
  f: LedgerFilter = {},
): CashFlowPro {
  const idx = indexChart(chart);
  const cash = new Set(cashCodes(chart));
  const per: Record<Exclude<CfClass, 'cash'>, Map<string, number>> = {
    operating: new Map(),
    investing: new Map(),
    financing: new Map(),
  };
  const io: Record<Exclude<CfClass, 'cash'>, { in: number; out: number }> = {
    operating: { in: 0, out: 0 },
    investing: { in: 0, out: 0 },
    financing: { in: 0, out: 0 },
  };
  // group scoped lines by entry (branch scoping applies per line)
  const byEntry = new Map<string, ReturnType<typeof scopedLines>>();
  for (const s of scopedLines(entries, f)) {
    const arr = byEntry.get(s.entry.id) ?? [];
    arr.push(s);
    byEntry.set(s.entry.id, arr);
  }
  for (const lines of byEntry.values()) {
    const cashDelta = lines
      .filter((s) => cash.has(s.line.account_code))
      .reduce((h, s) => h + toHalala(s.line.debit) - toHalala(s.line.credit), 0);
    if (cashDelta === 0) continue;
    const counter = lines.filter((s) => !cash.has(s.line.account_code));
    const weights = counter.map((s) => Math.abs(toHalala(s.line.debit) - toHalala(s.line.credit)));
    const wSum = weights.reduce((a, b) => a + b, 0);
    if (wSum === 0) continue;
    let assigned = 0;
    counter.forEach((s, i) => {
      const part =
        i === counter.length - 1
          ? cashDelta - assigned
          : Math.round((cashDelta * (weights[i] ?? 0)) / wSum);
      assigned += part;
      const cls = cfClassOf(s.line.account_code, idx);
      const k: Exclude<CfClass, 'cash'> = cls === 'cash' ? 'operating' : cls;
      per[k].set(s.line.account_code, (per[k].get(s.line.account_code) ?? 0) + part);
      if (part > 0) io[k].in += part;
      else io[k].out -= part;
    });
  }
  const mk = (k: Exclude<CfClass, 'cash'>): CashFlowSection => {
    const lines = [...per[k].entries()]
      .filter(([, h]) => h !== 0)
      .map(([code, h]) => ({ code, name: idx.get(code)?.name_ar ?? code, amount: fromHalala(h) }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      key: k,
      label: CF_LABEL[k],
      lines,
      inflow: fromHalala(io[k].in),
      outflow: fromHalala(io[k].out),
      net: fromHalala(io[k].in - io[k].out),
    };
  };
  const operating = mk('operating');
  const investing = mk('investing');
  const financing = mk('financing');
  const netChange = sumMoney([operating.net, investing.net, financing.net]);
  const cashBal = (to: string | undefined) => {
    const b = balances(entries, chart, { ...f, from: undefined, to });
    return sumMoney([...b.entries()].filter(([c]) => cash.has(c)).map(([, v]) => v));
  };
  const openingCash = f.from ? cashBal(dayBefore(f.from)) : 0;
  const closingCash = cashBal(f.to);
  return {
    operating,
    investing,
    financing,
    netChange,
    openingCash,
    closingCash,
    reconciles: toHalala(openingCash) + toHalala(netChange) === toHalala(closingCash),
  };
}

/** Entries that make up one statement line (drill-down: line → account → entries). */
export function entriesForAccounts(
  entries: JournalEntry[],
  codes: string[],
  f: LedgerFilter = {},
  opts: { excludeClosing?: boolean } = {},
): JournalEntry[] {
  const set = new Set(codes);
  const ids = new Set<string>();
  for (const s of scopedLines(entries, f)) {
    if (opts.excludeClosing && isClosingEntry(s.entry)) continue;
    if (set.has(s.line.account_code)) ids.add(s.entry.id);
  }
  return entries.filter((e) => ids.has(e.id));
}

/** Account natural balance in a scope (convenience for drill rows). */
export function accountMovement(
  entries: JournalEntry[],
  chart: Account[],
  code: string,
  f: LedgerFilter = {},
): number {
  const type = indexChart(chart).get(code)?.type ?? 'asset';
  return sumMoney(
    scopedLines(entries, f)
      .filter((s) => s.line.account_code === code)
      .map((s) => naturalAmount(type, s.line.debit, s.line.credit)),
  );
}
