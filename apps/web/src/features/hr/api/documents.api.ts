/**
 * HR documents (0074) — staff + worker documents in one register.
 * Facade: live Supabase when connected, otherwise an in-memory demo store that
 * mirrors the database rules (scope, hr.manage, soft delete, renewal, posting).
 */
import { isDemoMode } from '@/shared/lib/demoBackend';
import { scopeToViewerBranch } from '@/lib/branchScope';
import { recordAudit } from '@/shared/lib/auditTrail';
import { roleCan, type RoleCode } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import { listEmployees, listHouseWorkers } from '@/features/hr/api/hr.api';
import * as live from '@/features/hr/api/documents.live';
import { LOOKUP_STORE } from '@/features/hr/api/lookups.store';
import { lookupLabel } from '@/features/hr/lib/lookups';
import {
  assertRenewable,
  docStoragePath,
  documentSchema,
  firstIssue,
  renewSchema,
  validateDocFile,
  type RenewInput,
} from '@/features/hr/lib/documentsEngine';
import {
  type DocCostRow,
  type DocFile,
  type DocumentDraft,
  type HrDocument,
} from '@/features/hr/types';

type Stored = Omit<HrDocument, 'owner_name' | 'branch' | 'profession'>;

const DAY = 86_400_000;
/** Seeds are relative to today so the demo always shows a realistic mix. */
function rel(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

function seed(
  id: string,
  owner_kind: Stored['owner_kind'],
  owner_id: string,
  type: string,
  number: string,
  issue: number,
  expiry: number | null,
  extra: Partial<Stored> = {},
): Stored {
  return {
    id,
    owner_kind,
    owner_id,
    type,
    number,
    issue_date: rel(issue),
    expiry_date: expiry === null ? null : rel(expiry),
    file_path: null,
    file_name: null,
    mime_type: null,
    file_size: null,
    renewal_cost: 0,
    cost_posted: false,
    notes: '',
    is_active: true,
    superseded_by: null,
    created_at: `${rel(issue)}T08:00:00Z`,
    ...extra,
  };
}

const DOCS: Stored[] = [
  // staff
  seed('doc1', 'employee', 'e1', 'contract', 'CON-1001', -610, 485),
  seed('doc2', 'employee', 'e7', 'iqama', '2412345678', -340, 25, { renewal_cost: 0 }),
  seed('doc3', 'employee', 'e7', 'passport', 'P1234567', -1640, 1820),
  seed('doc4', 'employee', 'e7', 'work_permit', 'WP-2024-55120', -340, 25),
  seed('doc5', 'employee', 'e5', 'certificate', 'SOC-7788', -300, 430),
  seed('doc6', 'employee', 'e2', 'driving_license', 'DL-99001', -1800, -6),
  seed('doc7', 'employee', 'e8', 'contract', 'CON-1008', -230, null),
  seed('doc8', 'employee', 'e2', 'medical', 'BUPA-77812', -200, 165),
  // workers (iqama + work permit + passport / visa)
  seed('wdoc1', 'worker', 'w1', 'iqama', '2433445566', -165, 200),
  seed('wdoc2', 'worker', 'w1', 'work_permit', 'WP-2025-10231', -165, 200),
  seed('wdoc3', 'worker', 'w3', 'iqama', '2477889900', -325, 40),
  seed('wdoc4', 'worker', 'w3', 'passport', 'A7654321', -900, 900),
  seed('wdoc5', 'worker', 'w5', 'iqama', '2411223344', -368, -3),
  seed('wdoc6', 'worker', 'w9', 'iqama', '2466778899', -730, -365, { superseded_by: 'wdoc7' }),
  seed('wdoc7', 'worker', 'w9', 'iqama', '2466778899', -365, 300, {
    renewal_cost: 650,
    notes: 'تجديد سنوي عبر منصة مقيم',
  }),
  seed('wdoc8', 'worker', 'w9', 'work_permit', 'WP-2025-44120', -365, 300, { renewal_cost: 9700 }),
  seed('wdoc9', 'worker', 'w11', 'iqama', '2455667780', -310, 55),
  seed('wdoc10', 'worker', 'w11', 'visa', 'V-88231', -20, 70),
];

/** Demo object storage: path → blob. */
const FILES = new Map<string, Blob>();
let seq = 100;

function role(): RoleCode | undefined {
  return useAuth.getState().profile?.role as RoleCode | undefined;
}
function hasProfile(): boolean {
  return !!useAuth.getState().profile;
}

interface Owner {
  name: string;
  branch: string;
  profession: string;
}

/** Owners in the viewer's scope (hr_doc_visible): staff via HR scope, workers by branch. */
async function visibleOwners(): Promise<Map<string, Owner>> {
  const r = role();
  const out = new Map<string, Owner>();
  if (hasProfile() && (!r || !roleCan(r, 'hr', 'view'))) return out;
  const [emps, workers] = await Promise.all([listEmployees(), listHouseWorkers()]);
  emps.forEach((e) =>
    out.set(`employee:${e.id}`, {
      name: e.full_name,
      branch: e.branch,
      profession: e.job_title ?? '',
    }),
  );
  scopeToViewerBranch(workers, (w) => w.branch).forEach((w) =>
    out.set(`worker:${w.id}`, { name: w.full_name, branch: w.branch, profession: w.profession }),
  );
  return out;
}

function hydrate(d: Stored, owners: Map<string, Owner>): HrDocument | null {
  const o = owners.get(`${d.owner_kind}:${d.owner_id}`);
  return o ? { ...d, owner_name: o.name, branch: o.branch, profession: o.profession } : null;
}

async function assertWritable(owner_kind: string, owner_id: string): Promise<Owner> {
  const r = role();
  if (hasProfile() && (!r || !roleCan(r, 'hr', 'manage')))
    throw new Error('إدارة الوثائق من صلاحية إدارة الموارد البشرية');
  const o = (await visibleOwners()).get(`${owner_kind}:${owner_id}`);
  if (!o) throw new Error('صاحب الوثيقة خارج نطاقك');
  return o;
}

function audit(action: 'insert' | 'update', d: Stored, owner: Owner, before?: Partial<Stored>) {
  const changed = (Object.keys(d) as (keyof Stored)[]).filter((k) => !before || before[k] !== d[k]);
  recordAudit({
    action,
    entity: 'employee_documents',
    record_ref: `${lookupLabel(LOOKUP_STORE, 'doc_type', d.type)} — ${owner.name}`,
    old_data: before ? Object.fromEntries(changed.map((k) => [k, before[k]])) : null,
    new_data: Object.fromEntries(changed.map((k) => [k, d[k]])),
    branch: owner.branch || null,
  });
}

function checkFile(file: DocFile | null): void {
  if (!file) return;
  const err = validateDocFile(file);
  if (err) throw new Error(err);
}

/** Upload first (path under the owner) → the row stores the path. */
async function storeFile(
  owner: { owner_kind: Stored['owner_kind']; owner_id: string },
  file: DocFile | null,
): Promise<{ path: string; file: DocFile } | null> {
  if (!file) return null;
  checkFile(file);
  const path = docStoragePath(owner, file.name);
  if (!isDemoMode()) await live.liveUploadDocFile(path, file);
  else FILES.set(path, file.blob);
  return { path, file };
}

function validDraft(d: DocumentDraft): void {
  const err = firstIssue(documentSchema.safeParse(d));
  if (err) throw new Error(err);
}

/* --------------------------------- reads ---------------------------------- */
export async function listHrDocuments(): Promise<HrDocument[]> {
  if (!isDemoMode()) return live.liveListHrDocuments();
  const owners = await visibleOwners();
  return DOCS.map((d) => hydrate(d, owners))
    .filter((d): d is HrDocument => d !== null)
    .sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'));
}

/** Short-lived URL to open the stored file. */
export async function getDocFileUrl(path: string): Promise<string> {
  if (!isDemoMode()) return live.liveDocFileUrl(path);
  const blob = FILES.get(path);
  if (!blob) throw new Error('الملف غير متاح في الوضع التجريبي بعد إعادة التحميل');
  if (typeof URL.createObjectURL !== 'function') return path;
  return URL.createObjectURL(blob);
}

/* --------------------------------- writes --------------------------------- */
export async function createHrDocument(d: DocumentDraft, file: DocFile | null): Promise<string> {
  validDraft(d);
  checkFile(file);
  if (!isDemoMode()) {
    const stored = await storeFile(d, file);
    return live.liveCreateDocument(d, stored);
  }
  const owner = await assertWritable(d.owner_kind, d.owner_id);
  const stored = await storeFile(d, file);
  seq += 1;
  const row: Stored = {
    id: `doc-${Date.now()}-${seq}`,
    owner_kind: d.owner_kind,
    owner_id: d.owner_id,
    type: d.type,
    number: d.number.trim(),
    issue_date: d.issue_date || null,
    expiry_date: d.expiry_date || null,
    file_path: stored?.path ?? null,
    file_name: stored?.file.name ?? null,
    mime_type: stored?.file.type ?? null,
    file_size: stored?.file.size ?? null,
    renewal_cost: d.renewal_cost,
    cost_posted: false,
    notes: d.notes.trim(),
    is_active: true,
    superseded_by: null,
    created_at: new Date().toISOString(),
  };
  DOCS.unshift(row);
  audit('insert', row, owner);
  return row.id;
}

export async function updateHrDocument(
  id: string,
  d: DocumentDraft,
  file: DocFile | null,
): Promise<void> {
  validDraft(d);
  checkFile(file);
  if (!isDemoMode()) {
    const stored = await storeFile(d, file);
    return live.liveUpdateDocument(id, d, stored);
  }
  const row = DOCS.find((x) => x.id === id);
  if (!row) throw new Error('الوثيقة غير موجودة');
  if (row.owner_kind !== d.owner_kind || row.owner_id !== d.owner_id)
    throw new Error('لا يمكن نقل الوثيقة إلى شخص آخر');
  if (row.cost_posted && row.renewal_cost !== d.renewal_cost)
    throw new Error('تكلفة الوثيقة مُرحَّلة محاسبيًا ولا تُعدَّل');
  const owner = await assertWritable(row.owner_kind, row.owner_id);
  const stored = await storeFile(row, file);
  const before = { ...row };
  Object.assign(row, {
    type: d.type,
    number: d.number.trim(),
    issue_date: d.issue_date || null,
    expiry_date: d.expiry_date || null,
    renewal_cost: d.renewal_cost,
    notes: d.notes.trim(),
    ...(stored
      ? {
          file_path: stored.path,
          file_name: stored.file.name,
          mime_type: stored.file.type,
          file_size: stored.file.size,
        }
      : {}),
  });
  audit('update', row, owner, before);
}

/** «حذف» = تعطيل؛ والتفعيل يعيدها. */
export async function setHrDocumentActive(id: string, active: boolean): Promise<void> {
  if (!isDemoMode()) return live.liveSetDocumentActive(id, active);
  const row = DOCS.find((x) => x.id === id);
  if (!row) throw new Error('الوثيقة غير موجودة');
  const owner = await assertWritable(row.owner_kind, row.owner_id);
  const before = { ...row };
  row.is_active = active;
  audit('update', row, owner, before);
}

/** Renewal = new version (same owner/type), the old one archived (renew_document). */
export async function renewHrDocument(
  id: string,
  input: RenewInput,
  file: DocFile | null,
): Promise<string> {
  const err = firstIssue(renewSchema.safeParse(input));
  if (err) throw new Error(err);
  checkFile(file);
  if (!isDemoMode()) {
    const docs = await live.liveListHrDocuments();
    const doc = docs.find((x) => x.id === id);
    if (!doc) throw new Error('الوثيقة غير موجودة');
    assertRenewable(doc, input);
    const stored = await storeFile(doc, file);
    return live.liveRenewDocument(id, input, stored);
  }
  const row = DOCS.find((x) => x.id === id);
  if (!row) throw new Error('الوثيقة غير موجودة');
  const owner = await assertWritable(row.owner_kind, row.owner_id);
  assertRenewable({ ...row, owner_name: owner.name, branch: owner.branch, profession: '' }, input);
  const stored = await storeFile(row, file);
  seq += 1;
  const next: Stored = {
    ...row,
    id: `doc-${Date.now()}-${seq}`,
    number: input.number.trim() || row.number,
    issue_date: input.issue_date,
    expiry_date: input.expiry_date,
    renewal_cost: input.renewal_cost,
    cost_posted: false,
    notes: input.notes.trim(),
    file_path: stored?.path ?? null,
    file_name: stored?.file.name ?? null,
    mime_type: stored?.file.type ?? null,
    file_size: stored?.file.size ?? null,
    superseded_by: null,
    created_at: new Date().toISOString(),
  };
  DOCS.unshift(next);
  row.superseded_by = next.id;
  audit('insert', next, owner);
  return next.id;
}

/* ------------------------------- accounting -------------------------------- */
function canSeeCosts(): boolean {
  const r = role();
  return !hasProfile() || (!!r && roleCan(r, 'accounting', 'view'));
}

/** Documents carrying a renewal cost (pending first) — pending_document_costs. */
export async function listDocCosts(): Promise<DocCostRow[]> {
  if (!isDemoMode()) return live.liveListDocCosts();
  if (!canSeeCosts()) return [];
  // accounting reads amounts across branches (security definer in SQL)
  const [emps, workers] = await Promise.all([listEmployees(), listHouseWorkers()]);
  const names = new Map<string, { name: string; branch: string }>();
  emps.forEach((e) => names.set(`employee:${e.id}`, { name: e.full_name, branch: e.branch }));
  workers.forEach((w) => names.set(`worker:${w.id}`, { name: w.full_name, branch: w.branch }));
  return DOCS.filter((d) => d.renewal_cost > 0 && d.is_active)
    .map((d) => {
      const o = names.get(`${d.owner_kind}:${d.owner_id}`);
      return {
        id: d.id,
        owner_kind: d.owner_kind,
        owner_name: o?.name ?? '—',
        branch: o?.branch ?? '',
        type: d.type,
        number: d.number,
        expiry_date: d.expiry_date,
        renewal_cost: d.renewal_cost,
        posted: d.cost_posted,
        created_at: d.created_at,
      };
    })
    .sort(
      (a, b) => Number(a.posted) - Number(b.posted) || b.created_at.localeCompare(a.created_at),
    );
}

/** DR 5160 government fees / CR bank — idempotent (post_document_cost). */
export async function postDocCost(
  id: string,
  paidOn: string,
  bankCode: string,
  postEntry: (row: DocCostRow) => void,
): Promise<void> {
  if (!isDemoMode()) return live.livePostDocCost(id, paidOn, bankCode);
  const r = role();
  if (hasProfile() && (!r || !roleCan(r, 'accounting', 'edit')))
    throw new Error('ترحيل رسوم الوثائق من صلاحية المحاسبة');
  const d = DOCS.find((x) => x.id === id);
  if (!d) throw new Error('الوثيقة غير موجودة');
  if (d.cost_posted) return;
  if (d.renewal_cost <= 0) throw new Error('لا توجد تكلفة لترحيلها');
  if (!d.is_active) throw new Error('الوثيقة معطّلة');
  if (!paidOn) throw new Error('حدّد تاريخ السداد');
  if (!bankCode.startsWith('111')) throw new Error('اختر حساب بنك أو صندوق');
  const row = (await listDocCosts()).find((x) => x.id === id);
  if (!row) throw new Error('الوثيقة غير موجودة');
  postEntry(row);
  d.cost_posted = true;
}
