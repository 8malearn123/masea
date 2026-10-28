import {
  balances,
  scopedLines,
  indexChart,
  naturalAmount,
  type LedgerFilter,
} from '@/features/accounting/data/ledger';
import {
  fromHalala,
  pctOf,
  splitMoney,
  sumMoney,
  toHalala,
} from '@/features/accounting/data/money';
import type { Account, JournalEntry, JournalLine } from '@/features/accounting/types';

/* ============================ cost centers =============================== */
export type CostCenterKind = 'branch' | 'department' | 'project';
export const COST_CENTER_KIND_LABEL: Record<CostCenterKind, string> = {
  branch: 'فرع',
  department: 'قسم',
  project: 'مشروع',
};

/** Branches stay the primary cost centers; departments/projects tag entries too. */
export interface CostCenter {
  code: string;
  name: string;
  kind: CostCenterKind;
  branch: string | null; // owning branch (null = company-wide)
  is_active: boolean;
}

export interface CenterResult {
  code: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number | null;
}

/** Profitability per project / department (entries tagged with cost_center). */
export function centerProfitability(
  entries: JournalEntry[],
  chart: Account[],
  centers: CostCenter[],
  f: LedgerFilter = {},
): CenterResult[] {
  return centers
    .filter((c) => c.kind !== 'branch')
    .map((c) => {
      const bal = balances(entries, chart, { ...f, costCenter: c.code }, { excludeClosing: true });
      const idx = indexChart(chart);
      let rev = 0;
      let exp = 0;
      for (const [code, amt] of bal) {
        const t = idx.get(code)?.type;
        if (t === 'revenue') rev += toHalala(amt);
        else if (t === 'expense') exp += toHalala(amt);
      }
      const revenue = fromHalala(rev);
      const profit = fromHalala(rev - exp);
      return {
        code: c.code,
        name: c.name,
        revenue,
        expenses: fromHalala(exp),
        profit,
        margin: pctOf(profit, revenue),
      };
    });
}

/* ========================= shared-cost allocation ======================== */
export type AllocationBasis = 'fixed' | 'revenue';
export interface AllocationRule {
  id: string;
  name: string;
  account_codes: string[]; // head-office expense accounts to distribute
  basis: AllocationBasis;
  weights: Record<string, number>; // branch → % (fixed basis)
  is_active: boolean;
}

/**
 * Allocation entry for one period: moves the HEAD-OFFICE (branch = null)
 * balance of each account to the branches by the rule's basis. Uses line-level
 * branches so the company total is unchanged (DR account@branch / CR account@head).
 */
export function buildAllocationLines(
  rule: AllocationRule,
  entries: JournalEntry[],
  chart: Account[],
  period: string,
  branches: readonly string[],
): JournalLine[] {
  const from = `${period}-01`;
  const to = `${period}-31`;
  let weights: number[];
  if (rule.basis === 'revenue') {
    const idx = indexChart(chart);
    weights = branches.map((b) =>
      toHalala(
        sumMoney(
          scopedLines(entries, { from, to, branch: b })
            .filter((s) => idx.get(s.line.account_code)?.type === 'revenue')
            .map((s) => naturalAmount('revenue', s.line.debit, s.line.credit)),
        ),
      ),
    );
  } else {
    weights = branches.map((b) => rule.weights[b] ?? 0);
  }
  if (weights.every((w) => w <= 0)) return [];
  const head = balances(entries, chart, { from, to, branch: 'head' });
  const lines: JournalLine[] = [];
  for (const code of rule.account_codes) {
    const amt = head.get(code) ?? 0;
    if (toHalala(amt) <= 0) continue;
    const parts = splitMoney(amt, weights);
    parts.forEach((p, i) => {
      if (toHalala(p) > 0)
        lines.push({
          account_code: code,
          debit: p,
          credit: 0,
          branch: branches[i] ?? null,
          description: `توزيع ${rule.name}`,
        });
    });
    lines.push({
      account_code: code,
      debit: 0,
      credit: amt,
      branch: null,
      description: `توزيع ${rule.name} من المركز الرئيسي`,
    });
  }
  return lines;
}

/* =============================== budgets ================================= */
export type BudgetScope = 'company' | 'branch' | 'department' | 'project';
export const BUDGET_SCOPE_LABEL: Record<BudgetScope, string> = {
  company: 'الشركة',
  branch: 'فرع',
  department: 'قسم',
  project: 'مشروع',
};
export interface BudgetLine {
  account_code: string;
  amounts: number[]; // 12 months (Jan..Dec)
}
export interface Budget {
  id: string;
  name: string;
  year: number;
  scope: BudgetScope;
  branch: string | null;
  cost_center: string | null;
  status: 'draft' | 'approved';
  lines: BudgetLine[];
  is_active: boolean;
}

export interface BudgetVarianceRow {
  code: string;
  name: string;
  type: Account['type'];
  budget: number;
  actual: number;
  variance: number; // favourable positive
  usedPct: number | null;
  overrun: boolean;
}

/** Spread an annual amount over 12 months exactly. */
export function spreadAnnual(annual: number): number[] {
  return splitMoney(
    annual,
    Array.from({ length: 12 }, () => 1),
  );
}

/** Budget vs actual up to `throughMonth` (1..12) of the budget year. */
export function budgetVsActual(
  budget: Budget,
  entries: JournalEntry[],
  chart: Account[],
  throughMonth = 12,
): BudgetVarianceRow[] {
  const idx = indexChart(chart);
  const to = `${budget.year}-${String(throughMonth).padStart(2, '0')}-31`;
  const f: LedgerFilter = {
    from: `${budget.year}-01-01`,
    to,
    ...(budget.branch ? { branch: budget.branch } : {}),
    ...(budget.cost_center ? { costCenter: budget.cost_center } : {}),
  };
  const bal = balances(entries, chart, f, { excludeClosing: true });
  return budget.lines.map((l) => {
    const acc = idx.get(l.account_code);
    const type = acc?.type ?? 'expense';
    const b = sumMoney(l.amounts.slice(0, throughMonth));
    const a = bal.get(l.account_code) ?? 0;
    // expense: under budget is favourable; revenue: above budget is favourable
    const variance =
      type === 'revenue'
        ? fromHalala(toHalala(a) - toHalala(b))
        : fromHalala(toHalala(b) - toHalala(a));
    return {
      code: l.account_code,
      name: acc?.name_ar ?? l.account_code,
      type,
      budget: b,
      actual: a,
      variance,
      usedPct: pctOf(a, b),
      overrun: type !== 'revenue' && toHalala(a) > toHalala(b),
    };
  });
}

export interface BudgetAlert {
  budget: string;
  code: string;
  name: string;
  usedPct: number;
  overrun: boolean;
}
/** Lines at/over the alert threshold (% of budget consumed) — expense lines. */
export function budgetAlerts(
  budgets: Budget[],
  entries: JournalEntry[],
  chart: Account[],
  thresholdPct: number,
  throughMonth: number,
): BudgetAlert[] {
  const out: BudgetAlert[] = [];
  for (const b of budgets) {
    if (!b.is_active || b.status !== 'approved') continue;
    for (const r of budgetVsActual(b, entries, chart, throughMonth)) {
      if (r.type === 'revenue' || r.usedPct === null) continue;
      if (r.usedPct >= thresholdPct)
        out.push({
          budget: b.name,
          code: r.code,
          name: r.name,
          usedPct: r.usedPct,
          overrun: r.overrun,
        });
    }
  }
  return out.sort((a, b) => b.usedPct - a.usedPct);
}
