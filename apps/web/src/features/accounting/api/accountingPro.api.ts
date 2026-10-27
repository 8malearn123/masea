import { z } from 'zod';
import { BRANCHES_AR } from '@/lib/funnel';
import {
  addFiscalYear,
  listBills,
  listChart,
  listInvoices,
  listJournal,
  listPeriods,
  setPeriodStatus,
} from '@/features/accounting/api/accounting.api';
import {
  addSystemEntry,
  findStoreEntry,
  listAudit,
  markReversed,
  nextEntryIds,
  recordAudit,
  upsertWorkflow,
  workflowEntries,
} from '@/features/accounting/api/journalStore';
import {
  buildReversal,
  duePeriods,
  instantiateRecurring,
  isDuplicate,
  isPeriodOpen,
  JournalRuleError,
  transition,
  type EntryAction,
  type RecurringTemplate,
} from '@/features/accounting/data/journalWorkflow';
import {
  buildAllocationLines,
  spreadAnnual,
  type AllocationRule,
  type Budget,
  type CostCenter,
} from '@/features/accounting/data/budgets';
import {
  linesFromRule,
  type BankRule,
  type StatementLine,
} from '@/features/accounting/data/bankrec';
import {
  generateEInvoice,
  type EInvoiceRecord,
  type SalesCreditNote,
  type SellerProfile,
} from '@/features/accounting/data/zatca';
import {
  DEFAULT_DUTIES,
  ROLE_DEFAULT_DUTY,
  type AuditEvent,
  type DutyProfile,
} from '@/features/accounting/data/access';
import { DEFAULT_AI_CONFIG, type AiProviderConfig } from '@/features/accounting/data/assistant';
import type { AlertState } from '@/features/accounting/data/alerts';
import { yearClosingEntry } from '@/features/accounting/data/periodClose';
import { mulMoney, sumMoney, toHalala } from '@/features/accounting/data/money';
import { applyCreditToSale, settleCustomerSale } from '@/shared/lib/salesLedger';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { awardPaymentPoints } from '@/features/loyalty/data/engine';
import type { RoleCode } from '@/lib/permissions';
import type { EntryAttachment, JournalEntry, JournalLine } from '@/features/accounting/types';

/**
 * DEMO MODE stores for the professional accounting layer. Every mutation
 * mirrors a SECURITY DEFINER function in 0057_accounting_pro.sql (which also
 * enforces has_acc_perm + RLS server-side) and writes an audit event.
 */

export const today = (): string => new Date().toISOString().slice(0, 10);

/* =============================== journal ================================= */
const lineSchema = z.object({
  account_code: z.string().min(3),
  debit: z.number().min(0),
  credit: z.number().min(0),
  description: z.string().optional(),
});
export const draftEntrySchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  branch: z.string().nullable(),
  cost_center: z.string().nullable(),
  description: z.string().trim().min(3, 'البيان مطلوب'),
  reference: z.string().nullable(),
  kind: z.enum(['manual', 'opening', 'adjusting', 'recurring', 'reversing', 'auto', 'closing']),
  lines: z.array(lineSchema).min(2, 'سطران على الأقل'),
});
export type DraftEntryInput = z.infer<typeof draftEntrySchema>;

// seed: entries entered by a branch accountant awaiting the reviewer
const SEED_ACTOR = 'سلطان القحطاني (محاسب فرع جازان)';
(function seedWorkflow() {
  const seed = (e: Omit<JournalEntry, 'id' | 'entry_no'>) =>
    upsertWorkflow({ ...e, ...nextEntryIds() });
  seed({
    entry_date: '2026-06-30',
    branch: 'جازان',
    description: 'استحقاق إيجار سكن العمالة — يونيو',
    reference: 'RENT-JZN-06',
    source_type: 'manual',
    status: 'pending',
    kind: 'adjusting',
    created_by: SEED_ACTOR,
    lines: [
      { account_code: '5700', debit: 6500, credit: 0, description: 'إيجار سكن العمالة' },
      { account_code: '2110', debit: 0, credit: 6500, description: 'مستحق للمؤجر' },
    ],
  });
  seed({
    entry_date: '2026-05-18',
    branch: 'نجران',
    cost_center: 'PRJ-RAMADAN',
    description: 'حملة تسويق موسم رمضان للاستقدام',
    reference: 'MKT-RMD-01',
    source_type: 'manual',
    status: 'posted',
    kind: 'manual',
    created_by: SEED_ACTOR,
    approved_by: 'منصور المكرمي',
    posted_at: '2026-05-18T10:00:00Z',
    lines: [
      { account_code: '5300', debit: 4200, credit: 0, description: 'إعلانات ممولة' },
      { account_code: '1112', debit: 0, credit: 4200, description: 'تحويل بنكي' },
    ],
  });
  seed({
    entry_date: '2026-06-15',
    branch: null,
    description: 'رسوم بنكية وخدمات الحساب — يونيو',
    reference: null,
    source_type: 'manual',
    status: 'draft',
    kind: 'manual',
    created_by: SEED_ACTOR,
    lines: [
      { account_code: '5400', debit: 350, credit: 0 },
      { account_code: '1112', debit: 0, credit: 350 },
    ],
  });
})();

export async function listWorkflow(): Promise<JournalEntry[]> {
  return workflowEntries();
}

/** Save (create or update) a draft. Posted entries are immutable. */
export function saveDraftEntry(input: DraftEntryInput, actor: string, id?: string): JournalEntry {
  const data = draftEntrySchema.parse(input);
  const lines: JournalLine[] = data.lines
    .filter((l) => l.debit > 0 || l.credit > 0)
    .map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      ...(l.description ? { description: l.description } : {}),
    }));
  if (id) {
    const cur = findStoreEntry(id);
    if (!cur) throw new JournalRuleError('القيد غير موجود');
    if (cur.status !== 'draft') throw new JournalRuleError('لا يُعدَّل إلا القيد المسودة');
    const next: JournalEntry = { ...cur, ...data, lines };
    recordAudit({
      actor,
      action: 'update',
      entity: 'journal_entry',
      entity_id: id,
      before: cur,
      after: next,
    });
    return upsertWorkflow(next);
  }
  const entry: JournalEntry = {
    ...nextEntryIds(),
    entry_date: data.entry_date,
    branch: data.branch,
    cost_center: data.cost_center,
    description: data.description,
    reference: data.reference,
    source_type: 'manual',
    status: 'draft',
    kind: data.kind,
    created_by: actor,
    lines,
  };
  recordAudit({
    actor,
    action: 'create',
    entity: 'journal_entry',
    entity_id: entry.id,
    before: null,
    after: entry,
  });
  return upsertWorkflow(entry);
}

export async function actOnEntry(
  id: string,
  action: EntryAction,
  actor: string,
  requireApproval: boolean,
): Promise<JournalEntry> {
  const cur = findStoreEntry(id);
  if (!cur) throw new JournalRuleError('القيد غير موجود');
  if (action === 'post' && cur.idempotency_key) {
    const others = workflowEntries().filter((e) => e.id !== id && e.status === 'posted');
    if (isDuplicate(others, cur.idempotency_key))
      throw new JournalRuleError('مُرحَّل مسبقًا (مفتاح منع التكرار)');
  }
  if (action === 'post' && cur.status === 'posted') return cur; // idempotent re-submit
  const [chart, periods] = await Promise.all([listChart(), listPeriods()]);
  const next = transition(cur, action, { chart, periods }, { actor, requireApproval });
  upsertWorkflow(next);
  if (action === 'post' && next.reversal_of) markReversed(next.reversal_of, next.id);
  recordAudit({
    actor,
    action,
    entity: 'journal_entry',
    entity_id: id,
    before: { status: cur.status },
    after: { status: next.status },
  });
  return next;
}

/** Create a reversing DRAFT for a posted entry (goes through approval like any entry). */
export async function reverseEntry(id: string, date: string, actor: string): Promise<JournalEntry> {
  const journal = await listJournal();
  const original = journal.find((e) => e.id === id) ?? findStoreEntry(id);
  if (!original) throw new JournalRuleError('القيد غير موجود');
  const store = findStoreEntry(id);
  if (store?.reversed_by) throw new JournalRuleError('هذا القيد معكوس بالفعل');
  if (workflowEntries().some((e) => e.reversal_of === id && e.status !== 'void'))
    throw new JournalRuleError('يوجد قيد عكسي قائم لهذا القيد');
  const rev = buildReversal(
    { ...original, ...(store?.reversed_by ? { reversed_by: store.reversed_by } : {}) },
    date,
    actor,
    nextEntryIds(),
  );
  recordAudit({
    actor,
    action: 'reverse',
    entity: 'journal_entry',
    entity_id: id,
    before: null,
    after: rev,
  });
  return upsertWorkflow(rev);
}

export function addAttachment(
  id: string,
  file: { name: string; size: number },
  actor: string,
): JournalEntry {
  const cur = findStoreEntry(id);
  if (!cur) throw new JournalRuleError('القيد غير موجود');
  const att: EntryAttachment = {
    id: `att-${Date.now()}`,
    name: file.name,
    size: file.size,
    uploaded_at: new Date().toISOString(),
  };
  const next = { ...cur, attachments: [...(cur.attachments ?? []), att] };
  recordAudit({
    actor,
    action: 'attach',
    entity: 'journal_entry',
    entity_id: id,
    before: null,
    after: att,
  });
  return upsertWorkflow(next);
}

/* ------------------------------ recurring -------------------------------- */
const RECURRING: RecurringTemplate[] = [
  {
    id: 'rec-rent-hq',
    name: 'إيجار المقر الرئيسي — نجران',
    description: 'إيجار المقر الرئيسي',
    branch: null,
    lines: [
      { account_code: '5700', debit: 12000, credit: 0, description: 'إيجار شهري' },
      { account_code: '1112', debit: 0, credit: 12000, description: 'تحويل للمؤجر' },
    ],
    start_period: '2026-04',
    end_period: null,
    last_period: null,
    is_active: true,
  },
];
export async function listRecurring(): Promise<RecurringTemplate[]> {
  return RECURRING.map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l })) }));
}
export function saveRecurring(t: RecurringTemplate, actor: string): RecurringTemplate {
  const sum = (k: 'debit' | 'credit') => sumMoney(t.lines.map((l) => l[k]));
  if (toHalala(sum('debit')) !== toHalala(sum('credit')) || toHalala(sum('debit')) === 0)
    throw new JournalRuleError('قالب القيد المتكرر يجب أن يكون متوازنًا');
  const i = RECURRING.findIndex((r) => r.id === t.id);
  recordAudit({
    actor,
    action: i >= 0 ? 'update' : 'create',
    entity: 'recurring_entry',
    entity_id: t.id,
    before: i >= 0 ? RECURRING[i] : null,
    after: t,
  });
  if (i >= 0) RECURRING[i] = t;
  else RECURRING.unshift(t);
  return t;
}
/** Generate due recurring drafts up to a period (idempotent per template × period). */
export function generateRecurring(asOfPeriod: string, actor: string): JournalEntry[] {
  const made: JournalEntry[] = [];
  for (const t of RECURRING) {
    for (const p of duePeriods(t, asOfPeriod)) {
      const key = `REC-${t.id}-${p}`;
      if (!isDuplicate(workflowEntries(), key))
        made.push(upsertWorkflow(instantiateRecurring(t, p, actor, nextEntryIds())));
      t.last_period = p;
    }
  }
  if (made.length)
    recordAudit({
      actor,
      action: 'generate_recurring',
      entity: 'recurring_entry',
      entity_id: asOfPeriod,
      before: null,
      after: made.map((m) => m.reference),
    });
  return made;
}

/* =========================== cost centers ================================ */
const COST_CENTERS: CostCenter[] = [
  ...BRANCHES_AR.map((b) => ({
    code: `BR-${b}`,
    name: `فرع ${b}`,
    kind: 'branch' as const,
    branch: b,
    is_active: true,
  })),
  { code: 'DEP-FIN', name: 'الإدارة المالية', kind: 'department', branch: null, is_active: true },
  { code: 'DEP-OPS', name: 'العمليات والتشغيل', kind: 'department', branch: null, is_active: true },
  {
    code: 'DEP-SALES',
    name: 'المبيعات وخدمة العملاء',
    kind: 'department',
    branch: null,
    is_active: true,
  },
  {
    code: 'PRJ-RAMADAN',
    name: 'حملة استقدام موسم رمضان',
    kind: 'project',
    branch: 'نجران',
    is_active: true,
  },
  {
    code: 'PRJ-JZN-SEASON',
    name: 'تأجير موسمي — جازان',
    kind: 'project',
    branch: 'جازان',
    is_active: true,
  },
];
export async function listCostCenters(): Promise<CostCenter[]> {
  return COST_CENTERS.map((c) => ({ ...c }));
}
export const costCenterSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,20}$/, 'رمز بالإنجليزية الكبيرة (٣–٢٠)'),
  name: z.string().trim().min(2, 'الاسم مطلوب'),
  kind: z.enum(['branch', 'department', 'project']),
  branch: z.string().nullable(),
  is_active: z.boolean(),
});
export function saveCostCenter(c: CostCenter, actor: string, isNew: boolean): CostCenter {
  const data = costCenterSchema.parse(c);
  const i = COST_CENTERS.findIndex((x) => x.code === data.code);
  if (isNew && i >= 0) throw new Error('الرمز مستخدم');
  recordAudit({
    actor,
    action: isNew ? 'create' : 'update',
    entity: 'cost_center',
    entity_id: data.code,
    before: i >= 0 ? COST_CENTERS[i] : null,
    after: data,
  });
  if (i >= 0) COST_CENTERS[i] = data;
  else COST_CENTERS.push(data);
  return data;
}

const ALLOCATION_RULES: AllocationRule[] = [
  {
    id: 'alloc-hq',
    name: 'توزيع مصروفات المركز الرئيسي',
    account_codes: ['5400', '5700', '5800'],
    basis: 'fixed',
    weights: { نجران: 40, جازان: 30, شرورة: 15, حبونا: 15 },
    is_active: true,
  },
];
export async function listAllocationRules(): Promise<AllocationRule[]> {
  return ALLOCATION_RULES.map((r) => ({
    ...r,
    weights: { ...r.weights },
    account_codes: [...r.account_codes],
  }));
}
export function saveAllocationRule(r: AllocationRule, actor: string): AllocationRule {
  if (r.basis === 'fixed') {
    const total = Object.values(r.weights).reduce((s, w) => s + w, 0);
    if (Math.round(total) !== 100) throw new Error('مجموع النسب يجب أن يساوي 100٪');
  }
  const i = ALLOCATION_RULES.findIndex((x) => x.id === r.id);
  recordAudit({
    actor,
    action: i >= 0 ? 'update' : 'create',
    entity: 'allocation_rule',
    entity_id: r.id,
    before: i >= 0 ? ALLOCATION_RULES[i] : null,
    after: r,
  });
  if (i >= 0) ALLOCATION_RULES[i] = r;
  else ALLOCATION_RULES.push(r);
  return r;
}
/** Post the allocation entry for a period (once per rule × period). */
export async function runAllocation(
  ruleId: string,
  period: string,
  actor: string,
): Promise<JournalEntry> {
  const rule = ALLOCATION_RULES.find((r) => r.id === ruleId);
  if (!rule || !rule.is_active) throw new Error('القاعدة غير موجودة أو معطّلة');
  const [entries, chart, periods] = await Promise.all([listJournal(), listChart(), listPeriods()]);
  if (!isPeriodOpen(periods, `${period}-01`)) throw new Error('الفترة مقفلة');
  if (entries.some((e) => e.reference === `ALLOC-${rule.id}-${period}`))
    throw new Error('تم توزيع هذه الفترة بالفعل');
  const lines = buildAllocationLines(rule, entries, chart, period, BRANCHES_AR);
  if (!lines.length) throw new Error('لا توجد مصروفات للمركز الرئيسي في الفترة أو لا أساس للتوزيع');
  const entry: JournalEntry = {
    ...nextEntryIds('je-alloc'),
    entry_date: `${period}-28`,
    branch: null,
    description: `${rule.name} — ${period}`,
    reference: `ALLOC-${rule.id}-${period}`,
    idempotency_key: `ALLOC-${rule.id}-${period}`,
    source_type: 'adjustment',
    status: 'posted',
    kind: 'auto',
    created_by: actor,
    lines,
  };
  if (!addSystemEntry(entry)) throw new Error('تم توزيع هذه الفترة بالفعل');
  recordAudit({
    actor,
    action: 'allocate',
    entity: 'allocation_rule',
    entity_id: ruleId,
    before: null,
    after: { period, lines: lines.length },
  });
  return entry;
}

/* ================================ budgets ================================ */
const BUDGETS: Budget[] = [
  {
    id: 'bud-2026',
    name: 'الموازنة التشغيلية 2026',
    year: 2026,
    scope: 'company',
    branch: null,
    cost_center: null,
    status: 'approved',
    is_active: true,
    lines: [
      { account_code: '4100', amounts: spreadAnnual(240000) },
      { account_code: '4200', amounts: spreadAnnual(180000) },
      { account_code: '5300', amounts: spreadAnnual(36000) },
      { account_code: '5400', amounts: spreadAnnual(30000) },
      { account_code: '5700', amounts: spreadAnnual(144000) },
      { account_code: '5600', amounts: spreadAnnual(60000) },
    ],
  },
  {
    id: 'bud-rmd',
    name: 'موازنة حملة رمضان',
    year: 2026,
    scope: 'project',
    branch: 'نجران',
    cost_center: 'PRJ-RAMADAN',
    status: 'approved',
    is_active: true,
    lines: [{ account_code: '5300', amounts: [0, 0, 1500, 1500, 1500, 0, 0, 0, 0, 0, 0, 0] }],
  },
];
export async function listBudgets(): Promise<Budget[]> {
  return BUDGETS.map((b) => ({
    ...b,
    lines: b.lines.map((l) => ({ ...l, amounts: [...l.amounts] })),
  }));
}
export function saveBudget(b: Budget, actor: string): Budget {
  if (b.lines.some((l) => l.amounts.length !== 12 || l.amounts.some((x) => x < 0)))
    throw new Error('كل بند يحتاج 12 قيمة شهرية غير سالبة');
  const i = BUDGETS.findIndex((x) => x.id === b.id);
  if (
    i >= 0 &&
    BUDGETS[i]?.status === 'approved' &&
    b.status === 'approved' &&
    JSON.stringify(BUDGETS[i]?.lines) !== JSON.stringify(b.lines)
  )
    throw new Error('الموازنة المعتمدة لا تُعدَّل مباشرة — أعدها لمسودة أولًا');
  recordAudit({
    actor,
    action: i >= 0 ? 'update' : 'create',
    entity: 'budget',
    entity_id: b.id,
    before: i >= 0 ? BUDGETS[i] : null,
    after: b,
  });
  if (i >= 0) BUDGETS[i] = b;
  else BUDGETS.unshift(b);
  return b;
}

/* ============================ bank & cash ================================ */
interface BankStatement {
  account_code: string;
  imported_at: string;
  closing_balance: number;
  lines: StatementLine[];
}
const STATEMENTS = new Map<string, BankStatement>([
  [
    '1112',
    {
      account_code: '1112',
      imported_at: '2026-06-30T12:00:00Z',
      closing_balance: 0, // computed below from the seed lines
      lines: [
        ...BRANCHES_AR.map((b, i) => ({
          id: `st-o${i + 1}`,
          date: '2026-01-01',
          description: `إيداع رأس المال — فرع ${b}`,
          reference: 'OPEN',
          amount: 50000,
        })),
        {
          id: 'st-a1',
          date: '2026-01-10',
          description: 'شراء سيارة نقل عمالة',
          reference: 'ASSET-fa-1',
          amount: -90000,
        },
        {
          id: 'st-a2',
          date: '2026-01-15',
          description: 'أثاث مكتب الفرع',
          reference: 'ASSET-fa-2',
          amount: -24000,
        },
        {
          id: 'st-a3',
          date: '2026-02-01',
          description: 'أجهزة حاسب وطابعات',
          reference: 'ASSET-fa-3',
          amount: -18000,
        },
        {
          id: 'st-2',
          date: '2026-04-11',
          description: 'حوالة واردة سارة القحطاني',
          reference: 'PMT-CC33DD44',
          amount: 8625,
        },
        {
          id: 'st-3',
          date: '2026-05-05',
          description: 'حوالة صادرة مكتب الاستقدام الهند',
          reference: 'PV-0',
          amount: -9000,
        },
        {
          id: 'st-4',
          date: '2026-05-18',
          description: 'حملة إعلانية',
          reference: 'MKT-RMD-01',
          amount: -4200,
        },
        {
          id: 'st-5',
          date: '2026-06-30',
          description: 'رسوم خدمات بنكية',
          reference: 'FEE-06',
          amount: -115,
        },
      ],
    },
  ],
]);
for (const s of STATEMENTS.values()) s.closing_balance = sumMoney(s.lines.map((l) => l.amount));
const MATCHES = new Map<string, { statement_id: string; book_key: string }[]>();
const BANK_RULES: BankRule[] = [
  {
    id: 'rule-fees',
    name: 'رسوم بنكية',
    contains: 'رسوم',
    direction: 'out',
    account_code: '5400',
    approved: true,
    is_active: true,
  },
];

export async function getStatement(code: string): Promise<BankStatement | null> {
  const s = STATEMENTS.get(code);
  return s ? { ...s, lines: s.lines.map((l) => ({ ...l })) } : null;
}
export function importStatement(
  code: string,
  lines: StatementLine[],
  closing: number | null,
  actor: string,
): void {
  if (!lines.length) throw new Error('لا حركات في الكشف');
  STATEMENTS.set(code, {
    account_code: code,
    imported_at: new Date().toISOString(),
    closing_balance: closing ?? sumMoney(lines.map((l) => l.amount)),
    lines,
  });
  MATCHES.set(code, []);
  recordAudit({
    actor,
    action: 'import_statement',
    entity: 'bank_statement',
    entity_id: code,
    before: null,
    after: { lines: lines.length },
  });
}
export async function listMatches(
  code: string,
): Promise<{ statement_id: string; book_key: string }[]> {
  return [...(MATCHES.get(code) ?? [])];
}
export function confirmMatches(
  code: string,
  pairs: { statement_id: string; book_key: string }[],
  actor: string,
): void {
  const cur = MATCHES.get(code) ?? [];
  const usedS = new Set(cur.map((m) => m.statement_id));
  const usedB = new Set(cur.map((m) => m.book_key));
  const add = pairs.filter((p) => !usedS.has(p.statement_id) && !usedB.has(p.book_key));
  MATCHES.set(code, [...cur, ...add]);
  recordAudit({
    actor,
    action: 'match',
    entity: 'bank_reconciliation',
    entity_id: code,
    before: null,
    after: add,
  });
}
export function removeMatch(code: string, statementId: string, actor: string): void {
  MATCHES.set(
    code,
    (MATCHES.get(code) ?? []).filter((m) => m.statement_id !== statementId),
  );
  recordAudit({
    actor,
    action: 'unmatch',
    entity: 'bank_reconciliation',
    entity_id: code,
    before: { statementId },
    after: null,
  });
}
export async function listBankRules(): Promise<BankRule[]> {
  return BANK_RULES.map((r) => ({ ...r }));
}
export function saveBankRule(r: BankRule, actor: string): BankRule {
  if (!r.contains.trim()) throw new Error('نص المطابقة مطلوب');
  const i = BANK_RULES.findIndex((x) => x.id === r.id);
  // editing a rule drops its approval — a changed rule must be re-approved
  const next =
    i >= 0 && JSON.stringify({ ...BANK_RULES[i], approved: r.approved }) !== JSON.stringify(r)
      ? { ...r, approved: false }
      : r;
  recordAudit({
    actor,
    action: i >= 0 ? 'update' : 'create',
    entity: 'bank_rule',
    entity_id: r.id,
    before: i >= 0 ? BANK_RULES[i] : null,
    after: next,
  });
  if (i >= 0) BANK_RULES[i] = next;
  else BANK_RULES.push({ ...next, approved: false });
  return next;
}
export function approveBankRule(id: string, actor: string): void {
  const r = BANK_RULES.find((x) => x.id === id);
  if (!r) return;
  recordAudit({
    actor,
    action: 'approve',
    entity: 'bank_rule',
    entity_id: id,
    before: { approved: r.approved },
    after: { approved: true },
  });
  r.approved = true;
}
/** Draft entry from an APPROVED rule for an unrecorded statement line. */
export function draftFromRule(
  code: string,
  line: StatementLine,
  rule: BankRule,
  actor: string,
): JournalEntry {
  if (!rule.approved || !rule.is_active) throw new Error('القاعدة غير معتمدة');
  const key = `BANK-${code}-${line.id}`;
  if (isDuplicate(workflowEntries(), key)) throw new Error('أُنشئ قيد لهذه الحركة مسبقًا');
  const entry: JournalEntry = {
    ...nextEntryIds(),
    entry_date: line.date,
    branch: null,
    description: `${rule.name} — ${line.description}`,
    reference: line.reference || key,
    idempotency_key: key,
    source_type: 'manual',
    status: 'draft',
    kind: 'auto',
    created_by: actor,
    lines: linesFromRule(line, rule, code),
  };
  recordAudit({
    actor,
    action: 'create_from_bank_rule',
    entity: 'journal_entry',
    entity_id: entry.id,
    before: null,
    after: entry,
  });
  return upsertWorkflow(entry);
}

/* ====================== receivables & payables ========================== */
const CREDIT_LIMITS: Record<string, number> = { 'عبدالله الدوسري': 5000, 'نورة الشهري': 10000 };
const REMINDERS: { invoice_id: string; at: string; channel: string; actor: string }[] = [];
const AP_SCHEDULE: Record<string, string> = {};

export async function getCreditLimits(): Promise<Record<string, number>> {
  return { ...CREDIT_LIMITS };
}
export function setCreditLimit(customer: string, limit: number | null, actor: string): void {
  const before = CREDIT_LIMITS[customer] ?? null;
  if (limit === null) delete CREDIT_LIMITS[customer];
  else if (limit < 0) throw new Error('الحد لا يكون سالبًا');
  else CREDIT_LIMITS[customer] = limit;
  recordAudit({
    actor,
    action: 'update',
    entity: 'customer_credit_limit',
    entity_id: customer,
    before,
    after: limit,
  });
}
export async function listReminders(): Promise<typeof REMINDERS> {
  return REMINDERS.map((r) => ({ ...r }));
}
/** Queue a payment reminder (delivery happens via the SMS/WhatsApp provider once linked). */
export function queueReminder(invoiceId: string, actor: string, channel = 'sms'): void {
  REMINDERS.unshift({ invoice_id: invoiceId, at: today(), channel, actor });
  recordAudit({
    actor,
    action: 'queue_reminder',
    entity: 'invoice',
    entity_id: invoiceId,
    before: null,
    after: { channel },
  });
}
export async function getApSchedule(): Promise<Record<string, string>> {
  return { ...AP_SCHEDULE };
}
export function scheduleBillPayment(billId: string, date: string | null, actor: string): void {
  const before = AP_SCHEDULE[billId] ?? null;
  if (date) AP_SCHEDULE[billId] = date;
  else delete AP_SCHEDULE[billId];
  recordAudit({
    actor,
    action: 'schedule_payment',
    entity: 'bill',
    entity_id: billId,
    before,
    after: date,
  });
}
/** Record a customer collection (partial allowed) — posts DR cash / CR 1120. */
export async function recordCollection(
  invoiceId: string,
  amount: number,
  method: string,
  date: string,
  actor: string,
): Promise<void> {
  if (amount <= 0) throw new Error('أدخل مبلغًا صحيحًا');
  const periods = await listPeriods();
  if (!isPeriodOpen(periods, date)) throw new Error('الفترة مقفلة');
  const r = settleCustomerSale(invoiceId, amount, { method, paid_at: date });
  if (!r) throw new Error('الفاتورة مسددة بالكامل أو ملغاة');
  // loyalty points on payment — the 0059 payments trigger does this server-side
  if (isDemoMode()) awardPaymentPoints(r.customer_name, r.amount, r.id);
  recordAudit({
    actor,
    action: 'collect',
    entity: 'invoice',
    entity_id: invoiceId,
    before: null,
    after: r,
  });
}

/* -------------------------- sales credit notes --------------------------- */
const CREDIT_NOTES: SalesCreditNote[] = [];
let cnSeq = 0;
export async function listCreditNotes(): Promise<SalesCreditNote[]> {
  return CREDIT_NOTES.map((n) => ({ ...n }));
}
/** إشعار دائن: DR مردودات 4900 + DR ضريبة مخرجات 2120 / CR ذمم العملاء 1120. */
export async function createCreditNote(
  input: { invoice_id: string; subtotal: number; reason: string; date: string; vat_rate: number },
  actor: string,
): Promise<SalesCreditNote> {
  const invoices = await listInvoices();
  const inv = invoices.find((i) => i.id === input.invoice_id);
  if (!inv) throw new Error('الفاتورة غير موجودة');
  if (!input.reason.trim()) throw new Error('سبب الإشعار مطلوب');
  if (input.subtotal <= 0) throw new Error('المبلغ غير صحيح');
  const credited = sumMoney(
    CREDIT_NOTES.filter((n) => n.invoice_id === inv.id).map((n) => n.subtotal),
  );
  if (toHalala(credited + input.subtotal) > toHalala(inv.subtotal))
    throw new Error('الإشعارات تتجاوز قيمة الفاتورة قبل الضريبة');
  const vat = toHalala(inv.vat_amount) > 0 ? mulMoney(input.subtotal, input.vat_rate) : 0;
  const total = sumMoney([input.subtotal, vat]);
  cnSeq += 1;
  const note: SalesCreditNote = {
    id: `cn-${cnSeq}`,
    note_no: cnSeq,
    invoice_id: inv.id,
    customer_name: inv.customer_name,
    branch: inv.branch,
    note_date: input.date,
    subtotal: input.subtotal,
    vat_amount: vat,
    total,
    reason: input.reason.trim(),
  };
  addSystemEntry({
    ...nextEntryIds('je-cn'),
    entry_date: note.note_date,
    branch: note.branch,
    description: `إشعار دائن #${note.note_no} على الفاتورة #${inv.invoice_no} — ${note.reason}`,
    reference: `CN-${note.note_no}`,
    source_type: 'adjustment',
    source_id: inv.id,
    status: 'posted',
    kind: 'auto',
    lines: [
      { account_code: '4900', debit: note.subtotal, credit: 0, description: 'مردودات/خصم مبيعات' },
      ...(vat > 0
        ? [{ account_code: '2120', debit: vat, credit: 0, description: 'تخفيض ضريبة المخرجات' }]
        : []),
      { account_code: '1120', debit: 0, credit: total, description: 'تخفيض ذمة العميل' },
    ],
  });
  applyCreditToSale(inv.id, total);
  CREDIT_NOTES.unshift(note);
  recordAudit({
    actor,
    action: 'create',
    entity: 'credit_note',
    entity_id: note.id,
    before: null,
    after: note,
  });
  return note;
}

/* ============================ e-invoicing ================================ */
const SELLER: SellerProfile = {
  name: 'شركة ماسية الشرق للاستقدام',
  vat_number: '300000000000003',
  cr_number: '5950000000',
  address: 'طريق الملك عبدالعزيز، حي الفيصلية',
  city: 'نجران',
};
const EINVOICES: EInvoiceRecord[] = [];
export async function getSeller(): Promise<SellerProfile> {
  return { ...SELLER };
}
export function updateSeller(patch: Partial<SellerProfile>, actor: string): SellerProfile {
  const before = { ...SELLER };
  Object.assign(
    SELLER,
    Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v).trim()])),
  );
  recordAudit({
    actor,
    action: 'update',
    entity: 'seller_profile',
    entity_id: 'seller',
    before,
    after: { ...SELLER },
  });
  return { ...SELLER };
}
export async function listEInvoices(): Promise<EInvoiceRecord[]> {
  return EINVOICES.map((r) => ({ ...r, messages: [...r.messages] }));
}
export async function generateEInvoiceFor(
  invoiceId: string,
  actor: string,
): Promise<EInvoiceRecord> {
  if (EINVOICES.some((r) => r.invoice_id === invoiceId))
    throw new Error('الفاتورة الإلكترونية مولّدة بالفعل (لا تُعاد — التصحيح بإشعار)');
  const inv = (await listInvoices()).find((i) => i.id === invoiceId);
  if (!inv) throw new Error('الفاتورة غير موجودة');
  if (inv.status === 'void') throw new Error('فاتورة ملغاة');
  const prev = EINVOICES[0] ? { icv: EINVOICES[0].icv, hash: EINVOICES[0].hash } : null;
  const uuid = crypto.randomUUID();
  const rec = await generateEInvoice(inv, SELLER, prev, uuid);
  EINVOICES.unshift(rec);
  recordAudit({
    actor,
    action: 'generate_einvoice',
    entity: 'invoice',
    entity_id: invoiceId,
    before: null,
    after: { icv: rec.icv, status: rec.status },
  });
  return rec;
}
/** Submission is NOT wired (no production CSID) — the record moves to the queue with a clear message. */
export function queueSubmission(invoiceId: string, actor: string): EInvoiceRecord {
  const r = EINVOICES.find((x) => x.invoice_id === invoiceId);
  if (!r) throw new Error('ولّد الفاتورة الإلكترونية أولًا');
  if (r.status === 'error') throw new Error('صحّح أخطاء الفاتورة قبل الإرسال');
  r.status = 'pending_submission';
  r.messages = [
    'التكامل مع منصة فاتورة غير مفعّل: لا توجد شهادة CSID إنتاجية. تبقى الفاتورة في قائمة الانتظار.',
  ];
  recordAudit({
    actor,
    action: 'queue_einvoice',
    entity: 'invoice',
    entity_id: invoiceId,
    before: null,
    after: { status: r.status },
  });
  return { ...r };
}

/* ============================ period close =============================== */
export async function closePeriodChecked(id: string, actor: string): Promise<void> {
  const pending = workflowEntries().filter(
    (e) => ['draft', 'pending', 'approved'].includes(e.status) && e.entry_date.startsWith(id),
  );
  if (pending.length) throw new Error(`لا يمكن الإقفال: ${pending.length} قيد معلّق في الفترة`);
  setPeriodStatus(id, 'closed', { actor });
}
export function reopenPeriod(id: string, reason: string, actor: string): void {
  if (reason.trim().length < 5) throw new Error('سبب إعادة الفتح مطلوب (5 أحرف على الأقل)');
  setPeriodStatus(id, 'open', { actor, reason: reason.trim() });
}
export function createFiscalYear(year: number): void {
  if (year < 2000 || year > 2100) throw new Error('سنة غير صالحة');
  addFiscalYear(year);
}
export async function closeFiscalYear(year: number, actor: string): Promise<JournalEntry | null> {
  const [entries, chart, periods] = await Promise.all([listJournal(), listChart(), listPeriods()]);
  const pending = workflowEntries().filter(
    (e) =>
      ['draft', 'pending', 'approved'].includes(e.status) && e.entry_date.startsWith(String(year)),
  );
  if (pending.length) throw new Error(`لا يمكن إقفال السنة: ${pending.length} قيد معلّق`);
  if (entries.some((e) => e.reference === `CLOSE-FY${year}`))
    throw new Error('السنة مُقفلة بالفعل');
  const dec = periods.find((p) => p.id === `${year}-12`);
  if (dec?.status === 'closed') throw new Error('أعد فتح ديسمبر لترحيل قيد الإقفال');
  const entry = yearClosingEntry(entries, chart, year, nextEntryIds('je-fyclose'));
  if (entry) addSystemEntry(entry);
  for (const p of periods.filter((x) => x.year === year && x.status === 'open'))
    setPeriodStatus(p.id, 'closed', { actor });
  recordAudit({
    actor,
    action: 'close_fiscal_year',
    entity: 'fiscal_year',
    entity_id: String(year),
    before: null,
    after: { entry: entry?.reference ?? null },
  });
  return entry;
}

/* ============================== alerts =================================== */
const ALERT_STATE: Record<string, AlertState> = {};
export async function getAlertState(): Promise<Record<string, AlertState>> {
  return JSON.parse(JSON.stringify(ALERT_STATE)) as Record<string, AlertState>;
}
export function setAlertState(id: string, patch: Partial<AlertState>, actor: string): void {
  const before = ALERT_STATE[id] ?? { assignee: null, status: 'open' };
  ALERT_STATE[id] = { ...before, ...patch };
  recordAudit({
    actor,
    action: 'update',
    entity: 'fin_alert',
    entity_id: id,
    before,
    after: ALERT_STATE[id],
  });
}

/* ====================== duties (accounting permissions) ================== */
const DUTIES: DutyProfile[] = DEFAULT_DUTIES.map((d) => ({ ...d, caps: [...d.caps] }));
const ASSIGNMENTS: Record<string, string> = {}; // user email → duty code

export async function listDuties(): Promise<DutyProfile[]> {
  return DUTIES.map((d) => ({ ...d, caps: [...d.caps] }));
}
export function saveDuty(d: DutyProfile, actor: string): DutyProfile {
  if (!d.name.trim()) throw new Error('اسم الملف مطلوب');
  const i = DUTIES.findIndex((x) => x.code === d.code);
  recordAudit({
    actor,
    action: i >= 0 ? 'update' : 'create',
    entity: 'duty_profile',
    entity_id: d.code,
    before: i >= 0 ? DUTIES[i] : null,
    after: d,
  });
  if (i >= 0) DUTIES[i] = { ...d, is_system: DUTIES[i]?.is_system ?? false };
  else DUTIES.push({ ...d, is_system: false });
  return d;
}
export async function dutyFor(
  email: string | undefined,
  role: RoleCode | undefined,
): Promise<string | null> {
  if (email && ASSIGNMENTS[email]) return ASSIGNMENTS[email] ?? null;
  return (role && ROLE_DEFAULT_DUTY[role]) || null;
}
export async function listAssignments(): Promise<Record<string, string>> {
  return { ...ASSIGNMENTS };
}
export function assignDuty(email: string, duty: string | null, actor: string): void {
  const before = ASSIGNMENTS[email] ?? null;
  if (duty) ASSIGNMENTS[email] = duty;
  else delete ASSIGNMENTS[email];
  recordAudit({
    actor,
    action: 'assign_duty',
    entity: 'user',
    entity_id: email,
    before,
    after: duty,
  });
}

/* ========================= assistant & audit ============================= */
const AI_CONFIG: AiProviderConfig = { ...DEFAULT_AI_CONFIG };
const ASSISTANT_LOG: {
  at: string;
  actor: string;
  question: string;
  intent: string;
  refused: boolean;
}[] = [];
export async function getAiConfig(): Promise<AiProviderConfig> {
  return { ...AI_CONFIG };
}
export function logAssistant(
  actor: string,
  question: string,
  intent: string,
  refused: boolean,
): void {
  ASSISTANT_LOG.unshift({ at: new Date().toISOString(), actor, question, intent, refused });
}
export async function listAssistantLog(): Promise<typeof ASSISTANT_LOG> {
  return ASSISTANT_LOG.map((x) => ({ ...x }));
}

export async function listAuditTrail(): Promise<AuditEvent[]> {
  return listAudit();
}

export { listBills };
