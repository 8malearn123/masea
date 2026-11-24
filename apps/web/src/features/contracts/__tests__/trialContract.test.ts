import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { getContract } from '@/features/contracts/api/contracts.api';
import { resetContractOpsDemo } from '@/features/contracts/api/contractOps.api';
import {
  acceptTrial,
  createTrial,
  getTrialDocument,
  issueTrialLink,
  listTrials,
  listTrialTerms,
  resetTrialsDemo,
  viewTrialByToken,
} from '@/features/contracts/api/trials.api';
import { TRIAL_CONTRACT_V1 } from '@/features/contracts/lib/trialContract/template';
import { buildTrialContractHtml } from '@/features/contracts/lib/trialContract/render';
import {
  trialDataFromDocument,
  trialDocumentHtml,
} from '@/features/contracts/lib/trialContract/document';
import {
  EMPTY_TRIAL,
  prefillFromCustomer,
  trialEndDate,
  trialFieldsOf,
  trialPreviewData,
  trialStepError,
  trialTotals,
  workerKindFor,
  type TrialDraft,
} from '@/features/contracts/components/TransferTrialSteps';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../../../../../supabase/migrations/0106_trial_contract_template.sql'),
  'utf8',
);
const today = new Date().toISOString().slice(0, 10);
const draft: TrialDraft = {
  ...EMPTY_TRIAL,
  workerKind: 'العاملة',
  days: 15,
  sponsorName: 'علي بن محمد آل مريح',
  city: 'نجران',
  customerNationality: 'سعودي',
  idKind: 'بطاقة',
  idNumber: '1076543210',
  idIssueDate: '1440/05/12',
  idIssuePlace: 'الأحوال المدنية بنجران',
  address: 'نجران - حي الفيصلية',
  job: 'معلم',
  mobile: '0551236606',
  customerNo: '000231',
  price: '2000',
  paid: '1000',
  dailyWage: '60',
};
const input = {
  customerId: 'cust-tt-1',
  customerName: 'سالم آل حيدر',
  workerId: 'wp-tt-1',
  workerName: 'ماريا سانتوس',
  branch: 'نجران',
  price: 2000,
  days: 15,
  receiptDate: today,
  fields: trialFieldsOf(draft),
};

beforeEach(() => {
  resetContractOpsDemo();
  resetTrialsDemo();
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('عقد التجربة الرسمي (contract_final_black.pdf — 0106)', () => {
  it('the template is the PDF text verbatim, identical to the migration', () => {
    expect(TRIAL_CONTRACT_V1.clauses).toHaveLength(10);
    const all = [
      ...TRIAL_CONTRACT_V1.clauses,
      ...TRIAL_CONTRACT_V1.lines,
      ...TRIAL_CONTRACT_V1.letterhead_ar,
      ...TRIAL_CONTRACT_V1.letterhead_en,
      ...TRIAL_CONTRACT_V1.footer,
      ...TRIAL_CONTRACT_V1.amounts,
      ...TRIAL_CONTRACT_V1.signature,
      TRIAL_CONTRACT_V1.declaration,
      TRIAL_CONTRACT_V1.title,
    ];
    for (const s of all) expect(MIGRATION).toContain(`'${s}'`);
  });

  it('renders every field in place and the ten clauses unchanged', () => {
    const data = trialPreviewData(draft, {
      customerName: 'سالم آل حيدر',
      workerName: 'ماريا سانتوس',
      workerNationality: 'الفلبين',
      totals: trialTotals(draft, undefined),
    });
    const html = buildTrialContractHtml(TRIAL_CONTRACT_V1, {
      ...data,
      contract_no: 'MAS-2026-90001',
    });
    for (const v of [
      'سالم آل حيدر',
      'سعودي',
      '1076543210',
      '1440/05/12',
      'الأحوال المدنية بنجران',
      'علي بن محمد آل مريح',
      'ماريا سانتوس',
      'الفلبين',
      'نجران - حي الفيصلية',
      'معلم',
      '0551236606',
      '000231',
      'MAS-2026-90001',
      '15 يوماً',
      '60.00',
      '2,300.00', // الإجمالي شامل الضريبة
      '1,000.00',
      '1,300.00',
    ])
      expect(html).toContain(v);
    // the clauses' fixed text is untouched around the fields
    const text = html.replace(/<[^>]+>/g, '');
    for (const c of TRIAL_CONTRACT_V1.clauses)
      for (const piece of c.split(/\{\{[^}]+\}\}/)) expect(text).toContain(piece.trim());
    expect(html).toContain('<b class="pick">العاملة</b> / السائق');
    expect(html).toContain('<b class="pick">بطاقة</b> / إقامة');
    expect(html).toContain('trial-contract-logo');
  });

  it('escapes input and leaves blanks for missing data', () => {
    const data = trialPreviewData(
      { ...EMPTY_TRIAL, sponsorName: '<script>x</script>' },
      { customerName: '', workerName: '', workerNationality: '', totals: null },
    );
    const html = buildTrialContractHtml(TRIAL_CONTRACT_V1, data);
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('class="f empty" data-field="city"');
  });

  it('wizard steps: validation, end date, prefill never overwrites, driver from profession', () => {
    const ctx = {
      hasWorker: true,
      receipt: today,
      branch: 'نجران',
      maxDays: 90,
      totals: trialTotals(draft, undefined),
    };
    expect(trialStepError('details', draft, ctx)).toBeNull();
    expect(trialStepError('details', { ...draft, days: 91 }, ctx)).toMatch('المادة التاسعة');
    expect(trialStepError('details', { ...draft, sponsorName: '' }, ctx)).toMatch('الكفيل الحالي');
    expect(trialStepError('details', draft, { ...ctx, hasWorker: false })).toMatch(
      'العاملة أو السائق',
    );
    expect(trialStepError('customer', draft, ctx)).toBeNull();
    expect(trialStepError('customer', { ...draft, idNumber: '12' }, ctx)).toMatch('10 أرقام');
    expect(trialStepError('customer', { ...draft, idKind: '' }, ctx)).toMatch('بطاقة أو إقامة');
    expect(trialStepError('pricing', draft, ctx)).toBeNull();
    expect(trialStepError('pricing', { ...draft, paid: '9999' }, ctx)).toMatch(
      'أكبر من المبلغ الإجمالي',
    );
    expect(trialStepError('pricing', { ...draft, dailyWage: '' }, ctx)).toMatch('أجر اليوم');
    expect(trialEndDate('2026-12-01', 15)).toBe('2026-12-15');
    expect(
      prefillFromCustomer(
        { ...EMPTY_TRIAL, mobile: '0550000000' },
        {
          id: 'c',
          full_name: 'x',
          phone: '0551111111',
          city: 'نجران',
          national_id: '1012345678',
          address: 'نجران',
        },
      ),
    ).toEqual({ idNumber: '1012345678', address: 'نجران' });
    expect(workerKindFor('سائق خاص')).toBe('السائق');
    expect(workerKindFor('عاملة منزلية')).toBe('العاملة');
  });

  it('save → listed → reopen the same document → customer accepts (ID masked publicly)', async () => {
    const official = (await listTrialTerms()).find((x) => x.status === 'approved');
    expect(official?.doc?.layout).toBe('trial_contract_black_v1');
    await expect(
      createTrial({ ...input, fields: { ...input.fields, paid_amount: 99999 } }),
    ).rejects.toThrow('أكبر من المبلغ الإجمالي');
    const t = await createTrial(input);
    expect((await listTrials()).map((x) => x.id)).toEqual([t.id]);
    const c = await getContract(t.contract_id);
    expect(c?.service_code).toBe('transfer_trial');

    const doc = await getTrialDocument(t.id);
    const data = trialDataFromDocument(doc);
    expect(data).toMatchObject({
      contract_no: c?.contract_no,
      sponsor_name: 'علي بن محمد آل مريح',
      id_number: '1076543210',
      mobile: '0551236606',
      paid: 1000,
      daily_wage: 60,
      trial_period: '15 يوماً',
    });
    expect(data.remaining).toBe(Math.round((t.total_amount - 1000) * 100) / 100);
    expect(trialDocumentHtml(doc)).toContain('علي بن محمد آل مريح');

    const { token } = await issueTrialLink(t);
    const v = await viewTrialByToken(token);
    expect(v.customer_national_id).toBe('••••••3210');
    expect(trialDocumentHtml(v)).toContain('••••••3210');
    const ok = await acceptTrial({ token, idLast4: '3210', phoneLast4: '6606' });
    expect(ok.ok).toBe(true);
    expect(trialDocumentHtml(ok.document!)).toContain('سالم آل حيدر');
  });
});
