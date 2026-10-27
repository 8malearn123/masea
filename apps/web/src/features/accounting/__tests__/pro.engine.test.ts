import { describe, expect, it } from 'vitest';
import { CHART } from '@/features/accounting/data/chart';
import {
  mulMoney,
  pctChange,
  splitMoney,
  sumMoney,
  toHalala,
} from '@/features/accounting/data/money';
import {
  generalLedger,
  trialBalancePro,
  balances,
  monthEnd,
} from '@/features/accounting/data/ledger';
import {
  balanceSheetPro,
  cashFlowPro,
  incomeStatementPro,
} from '@/features/accounting/data/statements';
import {
  buildReversal,
  duePeriods,
  isDuplicate,
  JournalRuleError,
  postingErrors,
  transition,
  type RecurringTemplate,
} from '@/features/accounting/data/journalWorkflow';
import {
  buildAllocationLines,
  budgetVsActual,
  budgetAlerts,
  type Budget,
} from '@/features/accounting/data/budgets';
import {
  arOpenItems,
  bucketOf,
  partyStatement,
  paymentSchedule,
} from '@/features/accounting/data/receivables';
import {
  parseStatementCsv,
  reconciliationReport,
  suggestMatches,
  type BookLine,
} from '@/features/accounting/data/bankrec';
import {
  decodeQr,
  isValidVatNumber,
  sha256Base64,
  zatcaQr,
  FIRST_PIH,
  vatReturnForm,
} from '@/features/accounting/data/zatca';
import {
  buildDisposalEntry,
  buildTransferEntry,
  depreciationSchedule,
  monthlyDepreciation,
} from '@/features/accounting/data/assets';
import { yearClosingLines, closeChecklist, canClose } from '@/features/accounting/data/periodClose';
import {
  detectIntent,
  resolvePeriod,
  classifyExpense,
  answer,
} from '@/features/accounting/data/assistant';
import { dutyCan, DEFAULT_DUTIES, auditDiff } from '@/features/accounting/data/access';
import type { FixedAsset, Invoice, JournalEntry, Period } from '@/features/accounting/types';

const chart = CHART.map((a) => ({ ...a, is_active: true }));
const periods: Period[] = Array.from({ length: 12 }, (_, i) => ({
  id: `2026-${String(i + 1).padStart(2, '0')}`,
  year: 2026,
  month: i + 1,
  status: 'open',
}));

const je = (over: Partial<JournalEntry> & Pick<JournalEntry, 'lines'>): JournalEntry => ({
  id: over.id ?? `e-${Math.random()}`,
  entry_no: over.entry_no ?? 1,
  entry_date: over.entry_date ?? '2026-04-01',
  branch: over.branch === undefined ? 'نجران' : over.branch,
  description: over.description ?? 'قيد',
  reference: over.reference ?? 'REF',
  source_type: 'manual',
  status: over.status ?? 'posted',
  ...over,
});

// a small but complete ledger: capital, revenue (with VAT), collection, expense,
// asset purchase, depreciation, contra-revenue
const LEDGER: JournalEntry[] = [
  je({
    id: 'o',
    entry_date: '2026-01-01',
    lines: [
      { account_code: '1112', debit: 100000, credit: 0 },
      { account_code: '3100', debit: 0, credit: 100000 },
    ],
  }),
  je({
    id: 'r',
    entry_date: '2026-04-03',
    lines: [
      { account_code: '1120', debit: 11500, credit: 0 },
      { account_code: '4100', debit: 0, credit: 10000 },
      { account_code: '2120', debit: 0, credit: 1500 },
    ],
  }),
  je({
    id: 'c',
    entry_date: '2026-04-05',
    lines: [
      { account_code: '1112', debit: 11500, credit: 0 },
      { account_code: '1120', debit: 0, credit: 11500 },
    ],
  }),
  je({
    id: 'x',
    entry_date: '2026-04-20',
    lines: [
      { account_code: '5600', debit: 3000, credit: 0 },
      { account_code: '1112', debit: 0, credit: 3000 },
    ],
  }),
  je({
    id: 'a',
    entry_date: '2026-02-01',
    lines: [
      { account_code: '1230', debit: 60000, credit: 0 },
      { account_code: '1112', debit: 0, credit: 60000 },
    ],
  }),
  je({
    id: 'd',
    entry_date: '2026-04-30',
    branch: null,
    lines: [
      { account_code: '5900', debit: 1000, credit: 0 },
      { account_code: '1290', debit: 0, credit: 1000 },
    ],
  }),
  je({
    id: 'cn',
    entry_date: '2026-04-25',
    lines: [
      { account_code: '4900', debit: 500, credit: 0 },
      { account_code: '1120', debit: 0, credit: 500 },
    ],
  }),
];

describe('money (halala-exact)', () => {
  it('sums without float drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(mulMoney(1234.565, 0.15)).toBe(185.18);
  });
  it('splits exactly by weights', () => {
    const parts = splitMoney(100, [1, 1, 1]);
    expect(sumMoney(parts)).toBe(100);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });
  it('growth is undefined on a zero base', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
  });
});

describe('general ledger & trial balance', () => {
  it('running balance + opening balance before the range', () => {
    const gl = generalLedger(LEDGER, '1112', chart, { from: '2026-04-01', to: '2026-04-30' });
    expect(gl.opening).toBe(40000); // 100,000 − 60,000 asset purchase
    expect(gl.rows.map((r) => r.balance)).toEqual([51500, 48500]);
    expect(gl.closing).toBe(48500);
  });
  it('opening + movement + closing all balance; headers roll up', () => {
    const { rows, totals } = trialBalancePro(LEDGER, chart, {
      from: '2026-04-01',
      to: '2026-04-30',
    });
    expect(totals.balanced).toBe(true);
    expect(totals.openingDebit).toBe(totals.openingCredit);
    const fixed = rows.find((r) => r.code === '1200');
    expect(fixed?.is_postable).toBe(false);
    expect(fixed?.closingDebit).toBe(59000); // 60,000 − 1,000 accumulated depreciation
  });
});

describe('classified statements', () => {
  it('contra accounts reduce their section; gross vs net profit', () => {
    const is = incomeStatementPro(LEDGER, chart, { from: '2026-04-01', to: '2026-04-30' });
    expect(is.revenue.total).toBe(9500); // 10,000 − 500 returns
    expect(is.costOfSales.total).toBe(3000);
    expect(is.grossProfit).toBe(6500);
    expect(is.netProfit).toBe(5500); // − 1,000 depreciation
    expect(is.grossMargin).toBe(68.4);
  });
  it('balance sheet balances after depreciation (A = L + E)', () => {
    const bs = balanceSheetPro(LEDGER, chart, { to: '2026-12-31' });
    expect(bs.nonCurrentAssets.total).toBe(59000);
    expect(bs.balanced).toBe(true);
    expect(bs.difference).toBe(0);
  });
  it('closing entries do not distort the income statement', () => {
    const lines = yearClosingLines(LEDGER, chart, 2026);
    const closing = je({
      id: 'close',
      entry_date: '2026-12-31',
      reference: 'CLOSE-FY2026',
      kind: 'closing',
      branch: null,
      lines,
    });
    const all = [...LEDGER, closing];
    expect(incomeStatementPro(all, chart, { from: '2026-01-01', to: '2026-12-31' }).netProfit).toBe(
      5500,
    );
    const bs = balanceSheetPro(all, chart, { to: '2026-12-31' });
    expect(bs.unclosedProfit).toBe(0);
    expect(bs.balanced).toBe(true);
    expect(balances(all, chart).get('3200')).toBe(5500);
  });
  it('direct cash flow reconciles opening + net change = closing', () => {
    const cf = cashFlowPro(LEDGER, chart, { from: '2026-02-01', to: '2026-04-30' });
    expect(cf.openingCash).toBe(100000);
    expect(cf.investing.net).toBe(-60000);
    expect(cf.operating.net).toBe(8500);
    expect(cf.reconciles).toBe(true);
  });
});

describe('journal workflow', () => {
  const ctx = { chart, periods };
  const base = je({
    id: 'w',
    status: 'draft',
    created_by: 'أحمد',
    lines: [
      { account_code: '5400', debit: 100, credit: 0 },
      { account_code: '1111', debit: 0, credit: 100 },
    ],
  });

  it('refuses unbalanced / header / closed-period postings', () => {
    expect(
      postingErrors(
        {
          ...base,
          lines: [
            { account_code: '5400', debit: 100, credit: 0 },
            { account_code: '1111', debit: 0, credit: 90 },
          ],
        },
        ctx,
      ).join(),
    ).toContain('غير متوازن');
    expect(
      postingErrors(
        {
          ...base,
          lines: [
            { account_code: '5000', debit: 100, credit: 0 },
            { account_code: '1111', debit: 0, credit: 100 },
          ],
        },
        ctx,
      ).join(),
    ).toContain('رئيسي');
    const closed = periods.map((p) =>
      p.id === '2026-04' ? { ...p, status: 'closed' as const } : p,
    );
    expect(postingErrors(base, { chart, periods: closed }).join()).toContain('مقفلة');
  });
  it('segregation of duties: creator cannot approve; post needs approval', () => {
    const pending = transition(base, 'submit', ctx, { actor: 'أحمد', requireApproval: true });
    expect(() =>
      transition(pending, 'approve', ctx, { actor: 'أحمد', requireApproval: true }),
    ).toThrow(JournalRuleError);
    expect(() =>
      transition(pending, 'post', ctx, { actor: 'منصور', requireApproval: true }),
    ).toThrow('اعتماد');
    const approved = transition(pending, 'approve', ctx, { actor: 'منصور', requireApproval: true });
    const posted = transition(approved, 'post', ctx, { actor: 'أحمد', requireApproval: true });
    expect(posted.status).toBe('posted');
    expect(() =>
      transition(posted, 'void', ctx, { actor: 'منصور', requireApproval: true }),
    ).toThrow('عكسي');
  });
  it('reversal swaps sides and cannot precede the original', () => {
    const posted = { ...base, status: 'posted' as const };
    const rev = buildReversal(posted, '2026-04-10', 'منصور', { id: 'r1', entry_no: 2 });
    expect(rev.lines[0]).toMatchObject({ debit: 0, credit: 100 });
    expect(rev.kind).toBe('reversing');
    expect(() => buildReversal(posted, '2026-03-01', 'م', { id: 'r2', entry_no: 3 })).toThrow();
  });
  it('recurring periods and idempotency', () => {
    const t: RecurringTemplate = {
      id: 't',
      name: 'إيجار',
      description: 'إيجار',
      branch: null,
      lines: base.lines,
      start_period: '2026-04',
      end_period: null,
      last_period: '2026-04',
      is_active: true,
    };
    expect(duePeriods(t, '2026-06')).toEqual(['2026-05', '2026-06']);
    expect(isDuplicate([{ ...base, idempotency_key: 'K' }], 'K')).toBe(true);
  });
});

describe('cost centers & budgets', () => {
  it('allocation moves head-office cost to branches exactly', () => {
    const entries = [
      je({
        entry_date: '2026-04-10',
        branch: null,
        lines: [
          { account_code: '5700', debit: 1000, credit: 0 },
          { account_code: '1112', debit: 0, credit: 1000 },
        ],
      }),
    ];
    const lines = buildAllocationLines(
      {
        id: 'r',
        name: 'توزيع',
        account_codes: ['5700'],
        basis: 'fixed',
        weights: { نجران: 50, جازان: 30, شرورة: 20 },
        is_active: true,
      },
      entries,
      chart,
      '2026-04',
      ['نجران', 'جازان', 'شرورة', 'حبونا'],
    );
    expect(sumMoney(lines.map((l) => l.debit))).toBe(sumMoney(lines.map((l) => l.credit)));
    expect(lines.find((l) => l.branch === 'جازان')?.debit).toBe(300);
  });
  it('budget vs actual flags overruns and alerts at the threshold', () => {
    const b: Budget = {
      id: 'b',
      name: 'م',
      year: 2026,
      scope: 'company',
      branch: null,
      cost_center: null,
      status: 'approved',
      is_active: true,
      lines: [{ account_code: '5600', amounts: [0, 0, 0, 2000, 0, 0, 0, 0, 0, 0, 0, 0] }],
    };
    const [row] = budgetVsActual(b, LEDGER, chart, 4);
    expect(row).toMatchObject({ budget: 2000, actual: 3000, variance: -1000, overrun: true });
    expect(budgetAlerts([b], LEDGER, chart, 90, 4)).toHaveLength(1);
  });
});

describe('receivables & payables', () => {
  const inv = (over: Partial<Invoice>): Invoice => ({
    id: 'i1',
    invoice_no: 1,
    type: 'simplified',
    contract_no: null,
    customer_name: 'محمد الأحمدي',
    branch: 'نجران',
    issue_date: '2026-04-01',
    due_date: '2026-05-01',
    subtotal: 1000,
    vat_amount: 150,
    total: 1150,
    amount_paid: 150,
    status: 'partial',
    lines: [],
    ...over,
  });
  it('aging buckets by days past due', () => {
    expect(bucketOf(0)).toBe('current');
    expect(bucketOf(45)).toBe('d31_60');
    expect(bucketOf(120)).toBe('d90_plus');
    const [item] = arOpenItems([inv({})], '2026-06-10');
    expect(item).toMatchObject({ outstanding: 1000, days_overdue: 40, bucket: 'd31_60' });
  });
  it('statement running balance with partial payments', () => {
    const rows = partyStatement(
      [
        {
          id: 'i1',
          date: '2026-04-01',
          ref: 'INV-1',
          description: 'فاتورة',
          amount: 1150,
          paid: 150,
        },
      ],
      [],
      'ar',
    );
    expect(rows.at(-1)?.balance).toBe(1000);
  });
  it('weekly payment schedule', () => {
    const weeks = paymentSchedule([
      {
        id: 'b',
        no: 1,
        party: 'م',
        branch: null,
        issue_date: '2026-05-01',
        due_date: '2026-05-14',
        total: 100,
        paid: 0,
        outstanding: 100,
        days_overdue: 0,
        bucket: 'current',
      },
    ]);
    expect(weeks[0]?.week).toBe('2026-05-10');
  });
});

describe('bank reconciliation', () => {
  const csv =
    'التاريخ,البيان,المرجع,المبلغ\n05/04/2026,حوالة واردة,PMT-1,"11,500.00"\n30/04/2026,رسوم بنكية,FEE,-25';
  it('parses Saudi bank CSV (DD/MM/YYYY, thousands separators)', () => {
    const lines = parseStatementCsv(csv);
    expect(lines[0]).toMatchObject({ date: '2026-04-05', amount: 11500 });
  });
  it('suggests matches and reports unrecorded items', () => {
    const st = parseStatementCsv(csv);
    const book: BookLine[] = [
      {
        key: 'c:0',
        entry_id: 'c',
        entry_no: 3,
        date: '2026-04-05',
        description: 'تحصيل',
        reference: 'PMT-1',
        amount: 11500,
      },
    ];
    const m = suggestMatches(st, book, { statement: new Set(), book: new Set() }, 3);
    expect(m).toHaveLength(1);
    expect(m[0]?.score).toBe(100);
    const rep = reconciliationReport(book, st, m, 11475);
    expect(rep.unrecordedDebits).toHaveLength(1);
    expect(rep.reconciled).toBe(true);
  });
});

describe('ZATCA / VAT', () => {
  it('Phase-1 TLV QR round-trips', () => {
    const qr = zatcaQr({
      sellerName: 'ماسية الشرق',
      vatNumber: '300000000000003',
      timestamp: '2026-04-03T10:00:00Z',
      total: 18400,
      vat: 2400,
    });
    expect(decodeQr(qr)).toEqual({
      1: 'ماسية الشرق',
      2: '300000000000003',
      3: '2026-04-03T10:00:00Z',
      4: '18400.00',
      5: '2400.00',
    });
  });
  it('VAT number format and the spec PIH seed', async () => {
    expect(isValidVatNumber('300000000000003')).toBe(true);
    expect(isValidVatNumber('123')).toBe(false);
    const hex = atob(FIRST_PIH);
    expect(hex).toBe('5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9');
    expect(await sha256Base64('x')).toHaveLength(44);
  });
  it('VAT return: credit notes reduce output; imported services under reverse charge', () => {
    const form = vatReturnForm(
      '2026-04',
      0.15,
      [
        {
          id: 'i',
          invoice_no: 1,
          type: 'standard',
          contract_no: null,
          customer_name: 'م',
          branch: null,
          issue_date: '2026-04-03',
          due_date: '2026-05-03',
          subtotal: 10000,
          vat_amount: 1500,
          total: 11500,
          amount_paid: 0,
          status: 'issued',
          lines: [],
        },
      ],
      [
        {
          id: 'cn',
          note_no: 1,
          invoice_id: 'i',
          customer_name: 'م',
          branch: null,
          note_date: '2026-04-20',
          subtotal: 1000,
          vat_amount: 150,
          total: 1150,
          reason: 'مرتجع',
        },
      ],
      [
        {
          id: 'b',
          bill_no: 1,
          vendor_name: 'مكتب الهند',
          vendor_type: 'external_office',
          branch: null,
          issue_date: '2026-04-06',
          due_date: '2026-05-06',
          subtotal: 9000,
          vat_amount: 0,
          total: 9000,
          amount_paid: 0,
          expense_code: '5600',
          status: 'open',
        },
      ],
      [],
    );
    expect(form.boxes.find((b) => b.box === 6)?.vat).toBe(1350);
    expect(form.boxes.find((b) => b.box === 9)?.vat).toBe(1350);
    expect(form.netVat).toBe(1350); // reverse charge nets to zero
    expect(form.notes[0]).toContain('العكسي');
  });
});

describe('fixed assets (extended)', () => {
  const a: FixedAsset = {
    id: 'fa',
    name: 'سيارة',
    category: 'vehicles',
    asset_code: '1230',
    cost: 60000,
    salvage_value: 0,
    useful_life_years: 5,
    acquisition_date: '2026-01-01',
    branch: 'نجران',
    accumulated_dep: 12000,
    status: 'active',
  };
  it('disposal books gain/loss and stays balanced', () => {
    const e = buildDisposalEntry(a, { date: '2026-06-01', proceeds: 50000, pay_code: '1112' }, 1);
    expect(sumMoney(e.lines.map((l) => l.debit))).toBe(sumMoney(e.lines.map((l) => l.credit)));
    expect(e.lines.find((l) => l.account_code === '4600')?.credit).toBe(2000);
    const loss = buildDisposalEntry(a, { date: '2026-06-01', proceeds: 0, pay_code: '1112' }, 2);
    expect(loss.lines.find((l) => l.account_code === '5960')?.debit).toBe(48000);
  });
  it('transfer moves cost & accumulated depreciation between branches', () => {
    const e = buildTransferEntry(a, 'جازان', '2026-06-01', 1);
    const bs = balances([e], chart, { branch: 'جازان' });
    expect(bs.get('1230')).toBe(60000);
    expect(bs.get('1290')).toBe(-12000);
  });
  it('declining balance depreciates faster early and never below salvage', () => {
    const db = { ...a, accumulated_dep: 0, method: 'declining_balance' as const };
    expect(monthlyDepreciation(db)).toBe(2000);
    const sched = depreciationSchedule({ ...db, salvage_value: 5000 });
    expect(sched.at(-1)?.nbv).toBeGreaterThanOrEqual(5000);
  });
});

describe('period close', () => {
  it('blocks closing with pending entries', () => {
    const items = closeChecklist({
      period: '2026-04',
      pendingEntries: [je({ status: 'pending', lines: [] })],
      depreciationPosted: true,
      hasActiveAssets: true,
      vatFiled: false,
      bankReconciled: false,
      ledgerBalanced: true,
    });
    expect(canClose(items)).toBe(false);
  });
  it('monthEnd handles month length', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2026-04')).toBe('2026-04-30');
  });
});

describe('assistant', () => {
  it('understands Arabic intents and periods', () => {
    expect(detectIntent('كم إجمالي إيرادات هذا الشهر؟')).toBe('revenue');
    expect(detectIntent('ما صافي الأرباح؟')).toBe('profit');
    expect(detectIntent('من العملاء المتأخرون عن السداد؟')).toBe('overdue_customers');
    expect(detectIntent('ما أكبر خمسة مصروفات؟')).toBe('top_expenses');
    expect(detectIntent('لماذا انخفض الربح؟')).toBe('profit_drop');
    expect(detectIntent('ما الفواتير غير المحصلة؟')).toBe('unpaid_invoices');
    expect(detectIntent('قارن أداء الفروع')).toBe('compare_branches');
    expect(detectIntent('هل توجد قيود محاسبية غير معتادة؟')).toBe('anomalies');
    expect(detectIntent('ما التدفق النقدي المتوقع؟')).toBe('forecast');
    expect(detectIntent('رحّل القيد رقم 5')).toBe('action_refused');
    expect(detectIntent('ما معدل الضريبة؟')).toBe('vat');
    expect(resolvePeriod('إيرادات أبريل', '2026-10-27')).toMatchObject({
      from: '2026-04-01',
      to: '2026-04-30',
    });
  });
  it('answers with real figures, refuses writes and respects permissions', () => {
    const data = {
      entries: LEDGER,
      chart,
      invoices: [],
      bills: [],
      branches: ['نجران'],
      today: '2026-10-27',
      anomalyMultiplier: 3,
    };
    const a = answer('كم إيرادات أبريل؟', data, true);
    expect(a.text).toContain('9,500.00');
    expect(a.sources.length).toBeGreaterThan(0);
    expect(answer('احذف القيد', data, true).refused).toBe(true);
    expect(answer('كم الإيرادات؟', data, false).refused).toBe(true);
  });
  it('suggests expense accounts', () => {
    expect(classifyExpense('فاتورة كهرباء السكن', chart).code).toBe('5800');
    expect(classifyExpense('إيجار مكتب', chart).code).toBe('5700');
  });
});

describe('duties & audit', () => {
  const by = (c: string) => DEFAULT_DUTIES.find((d) => d.code === c);
  it('reports-only users cannot post; auditor views but never creates', () => {
    expect(dutyCan('accountant', by('reports_only'), 'gl', 'post')).toBe(false);
    expect(dutyCan('accountant', by('internal_auditor'), 'audit', 'view')).toBe(true);
    expect(dutyCan('accountant', by('internal_auditor'), 'gl', 'create')).toBe(false);
    expect(dutyCan('admin', undefined, 'close', 'reopen')).toBe(true);
  });
  it('audit diff lists changed fields only', () => {
    expect(auditDiff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([{ field: 'b', from: '2', to: '3' }]);
  });
  it('halala helper rounds half away from zero', () => {
    expect(toHalala(1.005)).toBe(101);
    expect(toHalala(-1.005)).toBe(-101);
  });
});
