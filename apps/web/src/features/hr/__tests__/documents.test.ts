/** المرحلة ح — الوثائق والإقامات والتأشيرات (مرآة 0074 واختبار 99c). */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  createHrDocument,
  getDocFileUrl,
  listDocCosts,
  listHrDocuments,
  postDocCost,
  renewHrDocument,
  setHrDocumentActive,
  updateHrDocument,
} from '@/features/hr/api/documents.api';
import {
  daysLeft,
  docStatus,
  docStoragePath,
  documentSchema,
  expiryAlerts,
  firstIssue,
  iqamaRegister,
  validateDocFile,
} from '@/features/hr/lib/documentsEngine';
import { assertBalanced } from '@/features/accounting/data/engine';
import { buildDocCostEntry } from '@/features/accounting/data/payroll';
import type { DocCostRow, DocFile, DocumentDraft, HrDocument } from '@/features/hr/types';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const T = '2026-11-07';
const plus = (days: number) =>
  new Date(Date.parse(T) + days * 86_400_000).toISOString().slice(0, 10);
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function doc(p: Partial<HrDocument>): HrDocument {
  return {
    id: 'x',
    owner_kind: 'worker',
    owner_id: 'w1',
    owner_name: 'ماريا سانتوس',
    branch: 'نجران',
    profession: 'عاملة منزلية',
    type: 'iqama',
    number: '2433445566',
    issue_date: null,
    expiry_date: null,
    file_path: null,
    file_name: null,
    mime_type: null,
    file_size: null,
    renewal_cost: 0,
    cost_posted: false,
    notes: '',
    is_active: true,
    superseded_by: null,
    created_at: '',
    ...p,
  };
}

function pdf(name = 'iqama.pdf', size = 2048): DocFile {
  return { name, type: 'application/pdf', size, blob: new Blob(['%PDF-1.4']) };
}

function draft(p: Partial<DocumentDraft> = {}): DocumentDraft {
  return {
    owner_kind: 'worker',
    owner_id: 'w1',
    type: 'passport',
    number: 'P7654321',
    issue_date: iso(-30),
    expiry_date: iso(1800),
    renewal_cost: 0,
    notes: '',
    ...p,
  };
}

describe('documents engine (doc_expiry_status with a managed window)', () => {
  it('status follows the configured alert days', () => {
    expect(docStatus(plus(45), 60, T)).toBe('expiring');
    expect(docStatus(plus(45), 30, T)).toBe('valid');
    expect(docStatus(plus(20), 30, T)).toBe('expiring');
    expect(docStatus(plus(-1), 30, T)).toBe('expired');
    expect(docStatus(null, 30, T)).toBe('valid');
    expect(daysLeft(plus(10), T)).toBe(10);
  });

  it('alerts count only current versions (renewed / deactivated are ignored)', () => {
    const docs = [
      doc({ id: 'old', expiry_date: plus(-10), superseded_by: 'new' }),
      doc({ id: 'new', expiry_date: plus(300) }),
      doc({ id: 'off', expiry_date: plus(5), is_active: false }),
      doc({ id: 'due', expiry_date: plus(5), owner_id: 'w3' }),
      doc({ id: 'gone', expiry_date: plus(-2), owner_id: 'w5' }),
    ];
    const a = expiryAlerts(docs, 60, T);
    expect(a.map((x) => x.doc.id)).toEqual(['gone', 'due']);
    expect(a[0]!.status).toBe('expired');
  });

  it('iqama register links the work permit of the same person', () => {
    const docs = [
      doc({ id: 'i1', expiry_date: plus(100) }),
      doc({ id: 'p1', type: 'work_permit', expiry_date: plus(100) }),
      doc({ id: 'i2', owner_id: 'w3', expiry_date: plus(10) }),
      doc({ id: 'p2', owner_id: 'w3', type: 'work_permit', expiry_date: plus(-1) }),
      doc({ id: 'i3', owner_kind: 'employee', owner_id: 'w1', expiry_date: plus(50) }),
    ];
    const r = iqamaRegister(docs, 60, T);
    expect(r.map((x) => x.doc.id)).toEqual(['i2', 'i3', 'i1']);
    expect(r.find((x) => x.doc.id === 'i1')!.work_permit).toBe(true);
    expect(r.find((x) => x.doc.id === 'i2')!.work_permit).toBe(false); // expired permit
    expect(r.find((x) => x.doc.id === 'i3')!.work_permit).toBe(false); // employee ≠ worker w1
  });

  it('validation: number, dates order, no negative cost', () => {
    expect(firstIssue(documentSchema.safeParse(draft()))).toBeNull();
    expect(firstIssue(documentSchema.safeParse(draft({ number: ' ' })))).toBe('أدخل رقم الوثيقة');
    expect(firstIssue(documentSchema.safeParse(draft({ expiry_date: iso(-60) })))).toContain(
      'بعد تاريخ الإصدار',
    );
    expect(firstIssue(documentSchema.safeParse(draft({ renewal_cost: -1 })))).toContain('سالبة');
  });

  it('files: PDF/images up to 10MB, stored under the owner', () => {
    expect(validateDocFile({ type: 'application/pdf', size: 1000 })).toBeNull();
    expect(validateDocFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validateDocFile({ type: 'application/zip', size: 1000 })).toContain('PDF');
    expect(validateDocFile({ type: 'image/jpeg', size: 11 * 1024 * 1024 })).toContain('10');
    expect(docStoragePath({ owner_kind: 'worker', owner_id: 'w1' }, 'Iqama Scan.PDF', 5)).toBe(
      'worker/w1/5.pdf',
    );
  });
});

describe('demo store (mirror of RLS + renew_document + post_document_cost)', () => {
  it('HR sees staff and worker documents; sales sees none', async () => {
    loginAs('hr');
    const all = await listHrDocuments();
    expect(all.some((d) => d.owner_kind === 'employee')).toBe(true);
    expect(all.some((d) => d.owner_kind === 'worker' && d.owner_name === 'ماريا سانتوس')).toBe(
      true,
    );
    loginAs('sales');
    expect(await listHrDocuments()).toEqual([]);
  });

  it('a branch manager sees only his branch (staff + workers) and cannot write', async () => {
    loginAs('branch_manager'); // جازان
    const docs = await listHrDocuments();
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((d) => d.branch === 'جازان')).toBe(true);
    await expect(createHrDocument(draft({ owner_id: 'w3' }), null)).rejects.toThrow(
      'إدارة الموارد البشرية',
    );
  });

  it('HR adds a document with its file, edits it and soft-deletes it', async () => {
    loginAs('hr');
    const id = await createHrDocument(draft(), pdf());
    let d = (await listHrDocuments()).find((x) => x.id === id)!;
    expect(d.file_path).toMatch(/^worker\/w1\/\d+\.pdf$/);
    expect(d.file_name).toBe('iqama.pdf');
    expect(await getDocFileUrl(d.file_path!)).toBeTruthy();
    await expect(createHrDocument(draft(), { ...pdf(), type: 'text/plain' })).rejects.toThrow(
      'PDF',
    );

    await updateHrDocument(id, draft({ number: 'P0000001', notes: 'جواز جديد' }), null);
    d = (await listHrDocuments()).find((x) => x.id === id)!;
    expect(d.number).toBe('P0000001');
    expect(d.file_name).toBe('iqama.pdf'); // file kept when none is picked
    await expect(updateHrDocument(id, draft({ owner_id: 'w3' }), null)).rejects.toThrow('شخص آخر');

    await setHrDocumentActive(id, false);
    d = (await listHrDocuments()).find((x) => x.id === id)!;
    expect(d.is_active).toBe(false); // still there — never hard-deleted
    await setHrDocumentActive(id, true);
  });

  it('renewal archives the old version, carries the cost, and posts once', async () => {
    loginAs('hr');
    const before = (await listHrDocuments()).find((x) => x.id === 'wdoc3')!; // w3 iqama
    await expect(
      renewHrDocument(
        'wdoc3',
        {
          number: '',
          issue_date: iso(0),
          expiry_date: before.expiry_date!,
          renewal_cost: 0,
          notes: '',
        },
        null,
      ),
    ).rejects.toThrow('بعد الحالي');
    const newId = await renewHrDocument(
      'wdoc3',
      { number: '', issue_date: iso(0), expiry_date: iso(405), renewal_cost: 650, notes: 'مقيم' },
      pdf('renewal.pdf'),
    );
    const docs = await listHrDocuments();
    const old = docs.find((x) => x.id === 'wdoc3')!;
    const next = docs.find((x) => x.id === newId)!;
    expect(old.superseded_by).toBe(newId);
    expect(next.number).toBe(before.number);
    expect(next.renewal_cost).toBe(650);
    expect(next.file_path).toMatch(/^worker\/w3\//);
    await expect(
      renewHrDocument(
        'wdoc3',
        { number: '', issue_date: iso(0), expiry_date: iso(900), renewal_cost: 0, notes: '' },
        null,
      ),
    ).rejects.toThrow('جُدِّدت سابقًا');

    // HR cannot post; accounting sees it pending and posts once
    await expect(postDocCost(newId, iso(0), '1112', () => undefined)).rejects.toThrow('المحاسبة');
    loginAs('accountant');
    const pending = (await listDocCosts()).find((r) => r.id === newId)!;
    expect(pending.posted).toBe(false);
    expect(pending.branch).toBe('جازان');
    await expect(postDocCost(newId, iso(0), '4100', () => undefined)).rejects.toThrow(
      'بنك أو صندوق',
    );
    const posted: DocCostRow[] = [];
    await postDocCost(newId, iso(0), '1112', (r) => posted.push(r));
    await postDocCost(newId, iso(0), '1112', (r) => posted.push(r)); // idempotent
    expect(posted).toHaveLength(1);
    expect((await listDocCosts()).find((r) => r.id === newId)!.posted).toBe(true);

    // a posted cost is frozen for HR
    loginAs('hr');
    const n = (await listHrDocuments()).find((x) => x.id === newId)!;
    await expect(
      updateHrDocument(
        newId,
        {
          ...draft({ owner_id: 'w3', type: 'iqama', number: n.number }),
          renewal_cost: 10,
          issue_date: n.issue_date!,
          expiry_date: n.expiry_date!,
        },
        null,
      ),
    ).rejects.toThrow('مُرحَّلة');
  });

  it('the fee entry is balanced: DR 5160 / CR bank', () => {
    const e = buildDocCostEntry(
      {
        id: 'doc-1',
        owner_kind: 'worker',
        owner_name: 'سيتي نورهاليزا',
        branch: 'جازان',
        type: 'iqama',
        number: '2477889900',
        expiry_date: '2027-12-01',
        renewal_cost: 650,
        posted: false,
        created_at: '',
      },
      '2026-11-07',
      '1112',
    );
    expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(e.lines[0]).toMatchObject({ account_code: '5160', debit: 650 });
    expect(e.lines[1]).toMatchObject({ account_code: '1112', credit: 650 });
    expect(e.description).toContain('إقامة');
  });
});

describe('live row mapping (PostgREST shape of employee_documents + embeds)', () => {
  it('maps a worker document with its branch and posting state', async () => {
    const { mapDocRow } = await import('@/features/hr/api/documents.live');
    const d = mapDocRow({
      id: 'u1',
      employee_id: null,
      worker_id: 'w-9',
      type: 'iqama',
      doc_number: '2466778899',
      issue_date: '2026-01-01',
      expiry_date: '2027-01-01',
      file_path: 'worker/w-9/1.pdf',
      file_name: 'iqama.pdf',
      mime_type: 'application/pdf',
      file_size: 2048,
      renewal_cost: '650.00',
      cost_entry_id: 'je-1',
      notes: null,
      is_active: true,
      superseded_by: null,
      created_at: '2026-01-01T08:00:00Z',
      employees: null,
      worker_profiles: {
        full_name: 'روكسانا بيغم',
        profession: 'عاملة منزلية',
        branches: { city: 'حبونا' },
      },
    });
    expect(d).toMatchObject({
      owner_kind: 'worker',
      owner_id: 'w-9',
      owner_name: 'روكسانا بيغم',
      branch: 'حبونا',
      profession: 'عاملة منزلية',
      renewal_cost: 650,
      cost_posted: true,
      notes: '',
    });
  });
});
