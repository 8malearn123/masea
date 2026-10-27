import { scopedLines } from '@/features/accounting/data/ledger';
import { daysBetween } from '@/features/accounting/data/receivables';
import { fromHalala, subMoney, sumMoney, toHalala } from '@/features/accounting/data/money';
import type { JournalEntry, JournalLine } from '@/features/accounting/types';

/**
 * Bank reconciliation: imported statement lines are matched against the GL
 * lines of the bank's chart account. Matching NEVER posts anything by itself;
 * an entry is only proposed from an explicit, approved rule and still goes
 * through the journal approval workflow (draft → approve → post).
 */

export interface StatementLine {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  reference: string;
  amount: number; // + deposit / − withdrawal
}

export interface BookLine {
  key: string; // `${entry.id}:${lineIndex}`
  entry_id: string;
  entry_no: number;
  date: string;
  description: string;
  reference: string | null;
  amount: number; // + debit to bank / − credit
}

export class StatementParseError extends Error {}

/** Normalise Arabic-Indic digits and thousands separators in a cell. */
function num(cell: string): number {
  const ascii = cell
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬,\s]/g, '')
    .replace('٫', '.');
  const n = Number(ascii);
  if (!Number.isFinite(n)) throw new StatementParseError(`قيمة غير رقمية: ${cell}`);
  return n;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if ((ch === ',' || ch === ';' || ch === '\t') && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normDate(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t); // DD/MM/YYYY (Saudi banks)
  if (m) return `${m[3]}-${(m[2] ?? '').padStart(2, '0')}-${(m[1] ?? '').padStart(2, '0')}`;
  throw new StatementParseError(`تاريخ غير معروف: ${s}`);
}

/**
 * Parse a bank CSV export. Accepted headers (Arabic or English):
 * date/التاريخ · description/البيان · reference/المرجع · and either
 * amount/المبلغ or debit/مدين + credit/دائن (bank's view: credit = deposit).
 */
export function parseStatementCsv(text: string): StatementLine[] {
  const rows = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);
  if (rows.length < 2) throw new StatementParseError('الملف لا يحتوي على حركات');
  const head = splitCsv(rows[0] as string).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col('date', 'التاريخ');
  const iDesc = col('desc', 'البيان', 'الوصف');
  const iRef = col('ref', 'المرجع');
  const iAmt = col('amount', 'المبلغ');
  const iDr = col('debit', 'withdraw', 'مدين', 'سحب');
  const iCr = col('credit', 'deposit', 'دائن', 'إيداع');
  if (iDate < 0 || (iAmt < 0 && (iDr < 0 || iCr < 0)))
    throw new StatementParseError('أعمدة مطلوبة: التاريخ + المبلغ (أو مدين/دائن)');
  return rows.slice(1).map((r, i) => {
    const c = splitCsv(r);
    const amount =
      iAmt >= 0 ? num(c[iAmt] ?? '0') : subMoney(num(c[iCr] || '0'), num(c[iDr] || '0'));
    return {
      id: `st-${i + 1}`,
      date: normDate(c[iDate] ?? ''),
      description: iDesc >= 0 ? (c[iDesc] ?? '') : '',
      reference: iRef >= 0 ? (c[iRef] ?? '') : '',
      amount,
    };
  });
}

/** GL lines of a bank account (posted), signed from the bank account's view. */
export function bookLines(entries: JournalEntry[], accountCode: string, to?: string): BookLine[] {
  const out: BookLine[] = [];
  for (const s of scopedLines(entries, { to })) {
    if (s.line.account_code !== accountCode) continue;
    const i = s.entry.lines.indexOf(s.line);
    out.push({
      key: `${s.entry.id}:${i}`,
      entry_id: s.entry.id,
      entry_no: s.entry.entry_no,
      date: s.entry.entry_date,
      description: s.entry.description,
      reference: s.entry.reference,
      amount: fromHalala(toHalala(s.line.debit) - toHalala(s.line.credit)),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface MatchSuggestion {
  statement_id: string;
  book_key: string;
  score: number; // 0..100
  reason: string;
}

/**
 * Suggest 1:1 matches: equal amount (mandatory) within `maxDays`, boosted by
 * reference / description overlap. Greedy by score; each side used once.
 */
export function suggestMatches(
  statement: StatementLine[],
  book: BookLine[],
  matched: { statement: Set<string>; book: Set<string> },
  maxDays: number,
): MatchSuggestion[] {
  const cands: MatchSuggestion[] = [];
  for (const s of statement) {
    if (matched.statement.has(s.id)) continue;
    for (const b of book) {
      if (matched.book.has(b.key)) continue;
      if (toHalala(s.amount) !== toHalala(b.amount)) continue;
      const gap = Math.abs(daysBetween(s.date, b.date));
      if (gap > maxDays) continue;
      let score = 70 - gap * 5;
      const reasons = ['المبلغ مطابق'];
      if (gap === 0) reasons.push('نفس التاريخ');
      const ref = (b.reference ?? '').toLowerCase();
      if (
        ref &&
        (s.reference.toLowerCase().includes(ref) || s.description.toLowerCase().includes(ref))
      ) {
        score += 30;
        reasons.push('المرجع مطابق');
      }
      cands.push({
        statement_id: s.id,
        book_key: b.key,
        score: Math.min(score, 100),
        reason: reasons.join(' · '),
      });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const usedS = new Set<string>();
  const usedB = new Set<string>();
  return cands.filter((c) => {
    if (usedS.has(c.statement_id) || usedB.has(c.book_key)) return false;
    usedS.add(c.statement_id);
    usedB.add(c.book_key);
    return true;
  });
}

export interface ReconciliationReport {
  bookBalance: number;
  bankBalance: number;
  depositsInTransit: BookLine[]; // in books, not on statement
  outstandingPayments: BookLine[];
  unrecordedCredits: StatementLine[]; // on statement, not in books
  unrecordedDebits: StatementLine[];
  adjustedBook: number;
  adjustedBank: number;
  difference: number;
  reconciled: boolean;
}

/**
 * Classic reconciliation statement:
 *   bank + deposits in transit − outstanding payments = adjusted bank
 *   book + unrecorded bank credits − unrecorded bank debits = adjusted book
 */
export function reconciliationReport(
  book: BookLine[],
  statement: StatementLine[],
  matches: { statement_id: string; book_key: string }[],
  bankClosing: number,
): ReconciliationReport {
  const mS = new Set(matches.map((m) => m.statement_id));
  const mB = new Set(matches.map((m) => m.book_key));
  const openBook = book.filter((b) => !mB.has(b.key));
  const openStmt = statement.filter((s) => !mS.has(s.id));
  const bookBalance = sumMoney(book.map((b) => b.amount));
  const depositsInTransit = openBook.filter((b) => b.amount > 0);
  const outstandingPayments = openBook.filter((b) => b.amount < 0);
  const unrecordedCredits = openStmt.filter((s) => s.amount > 0);
  const unrecordedDebits = openStmt.filter((s) => s.amount < 0);
  const adjustedBank = sumMoney([
    bankClosing,
    ...depositsInTransit.map((b) => b.amount),
    ...outstandingPayments.map((b) => b.amount),
  ]);
  const adjustedBook = sumMoney([
    bookBalance,
    ...unrecordedCredits.map((s) => s.amount),
    ...unrecordedDebits.map((s) => s.amount),
  ]);
  const difference = subMoney(adjustedBank, adjustedBook);
  return {
    bookBalance,
    bankBalance: bankClosing,
    depositsInTransit,
    outstandingPayments,
    unrecordedCredits,
    unrecordedDebits,
    adjustedBook,
    adjustedBank,
    difference,
    reconciled: toHalala(difference) === 0,
  };
}

/* ------------------------- approved posting rules ------------------------ */
export interface BankRule {
  id: string;
  name: string;
  contains: string; // statement description contains (case-insensitive)
  direction: 'in' | 'out';
  account_code: string; // counter account
  approved: boolean;
  is_active: boolean;
}

export function ruleFor(line: StatementLine, rules: BankRule[]): BankRule | undefined {
  const d = line.description.toLowerCase();
  return rules.find(
    (r) =>
      r.is_active &&
      r.approved &&
      r.contains.trim() !== '' &&
      d.includes(r.contains.toLowerCase()) &&
      (r.direction === 'in' ? line.amount > 0 : line.amount < 0),
  );
}

/** Draft-entry lines for an unrecorded bank item under an APPROVED rule. */
export function linesFromRule(
  line: StatementLine,
  rule: BankRule,
  bankCode: string,
): JournalLine[] {
  const amt = Math.abs(line.amount);
  return line.amount > 0
    ? [
        { account_code: bankCode, debit: amt, credit: 0, description: line.description },
        { account_code: rule.account_code, debit: 0, credit: amt, description: rule.name },
      ]
    : [
        { account_code: rule.account_code, debit: amt, credit: 0, description: rule.name },
        { account_code: bankCode, debit: 0, credit: amt, description: line.description },
      ];
}
