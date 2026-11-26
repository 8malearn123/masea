import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { splitVatInclusive } from '@/shared/lib/pricing';
import { getContract } from '@/features/contracts/api/contracts.api';
import { resetContractOpsDemo } from '@/features/contracts/api/contractOps.api';
import {
  createTrial,
  getTrialDocument,
  resetTrialsDemo,
} from '@/features/contracts/api/trials.api';
import {
  EMPTY_TRIAL,
  trialFieldsOf,
  trialStepError,
  trialTotals,
  type TrialDraft,
} from '@/features/contracts/components/TransferTrialSteps';
import { trialDocumentHtml } from '@/features/contracts/lib/trialContract/document';
import { buildContractHtml } from '@/features/contracts/lib/contractHtml';

const cfg = { vat_rate: 0.15 } as never;
const draft = (price: string, paid: string): TrialDraft => ({
  ...EMPTY_TRIAL,
  workerKind: 'العاملة',
  days: 10,
  sponsorName: 'سالم بن علي آل منصور',
  city: 'نجران',
  customerNationality: 'سعودي',
  idKind: 'بطاقة',
  idNumber: '1081234567',
  idIssueDate: '1442/01/10',
  idIssuePlace: 'نجران',
  address: 'نجران - حي الفهد',
  job: 'موظف',
  mobile: '0551238001',
  price,
  paid,
  dailyWage: '70',
});

beforeEach(() => {
  resetContractOpsDemo();
  resetTrialsDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin')!;
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('السعر المدخل شامل ضريبة القيمة المضافة (0108)', () => {
  it('extracts VAT from the entered total — 1,000 → 869.57 + 130.43 (never +150)', () => {
    expect(splitVatInclusive(1000, 0.15)).toEqual({ net: 869.57, vat: 130.43, total: 1000 });
    expect(splitVatInclusive(1000, 0.05)).toEqual({ net: 952.38, vat: 47.62, total: 1000 }); // managed rate
    for (let i = 1; i <= 5000; i++) {
      const t = Math.round((i / 7) * 100) / 100;
      const s = splitVatInclusive(t, 0.15);
      expect(Math.round((s.net + s.vat) * 100) / 100).toBe(t);
      // in halalas: the extracted VAT is within one halala of net × rate
      expect(
        Math.abs(Math.round(s.vat * 100) - Math.round(s.net * 0.15 * 100)),
      ).toBeLessThanOrEqual(1);
    }
  });

  it('pricing step: the five figures for full, partial and no payment', () => {
    expect(trialTotals(draft('1000', '1000'), cfg)).toMatchObject({
      base: 869.57,
      vat: 130.43,
      total: 1000,
      paid: 1000,
      remaining: 0,
    });
    expect(trialTotals(draft('1000', '400'), cfg)).toMatchObject({
      total: 1000,
      paid: 400,
      remaining: 600,
    });
    expect(trialTotals(draft('1000', ''), cfg)).toMatchObject({
      total: 1000,
      paid: 0,
      remaining: 1000,
    });
    const ctx = (d: TrialDraft) => ({
      hasWorker: true,
      receipt: '2026-12-01',
      branch: 'نجران',
      maxDays: 90,
      totals: trialTotals(d, cfg),
    });
    expect(trialStepError('pricing', draft('1000', '1000'), ctx(draft('1000', '1000')))).toBeNull();
    // paying 1,150 against a 1,000 contract is refused (VAT is not added on top)
    expect(trialStepError('pricing', draft('1000', '1150'), ctx(draft('1000', '1150')))).toMatch(
      'أكبر من المبلغ الإجمالي',
    );
  });

  it('save → contract, trial and printed document all carry 1,000 / 869.57 / 130.43', async () => {
    const t = await createTrial({
      customerId: 'cust-vat-1',
      customerName: 'حمد آل مسعود',
      workerId: 'wp-vat-1',
      workerName: 'ليزا مارتينيز',
      workerNationality: 'الفلبين',
      branch: 'نجران',
      price: 1000,
      days: 10,
      receiptDate: '2026-12-01',
      fields: trialFieldsOf(draft('1000', '1000')),
    });
    expect(t).toMatchObject({ price: 869.57, vat_amount: 130.43, total_amount: 1000 });
    const c = await getContract(t.contract_id);
    expect(c).toMatchObject({
      base_amount: 869.57,
      vat_amount: 130.43,
      total_amount: 1000,
      vat_inclusive: true,
    });
    const html = trialDocumentHtml(await getTrialDocument(t.id))!;
    expect(html).toContain('1,000.00'); // total and paid
    expect(html).toContain('0.00'); // remaining
    expect(html).not.toContain('1,150.00');
    // the generic contract document prints the stored figures and the stored rate
    const doc = buildContractHtml(c!, [], { autoPrint: false });
    expect(doc).toContain('ضريبة القيمة المضافة (15%)');
    expect(doc).toContain('130.43');
    expect(doc).toContain('1,000.00');
  });
});
