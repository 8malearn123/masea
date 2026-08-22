import { account } from '@/features/accounting/data/chart';
import type {
  AccountType,
  ContractEvent,
  JournalEntry,
  JournalLine,
  PaymentEvent,
  PayMethod,
  ServiceCode,
  TrialBalanceRow,
} from '@/features/accounting/types';

const VAT_RATE = 0.15;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export class UnbalancedEntryError extends Error {}
export class NonPostableAccountError extends Error {}

/** Σ debit must equal Σ credit (and the entry must have lines). Mirrors the DB
 *  deferred constraint trigger trg_je_balanced. */
export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length === 0) throw new UnbalancedEntryError('القيد بلا أسطر');
  const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (debit !== credit) {
    throw new UnbalancedEntryError(`القيد غير متوازن: مدين ${debit} ≠ دائن ${credit}`);
  }
  for (const l of lines) {
    const acc = account(l.account_code);
    if (!acc || !acc.is_postable) {
      throw new NonPostableAccountError(`الحساب ${l.account_code} غير قابل للترحيل`);
    }
    if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
      throw new UnbalancedEntryError('كل سطر إمّا مدين أو دائن');
    }
  }
}

/** revenue account by service — mirror of revenue_account_for(). */
export function revenueAccountFor(service: ServiceCode): string {
  switch (service) {
    case 'direct':
      return '4100'; // استقدام
    case 'kafala':
      return '4400'; // نقل كفالة
    case 'monthly':
      return '4200'; // تأجير شهري
    default:
      return '4300'; // daily / hourly / cleaning
  }
}

/** cash/bank account by payment method — mirror of cash_account_for(). */
export function cashAccountFor(method: PayMethod): string {
  switch (method) {
    case 'cash':
      return '1111';
    case 'transfer':
      return '1112';
    case 'tamara':
      return '1132';
    default:
      return '1131'; // mada / apple_pay عبر مُيسّر
  }
}

let entryCounter = 0;
export function resetEntryCounter(): void {
  entryCounter = 0;
}

function buildEntry(
  e: Omit<JournalEntry, 'id' | 'entry_no' | 'status'> & { status?: JournalEntry['status'] },
): JournalEntry {
  assertBalanced(e.lines);
  entryCounter += 1;
  return { ...e, id: `je-${entryCounter}`, entry_no: entryCounter, status: e.status ?? 'posted' };
}

/**
 * Contract signed → DR ذمم العملاء (total) / CR إيراد (pre-VAT) + CR ضريبة مخرجات.
 * Revenue is booked BEFORE tax; VAT is a liability, not revenue.
 */
export function postContract(c: ContractEvent): JournalEntry {
  const vat = round2(c.base * VAT_RATE);
  const total = round2(c.base + vat);
  const lines: JournalLine[] = [
    { account_code: '1120', debit: total, credit: 0, description: 'ذمة العميل' },
    {
      account_code: revenueAccountFor(c.service),
      debit: 0,
      credit: c.base,
      description: 'إيراد الخدمة (قبل الضريبة)',
    },
    { account_code: '2120', debit: 0, credit: vat, description: 'ضريبة القيمة المضافة المستحقة' },
  ];
  return buildEntry({
    entry_date: c.start_date,
    branch: c.branch,
    description: `إثبات عقد رقم ${c.contract_no}`,
    reference: `CON-${c.contract_no}`,
    source_type: 'contract',
    source_id: c.id,
    lines,
  });
}

/** Payment received → DR البنك/النقدية/الوسيط / CR ذمم العملاء. */
export function postPayment(p: PaymentEvent, branch: string | null): JournalEntry {
  const lines: JournalLine[] = [
    { account_code: cashAccountFor(p.method), debit: p.amount, credit: 0, description: 'تحصيل' },
    { account_code: '1120', debit: 0, credit: p.amount, description: 'سداد ذمة العميل' },
  ];
  return buildEntry({
    entry_date: p.paid_at.slice(0, 10),
    branch,
    description: 'تحصيل دفعة',
    reference: p.reference_no,
    source_type: 'payment',
    source_id: p.id,
    lines,
  });
}

/** Build a validated manual entry (UI for exceptions). */
export function buildManualEntry(input: {
  entry_date: string;
  branch: string | null;
  description: string;
  lines: JournalLine[];
}): JournalEntry {
  return buildEntry({ ...input, reference: 'MAN', source_type: 'manual' });
}

/* ------------------------------- reporting ------------------------------- */
/** Trial balance: per-account debit/credit totals + signed balance. */
export function trialBalance(entries: JournalEntry[]): TrialBalanceRow[] {
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) {
    if (e.status !== 'posted') continue;
    for (const l of e.lines) {
      const t = totals.get(l.account_code) ?? { debit: 0, credit: 0 };
      t.debit += l.debit;
      t.credit += l.credit;
      totals.set(l.account_code, t);
    }
  }
  return [...totals.entries()]
    .map(([code, t]) => {
      const acc = account(code);
      const debit = round2(t.debit);
      const credit = round2(t.credit);
      const balance =
        acc?.normal_balance === 'credit' ? round2(credit - debit) : round2(debit - credit);
      return {
        code,
        name_ar: acc?.name_ar ?? code,
        type: (acc?.type ?? 'asset') as AccountType,
        debit,
        credit,
        balance,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Sum of net balances for a set of account-code prefixes. */
function sumByPrefix(rows: TrialBalanceRow[], prefixes: string[]): number {
  return round2(
    rows
      .filter((r) => prefixes.some((p) => r.code.startsWith(p)))
      .reduce((s, r) => s + r.balance, 0),
  );
}

export interface FinancialSnapshot {
  revenue: number; // pre-VAT, net of contra-revenue
  expenses: number;
  netProfit: number;
  receivables: number; // 1120
  cash: number; // 1111/1112/1113 + gateways 113x
  vatPayable: number; // 2120 output − 1140 input
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

/** Headline figures for the accountant dashboard — all from the journal. */
export function financialSnapshot(entries: JournalEntry[]): FinancialSnapshot {
  const rows = trialBalance(entries);
  const revenueAccts = rows.filter((r) => r.type === 'revenue');
  // revenue accounts are credit-normal; contra (4900) is debit-normal → already signed
  const revenue = round2(revenueAccts.reduce((s, r) => s + r.balance, 0));
  const expenses = sumByPrefix(rows, ['5']);
  const receivables = sumByPrefix(rows, ['1120']);
  const cash = sumByPrefix(rows, ['1111', '1112', '1113', '1131', '1132']);
  const vatPayable = round2(sumByPrefix(rows, ['2120']) - sumByPrefix(rows, ['1140']));
  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return {
    revenue,
    expenses,
    netProfit: round2(revenue - expenses),
    receivables,
    cash,
    vatPayable,
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit,
  };
}
