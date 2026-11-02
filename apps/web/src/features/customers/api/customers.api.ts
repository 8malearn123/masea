/**
 * العملاء (CRM) — فوق جدول `customers` القائم.
 * مع قاعدة البيانات: `customer_insights` (0064) يحسب المؤشرات من العقود
 * والمدفوعات وسجل التواصل، وRLS تقصر كل دور على فرعه. في الوضع التجريبي تُحسب
 * المؤشرات بنفس القاعدة من مخزن العقود نفسه — لا أرقام مكتوبة باليد.
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { useAuth } from '@/store/auth';
import { scopeToViewerBranch, viewerScope } from '@/lib/branchScope';
import { recordAudit } from '@/shared/lib/auditTrail';
import { listContracts } from '@/features/contracts/api/contracts.api';
import type { ContractListItem } from '@/features/contracts/types';
import { contractIsSold } from '@/features/sales/api/sales.api';
import type {
  CustomerInput,
  CustomerInsight,
  CustomerInteraction,
  CustomerRecord,
  InteractionKind,
} from '@/features/customers/types';

const RUNNING = new Set(['signed', 'active', 'musaned_signed']);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/* --------------------------- demo directory -------------------------------- */
// The customers of the demo contracts (same ids) + customers who did not buy yet.
const DEMO_CUSTOMERS: CustomerRecord[] = [
  ['cust-00001', 'محمد الأحمدي', '0501234567', 'نجران', '2025-02-20T09:00:00Z'],
  ['cust-00002', 'سارة القحطاني', '0552345678', 'جازان', '2026-01-28T09:00:00Z'],
  ['cust-00003', 'فهد العنزي', '0533456789', 'شرورة', '2026-02-03T09:00:00Z'],
  ['cust-00004', 'نورة الشهري', '0544567890', 'نجران', '2025-04-15T09:00:00Z'],
  ['cust-00005', 'عبدالله الدوسري', '0505566778', 'حبونا', '2025-11-20T09:00:00Z'],
  ['cust-00006', 'ريم المالكي', '0566778899', 'جازان', '2026-01-12T09:00:00Z'],
  ['cust-00007', 'عبدالعزيز اليامي', '0577889900', 'شرورة', '2026-02-25T09:00:00Z'],
  ['cust-00008', 'هيا آل مفرح', '0588990011', 'جازان', '2026-06-01T09:00:00Z'],
  ['cust-00009', 'مشعل الصيعري', '0599001122', 'نجران', '2025-06-01T09:00:00Z'],
  ['cust-n1', 'ماجد آل سالم', '0551122334', 'جازان', daysAgo(10)],
  ['cust-n2', 'أمل القحطاني', '0552233445', 'نجران', daysAgo(120)],
].map(([id, full_name, phone, branch, created_at]) => ({
  id: id as string,
  full_name: full_name as string,
  phone: phone as string,
  national_id: null,
  city: branch as string,
  email: null,
  vat_number: null,
  address: null,
  branch: branch as string,
  is_active: true,
  created_at: created_at as string,
}));

const DEMO_INTERACTIONS: CustomerInteraction[] = [
  {
    id: 'ci-1',
    customer_id: 'cust-00004',
    kind: 'call',
    note: 'تذكير بقرب انتهاء عقد التأجير وعرض التجديد',
    follow_up_at: null,
    done: true,
    created_at: daysAgo(3),
    created_by_name: 'نايف اليامي',
  },
  {
    id: 'ci-2',
    customer_id: 'cust-00001',
    kind: 'whatsapp',
    note: 'إرسال تحديث مرحلة التأشيرة',
    follow_up_at: null,
    done: true,
    created_at: daysAgo(12),
    created_by_name: 'نايف اليامي',
  },
  {
    id: 'ci-3',
    customer_id: 'cust-00008',
    kind: 'note',
    note: 'العميلة تفضّل التواصل مساءً',
    follow_up_at: null,
    done: true,
    created_at: daysAgo(30),
    created_by_name: 'ريم الشهري',
  },
];
let seq = 0;

/** Demo directory = the seed + every customer that appears on a demo contract. */
function demoDirectory(contracts: ContractListItem[]): CustomerRecord[] {
  const all = [...DEMO_CUSTOMERS];
  for (const c of contracts) {
    if (!all.some((x) => x.id === c.customer_id)) {
      all.push({
        id: c.customer_id,
        full_name: c.customer_name ?? 'عميل',
        phone: '',
        national_id: null,
        city: c.branch_id,
        email: null,
        vat_number: null,
        address: null,
        branch: c.branch_id,
        is_active: true,
        created_at: c.created_at,
      });
    }
  }
  return all;
}

const soldAt = (c: ContractListItem) =>
  c.signed_at ?? (c.start_date ? `${c.start_date}T09:00:00Z` : c.created_at);

export function insightFor(
  cu: CustomerRecord,
  contracts: ContractListItem[],
  interactions: CustomerInteraction[],
  now = new Date(),
): CustomerInsight {
  const mine = contracts.filter((c) => c.customer_id === cu.id);
  const sold = mine.filter((c) => contractIsSold(c.status));
  const day = now.toISOString().slice(0, 10);
  const running = mine.filter((c) => RUNNING.has(c.status) && (!c.end_date || c.end_date >= day));
  const purchaseDates = sold.map(soldAt).sort();
  const contacts = interactions
    .filter((i) => i.customer_id === cu.id)
    .map((i) => i.created_at)
    .sort();
  const last = purchaseDates.at(-1) ?? null;
  const lastContact = contacts.at(-1) ?? null;
  const diff = (iso: string | null) =>
    iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000) : null;
  const ends = running
    .map((c) => c.end_date)
    .filter((d): d is string => !!d)
    .sort();
  return {
    id: cu.id,
    full_name: cu.full_name,
    phone: cu.phone || null,
    city: cu.city,
    branch: cu.branch,
    created_at: cu.created_at,
    is_active: cu.is_active,
    contracts_count: mine.length,
    purchases: sold.length,
    first_purchase_at: purchaseDates[0] ?? null,
    last_purchase_at: last,
    sales_value: Math.round(sold.reduce((s, c) => s + c.base_amount, 0) * 100) / 100,
    total_paid: Math.round(mine.reduce((s, c) => s + c.amount_paid, 0) * 100) / 100,
    active_contracts: running.length,
    next_end_date: ends[0] ?? null,
    last_end_date:
      sold
        .map((c) => c.end_date)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null,
    last_contact_at: lastContact,
    days_since_purchase: diff(last),
    days_since_contact: diff(lastContact),
  };
}

const ALL_CONTRACTS = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

async function branchNames(): Promise<Map<string, string>> {
  const { data } = await supabase.from('branches').select('id, city');
  return new Map(
    ((data ?? []) as { id: string; city: string | null }[]).map((b) => [b.id, b.city ?? '']),
  );
}

/* --------------------------------- queries --------------------------------- */
export async function listCustomerInsights(): Promise<CustomerInsight[]> {
  if (isDemoMode()) {
    const contracts = await listContracts(ALL_CONTRACTS);
    return scopeToViewerBranch(demoDirectory(contracts), (c) => c.branch)
      .map((cu) => insightFor(cu, contracts, DEMO_INTERACTIONS))
      .sort((a, b) =>
        (b.last_purchase_at ?? b.created_at).localeCompare(a.last_purchase_at ?? a.created_at),
      );
  }
  const [{ data, error }, names] = await Promise.all([
    supabase.from('customer_insights').select('*').order('created_at', { ascending: false }),
    branchNames(),
  ]);
  if (error) throw new Error(`تعذّر جلب العملاء: ${error.message}`);
  return ((data ?? []) as (Omit<CustomerInsight, 'branch'> & { branch_id: string | null })[]).map(
    ({ branch_id, ...r }) => ({
      ...r,
      branch: branch_id ? (names.get(branch_id) ?? null) : null,
      sales_value: Number(r.sales_value),
      total_paid: Number(r.total_paid),
    }),
  );
}

export async function getCustomer(id: string): Promise<CustomerRecord | null> {
  if (isDemoMode() || isDemoId(id)) {
    const contracts = await listContracts(ALL_CONTRACTS);
    const scoped = scopeToViewerBranch(demoDirectory(contracts), (c) => c.branch);
    return scoped.find((c) => c.id === id) ?? null;
  }
  const [{ data, error }, names] = await Promise.all([
    supabase
      .from('customers')
      .select(
        'id, full_name, phone, national_id, city, email, vat_number, address, branch_id, is_active, created_at',
      )
      .eq('id', id)
      .maybeSingle(),
    branchNames(),
  ]);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { branch_id, ...rest } = data as CustomerRecord & { branch_id: string | null };
  return { ...rest, branch: branch_id ? (names.get(branch_id) ?? null) : null };
}

/** Contracts of the customer (newest first) — the profile's history. */
export async function customerContracts(id: string): Promise<ContractListItem[]> {
  const contracts = await listContracts(ALL_CONTRACTS);
  return contracts
    .filter((c) => c.customer_id === id)
    .sort((a, b) => soldAt(b).localeCompare(soldAt(a)));
}

/* --------------------------------- writes ---------------------------------- */
export const customerInputSchema = z.object({
  full_name: z.string().trim().min(3, { message: 'أدخل اسم العميل كاملاً' }),
  phone: z
    .string()
    .trim()
    .regex(/^05\d{8}$/, { message: 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام' }),
  national_id: z
    .string()
    .trim()
    .regex(/^[12]\d{9}$/, { message: 'رقم الهوية/الإقامة 10 أرقام يبدأ بـ 1 أو 2' })
    .nullable(),
  city: z.string().trim().nullable(),
  email: z.string().trim().email({ message: 'البريد الإلكتروني غير صحيح' }).nullable(),
  vat_number: z
    .string()
    .trim()
    .regex(/^3\d{13}3$/, { message: 'الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3' })
    .nullable(),
  address: z.string().trim().nullable(),
  branch: z.string().trim().min(1, { message: 'اختر الفرع' }).nullable(),
});

const blankToNull = (v: string | null) => (v && v.trim() ? v.trim() : null);

export function parseCustomerInput(raw: CustomerInput): CustomerInput {
  const cleaned: CustomerInput = {
    full_name: raw.full_name,
    phone: raw.phone,
    national_id: blankToNull(raw.national_id),
    city: blankToNull(raw.city),
    email: blankToNull(raw.email),
    vat_number: blankToNull(raw.vat_number),
    address: blankToNull(raw.address),
    branch: blankToNull(raw.branch),
  };
  const parsed = customerInputSchema.safeParse(cleaned);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'بيانات العميل غير صحيحة');
  return parsed.data;
}

async function branchIdOf(name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data } = await supabase.from('branches').select('id').eq('city', name).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function saveCustomer(raw: CustomerInput, id?: string): Promise<CustomerRecord> {
  const input = parseCustomerInput(raw);
  // a branch role always writes into its own branch (same rule as set_default_branch)
  const scope = viewerScope();
  const branch = scope.crossBranch ? input.branch : (scope.branch ?? input.branch);
  if (isDemoMode() || (id && isDemoId(id))) {
    const contracts = await listContracts(ALL_CONTRACTS);
    const existing = id ? demoDirectory(contracts).find((c) => c.id === id) : undefined;
    if (id && !existing) throw new Error('العميل غير موجود أو خارج نطاق فرعك');
    if (existing && !scope.crossBranch && existing.branch !== scope.branch)
      throw new Error('العميل خارج نطاق فرعك');
    const row: CustomerRecord = existing
      ? { ...existing, ...input, branch: scope.crossBranch ? branch : existing.branch }
      : {
          ...input,
          branch,
          id: `cust-${Date.now()}-${++seq}`,
          is_active: true,
          created_at: new Date().toISOString(),
        };
    const idx = DEMO_CUSTOMERS.findIndex((c) => c.id === row.id);
    if (idx >= 0) DEMO_CUSTOMERS[idx] = row;
    else DEMO_CUSTOMERS.unshift(row);
    recordAudit({
      action: existing ? 'update' : 'insert',
      entity: 'customers',
      record_ref: row.full_name,
      old_data: existing ? { phone: existing.phone, city: existing.city } : null,
      new_data: { phone: row.phone, city: row.city },
      branch: row.branch,
    });
    return row;
  }
  const { branch: _b, ...cols } = input;
  void _b;
  const payload = { ...cols, branch_id: await branchIdOf(branch) };
  const q = id
    ? supabase.from('customers').update(payload).eq('id', id)
    : supabase.from('customers').insert(payload);
  const { data, error } = await q
    .select(
      'id, full_name, phone, national_id, city, email, vat_number, address, is_active, created_at',
    )
    .single();
  if (error) throw new Error(`تعذّر حفظ العميل: ${error.message}`);
  return { ...(data as Omit<CustomerRecord, 'branch'>), branch };
}

/** Delete = disable (soft delete); a disabled customer can be re-enabled. */
export async function setCustomerActive(id: string, active: boolean): Promise<void> {
  if (isDemoMode() || isDemoId(id)) {
    const contracts = await listContracts(ALL_CONTRACTS);
    const row = demoDirectory(contracts).find((c) => c.id === id);
    if (!row) throw new Error('العميل غير موجود');
    const updated = { ...row, is_active: active };
    const idx = DEMO_CUSTOMERS.findIndex((c) => c.id === id);
    if (idx >= 0) DEMO_CUSTOMERS[idx] = updated;
    else DEMO_CUSTOMERS.push(updated);
    recordAudit({
      action: 'update',
      entity: 'customers',
      record_ref: row.full_name,
      old_data: { is_active: !active },
      new_data: { is_active: active },
      branch: row.branch,
    });
    return;
  }
  const { error } = await supabase.from('customers').update({ is_active: active }).eq('id', id);
  if (error) throw new Error(`تعذّر تحديث حالة العميل: ${error.message}`);
}

/* ---------------------------- contact log ----------------------------------- */
export async function listInteractions(customerId: string): Promise<CustomerInteraction[]> {
  if (isDemoMode() || isDemoId(customerId)) {
    return DEMO_INTERACTIONS.filter((i) => i.customer_id === customerId).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }
  const { data, error } = await supabase
    .from('lead_activities')
    .select('id, customer_id, kind, note, follow_up_at, done, created_at, created_by')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as (Omit<CustomerInteraction, 'created_by_name'> & {
    created_by: string | null;
  })[];
  const ids = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x))];
  const { data: people } = ids.length
    ? await supabase.from('user_profiles').select('id, full_name').in('id', ids)
    : { data: [] };
  const name = new Map(
    ((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]),
  );
  return rows.map(({ created_by, ...r }) => ({
    ...r,
    created_by_name: created_by ? (name.get(created_by) ?? null) : null,
  }));
}

export async function addInteraction(input: {
  customer_id: string;
  kind: InteractionKind;
  note: string | null;
  follow_up_at: string | null;
}): Promise<void> {
  if (!input.note?.trim() && !input.follow_up_at)
    throw new Error('اكتب ملاحظة أو حدّد موعد متابعة');
  if (isDemoMode() || isDemoId(input.customer_id)) {
    DEMO_INTERACTIONS.unshift({
      id: `ci-${Date.now()}-${++seq}`,
      ...input,
      note: input.note?.trim() || null,
      done: false,
      created_at: new Date().toISOString(),
      created_by_name: useAuth.getState().profile?.full_name ?? null,
    });
    return;
  }
  const { error } = await supabase
    .from('lead_activities')
    .insert({ ...input, note: input.note?.trim() || null });
  if (error) throw new Error(`تعذّر تسجيل التواصل: ${error.message}`);
}
