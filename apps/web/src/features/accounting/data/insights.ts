import { cashCodes, monthsBetween, scopedLines, balances } from '@/features/accounting/data/ledger';
import { fromHalala, sumMoney, toHalala } from '@/features/accounting/data/money';
import { monthlySeries } from '@/features/accounting/data/analytics';
import type { OpenItem } from '@/features/accounting/data/receivables';
import type { Account, JournalEntry } from '@/features/accounting/types';

/* ============================ unusual entries ============================ */
export interface Anomaly {
  entry_id: string;
  entry_no: number;
  date: string;
  description: string;
  amount: number;
  reasons: string[];
  score: number; // higher = more unusual
}

const entryAmount = (e: JournalEntry) =>
  fromHalala(e.lines.reduce((h, l) => h + toHalala(l.debit), 0));

/**
 * Explainable rules (no black box): amount ≥ multiplier × median of manual
 * entries, posting on Friday (Saudi weekend), round amounts ≥ 10,000, manual
 * entries touching cash directly, and entries without a reference.
 */
export function detectAnomalies(
  entries: JournalEntry[],
  chart: Account[],
  multiplier: number,
): Anomaly[] {
  const posted = entries.filter((e) => e.status === 'posted');
  const manual = posted.filter((e) => e.kind === 'manual' || (e.reference ?? '') === 'MAN');
  const amounts = manual.map(entryAmount).sort((a, b) => a - b);
  const median = amounts.length ? (amounts[Math.floor(amounts.length / 2)] as number) : 0;
  const cash = new Set(cashCodes(chart));
  const out: Anomaly[] = [];
  for (const e of posted) {
    const amt = entryAmount(e);
    const reasons: string[] = [];
    let score = 0;
    const isManual = manual.includes(e);
    if (isManual && median > 0 && amt >= median * multiplier) {
      reasons.push(`مبلغ يفوق ${multiplier}× متوسط القيود اليدوية`);
      score += 3;
    }
    if (new Date(`${e.entry_date}T00:00:00Z`).getUTCDay() === 5) {
      reasons.push('مرحّل يوم الجمعة (عطلة)');
      score += 1;
    }
    if (isManual && amt >= 10000 && toHalala(amt) % 100000 === 0) {
      reasons.push('مبلغ مُقرَّب كبير');
      score += 1;
    }
    if (isManual && e.lines.some((l) => cash.has(l.account_code))) {
      reasons.push('قيد يدوي يمس النقدية مباشرة');
      score += 1;
    }
    if (isManual && !e.reference) {
      reasons.push('بلا مرجع مستندي');
      score += 1;
    }
    if (score >= 2)
      out.push({
        entry_id: e.id,
        entry_no: e.entry_no,
        date: e.entry_date,
        description: e.description,
        amount: amt,
        reasons,
        score,
      });
  }
  return out.sort((a, b) => b.score - a.score || b.amount - a.amount);
}

/* ============================== cash forecast ============================ */
export interface ForecastPoint {
  month: string;
  expectedIn: number;
  expectedOut: number;
  projectedCash: number;
}
export interface CashForecast {
  points: ForecastPoint[];
  openingCash: number;
  historyMonths: number;
  confidence: 'منخفضة' | 'متوسطة' | 'مرتفعة';
  assumptions: string[];
  sufficient: boolean;
}

/**
 * Cash forecast = current cash + scheduled AR collections + scheduled AP
 * payments (by due date) + the average of recurring monthly cash movement
 * that isn't AR/AP (from history). Confidence grows with history length.
 */
export function cashForecast(
  entries: JournalEntry[],
  chart: Account[],
  ar: OpenItem[],
  ap: OpenItem[],
  asOf: string,
  horizon = 3,
): CashForecast {
  const cash = new Set(cashCodes(chart));
  const bal = balances(entries, chart, { to: asOf });
  const openingCash = sumMoney([...bal.entries()].filter(([c]) => cash.has(c)).map(([, v]) => v));
  const hist = monthlySeries(
    entries,
    chart,
    { from: `${asOf.slice(0, 4)}-01-01`, to: asOf },
    12,
  ).filter((p) => p.inflow !== 0 || p.outflow !== 0);
  const historyMonths = hist.length;
  const sufficient = historyMonths >= 3;
  // non-AR/AP run-rate: average monthly outflow on payroll/expense accounts paid in cash
  const lines = scopedLines(entries, { to: asOf });
  const months = new Set(lines.map((s) => s.entry.entry_date.slice(0, 7)));
  let otherOut = 0;
  for (const s of lines) {
    if (!cash.has(s.line.account_code)) continue;
    const touchesArAp = s.entry.lines.some(
      (l) => l.account_code === '1120' || l.account_code === '2110',
    );
    const internal = s.entry.lines.every((l) => cash.has(l.account_code));
    const opening = (s.entry.description ?? '').includes('رصيد افتتاحي');
    if (!touchesArAp && !internal && !opening)
      otherOut += toHalala(s.line.credit) - toHalala(s.line.debit);
  }
  const avgOther = months.size ? Math.max(otherOut / months.size, 0) : 0;

  const start = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + horizon - 1);
  const keys = monthsBetween(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  let run = toHalala(openingCash);
  const overdueIn = ar
    .filter((i) => i.due_date <= asOf)
    .reduce((h, i) => h + toHalala(i.outstanding), 0);
  const overdueOut = ap
    .filter((i) => i.due_date <= asOf)
    .reduce((h, i) => h + toHalala(i.outstanding), 0);
  const points = keys.map((month, k) => {
    // overdue items are assumed collected/paid in the first forecast month
    const inH =
      ar
        .filter((i) => i.due_date.startsWith(month))
        .reduce((h, i) => h + toHalala(i.outstanding), 0) + (k === 0 ? overdueIn : 0);
    const outH =
      ap
        .filter((i) => i.due_date.startsWith(month))
        .reduce((h, i) => h + toHalala(i.outstanding), 0) +
      (k === 0 ? overdueOut : 0) +
      Math.round(avgOther);
    run += inH - outH;
    return {
      month,
      expectedIn: fromHalala(inH),
      expectedOut: fromHalala(outH),
      projectedCash: fromHalala(run),
    };
  });
  return {
    points,
    openingCash,
    historyMonths,
    confidence: historyMonths >= 9 ? 'مرتفعة' : historyMonths >= 3 ? 'متوسطة' : 'منخفضة',
    assumptions: [
      'تحصيل الذمم المدينة في تواريخ استحقاقها، والمتأخرة منها في الشهر الأول.',
      'سداد فواتير الموردين في تواريخ استحقاقها، والمتأخرة منها في الشهر الأول.',
      `مصروفات نقدية متكررة بمتوسط ${fromHalala(Math.round(avgOther)).toLocaleString('en-US')} ر.س شهريًا من التاريخ.`,
      'لا يشمل عقودًا جديدة لم تُوقّع بعد.',
    ],
    sufficient,
  };
}
