/**
 * سجل البريد المؤسسي (0093) — سجل إداري فقط: لا اتصال بلوحة مزوّد البريد ولا كلمات مرور.
 * الوضع التجريبي: مخزن في الذاكرة بنفس القواعد (أربع أعين، لا تكرار، دومين الشركة).
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { useAuth } from '@/store/auth';

export type AccountStatus = 'requested' | 'active' | 'suspended' | 'disabled' | 'deleted';
export type AccountKind = 'person' | 'group' | 'shared';
export type RequestType =
  | 'create'
  | 'modify'
  | 'reset_password'
  | 'suspend'
  | 'disable'
  | 'delete'
  | 'group_change'
  | 'reactivate';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'done' | 'cancelled';
export type DomainStatus =
  | 'not_checked'
  | 'available'
  | 'registered_by_company'
  | 'registered_by_other'
  | 'purchased';

export interface MailAccount {
  id: string;
  address: string;
  display_name: string;
  kind: AccountKind;
  employee_id: string | null;
  status: AccountStatus;
  mfa_enabled: boolean;
  groups: string[];
  note: string | null;
  created_at: string;
}

export interface AccountRequest {
  id: string;
  request_no: string;
  request_type: RequestType;
  account_id: string | null;
  employee_name: string;
  details: {
    address?: string;
    display_name?: string;
    groups?: string[];
    mfa_enabled?: boolean;
    kind?: AccountKind;
  };
  reason: string | null;
  status: RequestStatus;
  requested_by: string | null;
  approved_by: string | null;
  executed_by: string | null;
  requested_at: string;
  decided_at: string | null;
  executed_at: string | null;
  decision_note: string | null;
  execution_note: string | null;
  /** display */
  requested_by_name?: string | null;
  approved_by_name?: string | null;
  executed_by_name?: string | null;
}

export interface MailOwnership {
  domain: string;
  domain_status: DomainStatus;
  registrar: string | null;
  registrant_name: string | null;
  registrar_account: string | null;
  provider: string | null;
  billing_owner: string | null;
  super_admin_email: string | null;
  backup_admin_email: string | null;
  mfa_enforced: boolean;
  dns_mx: boolean;
  dns_spf: boolean;
  dns_dkim: boolean;
  dns_dmarc: boolean;
  renewal_date: string | null;
  notes: string | null;
  updated_at: string;
}

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  requested: 'مطلوب — لم يُنشأ',
  active: 'نشط',
  suspended: 'موقوف مؤقتاً',
  disabled: 'معطّل',
  deleted: 'محذوف',
};
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  create: 'إنشاء حساب',
  modify: 'تعديل بيانات',
  reset_password: 'إعادة تعيين كلمة المرور',
  suspend: 'إيقاف مؤقت',
  disable: 'تعطيل (موظف مغادر)',
  delete: 'حذف بعد سياسة الاحتفاظ',
  group_change: 'تعديل المجموعات',
  reactivate: 'إعادة تفعيل',
};
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد — بانتظار التنفيذ',
  rejected: 'مرفوض',
  done: 'منفّذ',
  cancelled: 'ملغى',
};
export const DOMAIN_STATUS_LABEL: Record<DomainStatus, string> = {
  not_checked: 'لم يُفحص التوفر',
  available: 'متاح للحجز',
  registered_by_company: 'مسجّل باسم الشركة',
  registered_by_other: 'مسجّل لجهة أخرى',
  purchased: 'محجوز باسم الشركة',
};

const ADDRESS_RE = /^[a-z0-9]+([._-][a-z0-9]+)*@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const PASSWORD_RE = /pass(word)?|كلمة ?(ال)?مرور ?[:=]/i;

/* ------------------------------- demo store ------------------------------- */

const SEED: [string, string][] = [
  ['abdullah', 'Abdullah'],
  ['abdulmonem', 'Abdulmonem'],
  ['ahmed.alsayed', 'Ahmed AlSayed'],
  ['ahmed.mohamed', 'Ahmed Mohamed'],
  ['khaled.mohamed', 'Khaled Mohamed'],
  ['khaled.natej', 'Khaled Natej'],
  ['karim', 'Karim'],
  ['mohamed.abdelhamid', 'Mohamed Abdelhamid'],
  ['mohamed.dhafer', 'Mohamed Dhafer'],
  ['mohamed.omar', 'Mohamed Omar'],
  ['hamad', 'Hamad'],
  ['sameh', 'Sameh'],
  ['adel', 'Adel'],
  ['maram', 'Maram'],
  ['bdoor', 'Bdoor'],
  ['nouf', 'Nouf'],
  ['busy', 'Busy'],
  ['saja', 'Saja'],
  ['sarah', 'Sarah'],
  ['wijdan', 'Wijdan'],
  ['reem', 'Reem'],
  ['shatha', 'Shatha'],
  ['layali', 'Layali'],
  ['noura', 'Noura'],
  ['amwaj', 'Amwaj'],
  ['alanoud', 'Al Anoud'],
];

function seedAccounts(): MailAccount[] {
  return SEED.map(([local, name], i) => ({
    id: `mail-${i + 1}`,
    address: `${local}@masiatalsharq.com`,
    display_name: name,
    kind: 'person',
    employee_id: null,
    status: 'requested',
    mfa_enabled: false,
    groups: [],
    note: local === 'maram' ? 'بانتظار اعتماد التسمية: maram أو maram.almustanir' : null,
    created_at: '2026-11-23T00:00:00Z',
  }));
}
function seedRequests(accounts: MailAccount[]): AccountRequest[] {
  return accounts.map((a, i) => ({
    id: `itr-${i + 1}`,
    request_no: `IT-2026-${String(i + 1).padStart(4, '0')}`,
    request_type: 'create',
    account_id: a.id,
    employee_name: a.display_name,
    details: {
      address: a.address,
      display_name: a.display_name,
      kind: 'person',
      mfa_enabled: true,
    },
    reason: 'من قائمة الشركة المعتمدة — بانتظار اختيار مزوّد البريد وتفعيل الدومين',
    status: 'pending',
    requested_by: null,
    approved_by: null,
    executed_by: null,
    requested_at: '2026-11-23T00:00:00Z',
    decided_at: null,
    executed_at: null,
    decision_note: null,
    execution_note: null,
  }));
}
const OWNERSHIP_SEED: MailOwnership = {
  domain: 'masiatalsharq.com',
  domain_status: 'not_checked',
  registrar: null,
  registrant_name: null,
  registrar_account: null,
  provider: null,
  billing_owner: null,
  super_admin_email: null,
  backup_admin_email: null,
  mfa_enforced: false,
  dns_mx: false,
  dns_spf: false,
  dns_dkim: false,
  dns_dmarc: false,
  renewal_date: null,
  notes: null,
  updated_at: '2026-11-23T00:00:00Z',
};

let accounts = seedAccounts();
let requests = seedRequests(accounts);
let ownership: MailOwnership = { ...OWNERSHIP_SEED };
let seq = requests.length;

export function resetItAdminDemo(): void {
  accounts = seedAccounts();
  requests = seedRequests(accounts);
  ownership = { ...OWNERSHIP_SEED };
  seq = requests.length;
}

function me(): { id: string; name: string } {
  const p = useAuth.getState().profile;
  return { id: p?.id ?? 'demo-user', name: p?.full_name ?? 'مستخدم تجريبي' };
}
function fail(message: string): never {
  throw new Error(message);
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error)
    throw new Error(error.message.replace(/^.*?\bERROR:\s*/, '').trim() || 'تعذّر تنفيذ العملية');
  return data as T;
}
const nowIso = () => new Date().toISOString();

/* -------------------------------- reads ----------------------------------- */

export async function getOwnership(): Promise<MailOwnership> {
  if (isDemoMode()) return { ...ownership };
  const { data, error } = await supabase
    .from('it_mail_ownership')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(`تعذّر جلب بيانات الملكية: ${error.message}`);
  return (data as MailOwnership | null) ?? { ...OWNERSHIP_SEED };
}

export async function listAccounts(): Promise<MailAccount[]> {
  if (isDemoMode()) return accounts.map((a) => ({ ...a, groups: [...a.groups] }));
  const { data, error } = await supabase.from('it_mail_accounts').select('*').order('address');
  if (error) throw new Error(`تعذّر جلب الحسابات: ${error.message}`);
  return (data ?? []) as MailAccount[];
}

export async function listRequests(): Promise<AccountRequest[]> {
  if (isDemoMode())
    return requests
      .map((r) => ({ ...r }))
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  const { data, error } = await supabase
    .from('it_account_requests')
    .select('*')
    .order('requested_at', { ascending: false });
  if (error) throw new Error(`تعذّر جلب الطلبات: ${error.message}`);
  const rows = (data ?? []) as AccountRequest[];
  const ids = [
    ...new Set(rows.flatMap((r) => [r.requested_by, r.approved_by, r.executed_by]).filter(Boolean)),
  ] as string[];
  if (ids.length === 0) return rows;
  const { data: people } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .in('id', ids);
  const names = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));
  return rows.map((r) => ({
    ...r,
    requested_by_name: r.requested_by ? (names.get(r.requested_by) ?? null) : null,
    approved_by_name: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
    executed_by_name: r.executed_by ? (names.get(r.executed_by) ?? null) : null,
  }));
}

/* -------------------------------- writes ---------------------------------- */

export const ownershipSchema = z.object({
  domain: z.string().trim().min(3, { message: 'اكتب الدومين' }),
  domain_status: z.enum([
    'not_checked',
    'available',
    'registered_by_company',
    'registered_by_other',
    'purchased',
  ]),
  registrar: z.string().nullable(),
  registrant_name: z.string().nullable(),
  registrar_account: z.string().nullable(),
  provider: z.string().nullable(),
  billing_owner: z.string().nullable(),
  super_admin_email: z.string().nullable(),
  backup_admin_email: z.string().nullable(),
  mfa_enforced: z.boolean(),
  dns_mx: z.boolean(),
  dns_spf: z.boolean(),
  dns_dkim: z.boolean(),
  dns_dmarc: z.boolean(),
  renewal_date: z.string().nullable(),
  notes: z.string().nullable(),
});
export type OwnershipInput = z.infer<typeof ownershipSchema>;

export async function updateOwnership(input: OwnershipInput): Promise<void> {
  const p = ownershipSchema.parse(input);
  if (!isDemoMode()) {
    await rpc('update_mail_ownership', { p });
    return;
  }
  ownership = { ...ownership, ...p, updated_at: nowIso() };
}

export const requestSchema = z
  .object({
    type: z.enum([
      'create',
      'modify',
      'reset_password',
      'suspend',
      'disable',
      'delete',
      'group_change',
      'reactivate',
    ]),
    accountId: z.string().nullable(),
    employeeName: z.string().trim().min(1, { message: 'اكتب اسم الموظف' }),
    address: z.string().optional(),
    displayName: z.string().optional(),
    groups: z.array(z.string()).optional(),
    reason: z.string().optional(),
  })
  .refine((d) => d.type !== 'create' || ADDRESS_RE.test((d.address ?? '').toLowerCase()), {
    message: 'العنوان غير صحيح',
    path: ['address'],
  })
  .refine((d) => d.type === 'create' || Boolean(d.accountId), {
    message: 'اختر الحساب',
    path: ['accountId'],
  });
export type RequestInput = z.infer<typeof requestSchema>;

export async function submitRequest(input: RequestInput): Promise<void> {
  const p = requestSchema.parse(input);
  const details: AccountRequest['details'] = {};
  if (p.address) details.address = p.address.trim();
  if (p.displayName) details.display_name = p.displayName.trim();
  if (p.groups) details.groups = p.groups;
  if (p.type === 'create') {
    details.kind = 'person';
    details.mfa_enabled = true;
  }
  if (!isDemoMode()) {
    await rpc('submit_account_request', {
      p_type: p.type,
      p_account: p.accountId,
      p_employee_name: p.employeeName,
      p_details: details,
      p_reason: p.reason ?? null,
    });
    return;
  }
  if (p.type === 'create') {
    const addr = (p.address ?? '').trim().toLowerCase();
    if (!addr.endsWith(`@${ownership.domain}`))
      fail(`العنوان يجب أن يكون على دومين الشركة ${ownership.domain}`);
    if (accounts.some((a) => a.address === addr && a.status !== 'deleted'))
      fail(`العنوان ${addr} مستخدم مسبقاً — لا حسابات مكررة`);
    if (
      requests.some(
        (r) =>
          r.request_type === 'create' &&
          ['pending', 'approved'].includes(r.status) &&
          r.details.address?.toLowerCase() === addr,
      )
    ) {
      fail('يوجد طلب إنشاء قائم لهذا العنوان');
    }
  }
  seq += 1;
  const u = me();
  requests.unshift({
    id: `itr-${seq}`,
    request_no: `IT-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
    request_type: p.type,
    account_id: p.accountId,
    employee_name: p.employeeName.trim(),
    details,
    reason: p.reason?.trim() || null,
    status: 'pending',
    requested_by: u.id,
    approved_by: null,
    executed_by: null,
    requested_at: nowIso(),
    decided_at: null,
    executed_at: null,
    decision_note: null,
    execution_note: null,
    requested_by_name: u.name,
  });
}

export async function decideRequest(
  r: Pick<AccountRequest, 'id'>,
  approve: boolean,
  note?: string,
): Promise<void> {
  if (!isDemoMode()) {
    await rpc('decide_account_request', { p_id: r.id, p_approve: approve, p_note: note ?? null });
    return;
  }
  const row = requests.find((x) => x.id === r.id) ?? fail('الطلب غير موجود');
  if (row.status !== 'pending') fail('الطلب ليس معلّقاً');
  const u = me();
  if (row.requested_by === u.id)
    fail('لا يعتمد مقدّم الطلب طلبه (أربع أعين) — سجّل دخولك بحساب آخر');
  if (!approve && !note?.trim()) fail('اكتب سبب الرفض');
  Object.assign(row, {
    status: approve ? 'approved' : 'rejected',
    approved_by: u.id,
    approved_by_name: u.name,
    decided_at: nowIso(),
    decision_note: note?.trim() || null,
  });
}

export async function executeRequest(r: Pick<AccountRequest, 'id'>, note?: string): Promise<void> {
  if (note && PASSWORD_RE.test(note)) fail('لا تُسجَّل كلمات المرور في ملاحظة التنفيذ');
  if (!isDemoMode()) {
    await rpc('execute_account_request', { p_id: r.id, p_note: note ?? null });
    return;
  }
  const row = requests.find((x) => x.id === r.id) ?? fail('الطلب غير موجود');
  if (row.status !== 'approved') fail('يُنفَّذ الطلب بعد اعتماده');
  const acc = accounts.find(
    (a) => a.id === row.account_id || a.address === row.details.address?.toLowerCase(),
  );
  if (row.request_type === 'create') {
    if (acc) acc.status = 'active';
    else {
      const id = `mail-${accounts.length + 1}`;
      accounts.push({
        id,
        address: (row.details.address ?? '').toLowerCase(),
        display_name: row.details.display_name ?? row.employee_name,
        kind: row.details.kind ?? 'person',
        employee_id: null,
        status: 'active',
        mfa_enabled: row.details.mfa_enabled ?? false,
        groups: row.details.groups ?? [],
        note: null,
        created_at: nowIso(),
      });
      row.account_id = id;
    }
  } else if (acc) {
    if (row.request_type === 'suspend') acc.status = 'suspended';
    if (row.request_type === 'disable') acc.status = 'disabled';
    if (row.request_type === 'delete') acc.status = 'deleted';
    if (row.request_type === 'reactivate') acc.status = 'active';
    if (row.request_type === 'group_change' && row.details.groups) acc.groups = row.details.groups;
    if (row.request_type === 'modify' && row.details.display_name)
      acc.display_name = row.details.display_name;
  }
  const u = me();
  Object.assign(row, {
    status: 'done',
    executed_by: u.id,
    executed_by_name: u.name,
    executed_at: nowIso(),
    execution_note: note?.trim() || null,
  });
}

export async function cancelRequest(r: Pick<AccountRequest, 'id'>): Promise<void> {
  if (!isDemoMode()) {
    await rpc('cancel_account_request', { p_id: r.id });
    return;
  }
  const row = requests.find((x) => x.id === r.id) ?? fail('الطلب غير موجود');
  if (!['pending', 'approved'].includes(row.status)) fail('لا يُلغى الطلب بعد تنفيذه أو رفضه');
  row.status = 'cancelled';
}
