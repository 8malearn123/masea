import { toHalala } from '@/features/accounting/data/money';
import { monthEnd } from '@/features/accounting/data/ledger';
import type {
  Account,
  EntryStatus,
  JournalEntry,
  JournalLine,
  Period,
} from '@/features/accounting/types';

/**
 * Journal-entry lifecycle — mirror of post_journal_entry / approve_journal_entry
 * / reverse_journal_entry (0057). Rules:
 *  - only BALANCED entries on ACTIVE POSTABLE accounts in an OPEN period post;
 *  - posted entries are immutable: corrections go through a reversing entry;
 *  - with segregation of duties on, the creator cannot approve their own entry;
 *  - an idempotency key makes re-submitting the same post a no-op.
 */
export class JournalRuleError extends Error {}

export type EntryAction = 'submit' | 'approve' | 'post' | 'void' | 'return';

export const periodKey = (date: string): string => date.slice(0, 7);

export function isPeriodOpen(periods: Period[], date: string): boolean {
  const p = periods.find((x) => x.id === periodKey(date));
  // a period that isn't defined yet is opened on demand (ensure_period)
  return !p || p.status === 'open';
}

export interface PostingContext {
  chart: Account[];
  periods: Period[];
}

/** All reasons an entry can't be posted (empty = postable). */
export function postingErrors(
  entry: Pick<JournalEntry, 'lines' | 'entry_date' | 'description'>,
  ctx: PostingContext,
): string[] {
  const errs: string[] = [];
  const lines = entry.lines;
  if (!entry.description.trim()) errs.push('بيان القيد مطلوب');
  if (lines.length < 2) errs.push('القيد يحتاج سطرين على الأقل');
  let dr = 0;
  let cr = 0;
  const byCode = new Map(ctx.chart.map((a) => [a.code, a]));
  lines.forEach((l, i) => {
    const d = toHalala(l.debit);
    const c = toHalala(l.credit);
    if (d < 0 || c < 0) errs.push(`السطر ${i + 1}: مبلغ سالب`);
    if ((d > 0 && c > 0) || (d === 0 && c === 0)) errs.push(`السطر ${i + 1}: إمّا مدين أو دائن`);
    dr += d;
    cr += c;
    const a = byCode.get(l.account_code);
    if (!a) errs.push(`السطر ${i + 1}: الحساب ${l.account_code} غير موجود`);
    else if (!a.is_postable) errs.push(`السطر ${i + 1}: الحساب ${a.code} رئيسي غير قابل للترحيل`);
    else if (a.is_active === false) errs.push(`السطر ${i + 1}: الحساب ${a.code} معطّل`);
  });
  if (dr !== cr) errs.push(`القيد غير متوازن: مدين ${dr / 100} ≠ دائن ${cr / 100}`);
  if (!isPeriodOpen(ctx.periods, entry.entry_date))
    errs.push(`الفترة ${periodKey(entry.entry_date)} مقفلة — لا ترحيل فيها`);
  return errs;
}

const NEXT: Record<EntryAction, { from: EntryStatus[]; to: EntryStatus }> = {
  submit: { from: ['draft'], to: 'pending' },
  approve: { from: ['pending'], to: 'approved' },
  return: { from: ['pending', 'approved'], to: 'draft' },
  post: { from: ['approved', 'pending', 'draft'], to: 'posted' },
  void: { from: ['draft', 'pending', 'approved'], to: 'void' },
};

export interface TransitionOptions {
  actor: string;
  requireApproval: boolean; // segregation of duties: post only after an approval
  now?: string;
}

/** Apply one lifecycle action; throws JournalRuleError with an Arabic reason. */
export function transition(
  entry: JournalEntry,
  action: EntryAction,
  ctx: PostingContext,
  opts: TransitionOptions,
): JournalEntry {
  const rule = NEXT[action];
  if (entry.status === 'posted' && (action === 'void' || action === 'return'))
    throw new JournalRuleError('القيد المُرحَّل محمي — صحّحه بقيد عكسي');
  if (!rule.from.includes(entry.status))
    throw new JournalRuleError(`لا يمكن تنفيذ الإجراء على قيد بحالة «${entry.status}»`);
  if (action === 'approve' && opts.requireApproval && entry.created_by === opts.actor)
    throw new JournalRuleError('فصل المهام: لا يعتمد المستخدم قيدًا أنشأه بنفسه');
  if (action === 'post') {
    if (opts.requireApproval && entry.status !== 'approved')
      throw new JournalRuleError('القيد يحتاج اعتمادًا قبل الترحيل');
    const errs = postingErrors(entry, ctx);
    if (errs.length) throw new JournalRuleError(errs.join(' · '));
  }
  if (action === 'submit') {
    const errs = postingErrors(entry, ctx);
    if (errs.length) throw new JournalRuleError(errs.join(' · '));
  }
  const now = opts.now ?? new Date().toISOString();
  return {
    ...entry,
    status: rule.to,
    ...(action === 'approve' ? { approved_by: opts.actor } : {}),
    ...(action === 'post' ? { posted_at: now } : {}),
    ...(action === 'return' ? { approved_by: undefined } : {}),
  } as JournalEntry;
}

/** Reversing entry for a posted one (swap debit/credit), dated `date`. */
export function buildReversal(
  original: JournalEntry,
  date: string,
  actor: string,
  ids: { id: string; entry_no: number },
): JournalEntry {
  if (original.status !== 'posted') throw new JournalRuleError('يُعكس القيد المُرحَّل فقط');
  if (original.reversed_by) throw new JournalRuleError('هذا القيد معكوس بالفعل');
  if (date < original.entry_date)
    throw new JournalRuleError('تاريخ القيد العكسي لا يسبق تاريخ القيد الأصلي');
  const lines: JournalLine[] = original.lines.map((l) => ({
    ...l,
    debit: l.credit,
    credit: l.debit,
    description: `عكس: ${l.description ?? ''}`.trim(),
  }));
  return {
    id: ids.id,
    entry_no: ids.entry_no,
    entry_date: date,
    branch: original.branch,
    cost_center: original.cost_center ?? null,
    description: `قيد عكسي للقيد #${original.entry_no} — ${original.description}`,
    reference: `REV-${original.entry_no}`,
    source_type: 'adjustment',
    status: 'draft',
    kind: 'reversing',
    reversal_of: original.id,
    created_by: actor,
    idempotency_key: `REV-${original.id}`,
    lines,
  };
}

/* ------------------------------- recurring ------------------------------- */
export interface RecurringTemplate {
  id: string;
  name: string;
  description: string;
  branch: string | null;
  lines: JournalLine[];
  start_period: string; // YYYY-MM
  end_period: string | null;
  last_period: string | null; // last generated
  is_active: boolean;
}

const nextPeriod = (p: string): string => {
  let y = Number(p.slice(0, 4));
  let m = Number(p.slice(5, 7)) + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
};

/** Periods still to generate for a template up to (and incl.) `asOfPeriod`. */
export function duePeriods(t: RecurringTemplate, asOfPeriod: string): string[] {
  if (!t.is_active) return [];
  const out: string[] = [];
  let p = t.last_period ? nextPeriod(t.last_period) : t.start_period;
  let guard = 0;
  while (p <= asOfPeriod && (!t.end_period || p <= t.end_period) && guard++ < 120) {
    out.push(p);
    p = nextPeriod(p);
  }
  return out;
}

/** Draft entry for one recurring period — idempotent by key REC-{template}-{period}. */
export function instantiateRecurring(
  t: RecurringTemplate,
  period: string,
  actor: string,
  ids: { id: string; entry_no: number },
): JournalEntry {
  return {
    id: ids.id,
    entry_no: ids.entry_no,
    entry_date: monthEnd(period),
    branch: t.branch,
    description: `${t.description} — ${period}`,
    reference: `REC-${t.id}-${period}`,
    source_type: 'manual',
    status: 'draft',
    kind: 'recurring',
    created_by: actor,
    idempotency_key: `REC-${t.id}-${period}`,
    lines: t.lines.map((l) => ({ ...l })),
  };
}

/** True when an entry with the same idempotency key already exists (re-submit guard). */
export function isDuplicate(entries: JournalEntry[], key: string | undefined): boolean {
  return !!key && entries.some((e) => e.idempotency_key === key && e.status !== 'void');
}
