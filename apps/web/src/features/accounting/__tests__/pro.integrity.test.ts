import { describe, expect, it } from 'vitest';
import {
  listBills,
  listChart,
  listInvoices,
  listJournal,
  listPeriods,
  setPeriodStatus,
  addManualEntry,
  postDepreciation,
} from '@/features/accounting/api/accounting.api';
import {
  actOnEntry,
  closePeriodChecked,
  createCreditNote,
  generateEInvoiceFor,
  generateRecurring,
  listWorkflow,
  queueSubmission,
  recordCollection,
  reopenPeriod,
  reverseEntry,
  runAllocation,
  saveDraftEntry,
  listAuditTrail,
} from '@/features/accounting/api/accountingPro.api';
import { controlReconciliation } from '@/features/accounting/data/receivables';
import { balanceSheetPro, cashFlowPro } from '@/features/accounting/data/statements';
import { trialBalancePro } from '@/features/accounting/data/ledger';
import { dashboardKpis } from '@/features/accounting/data/analytics';
import { financialSnapshot } from '@/features/accounting/data/engine';
import { settleCustomerSale } from '@/shared/lib/salesLedger';
import { decodeQr } from '@/features/accounting/data/zatca';

/**
 * Whole-ledger integrity on the demo data set: every posting path (contracts,
 * collections, bills, vouchers, assets, depreciation, credit notes, workflow
 * entries, allocations) must keep the books balanced and the sub-ledgers equal
 * to their control accounts.
 */
async function snapshot() {
  const [entries, chart, invoices, bills] = await Promise.all([
    listJournal(),
    listChart(),
    listInvoices(),
    listBills(),
  ]);
  return { entries, chart, invoices, bills };
}

async function assertIntegrity() {
  const { entries, chart, invoices, bills } = await snapshot();
  const tb = trialBalancePro(entries, chart, {});
  expect(tb.totals.balanced).toBe(true);
  const bs = balanceSheetPro(entries, chart, { to: '2026-12-31' });
  expect(bs.difference).toBe(0);
  const cf = cashFlowPro(entries, chart, { from: '2026-01-01', to: '2026-12-31' });
  expect(cf.reconciles).toBe(true);
  for (const c of controlReconciliation(entries, chart, invoices, bills, '2026-12-31')) {
    expect({ label: c.label, diff: c.difference }).toEqual({ label: c.label, diff: 0 });
  }
}

describe('demo ledger integrity', () => {
  it('seed data: balanced, A = L + E, AR/AP sub-ledgers = GL control accounts', async () => {
    await assertIntegrity();
  });

  it('dashboard KPIs agree with the statements and the legacy snapshot', async () => {
    const { entries, chart, invoices, bills } = await snapshot();
    const k = dashboardKpis(entries, chart, invoices, bills, {
      from: '2026-01-01',
      to: '2026-12-31',
    });
    const legacy = financialSnapshot(entries);
    expect(k.revenue).toBe(legacy.revenue);
    expect(k.netProfit).toBe(legacy.netProfit);
    expect(k.cash).toBe(legacy.cash);
    expect(k.totalAR).toBe(k.receivables);
  });

  it('collections from the Payments page post to the journal (AR stays reconciled)', async () => {
    settleCustomerSale('inv-5', 1000, { method: 'mada', paid_at: '2026-06-12' });
    await recordCollection('inv-4', 500, 'cash', '2026-06-12', 'test');
    await assertIntegrity();
  });

  it('credit notes, depreciation, workflow posting, reversal, allocation keep integrity', async () => {
    await createCreditNote(
      {
        invoice_id: 'inv-5',
        subtotal: 1000,
        reason: 'خصم تأخر وصول العاملة',
        date: '2026-06-15',
        vat_rate: 0.15,
      },
      'test',
    );
    postDepreciation('2026-04');
    const d = saveDraftEntry(
      {
        entry_date: '2026-06-20',
        branch: null,
        cost_center: null,
        description: 'مصروف ضيافة المقر',
        reference: 'HOSP-1',
        kind: 'manual',
        lines: [
          { account_code: '5400', debit: 800, credit: 0 },
          { account_code: '1111', debit: 0, credit: 800 },
        ],
      },
      'أحمد',
    );
    await actOnEntry(d.id, 'submit', 'أحمد', true);
    await expect(actOnEntry(d.id, 'approve', 'أحمد', true)).rejects.toThrow('فصل المهام');
    await actOnEntry(d.id, 'approve', 'منصور', true);
    const posted = await actOnEntry(d.id, 'post', 'أحمد', true);
    expect(posted.status).toBe('posted');
    // re-submitting the same post is a no-op (idempotent)
    expect((await actOnEntry(d.id, 'post', 'أحمد', true)).status).toBe('posted');
    const rev = await reverseEntry(d.id, '2026-06-25', 'أحمد');
    await expect(reverseEntry(d.id, '2026-06-26', 'أحمد')).rejects.toThrow();
    await actOnEntry(rev.id, 'post', 'منصور', false);
    const hq = saveDraftEntry(
      {
        entry_date: '2026-06-28',
        branch: null,
        cost_center: null,
        description: 'كهرباء المقر الرئيسي',
        reference: 'SEC-06',
        kind: 'manual',
        lines: [
          { account_code: '5800', debit: 1999.99, credit: 0 },
          { account_code: '1112', debit: 0, credit: 1999.99 },
        ],
      },
      'أحمد',
    );
    await actOnEntry(hq.id, 'post', 'منصور', false);
    await runAllocation('alloc-hq', '2026-06', 'منصور');
    await expect(runAllocation('alloc-hq', '2026-06', 'منصور')).rejects.toThrow('بالفعل');
    await assertIntegrity();
  });

  it('closed periods reject every posting path; reopen needs a reason and is audited', async () => {
    const wf = await listWorkflow();
    for (const e of wf.filter((x) => x.entry_date.startsWith('2026-03') && x.status !== 'posted'))
      await actOnEntry(e.id, 'void', 'منصور', false);
    await closePeriodChecked('2026-03', 'منصور');
    expect(() =>
      addManualEntry({
        entry_date: '2026-03-10',
        branch: null,
        description: 'x',
        lines: [
          { account_code: '5400', debit: 1, credit: 0 },
          { account_code: '1111', debit: 0, credit: 1 },
        ],
      }),
    ).toThrow('مقفلة');
    await expect(recordCollection('inv-5', 10, 'cash', '2026-03-10', 't')).rejects.toThrow('مقفلة');
    expect(() => reopenPeriod('2026-03', '', 'منصور')).toThrow('سبب');
    reopenPeriod('2026-03', 'تصحيح قيد إهلاك بعد المراجعة', 'منصور');
    const p = (await listPeriods()).find((x) => x.id === '2026-03');
    expect(p?.status).toBe('open');
    const audit = await listAuditTrail();
    expect(audit.some((a) => a.action === 'reopen_period' && a.note?.includes('تصحيح'))).toBe(true);
    setPeriodStatus('2026-03', 'open');
  });

  it('pending entries block closing the period', async () => {
    // seeded pending accrual sits in June
    await expect(closePeriodChecked('2026-06', 'منصور')).rejects.toThrow('معلّق');
  });

  it('recurring generation is idempotent', async () => {
    const first = generateRecurring('2026-06', 'منصور');
    expect(first.length).toBe(3); // Apr, May, Jun
    expect(generateRecurring('2026-06', 'منصور')).toHaveLength(0);
  });

  it('e-invoice: chained ICV/PIH, decodable QR, no resubmission, honest queue status', async () => {
    const a = await generateEInvoiceFor('inv-1', 'منصور');
    const b = await generateEInvoiceFor('inv-2', 'منصور');
    expect(b.icv).toBe(a.icv + 1);
    expect(b.pih).toBe(a.hash);
    expect(decodeQr(a.qr)[4]).toBe('18400.00');
    await expect(generateEInvoiceFor('inv-1', 'منصور')).rejects.toThrow();
    const q = queueSubmission('inv-1', 'منصور');
    expect(q.status).toBe('pending_submission');
    expect(q.messages[0]).toContain('CSID');
  });
});
