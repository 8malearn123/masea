import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import {
  createDraft,
  getContract,
  getSignatures,
  signCaptured,
  signContractParty,
  transitionContract,
} from '@/features/contracts/api/contracts.api';
import { resetContractOpsDemo } from '@/features/contracts/api/contractOps.api';
import { createTrial, listTrials, resetTrialsDemo } from '@/features/contracts/api/trials.api';
import { signatureState } from '@/features/contracts/lib/signatureStage';
import { signedParties } from '@/features/contracts/lib/signedParties';
import { buildContractHtml } from '@/features/contracts/lib/contractHtml';
import { contractDocumentHtml } from '@/features/contracts/lib/contractDocument';
import { buildTrialContractHtml } from '@/features/contracts/lib/trialContract/render';
import { TRIAL_CONTRACT_V1 } from '@/features/contracts/lib/trialContract/template';
import type { ContractSignature } from '@/features/contracts/types';

const PNG = (c = 'A') => `data:image/png;base64,${c.repeat(300)}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = iso(new Date());

function as(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(`no demo ${role}`);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}

beforeEach(() => {
  resetContractOpsDemo();
  resetTrialsDemo();
});
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

async function draft(
  service: 'monthly_rental' | 'daily_rental' | 'recruitment' = 'monthly_rental',
) {
  as('admin');
  return createDraft({
    service_code: service,
    customer_id: 'cust-1',
    customer_name: 'محمد الأحمدي',
    worker_profile_id: service === 'recruitment' ? null : `wp-sig-${Math.random()}`,
    worker_name: service === 'recruitment' ? null : 'نورما ديلا كروز',
    branch: 'جازان',
    start_date: today,
    end_date: iso(new Date(Date.now() + 30 * 86_400_000)),
    quantity: 1,
    nationality: 'الفلبين',
  });
}
const customer = (extra: Partial<Parameters<typeof signContractParty>[1]> = {}) => ({
  party: 'customer' as const,
  image: PNG('C'),
  signerName: 'محمد الأحمدي',
  nationalId: '1012345678',
  ipAddress: '10.0.0.7',
  userAgent: 'Mozilla/5.0 (iPhone)',
  ...extra,
});
const company = { party: 'company' as const, image: PNG('D'), ipAddress: '10.0.0.8' };

describe('التوقيع الإلكتروني لكل العقود (0107)', () => {
  it('stages: draft → awaiting both → awaiting company → complete', () => {
    const sig = (t: 'customer' | 'company'): ContractSignature => ({
      id: t,
      contract_id: 'k',
      signer_type: t,
      signer_name: t,
      national_id: null,
      ip_address: null,
      signature_image: null,
      signed_at: new Date().toISOString(),
    });
    const s = (
      status: string,
      sigs: ContractSignature[],
      musaned = false,
      service = 'monthly_rental',
    ) => signatureState({ status, service_code: service } as never, sigs, musaned).label;
    expect(s('draft', [])).toBe('مسودة');
    expect(s('approved', [])).toBe('بانتظار اكتمال التوقيعات');
    expect(s('awaiting_signature', [sig('customer')])).toBe('بانتظار توقيع الشركة');
    expect(s('awaiting_signature', [sig('company')])).toBe('بانتظار توقيع العميل');
    expect(s('signed', [sig('customer'), sig('company')])).toBe('موقّع ومكتمل');
    expect(s('draft', [], true, 'recruitment')).toBe('بانتظار اكتمال التوقيعات'); // Musaned office copy
    expect(s('draft', [], false, 'transfer_trial')).toBe('بانتظار اكتمال التوقيعات');
    expect(
      signatureState({ status: 'draft', service_code: 'monthly_rental' } as never, [], false)
        .signable,
    ).toBe(false);
  });

  it('internal contract: approval first, per-party permissions, identity, one signature each', async () => {
    const c = await draft();
    await expect(signContractParty(c.id, customer())).rejects.toThrow('بعد اعتماده');
    await transitionContract(c.id, 'pending_approval');
    await transitionContract(c.id, 'approved');
    as('sales');
    await expect(signContractParty(c.id, customer({ image: 'data:,' }))).rejects.toThrow(
      'ارسم التوقيع',
    );
    await expect(signContractParty(c.id, customer({ method: 'agent', poaNo: '' }))).rejects.toThrow(
      'رقم الوكالة',
    );
    const r1 = await signContractParty(c.id, customer());
    expect(r1.complete).toBe(false);
    as('admin'); // contract reads are scoped to the viewer's branch
    expect((await getContract(c.id))?.status).toBe('awaiting_signature');
    as('sales');
    await expect(signContractParty(c.id, customer())).rejects.toThrow('سبق توقيع');
    await expect(signContractParty(c.id, company)).rejects.toThrow('صلاحية اعتماد');
    as('branch_manager');
    const r2 = await signContractParty(c.id, company);
    expect(r2.complete).toBe(true);
    as('admin');
    expect((await getContract(c.id))?.status).toBe('signed');
    as('branch_manager');
    const sigs = await getSignatures(c.id);
    expect(sigs.map((s) => s.signer_type)).toEqual(['customer', 'company']);
    expect(sigs[0]).toMatchObject({
      signer_capacity: 'العميل (الطرف الثاني)',
      method: 'in_person',
      national_id: '1012345678',
      ip_address: '10.0.0.7',
      signature_image: PNG('C'),
    });
    expect(sigs[0]?.document_sha256).toBe(sigs[1]?.document_sha256);
    expect(sigs[1]?.signer_capacity).toMatch('ممثل الشركة (الطرف الأول)');
    await expect(signContractParty(c.id, company)).rejects.toThrow('نسخة جديدة');
  });

  it('recruitment (Musaned): office copy signed, Musaned status untouched; daily via the capture helper', async () => {
    const r = await draft('recruitment');
    as('admin');
    await signCaptured(r.id, {
      customer: {
        image: PNG(),
        name: 'محمد الأحمدي',
        nationalId: '1012345678',
        method: 'in_person',
        poaNo: null,
      },
      company: { image: PNG('B') },
      ipAddress: null,
    });
    expect((await getContract(r.id))?.status).toBe('draft');
    expect(await getSignatures(r.id)).toHaveLength(2);

    const d = await draft('daily_rental');
    await transitionContract(d.id, 'pending_approval');
    await transitionContract(d.id, 'approved');
    const res = await signCaptured(d.id, {
      customer: {
        image: PNG(),
        name: 'وكيل العميل',
        nationalId: '1099999999',
        method: 'agent',
        poaNo: '4410123',
      },
      company: { image: PNG('B') },
      ipAddress: '10.0.0.9',
    });
    expect(res?.complete).toBe(true);
    expect((await getSignatures(d.id))[0]?.signer_capacity).toBe(
      'وكيل عن العميل بموجب الوكالة 4410123',
    );
  });

  it('trial: in-person signing of both parties = acceptance → awaiting handover', async () => {
    as('admin');
    const t = await createTrial({
      customerId: 'cust-sig-1',
      customerName: 'سالم آل حيدر',
      workerId: 'wp-sig-trial',
      workerName: 'ماريا سانتوس',
      branch: 'نجران',
      price: 1500,
      days: 10,
      receiptDate: today,
    });
    await signContractParty(t.contract_id, customer({ signerName: 'سالم آل حيدر' }));
    await signContractParty(t.contract_id, company);
    expect((await getContract(t.contract_id))?.status).toBe('signed');
    expect((await listTrials())[0]?.status).toBe('awaiting_handover');
  });

  it('PDF: signatures at the end with name, capacity, time and fingerprint (all three layouts)', async () => {
    const c = await draft();
    await transitionContract(c.id, 'pending_approval');
    await transitionContract(c.id, 'approved');
    await signContractParty(c.id, customer());
    await signContractParty(c.id, company);
    const sigs = await getSignatures(c.id);
    const parties = signedParties(
      sigs,
      Object.fromEntries(sigs.map((s) => [s.id, s.signature_image])),
    );
    const fp = sigs[0]!.document_sha256!.slice(0, 16);

    const generic = buildContractHtml((await getContract(c.id))!, ['البند الأول.'], {
      autoPrint: false,
      signers: parties,
    });
    for (const v of [
      PNG('C'),
      PNG('D'),
      'محمد الأحمدي',
      'العميل (الطرف الثاني)',
      'ممثل الشركة (الطرف الأول)',
      fp,
    ])
      expect(generic).toContain(v);
    expect(generic.indexOf('البند الأول.')).toBeLessThan(generic.indexOf(PNG('C'))); // after the clauses

    const doc = await contractDocumentHtml((await getContract(c.id))!, {
      clauses: ['البند الأول.'],
      signatures: sigs,
    });
    expect(doc.html).toContain(PNG('C'));
    expect(doc.html).toContain(fp);

    const trial = buildTrialContractHtml(
      TRIAL_CONTRACT_V1,
      {
        contract_no: 'MAS-1',
        customer_no: '',
        issued_on: new Date().toISOString(),
        customer_name: 'محمد الأحمدي',
        customer_nationality: 'سعودي',
        id_kind: 'بطاقة',
        id_number: '1012345678',
        id_issue_date: '',
        id_issue_place: '',
        worker_kind: 'العاملة',
        sponsor_name: '',
        worker_name: '',
        worker_nationality: '',
        total: 1,
        paid: 0,
        remaining: 1,
        city: '',
        trial_period: '',
        daily_wage: 1,
        address: '',
        job: '',
        mobile: '',
      },
      { signers: parties },
    );
    expect(trial).toContain('التوقيع الإلكتروني');
    expect(trial).toContain(PNG('C'));
    expect(trial).toContain(PNG('D'));
    expect(trial.indexOf(TRIAL_CONTRACT_V1.declaration)).toBeLessThan(
      trial.indexOf('التوقيع الإلكتروني'),
    );
    // nothing is printed for a party that did not sign
    const none = signedParties([], {});
    expect(
      buildContractHtml((await getContract(c.id))!, [], { autoPrint: false, signers: none }),
    ).not.toContain('esig-cap"');
  });
});
