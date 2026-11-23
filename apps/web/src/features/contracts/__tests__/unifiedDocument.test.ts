import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  createDraft,
  getClauses,
  getContract,
  listContracts,
  transitionContract,
} from '@/features/contracts/api/contracts.api';
import {
  approvedTemplateFor,
  listRentalTemplates,
  resetRentalDemoStore,
  setContractDocFields,
  getCompanyProfile,
} from '@/features/contracts/api/rentalContract.api';
import { legalClausesOf } from '@/features/contracts/lib/rentalContract/template';
import { contractDocumentHtml } from '@/features/contracts/lib/contractDocument';
import {
  listContractPayments,
  recordContractPayment,
  resetContractPaymentsDemo,
} from '@/features/contracts/api/contractPayments.api';

function signIn(): void {
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
}
afterEach(() => {
  resetRentalDemoStore();
  resetContractPaymentsDemo();
  clearDemo();
  useAuth.setState({ profile: null });
});

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

async function rentalContract() {
  signIn();
  const tpl = approvedTemplateFor(await listRentalTemplates(), 'monthly_rental')!;
  const c = await createDraft({
    service_code: 'monthly_rental',
    customer_id: 'cust-1',
    customer_name: 'محمد الأحمدي',
    worker_profile_id: 'wp-doc-1',
    worker_name: 'ماريا سانتوس',
    branch: 'نجران',
    start_date: '2027-01-01',
    end_date: '2027-03-31',
    quantity: 3,
    nationality: 'الفلبين',
    template_id: tpl.id,
    clauses: legalClausesOf(tpl.doc),
  });
  await setContractDocFields(c.id, {
    customer: {
      full_name: 'محمد الأحمدي',
      national_id: '1023456781',
      phone: '0501234567',
      mobile: '0501234567',
      address: 'نجران',
      city: 'نجران',
    },
    worker: { full_name: 'ماريا سانتوس', nationality: 'الفلبين' },
    company: await getCompanyProfile(),
    employee_mobile: null,
    work_location: 'نجران — حي الفيصلية',
    service_label: 'تأجير شهري — 3 شهر',
  });
  return { c: (await getContract(c.id))!, tpl };
}

describe('one document engine for preview, details, print and PDF', () => {
  it('a rental contract renders the pinned template with every legal clause verbatim', async () => {
    const { c, tpl } = await rentalContract();
    const doc = await contractDocumentHtml(c, { clauses: [], signatures: [] });
    expect(doc.kind).toBe('rental_template');
    expect(doc.templateVersion).toBe(tpl.version);
    const body = text(doc.html);
    for (const block of tpl.doc.sections.flatMap((s) => s.blocks)) {
      if (block.t === 'clause' && !block.text.includes('{{')) {
        expect(body).toContain(block.text.replace(/\s+/g, ' ').trim().slice(0, 60));
      }
    }
    expect(body).toContain('محمد الأحمدي');
    expect(body).toContain('ماريا سانتوس');
    // the same engine with autoPrint differs only by the print script
    const printed = await contractDocumentHtml(c, { clauses: [], signatures: [], autoPrint: true });
    expect(printed.html.replace(/<script>[^<]*<\/script>/g, '')).toBe(
      doc.html.replace(/<script>[^<]*<\/script>/g, ''),
    );
  });

  it('an old contract keeps its stored clauses and shows no invented data', async () => {
    signIn();
    const old = (await listContracts(ALL)).find(
      (c) => !c.template_id && c.service_code === 'monthly_rental',
    )!;
    const clauses = (await getClauses(old.id)).map((x) => x.body);
    const doc = await contractDocumentHtml(old, { clauses, signatures: [] });
    expect(doc.kind).toBe('stored_clauses');
    for (const cl of clauses) expect(doc.html).toContain(cl.slice(0, 30));
  });
});

describe('recording a payment from the contract page', () => {
  it('updates the paid amount and refuses more than what remains', async () => {
    const { c } = await rentalContract();
    await transitionContract(c.id, 'pending_approval');
    await recordContractPayment(c.id, {
      amount: 1000,
      method: 'transfer',
      bank_account_id: 'bank-2',
      transaction_no: 'TRF-1',
      paid_on: '2026-11-20',
    });
    expect((await getContract(c.id))?.amount_paid).toBe(1000);
    expect(await listContractPayments(c.id)).toHaveLength(1);
    await expect(
      recordContractPayment(c.id, {
        amount: c.total_amount,
        method: 'cash',
        paid_on: '2026-11-20',
      }),
    ).rejects.toThrow('يتجاوز');
  });
});

describe('contract list filters', () => {
  it('filters by customer and by start-date period', async () => {
    signIn();
    const all = await listContracts(ALL);
    const name = all[0]!.customer_name!;
    expect(
      (await listContracts({ ...ALL, customer: name })).every((c) =>
        c.customer_name?.includes(name),
      ),
    ).toBe(true);
    const from = '2026-06-01';
    const scoped = await listContracts({ ...ALL, from });
    expect(scoped.every((c) => (c.start_date ?? c.created_at).slice(0, 10) >= from)).toBe(true);
    expect(scoped.length).toBeLessThanOrEqual(all.length);
  });
});
