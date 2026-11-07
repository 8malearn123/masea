/**
 * Live (Supabase) layer for HR documents — 0074. RLS decides who sees and
 * writes what; files live in the private «hr-documents» bucket and are opened
 * through short-lived signed URLs.
 */
import { supabase } from '@/shared/lib/supabase';
import type { DocCostRow, DocFile, DocumentDraft, HrDocument } from '@/features/hr/types';
import type { RenewInput } from '@/features/hr/lib/documentsEngine';

type Row = Record<string, unknown>;
export const HR_DOCS_BUCKET = 'hr-documents';

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`تعذّر ${what}: ${error.message}`);
}
function one(v: unknown): Row | null {
  if (Array.isArray(v)) return (v[0] as Row | undefined) ?? null;
  return (v as Row | null) ?? null;
}
const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

const DOC_SELECT =
  'id, employee_id, worker_id, type, doc_number, issue_date, expiry_date, file_path, file_name, ' +
  'mime_type, file_size, renewal_cost, cost_entry_id, notes, is_active, superseded_by, created_at, ' +
  'employees(full_name, job_title, branches(city)), worker_profiles(full_name, profession, branches(city))';

export function mapDocRow(r: Row): HrDocument {
  const e = one(r.employees);
  const w = one(r.worker_profiles);
  const isEmp = r.employee_id != null;
  const owner = isEmp ? e : w;
  return {
    id: str(r.id),
    owner_kind: isEmp ? 'employee' : 'worker',
    owner_id: str(isEmp ? r.employee_id : r.worker_id),
    owner_name: str(owner?.full_name),
    branch: str(one(owner?.branches)?.city),
    profession: str(isEmp ? e?.job_title : w?.profession),
    type: str(r.type),
    number: str(r.doc_number) || str(r.file_name),
    issue_date: strOrNull(r.issue_date),
    expiry_date: strOrNull(r.expiry_date),
    file_path: strOrNull(r.file_path),
    file_name: strOrNull(r.file_name),
    mime_type: strOrNull(r.mime_type),
    file_size: numOrNull(r.file_size),
    renewal_cost: Number(r.renewal_cost ?? 0),
    cost_posted: r.cost_entry_id != null,
    notes: str(r.notes),
    is_active: r.is_active !== false,
    superseded_by: strOrNull(r.superseded_by),
    created_at: str(r.created_at),
  };
}

export async function liveListHrDocuments(): Promise<HrDocument[]> {
  const { data, error } = await supabase
    .from('employee_documents')
    .select(DOC_SELECT)
    .order('expiry_date', { ascending: true, nullsFirst: false });
  fail(error, 'تحميل الوثائق');
  return ((data ?? []) as unknown as Row[]).map(mapDocRow);
}

function ownerCols(d: Pick<DocumentDraft, 'owner_kind' | 'owner_id'>): Row {
  return d.owner_kind === 'employee'
    ? { employee_id: d.owner_id, worker_id: null }
    : { worker_id: d.owner_id, employee_id: null };
}

function fileCols(f: { path: string; file: DocFile } | null): Row {
  return f
    ? { file_path: f.path, file_name: f.file.name, mime_type: f.file.type, file_size: f.file.size }
    : {};
}

export async function liveUploadDocFile(path: string, file: DocFile): Promise<void> {
  const { error } = await supabase.storage
    .from(HR_DOCS_BUCKET)
    .upload(path, file.blob, { contentType: file.type, upsert: false });
  fail(error, 'رفع الملف');
}

export async function liveCreateDocument(
  d: DocumentDraft,
  file: { path: string; file: DocFile } | null,
): Promise<string> {
  const { data, error } = await supabase
    .from('employee_documents')
    .insert({
      ...ownerCols(d),
      type: d.type,
      doc_number: d.number.trim(),
      issue_date: d.issue_date || null,
      expiry_date: d.expiry_date || null,
      renewal_cost: d.renewal_cost,
      notes: d.notes || null,
      ...fileCols(file),
    })
    .select('id')
    .single();
  fail(error, 'حفظ الوثيقة');
  return str((data as Row).id);
}

export async function liveUpdateDocument(
  id: string,
  d: DocumentDraft,
  file: { path: string; file: DocFile } | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('employee_documents')
    .update({
      type: d.type,
      doc_number: d.number.trim(),
      issue_date: d.issue_date || null,
      expiry_date: d.expiry_date || null,
      renewal_cost: d.renewal_cost,
      notes: d.notes || null,
      ...fileCols(file),
    })
    .eq('id', id)
    .select('id');
  fail(error, 'تعديل الوثيقة');
  if (!data || (data as unknown[]).length === 0)
    throw new Error('لم تُحفظ الوثيقة — تعديل الوثائق من صلاحية إدارة الموارد البشرية');
}

export async function liveSetDocumentActive(id: string, active: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('employee_documents')
    .update({ is_active: active })
    .eq('id', id)
    .select('id');
  fail(error, active ? 'تفعيل الوثيقة' : 'تعطيل الوثيقة');
  if (!data || (data as unknown[]).length === 0)
    throw new Error('غير مصرّح — إدارة الوثائق من صلاحية الموارد البشرية');
}

export async function liveRenewDocument(
  id: string,
  r: RenewInput,
  file: { path: string; file: DocFile } | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('renew_document', {
    p_id: id,
    p_doc_number: r.number || null,
    p_issue: r.issue_date,
    p_expiry: r.expiry_date,
    p_cost: r.renewal_cost,
    p_file_path: file?.path ?? null,
    p_file_name: file?.file.name ?? null,
    p_mime_type: file?.file.type ?? null,
    p_file_size: file?.file.size ?? null,
    p_notes: r.notes || null,
  });
  if (error) throw new Error(error.message);
  return str(data);
}

export async function liveDocFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(HR_DOCS_BUCKET).createSignedUrl(path, 300);
  fail(error, 'فتح الملف');
  return str(data?.signedUrl);
}

export async function liveListDocCosts(): Promise<DocCostRow[]> {
  const { data, error } = await supabase.rpc('pending_document_costs');
  fail(error, 'تحميل رسوم الوثائق');
  const branchIds = new Set(((data ?? []) as Row[]).map((r) => str(r.branch_id)).filter(Boolean));
  const cities = new Map<string, string>();
  if (branchIds.size) {
    const { data: b } = await supabase
      .from('branches')
      .select('id, city')
      .in('id', [...branchIds]);
    ((b ?? []) as Row[]).forEach((x) => cities.set(str(x.id), str(x.city)));
  }
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    owner_kind: r.owner_kind === 'worker' ? 'worker' : 'employee',
    owner_name: str(r.owner_name),
    branch: cities.get(str(r.branch_id)) ?? '',
    type: str(r.type),
    number: str(r.doc_number),
    expiry_date: strOrNull(r.expiry_date),
    renewal_cost: Number(r.renewal_cost ?? 0),
    posted: r.cost_entry_id != null,
    created_at: str(r.created_at),
  }));
}

export async function livePostDocCost(id: string, paidOn: string, bankCode: string): Promise<void> {
  const { error } = await supabase.rpc('post_document_cost', {
    p_id: id,
    p_paid_on: paidOn,
    p_bank_code: bankCode,
  });
  if (error) throw new Error(error.message);
}
