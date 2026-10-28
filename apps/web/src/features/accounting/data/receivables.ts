import { aging } from '@/features/accounting/data/invoicing';
import { balances } from '@/features/accounting/data/ledger';
import { fromHalala, subMoney, sumMoney, toHalala } from '@/features/accounting/data/money';
import type {
  Account,
  AgingBucketKey,
  AgingReport,
  Bill,
  Invoice,
  JournalEntry,
} from '@/features/accounting/types';

/**
 * Receivables / payables sub-ledgers built on the existing invoices (shared
 * sales ledger) and vendor bills — no parallel store. Aging reuses
 * invoicing.aging(); control totals are reconciled against GL 1120 / 2110.
 */

export const DAY_MS = 86400000;

export function daysBetween(from: string, to: string): number {
  return Math.floor(
    (new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime() -
      new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime()) /
      DAY_MS,
  );
}

export function bucketOf(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}

export interface OpenItem {
  id: string;
  no: number;
  party: string;
  branch: string | null;
  issue_date: string;
  due_date: string;
  total: number;
  paid: number;
  outstanding: number;
  days_overdue: number;
  bucket: AgingBucketKey;
}

export function arOpenItems(invoices: Invoice[], asOf: string): OpenItem[] {
  return invoices
    .filter((i) => i.status !== 'void' && i.status !== 'draft')
    .map((i) => {
      const outstanding = subMoney(i.total, i.amount_paid);
      const d = daysBetween(i.due_date, asOf);
      return {
        id: i.id,
        no: i.invoice_no,
        party: i.customer_name,
        branch: i.branch,
        issue_date: i.issue_date,
        due_date: i.due_date,
        total: i.total,
        paid: i.amount_paid,
        outstanding,
        days_overdue: Math.max(d, 0),
        bucket: bucketOf(d),
      };
    })
    .filter((x) => toHalala(x.outstanding) > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue);
}

export function apOpenItems(bills: Bill[], asOf: string): OpenItem[] {
  return bills
    .filter((b) => b.status !== 'void')
    .map((b) => {
      const outstanding = subMoney(b.total, b.amount_paid);
      const d = daysBetween(b.due_date, asOf);
      return {
        id: b.id,
        no: b.bill_no,
        party: b.vendor_name,
        branch: b.branch,
        issue_date: b.issue_date,
        due_date: b.due_date,
        total: b.total,
        paid: b.amount_paid,
        outstanding,
        days_overdue: Math.max(d, 0),
        bucket: bucketOf(d),
      };
    })
    .filter((x) => toHalala(x.outstanding) > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

export function agingOf(items: OpenItem[], asOf: string): AgingReport {
  return aging(
    items.map((i) => ({ due_date: i.due_date, outstanding: i.outstanding })),
    new Date(`${asOf}T00:00:00Z`),
  );
}

/** Per-party totals with buckets (customers or vendors). */
export interface PartyBalance {
  party: string;
  outstanding: number;
  overdue: number;
  items: number;
  oldestDays: number;
  creditLimit: number | null;
  overLimit: boolean;
}
export function partyBalances(
  items: OpenItem[],
  limits: Record<string, number> = {},
): PartyBalance[] {
  const m = new Map<string, OpenItem[]>();
  for (const it of items) m.set(it.party, [...(m.get(it.party) ?? []), it]);
  return [...m.entries()]
    .map(([party, its]) => {
      const outstanding = sumMoney(its.map((i) => i.outstanding));
      const limit = limits[party];
      return {
        party,
        outstanding,
        overdue: sumMoney(its.filter((i) => i.days_overdue > 0).map((i) => i.outstanding)),
        items: its.length,
        oldestDays: Math.max(...its.map((i) => i.days_overdue)),
        creditLimit: limit ?? null,
        overLimit: limit !== undefined && toHalala(outstanding) > toHalala(limit),
      };
    })
    .sort((a, b) => b.outstanding - a.outstanding);
}

/* ------------------------------ statements ------------------------------- */
export interface StatementRow {
  date: string;
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}
export interface PartyPayment {
  date: string;
  ref: string;
  amount: number;
  doc_id?: string;
}

/**
 * Customer / vendor statement: documents (debit for AR, credit for AP) and
 * settlements, with a running balance. Settlements not individually logged
 * (seeded paid amounts) appear as one settlement on the document date.
 */
export function partyStatement(
  docs: {
    id: string;
    date: string;
    ref: string;
    description: string;
    amount: number;
    paid: number;
  }[],
  payments: PartyPayment[],
  side: 'ar' | 'ap',
): StatementRow[] {
  type Ev = { date: string; ref: string; description: string; doc: number; pay: number };
  const evs: Ev[] = [];
  for (const d of docs) {
    evs.push({ date: d.date, ref: d.ref, description: d.description, doc: d.amount, pay: 0 });
    const logged = sumMoney(payments.filter((p) => p.doc_id === d.id).map((p) => p.amount));
    const unlogged = subMoney(d.paid, logged);
    if (toHalala(unlogged) > 0)
      evs.push({ date: d.date, ref: `${d.ref}-PAY`, description: 'سداد', doc: 0, pay: unlogged });
  }
  for (const p of payments)
    evs.push({ date: p.date, ref: p.ref, description: 'سداد', doc: 0, pay: p.amount });
  evs.sort((a, b) => a.date.localeCompare(b.date) || b.doc - a.doc);
  let run = 0;
  return evs.map((e) => {
    run += toHalala(e.doc) - toHalala(e.pay);
    return side === 'ar'
      ? {
          date: e.date,
          ref: e.ref,
          description: e.description,
          debit: e.doc,
          credit: e.pay,
          balance: fromHalala(run),
        }
      : {
          date: e.date,
          ref: e.ref,
          description: e.description,
          debit: e.pay,
          credit: e.doc,
          balance: fromHalala(run),
        };
  });
}

/* -------------------------- control reconciliation ----------------------- */
export interface ControlCheck {
  label: string;
  account: string;
  subledger: number;
  ledger: number;
  difference: number;
  matched: boolean;
}

/** Sub-ledger open balances must equal their GL control accounts. */
export function controlReconciliation(
  entries: JournalEntry[],
  chart: Account[],
  invoices: Invoice[],
  bills: Bill[],
  asOf: string,
  controls: { ar: string; ap: string } = { ar: '1120', ap: '2110' },
): ControlCheck[] {
  const bal = balances(entries, chart, { to: asOf });
  const ar = sumMoney(arOpenItems(invoices, asOf).map((i) => i.outstanding));
  const ap = sumMoney(apOpenItems(bills, asOf).map((i) => i.outstanding));
  const glAr = bal.get(controls.ar) ?? 0;
  const glAp = bal.get(controls.ap) ?? 0;
  const mk = (label: string, account: string, sub: number, gl: number): ControlCheck => ({
    label,
    account,
    subledger: sub,
    ledger: gl,
    difference: subMoney(gl, sub),
    matched: toHalala(gl) === toHalala(sub),
  });
  return [mk('ذمم العملاء', controls.ar, ar, glAr), mk('ذمم الموردين', controls.ap, ap, glAp)];
}

/* ---------------------------- AP payment plan ---------------------------- */
export interface PaymentPlanWeek {
  week: string; // YYYY-MM-DD (week start)
  amount: number;
  bills: number;
}
/** Group payable open items into weekly buckets by due date (schedule view). */
export function paymentSchedule(
  items: OpenItem[],
  scheduled: Record<string, string> = {}, // bill id → planned pay date
): PaymentPlanWeek[] {
  const m = new Map<string, { amount: number; bills: number }>();
  for (const it of items) {
    const date = scheduled[it.id] ?? it.due_date;
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // week starts Sunday (Saudi work week)
    const k = d.toISOString().slice(0, 10);
    const t = m.get(k) ?? { amount: 0, bills: 0 };
    m.set(k, { amount: sumMoney([t.amount, it.outstanding]), bills: t.bills + 1 });
  }
  return [...m.entries()]
    .map(([week, v]) => ({ week, ...v }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

/** Customers due a reminder: overdue ≥ `afterDays` and not reminded in the last `afterDays`. */
export function remindersDue(
  items: OpenItem[],
  afterDays: number,
  lastReminded: Record<string, string>, // invoice id → date
  asOf: string,
): OpenItem[] {
  return items.filter(
    (i) =>
      i.days_overdue >= afterDays &&
      (!lastReminded[i.id] || daysBetween(lastReminded[i.id] as string, asOf) >= afterDays),
  );
}
