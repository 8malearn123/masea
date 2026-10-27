import { sumMoney, toHalala, fromHalala } from '@/features/accounting/data/money';
import type {
  Account,
  AccountType,
  CfClass,
  FsClass,
  JournalEntry,
  JournalLine,
} from '@/features/accounting/types';

/**
 * General-ledger core — every report, KPI and statement is derived from the
 * POSTED journal through these helpers (single source of truth).
 *
 * Sign convention: amounts are "natural" for the account TYPE, not the
 * account's own normal balance — assets/expenses = debit − credit,
 * liabilities/equity/revenue = credit − debit. Contra accounts (مجمع الإهلاك
 * 1290, مردودات المبيعات 4900) therefore come out negative and reduce their
 * section, which is what the statements need.
 */

export interface LedgerFilter {
  from?: string | undefined; // YYYY-MM-DD inclusive
  to?: string | undefined; // YYYY-MM-DD inclusive
  branch?: string | undefined; // 'all' / undefined = every cost center; 'head' = المركز الرئيسي
  costCenter?: string | undefined; // project / department code; 'all' / undefined = every
}

export const isPosted = (e: JournalEntry): boolean => e.status === 'posted';

/** Closing entries zero P&L into retained earnings — excluded from the income statement. */
export function isClosingEntry(e: JournalEntry): boolean {
  return e.kind === 'closing' || (e.reference ?? '').startsWith('CLOSE-');
}

/** Line-level cost center wins over the header (allocation lines). */
export function lineBranch(e: JournalEntry, l: JournalLine): string | null {
  return l.branch !== undefined ? l.branch : e.branch;
}

const DEBIT_NATURAL: AccountType[] = ['asset', 'expense'];
export function isDebitNatural(type: AccountType): boolean {
  return DEBIT_NATURAL.includes(type);
}

/** Natural signed amount of one line for an account type. */
export function naturalAmount(type: AccountType, debit: number, credit: number): number {
  return isDebitNatural(type)
    ? fromHalala(toHalala(debit) - toHalala(credit))
    : fromHalala(toHalala(credit) - toHalala(debit));
}

function matchBranch(want: string | undefined, have: string | null): boolean {
  if (!want || want === 'all') return true;
  if (want === 'head') return have === null;
  return have === want;
}

export interface ScopedLine {
  entry: JournalEntry;
  line: JournalLine;
  branch: string | null;
}

/** Posted lines inside a date range / branch / cost-center scope. */
export function scopedLines(entries: JournalEntry[], f: LedgerFilter = {}): ScopedLine[] {
  const out: ScopedLine[] = [];
  for (const e of entries) {
    if (!isPosted(e)) continue;
    if (f.from && e.entry_date < f.from) continue;
    if (f.to && e.entry_date > f.to) continue;
    if (f.costCenter && f.costCenter !== 'all' && (e.cost_center ?? null) !== f.costCenter)
      continue;
    for (const line of e.lines) {
      const branch = lineBranch(e, line);
      if (!matchBranch(f.branch, branch)) continue;
      out.push({ entry: e, line, branch });
    }
  }
  return out;
}

/* --------------------------- account classification ---------------------- */
/** Default statement class from the Saudi chart codes (overridable per account). */
export function defaultFsClass(a: Pick<Account, 'code' | 'type'>): FsClass {
  const c = a.code;
  switch (a.type) {
    case 'asset':
      return c.startsWith('12') || c.startsWith('13') ? 'non_current_asset' : 'current_asset';
    case 'liability':
      return c.startsWith('22') || c.startsWith('23')
        ? 'non_current_liability'
        : 'current_liability';
    case 'equity':
      return 'equity';
    case 'revenue':
      // 41xx–44xx النشاط (+ 49xx المردودات) ؛ 45xx فما فوق إيرادات أخرى
      return Number(c) >= 4500 && !c.startsWith('49') ? 'other_income' : 'revenue';
    case 'expense':
      if (c === '5600') return 'cost_of_sales'; // رسوم المكاتب الخارجية: تكلفة مباشرة للاستقدام
      if (c.startsWith('59') && c !== '5900') return 'other_expense'; // خسائر/أخرى
      return 'operating_expense';
  }
}

/** Default cash-flow class (cash itself, or the activity a counter-account belongs to). */
export function defaultCfClass(a: Pick<Account, 'code' | 'type' | 'parent_code'>): CfClass {
  const c = a.code;
  if (a.type === 'asset' && (a.parent_code === '1110' || a.parent_code === '1130')) return 'cash';
  if (a.type === 'asset' && (c.startsWith('12') || c.startsWith('13'))) return 'investing';
  if (a.type === 'equity') return 'financing';
  if (a.type === 'liability' && (c.startsWith('22') || c.startsWith('23'))) return 'financing';
  return 'operating';
}

export type ChartIndex = Map<string, Account>;
export function indexChart(chart: Account[]): ChartIndex {
  return new Map(chart.map((a) => [a.code, a]));
}

export function fsClassOf(code: string, idx: ChartIndex): FsClass {
  const a = idx.get(code);
  if (!a) return 'operating_expense';
  return a.fs_class ?? defaultFsClass(a);
}
export function cfClassOf(code: string, idx: ChartIndex): CfClass {
  const a = idx.get(code);
  if (!a) return 'operating';
  return a.cf_class ?? defaultCfClass(a);
}
export function cashCodes(chart: Account[]): string[] {
  const idx = indexChart(chart);
  return chart.filter((a) => a.is_postable && cfClassOf(a.code, idx) === 'cash').map((a) => a.code);
}

/** Natural balance per account over a scope (posted only). */
export function balances(
  entries: JournalEntry[],
  chart: Account[],
  f: LedgerFilter = {},
  opts: { excludeClosing?: boolean } = {},
): Map<string, number> {
  const idx = indexChart(chart);
  const acc = new Map<string, number>();
  for (const { entry, line } of scopedLines(entries, f)) {
    if (opts.excludeClosing && isClosingEntry(entry)) continue;
    const type = idx.get(line.account_code)?.type ?? 'asset';
    const h = toHalala(naturalAmount(type, line.debit, line.credit));
    acc.set(line.account_code, (acc.get(line.account_code) ?? 0) + h);
  }
  return new Map([...acc.entries()].map(([k, v]) => [k, fromHalala(v)]));
}

/* ------------------------------ general ledger --------------------------- */
export interface GlRow {
  entry_id: string;
  entry_no: number;
  date: string;
  reference: string | null;
  description: string;
  source: JournalEntry['source_type'];
  branch: string | null;
  debit: number;
  credit: number;
  balance: number; // running, natural sign
}
export interface GeneralLedger {
  account: Account | undefined;
  opening: number;
  rows: GlRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

/** Account ledger with opening balance (before `from`) and running balance. */
export function generalLedger(
  entries: JournalEntry[],
  code: string,
  chart: Account[],
  f: LedgerFilter = {},
  search = '',
): GeneralLedger {
  const idx = indexChart(chart);
  const account = idx.get(code);
  const type = account?.type ?? 'asset';
  const before = f.from
    ? scopedLines(entries, { ...f, from: undefined, to: dayBefore(f.from) })
    : [];
  let run = 0;
  for (const s of before)
    if (s.line.account_code === code)
      run += toHalala(naturalAmount(type, s.line.debit, s.line.credit));
  const opening = fromHalala(run);

  const q = search.trim();
  const inRange = scopedLines(entries, f)
    .filter((s) => s.line.account_code === code)
    .sort(
      (a, b) =>
        a.entry.entry_date.localeCompare(b.entry.entry_date) || a.entry.entry_no - b.entry.entry_no,
    );
  const rows: GlRow[] = [];
  let dr = 0;
  let cr = 0;
  for (const s of inRange) {
    run += toHalala(naturalAmount(type, s.line.debit, s.line.credit));
    dr += toHalala(s.line.debit);
    cr += toHalala(s.line.credit);
    rows.push({
      entry_id: s.entry.id,
      entry_no: s.entry.entry_no,
      date: s.entry.entry_date,
      reference: s.entry.reference,
      description: s.line.description
        ? `${s.entry.description} — ${s.line.description}`
        : s.entry.description,
      source: s.entry.source_type,
      branch: s.branch,
      debit: s.line.debit,
      credit: s.line.credit,
      balance: fromHalala(run),
    });
  }
  const filtered = q
    ? rows.filter(
        (r) =>
          r.description.includes(q) ||
          (r.reference ?? '').includes(q) ||
          String(r.entry_no) === q.replace('#', ''),
      )
    : rows;
  return {
    account,
    opening,
    rows: filtered,
    totalDebit: fromHalala(dr),
    totalCredit: fromHalala(cr),
    closing: fromHalala(run),
  };
}

export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------------- trial balance (opening/movement/closing) --------- */
export interface TbProRow {
  code: string;
  name: string;
  type: AccountType;
  parent_code: string | null;
  level: number;
  is_postable: boolean;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}
export interface TbProTotals {
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
  balanced: boolean;
}

/**
 * Trial balance with opening balances (before `from`), period movements and
 * closing balances. Header accounts roll up their descendants. Totals count
 * postable rows only, and must balance at every column pair.
 */
export function trialBalancePro(
  entries: JournalEntry[],
  chart: Account[],
  f: LedgerFilter = {},
): { rows: TbProRow[]; totals: TbProTotals } {
  const openNet = new Map<string, number>(); // halalas, debit-positive
  const pd = new Map<string, number>();
  const pc = new Map<string, number>();
  if (f.from) {
    for (const s of scopedLines(entries, { ...f, from: undefined, to: dayBefore(f.from) })) {
      const c = s.line.account_code;
      openNet.set(c, (openNet.get(c) ?? 0) + toHalala(s.line.debit) - toHalala(s.line.credit));
    }
  }
  for (const s of scopedLines(entries, f)) {
    const c = s.line.account_code;
    pd.set(c, (pd.get(c) ?? 0) + toHalala(s.line.debit));
    pc.set(c, (pc.get(c) ?? 0) + toHalala(s.line.credit));
  }

  const byCode = indexChart(chart);
  const codes = new Set<string>([...openNet.keys(), ...pd.keys(), ...pc.keys()]);
  // raw postable figures (halalas)
  type Raw = { od: number; oc: number; pd: number; pc: number };
  const raw = new Map<string, Raw>();
  for (const code of codes) {
    const o = openNet.get(code) ?? 0;
    raw.set(code, {
      od: o > 0 ? o : 0,
      oc: o < 0 ? -o : 0,
      pd: pd.get(code) ?? 0,
      pc: pc.get(code) ?? 0,
    });
  }
  // roll-up to ancestors
  const roll = new Map<string, Raw>();
  const add = (code: string, r: Raw) => {
    const t = roll.get(code) ?? { od: 0, oc: 0, pd: 0, pc: 0 };
    roll.set(code, { od: t.od + r.od - r.oc, oc: 0, pd: t.pd + r.pd, pc: t.pc + r.pc });
  };
  for (const [code, r] of raw) {
    let parent = byCode.get(code)?.parent_code ?? null;
    let guard = 0;
    while (parent && guard++ < 10) {
      add(parent, r);
      parent = byCode.get(parent)?.parent_code ?? null;
    }
  }
  const depth = (code: string): number => {
    let d = 0;
    let p = byCode.get(code)?.parent_code ?? null;
    while (p && d < 10) {
      d += 1;
      p = byCode.get(p)?.parent_code ?? null;
    }
    return d;
  };
  const toRow = (code: string, r: Raw, postable: boolean): TbProRow => {
    const a = byCode.get(code);
    const openNetH = r.od - r.oc;
    const closeNet = openNetH + r.pd - r.pc;
    return {
      code,
      name: a?.name_ar ?? code,
      type: a?.type ?? 'asset',
      parent_code: a?.parent_code ?? null,
      level: depth(code),
      is_postable: postable,
      openingDebit: fromHalala(openNetH > 0 ? openNetH : 0),
      openingCredit: fromHalala(openNetH < 0 ? -openNetH : 0),
      periodDebit: fromHalala(r.pd),
      periodCredit: fromHalala(r.pc),
      closingDebit: fromHalala(closeNet > 0 ? closeNet : 0),
      closingCredit: fromHalala(closeNet < 0 ? -closeNet : 0),
    };
  };
  const rows: TbProRow[] = [
    ...[...raw.entries()].map(([c, r]) => toRow(c, r, true)),
    ...[...roll.entries()].map(([c, r]) => toRow(c, r, false)),
  ].sort((a, b) => a.code.localeCompare(b.code));

  const post = rows.filter((r) => r.is_postable);
  const t = (k: keyof TbProTotals & keyof TbProRow) => sumMoney(post.map((r) => r[k] as number));
  const totals: TbProTotals = {
    openingDebit: t('openingDebit'),
    openingCredit: t('openingCredit'),
    periodDebit: t('periodDebit'),
    periodCredit: t('periodCredit'),
    closingDebit: t('closingDebit'),
    closingCredit: t('closingCredit'),
    balanced: false,
  };
  // branch-scoped views may legitimately not balance (cross-branch allocations)
  totals.balanced =
    toHalala(totals.openingDebit) === toHalala(totals.openingCredit) &&
    toHalala(totals.periodDebit) === toHalala(totals.periodCredit) &&
    toHalala(totals.closingDebit) === toHalala(totals.closingCredit);
  return { rows, totals };
}

/** Closing balance per account for two scopes side by side (period comparison). */
export interface TbCompareRow {
  code: string;
  name: string;
  current: number;
  previous: number;
  diff: number;
}
export function compareBalances(
  entries: JournalEntry[],
  chart: Account[],
  current: LedgerFilter,
  previous: LedgerFilter,
): TbCompareRow[] {
  const a = balances(entries, chart, current);
  const b = balances(entries, chart, previous);
  const idx = indexChart(chart);
  const codes = [...new Set([...a.keys(), ...b.keys()])].sort();
  return codes.map((code) => {
    const cur = a.get(code) ?? 0;
    const prev = b.get(code) ?? 0;
    return {
      code,
      name: idx.get(code)?.name_ar ?? code,
      current: cur,
      previous: prev,
      diff: fromHalala(toHalala(cur) - toHalala(prev)),
    };
  });
}

/** Month keys (YYYY-MM) covering a range, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 240) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function monthEnd(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, '0')}`;
}
