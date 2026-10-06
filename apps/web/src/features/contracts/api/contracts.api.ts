import { supabase } from '@/shared/lib/supabase';
import { useAuth } from '@/store/auth';
import { loadDemo } from '@/lib/demo';
import { ROLE_META, roleCan, type RoleCode } from '@/lib/permissions';
import { isDemoId, isDemoMode, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { fallbackPrice } from '@/shared/lib/pricing';
import { formatContractNo } from '@/features/contracts/lib/contractNo';
import { addDays, addMonths, computeEndDate } from '@/features/requests/lib/period';
import type { PeriodUnit } from '@/features/requests/types';
import { DEFAULT_SERVICE_ORIGIN } from '@/features/contracts/lib/contractOrigin';
import {
  nextVersion,
  renewalRuleError,
  renewalTerm,
  renewClauseBody,
} from '@/features/contracts/lib/contractRenewal';
import {
  contractTermSchema,
  type ContractTerm,
} from '@/features/contracts/schemas/contract.schema';
import type {
  Contract,
  ContractClause,
  ContractFilters,
  ContractListItem,
  ContractServiceCode,
  ContractSignature,
  ContractStatus,
  ContractStatusHistory,
  ContractTemplate,
  CreateContractInput,
} from '@/features/contracts/types';

/** Identity + signature payload captured when signing a contract. */
export interface SignPayload {
  customer: string; // customer signature (data URL)
  company: string; // company signature (data URL)
  customerName: string;
  nationalId: string;
  ipAddress: string | null;
}

/* --------------------------- offline fallback ---------------------------- */
function mk(o: {
  id: string;
  contract_no: string;
  service_code: ContractServiceCode;
  status: ContractStatus;
  base_amount: number;
  amount_paid?: number;
  customer_name: string;
  branch: string;
  start_date: string;
  end_date?: string | null;
  signed_at?: string | null;
  musaned_contract_no?: string | null;
  assigned_office_id?: string | null;
  assigned_at?: string | null;
  recruitment_stage?: string | null;
  visa_number?: string | null;
  expected_arrival_date?: string | null;
  flight_no?: string | null;
}): ContractListItem {
  const vat = Math.round(o.base_amount * 0.15 * 100) / 100;
  const total = o.base_amount + vat;
  return {
    id: o.id,
    contract_no: o.contract_no,
    service_code: o.service_code,
    template_id: null,
    customer_id: `cust-${o.id}`,
    worker_id: null,
    branch_id: o.branch,
    created_by: null,
    start_date: o.start_date,
    end_date: o.end_date ?? null,
    base_amount: o.base_amount,
    vat_amount: vat,
    total_amount: total,
    amount_paid: o.amount_paid ?? total,
    status: o.status,
    version: 1,
    parent_contract_id: null,
    signed_at: o.signed_at ?? null,
    musaned_contract_no: o.musaned_contract_no ?? null,
    created_at: `${o.start_date}T09:00:00Z`,
    customer_name: o.customer_name,
    worker_name: null,
    assigned_office_id: o.assigned_office_id ?? null,
    assigned_at: o.assigned_at ?? null,
    recruitment_stage: o.recruitment_stage ?? null,
    visa_number: o.visa_number ?? null,
    expected_arrival_date: o.expected_arrival_date ?? null,
    flight_no: o.flight_no ?? null,
  };
}

/** The demo external-office account id (mirrors demoProfile id for that role). */
export const DEMO_OFFICE_ID = 'demo-external_office';

/**
 * تاريخ نسبةً لليوم (yyyy-mm-dd) — تواريخ نهاية العقود التجريبية محسوبة نسبيًا
 * حتى تبقى تنبيهات الانتهاء حيّة مهما طال الوقت على بيانات العرض.
 */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * بداية مدة (n أشهر/أيام) تنتهي بعد `endOffset` يومًا من اليوم — حتى تكون تواريخ
 * عقود العرض النشطة مدة كاملة متّسقة (تُحسب مدتها ويمكن تجديدها) مهما طال الوقت.
 */
function termStart(endOffset: number, unit: PeriodUnit, n: number): string {
  const end = inDays(endOffset);
  const naive = unit === 'day' ? addDays(end, -(n - 1)) : addMonths(addDays(end, 1), -n);
  for (const shift of [0, -1, 1, -2, 2, -3, 3]) {
    const start = addDays(naive, shift);
    if (computeEndDate(start, unit, n) === end) return start;
  }
  return naive;
}

/** Demo-only: mutate a fallback contract in place so offline writes are visible. */
export function demoMutateContract(id: string, patch: Partial<ContractListItem>): boolean {
  const row = FALLBACK.find((c) => c.id === id);
  if (!row) return false;
  Object.assign(row, patch);
  return true;
}

const FALLBACK: ContractListItem[] = [
  mk({
    id: '00001',
    contract_no: 'MAS-2026-00001',
    service_code: 'recruitment',
    status: 'musaned_created',
    base_amount: 16000,
    customer_name: 'محمد الأحمدي',
    branch: 'نجران',
    start_date: '2026-02-01',
    musaned_contract_no: '4062118045',
    assigned_office_id: DEMO_OFFICE_ID,
    assigned_at: '2026-02-02T09:00:00Z',
    recruitment_stage: 'office_contract',
  }),
  mk({
    id: '00002',
    contract_no: 'MAS-2026-00002',
    service_code: 'monthly_rental',
    status: 'pending_approval',
    base_amount: 7500,
    amount_paid: 2875,
    customer_name: 'سارة القحطاني',
    branch: 'جازان',
    start_date: '2026-02-05',
    end_date: inDays(95),
  }),
  mk({
    id: '00003',
    contract_no: 'MAS-2026-00003',
    service_code: 'daily_rental',
    status: 'approved',
    base_amount: 540,
    customer_name: 'فهد العنزي',
    branch: 'شرورة',
    start_date: '2026-02-10',
  }),
  mk({
    id: '00004',
    contract_no: 'MAS-2026-00004',
    service_code: 'recruitment',
    status: 'active',
    base_amount: 14000,
    amount_paid: 8050,
    customer_name: 'نورة الشهري',
    branch: 'نجران',
    start_date: '2026-01-10',
    end_date: inDays(11),
    signed_at: '2026-01-12T08:00:00Z',
    musaned_contract_no: '4059930127',
    assigned_office_id: DEMO_OFFICE_ID,
    assigned_at: '2026-01-13T09:00:00Z',
    recruitment_stage: 'handover',
  }),
  mk({
    id: '00007',
    contract_no: 'MAS-2026-00007',
    service_code: 'recruitment',
    status: 'musaned_signed',
    base_amount: 15500,
    amount_paid: 5000,
    customer_name: 'عبدالعزيز اليامي',
    branch: 'شرورة',
    start_date: '2026-03-02',
    signed_at: '2026-03-04T10:00:00Z',
    musaned_contract_no: '4061207781',
    assigned_office_id: DEMO_OFFICE_ID,
    assigned_at: '2026-03-03T10:00:00Z',
    recruitment_stage: 'medical_exam',
  }),
  mk({
    id: '00008',
    contract_no: 'MAS-2026-00008',
    service_code: 'monthly_rental',
    status: 'active',
    base_amount: 9000,
    amount_paid: 9000,
    customer_name: 'هيا آل مفرح',
    branch: 'جازان',
    start_date: termStart(4, 'month', 3),
    end_date: inDays(4),
    signed_at: `${termStart(4, 'month', 3)}T11:00:00Z`,
  }),
  mk({
    id: '00009',
    contract_no: 'MAS-2026-00009',
    service_code: 'monthly_rental',
    status: 'active',
    base_amount: 6600,
    amount_paid: 4400,
    customer_name: 'مشعل الصيعري',
    branch: 'نجران',
    start_date: termStart(-6, 'month', 3),
    end_date: inDays(-6),
    signed_at: `${termStart(-6, 'month', 3)}T09:30:00Z`,
  }),
  mk({
    id: '00005',
    contract_no: 'MAS-2026-00005',
    service_code: 'sponsorship_transfer',
    status: 'completed',
    base_amount: 2000,
    customer_name: 'عبدالله الدوسري',
    branch: 'حبونا',
    start_date: '2025-12-01',
    musaned_contract_no: '4058842100',
  }),
  mk({
    id: '00006',
    contract_no: 'MAS-2026-00006',
    service_code: 'monthly_rental',
    status: 'cancelled',
    base_amount: 6600,
    customer_name: 'ريم المالكي',
    branch: 'جازان',
    start_date: '2026-01-20',
  }),
];

// Musaned contracts (استقدام/نقل كفالة) carry no in-system clauses — the paperwork
// lives on منصة مساند. Internal (rental) drafts get their clause snapshot on creation.
const FALLBACK_CLAUSES: Record<string, ContractClause[]> = {};

// Musaned contracts are signed on مساند, not in-system, so no signature trail here.
const FALLBACK_HISTORY: Record<string, ContractStatusHistory[]> = {};

/** Demo signature records — the evidentiary trail for in-system signed contracts. */
const FALLBACK_SIGNATURES: Record<string, ContractSignature[]> = {};

/** Forward lifecycle paths per origin — used to synthesize a plausible status
 *  history for demo contracts that have no explicit trail. */
const INTERNAL_STATUS_PATH: ContractStatus[] = [
  'draft',
  'pending_approval',
  'approved',
  'awaiting_signature',
  'signed',
  'active',
  'completed',
];
const MUSANED_STATUS_PATH: ContractStatus[] = [
  'draft',
  'musaned_created',
  'musaned_signed',
  'active',
  'completed',
];

function synthHistory(c: ContractListItem): ContractStatusHistory[] {
  const base = new Date(c.created_at).getTime();
  const at = (i: number) => new Date(base + i * 3_600_000).toISOString();
  const origin = DEFAULT_SERVICE_ORIGIN[c.service_code ?? 'monthly_rental'] ?? 'internal';
  const STATUS_PATH = origin === 'musaned' ? MUSANED_STATUS_PATH : INTERNAL_STATUS_PATH;
  if (c.status === 'cancelled') {
    return [
      {
        id: `h-${c.id}-0`,
        contract_id: c.id,
        from_status: null,
        to_status: 'draft',
        changed_by: null,
        created_at: at(0),
      },
      {
        id: `h-${c.id}-1`,
        contract_id: c.id,
        from_status: 'draft',
        to_status: 'cancelled',
        changed_by: null,
        created_at: at(1),
      },
    ];
  }
  const idx = STATUS_PATH.indexOf(c.status);
  const steps = idx < 0 ? ['draft'] : STATUS_PATH.slice(0, idx + 1);
  return steps.map((to, i) => ({
    id: `h-${c.id}-${i}`,
    contract_id: c.id,
    from_status: i ? (steps[i - 1] ?? null) : null,
    to_status: to,
    changed_by: null,
    created_at: at(i),
  }));
}

const FALLBACK_TEMPLATES: ContractTemplate[] = [
  {
    id: 't-rec-full',
    service_code: 'recruitment',
    name: 'عقد استقدام — شامل',
    is_active: true,
    clauses: [
      'أُبرم هذا العقد بين شركة ماسية الشرق للاستقدام (الطرف الأول) والعميل {{customer_name}} (الطرف الثاني)، وكلاهما بكامل الأهلية المعتبرة شرعاً ونظاماً.',
      'يلتزم الطرف الأول باستقدام عاملة منزلية من جنسية {{nationality}} لمهنة {{profession}} لصالح الطرف الثاني وفق أنظمة وزارة الموارد البشرية والتنمية الاجتماعية.',
      'مدة العقد {{duration}} شهراً تبدأ من تاريخ {{start_date}}، ولا تُجدَّد إلا باتفاق كتابي بين الطرفين.',
      'إجمالي رسوم الاستقدام {{total}} ريال سعودي شاملة ضريبة القيمة المضافة (15%)، وتُسدَّد وفق جدول الدفعات المعتمد.',
      'يمنح الطرف الأول فترة ضمان (استبدال) مدتها تسعون (90) يوماً من تاريخ استلام العاملة، يحق خلالها للطرف الثاني طلب الاستبدال وفق ضوابط منصة مساند.',
      'يلتزم الطرف الأول بإنهاء إجراءات التأشيرة والفحص الطبي والتصديق والسفر خلال المدة النظامية، وإشعار الطرف الثاني بمستجدات الطلب أولاً بأول.',
      'يلتزم الطرف الثاني بتوفير سكن ومعيشة لائقة للعاملة، وصرف أجرها في موعده، وعدم تكليفها بغير العمل المتفق عليه أو لدى غيره.',
      'لا يجوز لأي من الطرفين التنازل عن هذا العقد للغير إلا بموافقة كتابية مسبقة من الطرف الآخر.',
      'يحق لأي من الطرفين فسخ العقد عند إخلال الطرف الآخر بالتزاماته الجوهرية بعد إشعاره كتابةً ومنحه مهلة معقولة لتصحيح الإخلال.',
      'لا يُسأل أي طرف عن إخلال ناتج عن قوة قاهرة خارجة عن إرادته وفق ما تقرره الأنظمة المرعية.',
      'يخضع هذا العقد وتفسيره لأنظمة المملكة العربية السعودية، وتختص المحاكم العمالية بالنظر في أي نزاع ينشأ عنه.',
      'حُرِّر هذا العقد واعتُمد إلكترونياً عبر النظام، ولكل طرف نسخة منه للعمل بموجبها.',
    ],
  },
  {
    id: 't-rec-lite',
    service_code: 'recruitment',
    name: 'عقد استقدام — مختصر',
    is_active: true,
    clauses: [
      'يلتزم الطرف الأول (ماسية الشرق للاستقدام) باستقدام عاملة من جنسية {{nationality}} لمهنة {{profession}} لصالح الطرف الثاني {{customer_name}}.',
      'مدة العقد {{duration}} شهراً تبدأ من تاريخ {{start_date}}.',
      'إجمالي رسوم الاستقدام {{total}} ريال سعودي شاملة ضريبة القيمة المضافة (15%)، تُسدَّد وفق الجدول المتفق عليه.',
      'فترة الاستبدال تسعون (90) يوماً من تاريخ الاستلام وفق ضوابط منصة مساند.',
      'يخضع هذا العقد لأنظمة وزارة الموارد البشرية والتنمية الاجتماعية ومنصة مساند.',
    ],
  },
  {
    id: 't-month-full',
    service_code: 'monthly_rental',
    name: 'تأجير شهري — شامل',
    is_active: true,
    clauses: [
      'أُبرم هذا العقد بين شركة ماسية الشرق للاستقدام (الطرف الأول) والعميل {{customer_name}} (الطرف الثاني).',
      'يؤجّر الطرف الأول للطرف الثاني خدمات عاملة منزلية من جنسية {{nationality}} لمهنة {{profession}} بنظام التأجير الشهري.',
      'قيمة الإيجار الشهري {{monthly}} ريال، ومدة العقد {{duration}} أشهر تبدأ من {{start_date}}.',
      'الإجمالي {{total}} ريال شامل ضريبة القيمة المضافة (15%)، ويُسدَّد الإيجار مقدماً في بداية كل شهر.',
      'يلتزم الطرف الأول بتوفير عاملة مؤهلة، وباستبدالها خلال ثلاثة (3) أيام عمل حال ثبوت عدم كفاءتها.',
      'يلتزم الطرف الثاني بتوفير سكن ومعيشة لائقة للعاملة طوال مدة التأجير، وعدم إسناد أعمال خارج نطاق الخدمة المنزلية.',
      'يُجدَّد العقد تلقائياً لمدة مماثلة ما لم يُشعر أحد الطرفين الآخر كتابةً برغبته في عدم التجديد قبل انتهائه بسبعة (7) أيام.',
      'يحق للطرف الأول إيقاف الخدمة عند تأخر السداد عن موعده بعد إشعار الطرف الثاني.',
      'يخضع العقد لأنظمة وزارة الموارد البشرية والتنمية الاجتماعية، وتختص المحاكم العمالية بأي نزاع.',
    ],
  },
  {
    id: 't-month-lite',
    service_code: 'monthly_rental',
    name: 'تأجير شهري — مختصر',
    is_active: true,
    clauses: [
      'يؤجّر الطرف الأول للطرف الثاني {{customer_name}} خدمات عاملة منزلية بنظام التأجير الشهري.',
      'قيمة الإيجار الشهري {{monthly}} ريال، ومدة العقد {{duration}} أشهر تبدأ من {{start_date}}.',
      'الإجمالي {{total}} ريال شامل ضريبة القيمة المضافة (15%).',
      'يُجدَّد العقد تلقائياً ما لم يُشعر أحد الطرفين بخلاف ذلك قبل انتهائه بسبعة (7) أيام.',
    ],
  },
  {
    id: 't-daily',
    service_code: 'daily_rental',
    name: 'تأجير يومي — قياسي',
    is_active: true,
    clauses: [
      'يقدّم الطرف الأول للطرف الثاني {{customer_name}} خدمة منزلية ({{task}}) بنظام التأجير اليومي.',
      'عدد الأيام {{days}} تبدأ من {{start_date}}، بقيمة إجمالية {{total}} ريال شاملة ضريبة القيمة المضافة (15%).',
      'يلتزم الطرف الأول بتوفير عاملة مؤهلة ومناسبة لطبيعة المهمة المتفق عليها.',
      'يلتزم الطرف الثاني بتأمين وسيلة الوصول ومستلزمات العمل وبيئة آمنة ولائقة أثناء تنفيذ الخدمة.',
      'تُسدَّد القيمة كاملةً قبل مباشرة الخدمة ما لم يُتفق كتابةً على خلاف ذلك.',
      'في حال إلغاء الخدمة قبل موعدها بأقل من أربعٍ وعشرين (24) ساعة تُطبَّق سياسة الإلغاء المعتمدة لدى الطرف الأول.',
    ],
  },
  {
    id: 't-transfer',
    service_code: 'sponsorship_transfer',
    name: 'نقل كفالة — قياسي',
    is_active: true,
    clauses: [
      'ينظّم هذا العقد نقل كفالة العاملة من جنسية {{nationality}} لصالح الطرف الثاني {{customer_name}}.',
      'رسوم نقل الكفالة {{total}} ريال شاملة ضريبة القيمة المضافة (15%).',
      'تتم إجراءات النقل عبر منصتي مساند وأبشر ووفق ضوابط وزارة الموارد البشرية والتنمية الاجتماعية.',
      'يقرّ الطرف الثاني باطلاعه على الوضع النظامي والمهني للعاملة قبل إتمام النقل وقبوله به.',
      'يلتزم الطرف الأول باستكمال إجراءات النقل النظامية خلال المدة المحددة وإشعار الطرف الثاني بإتمامها.',
      'بعد إتمام النقل تنتقل كامل التزامات صاحب العمل النظامية تجاه العاملة إلى الطرف الثاني.',
      'تختص الجهات المختصة في المملكة بالنظر في أي نزاع ينشأ عن تنفيذ هذا العقد.',
    ],
  },
];

function applyFilters(rows: ContractListItem[], f: ContractFilters): ContractListItem[] {
  return rows.filter((r) => {
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.service !== 'all' && r.service_code !== f.service) return false;
    if (f.branch !== 'all' && r.branch_id !== f.branch) return false;
    if (f.search.trim()) {
      const q = f.search.trim();
      const hay = `${r.contract_no ?? ''} ${r.customer_name ?? ''}`;
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

interface RawRow extends Contract {
  customers: { full_name: string | null } | null;
}

/**
 * The external office must only ever see contracts assigned to its own account.
 * The backend enforces this in RLS; in demo mode (no Supabase) we mirror it here
 * so the offline experience matches the secured one.
 *
 * Branch scope (RLS contracts_read): a role that is not cross-branch sees only
 * its own branch's contracts (plus unassigned ones). With a real backend RLS does
 * this; in demo mode it is mirrored here from the demo account's branch, and an
 * unknown branch sees no branch-assigned contracts (deny by default).
 */
function scopeForViewer(rows: ContractListItem[]): ContractListItem[] {
  const profile = useAuth.getState().profile;
  if (!profile) return rows;
  if (profile.role === 'external_office') {
    return rows.filter((r) => r.assigned_office_id === profile.id);
  }
  const crossBranch = ROLE_META[profile.role as RoleCode]?.crossBranch ?? false;
  if (isDemoMode() && !crossBranch) {
    const branch = loadDemo()?.branch ?? null;
    return rows.filter((r) => r.branch_id === null || (branch !== null && r.branch_id === branch));
  }
  return rows;
}

/* ------------------------------- queries --------------------------------- */
/**
 * قائمة العقود. الوضع التجريبي يعرض بيانات العرض (نُسخ لا مراجع). مع قاعدة
 * بيانات فعلية تُعرض صفوفها فقط — حتى لو كانت فارغة — ويُرمى أي خطأ جلب، فلا
 * تظهر عقود تجريبية على أنها حقيقية.
 */
export async function listContracts(filters: ContractFilters): Promise<ContractListItem[]> {
  if (isDemoMode()) {
    // نُسخ لا مراجع: التعديل التجريبي (demoMutateContract) يغيّر صفوف المخزن، فلو شاركت
    // ذاكرة React Query نفس الكائن لما ظهر التحديث على الشاشة.
    return applyFilters(scopeForViewer(FALLBACK.map((c) => ({ ...c }))), filters);
  }
  const { data, error } = await supabase
    .from('contracts')
    .select('*, customers(full_name)')
    .not('contract_no', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`تعذّر جلب العقود: ${error.message}`);
  const rows = ((data ?? []) as RawRow[]).map(({ customers, ...rest }) => ({
    ...rest,
    customer_name: customers?.full_name ?? null,
    worker_name: null,
  }));
  return applyFilters(scopeForViewer(rows), filters);
}

export async function getContract(id: string): Promise<ContractListItem | null> {
  if (isDemoMode()) {
    const row = scopeForViewer(FALLBACK.filter((c) => c.id === id))[0];
    return row ? { ...row } : null;
  }
  const { data, error } = await supabase
    .from('contracts')
    .select('*, customers(full_name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`تعذّر جلب العقد: ${error.message}`);
  if (!data) return null; // غير موجود أو خارج صلاحية المستخدم (RLS)
  const { customers, ...rest } = data as RawRow;
  return { ...rest, customer_name: customers?.full_name ?? null, worker_name: null };
}

export async function getClauses(contractId: string): Promise<ContractClause[]> {
  try {
    const { data, error } = await supabase
      .from('contract_clauses')
      .select('*')
      .eq('contract_id', contractId)
      .order('sort_order', { ascending: true });
    if (!error && data && data.length > 0) return data as ContractClause[];
  } catch {
    /* fall through */
  }
  return FALLBACK_CLAUSES[contractId] ?? [];
}

export async function getHistory(contractId: string): Promise<ContractStatusHistory[]> {
  try {
    const { data, error } = await supabase
      .from('contract_status_history')
      .select('*')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });
    if (!error && data && data.length > 0) return data as ContractStatusHistory[];
  } catch {
    /* fall through */
  }
  if (FALLBACK_HISTORY[contractId]) return FALLBACK_HISTORY[contractId];
  const c = FALLBACK.find((x) => x.id === contractId);
  return c ? synthHistory(c) : [];
}

export async function getSignatures(contractId: string): Promise<ContractSignature[]> {
  try {
    const { data, error } = await supabase
      .from('contract_signatures')
      .select('*')
      .eq('contract_id', contractId)
      .order('signed_at', { ascending: true });
    if (!error && data && data.length > 0) return data as ContractSignature[];
  } catch {
    /* fall through */
  }
  return FALLBACK_SIGNATURES[contractId] ?? [];
}

export async function getTemplates(): Promise<ContractTemplate[]> {
  try {
    const { data, error } = await supabase
      .from('contract_templates')
      .select('*')
      .eq('is_active', true);
    if (!error && data && data.length > 0) return data as ContractTemplate[];
  } catch {
    /* fall through */
  }
  return FALLBACK_TEMPLATES;
}

/* ------------------------------ mutations -------------------------------- */

/**
 * بيانات إنشاء العقد من المعالج: مدخلات العقد + ما يلزم لعرضه فورًا (اسم العميل
 * والعاملة) + لقطة البنود المُجمّدة وقالبها (للعقود الداخلية).
 */
export interface CreateDraftInput extends CreateContractInput {
  customer_name?: string | null;
  worker_name?: string | null;
  template_id?: string | null;
  clauses?: string[];
}

/** يفحص مدة العقد قبل أي كتابة ويرمي رسالة عربية واضحة عند الخطأ. */
function parseTerm(start_date: string, end_date: string | null | undefined): ContractTerm {
  const parsed = contractTermSchema.safeParse({ start_date, end_date: end_date ?? null });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'تواريخ العقد غير صالحة');
  }
  return parsed.data;
}

/** عدّاد يضمن تفرّد معرّفات المسودات المحلية المنشأة في نفس اللحظة. */
let localSeq = 0;

function localDraft(input: CreateDraftInput, term: ContractTerm): ContractListItem {
  const price = fallbackPrice(input.service_code, {
    nationality: input.nationality,
    profession: input.profession,
    quantity: input.quantity,
  });
  return {
    id: `local-${Date.now()}-${++localSeq}`,
    contract_no: formatContractNo(new Date().getFullYear(), Math.floor(Math.random() * 99999) + 1),
    service_code: input.service_code,
    template_id: input.template_id ?? null,
    customer_id: input.customer_id,
    worker_id: input.worker_id ?? null,
    branch_id: input.branch_id,
    created_by: null,
    start_date: term.start_date,
    end_date: term.end_date,
    base_amount: price.base,
    vat_amount: price.vat,
    total_amount: price.total,
    amount_paid: 0,
    status: 'draft',
    version: 1,
    parent_contract_id: null,
    signed_at: null,
    musaned_contract_no: input.musaned_contract_no ?? null,
    created_at: new Date().toISOString(),
    assigned_office_id: null,
    assigned_at: null,
    recruitment_stage: null,
    visa_number: null,
    expected_arrival_date: null,
    flight_no: null,
    customer_name: input.customer_name ?? null,
    worker_name: input.worker_name ?? null,
  };
}

/** معرّف الفرع: المعالج يختار الفرع باسمه، وجدول branches يحفظه بمعرّف uuid. */
async function resolveBranchId(branch: string): Promise<string> {
  if (!isDemoId(branch)) return branch; // already a uuid
  const { data, error } = await supabase
    .from('branches')
    .select('id')
    .or(`city.eq.${branch},name.eq.${branch}`)
    .limit(1);
  if (error) throw new Error(`تعذّر تحديد الفرع: ${error.message}`);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(`الفرع «${branch}» غير موجود في قاعدة البيانات`);
  return id;
}

/**
 * إنشاء مسودة عقد بتاريخ بدايتها ونهايتها.
 * - الوضع التجريبي (بلا Supabase أو بحساب تجريبي): تُحفظ محليًا في مخزن العرض
 *   فتبقى ظاهرة في القائمة والتفاصيل والتنبيهات.
 * - مع قاعدة بيانات فعلية: أي فشل (تسعير، ترقيم، إدخال، بنود) يُرمى للمستخدم —
 *   لا نجاح وهمي ولا رجوع صامت لمسودة محلية.
 */
export async function createDraft(input: CreateDraftInput): Promise<ContractListItem> {
  const term = parseTerm(input.start_date, input.end_date);

  if (isDemoMode()) {
    const draft = localDraft(input, term);
    FALLBACK.unshift({ ...draft });
    FALLBACK_CLAUSES[draft.id] = (input.clauses ?? []).map((body, i) => ({
      id: `cl-${draft.id}-${i}`,
      contract_id: draft.id,
      sort_order: i,
      body,
    }));
    return draft;
  }

  const branchId = await resolveBranchId(input.branch_id);
  const { data: priceData, error: priceError } = await supabase.rpc('calc_contract_price', {
    p_service_code: input.service_code,
    p_params: {
      nationality: input.nationality,
      profession: input.profession,
      quantity: input.quantity,
    },
  });
  if (priceError) throw new Error(`تعذّر احتساب سعر العقد: ${priceError.message}`);
  const price = priceData as { base: number; vat: number; total: number } | null;
  if (!price) throw new Error('تعذّر احتساب سعر العقد');

  const { data: noData, error: noError } = await supabase.rpc('generate_contract_no');
  if (noError || !noData) throw new Error(`تعذّر توليد رقم العقد: ${noError?.message ?? ''}`);

  const templateId = input.template_id && !isDemoId(input.template_id) ? input.template_id : null;
  const { data, error } = await supabase
    .from('contracts')
    .insert({
      contract_no: noData as string,
      service_code: input.service_code,
      template_id: templateId,
      customer_id: input.customer_id,
      worker_id: input.worker_id ?? null,
      branch_id: branchId,
      start_date: term.start_date,
      end_date: term.end_date,
      base_amount: price.base,
      musaned_contract_no: input.musaned_contract_no ?? null,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) throw new Error(`تعذّر حفظ العقد: ${error.message}`);
  if (!data) throw new Error('تعذّر حفظ العقد');
  const saved = data as Contract;

  const clauses = input.clauses ?? [];
  if (clauses.length > 0) {
    const { error: clauseError } = await supabase
      .from('contract_clauses')
      .insert(clauses.map((body, i) => ({ contract_id: saved.id, sort_order: i, body })));
    if (clauseError) {
      throw new Error(
        `حُفظ العقد ${saved.contract_no ?? ''} كمسودة لكن تعذّر حفظ بنوده: ${clauseError.message}`,
      );
    }
  }

  return {
    ...saved,
    customer_name: input.customer_name ?? null,
    worker_name: input.worker_name ?? null,
  };
}

/**
 * تعديل مدة العقد (تاريخ البداية والنهاية). مسموح للمسودات فقط — نفس سياسة RLS
 * (contracts_update_draft): العقد المعتمد/الموقّع يُصحَّح بنسخة جديدة لا بالتعديل.
 * مع قاعدة بيانات فعلية: إن لم يتأثّر أي صف (ليس مسودة أو خارج نطاق الفرع/الصلاحية)
 * يُرمى خطأ بدل الإيحاء بالنجاح.
 */
export async function updateContractTerm(
  id: string,
  start_date: string,
  end_date: string | null,
): Promise<ContractTerm> {
  const term = parseTerm(start_date, end_date);

  if (isDemoMode() || isDemoId(id)) {
    const row = FALLBACK.find((c) => c.id === id);
    if (!row) throw new Error('العقد غير موجود');
    if (row.status !== 'draft') throw new Error('لا تُعدَّل مدة العقد إلا وهو مسودة');
    demoMutateContract(id, term);
    return term;
  }

  const { data, error } = await supabase
    .from('contracts')
    .update(term)
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  if (error) throw new Error(`تعذّر حفظ مدة العقد: ${error.message}`);
  if (!data || (data as unknown[]).length === 0) {
    throw new Error('لم تُحفظ المدة — العقد ليس مسودة أو لا تملك صلاحية تعديله');
  }
  return term;
}

/**
 * تجديد العقد: نسخة جديدة مرتبطة بالأصل (parent_contract_id + version) بنفس
 * مدته، تبدأ بعد نهايته، في حالة «مسودة» برقم عقد جديد. الأصل لا يتغيّر.
 * - قاعدة بيانات فعلية: دالة الخادم `renew_contract` (0051) — معاملة واحدة ذرّية،
 *   صلاحية contracts.create ونطاق الفرع، وقفل الأصل يمنع النسخ المكرّرة. أي فشل
 *   يُرمى للمستخدم؛ لا نسخة محلية بديلة.
 * - الوضع التجريبي: نفس القواعد على مخزن العرض.
 */
export async function renewContract(
  parentId: string,
  start_date: string,
  end_date: string,
): Promise<ContractListItem> {
  parseTerm(start_date, end_date);

  if (isDemoMode()) return renewDemoContract(parentId, start_date, end_date);

  const { data, error } = await supabase.rpc('renew_contract', {
    p_contract_id: parentId,
    p_start_date: start_date,
    p_end_date: end_date,
  });
  if (error) throw new Error(`تعذّر تجديد العقد: ${error.message}`);
  const row = data as Contract | null;
  if (!row?.id) throw new Error('تعذّر تجديد العقد: لم يُرجِع الخادم النسخة الجديدة');
  // الحفظ تمّ؛ نجلب الصف كاملًا (اسم العميل) وإن تعذّر نكتفي بما أرجعه الخادم
  const full = await getContract(row.id).catch(() => null);
  return full ?? { ...row, customer_name: null, worker_name: null };
}

function renewDemoContract(parentId: string, start: string, end: string): ContractListItem {
  const profile = useAuth.getState().profile;
  if (!roleCan(profile?.role as RoleCode | undefined, 'contracts', 'create')) {
    throw new Error('لا تملك صلاحية إنشاء العقود وتجديدها');
  }
  const parent = scopeForViewer(FALLBACK.filter((c) => c.id === parentId))[0];
  if (!parent) throw new Error('العقد غير موجود');

  const renewals = FALLBACK.filter((c) => c.parent_contract_id === parent.id);
  const ruleError = renewalRuleError(
    parent,
    renewals.filter((c) => c.status !== 'cancelled'),
  );
  if (ruleError) throw new Error(ruleError);
  const plan = renewalTerm(parent, start);
  if (plan.error !== null) throw new Error(plan.error);
  if (plan.term.end_date !== end) {
    throw new Error('تاريخ نهاية النسخة الجديدة لا يطابق مدة العقد الأصلي');
  }

  const now = new Date();
  const renewal: ContractListItem = {
    ...parent,
    id: `local-${Date.now()}-${++localSeq}`,
    contract_no: formatContractNo(now.getFullYear(), Math.floor(Math.random() * 99999) + 1),
    start_date: start,
    end_date: end,
    amount_paid: 0,
    status: 'draft',
    version: nextVersion(parent, renewals),
    parent_contract_id: parent.id,
    created_by: profile?.id ?? null,
    created_at: now.toISOString(),
    signed_at: null,
    musaned_contract_no: null,
    assigned_office_id: null,
    assigned_at: null,
    recruitment_stage: null,
    visa_number: null,
    expected_arrival_date: null,
    flight_no: null,
  };
  FALLBACK.unshift({ ...renewal });
  FALLBACK_CLAUSES[renewal.id] = (FALLBACK_CLAUSES[parent.id] ?? []).map((cl, i) => ({
    id: `cl-${renewal.id}-${i}`,
    contract_id: renewal.id,
    sort_order: cl.sort_order,
    body: renewClauseBody(cl.body, parent.start_date, start),
  }));
  return renewal;
}

/**
 * سجل إصدارات العقد: من الأصل الأول (الجذر عبر parent_contract_id) وكل تجديداته
 * ومنها الملغاة، مرتّبة بالإصدار. تحترم الصلاحيات (RLS / نطاق العرض): ما لا يراه
 * المستخدم لا يظهر.
 */
export async function getContractLineage(id: string): Promise<ContractListItem[]> {
  const MAX = 50;
  const seen = new Map<string, ContractListItem>();
  const self = await getContract(id);
  if (!self) return [];
  seen.set(self.id, self);

  let root = self;
  for (let i = 0; root.parent_contract_id && i < MAX; i += 1) {
    if (seen.has(root.parent_contract_id) && root.parent_contract_id !== root.id) {
      root = seen.get(root.parent_contract_id) as ContractListItem;
      continue;
    }
    const parent = await getContract(root.parent_contract_id);
    if (!parent) break;
    seen.set(parent.id, parent);
    root = parent;
  }

  // نزولًا من الجذر: كل عقدة تُوسَّع مرة واحدة (حتى لو رأيناها صعودًا، كالعقد نفسه)
  const expanded = new Set<string>();
  let frontier = [root.id];
  for (let i = 0; frontier.length > 0 && i < MAX; i += 1) {
    frontier.forEach((f) => expanded.add(f));
    const children = await listChildren(frontier);
    frontier = [];
    for (const c of children) {
      if (!seen.has(c.id)) seen.set(c.id, c);
      if (!expanded.has(c.id)) frontier.push(c.id);
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.version !== b.version ? a.version - b.version : a.created_at < b.created_at ? -1 : 1,
  );
}

async function listChildren(parentIds: string[]): Promise<ContractListItem[]> {
  if (isDemoMode()) {
    return scopeForViewer(
      FALLBACK.filter((c) => c.parent_contract_id && parentIds.includes(c.parent_contract_id)),
    ).map((c) => ({ ...c }));
  }
  const { data, error } = await supabase
    .from('contracts')
    .select('*, customers(full_name)')
    .in('parent_contract_id', parentIds);
  if (error) throw new Error(`تعذّر جلب إصدارات العقد: ${error.message}`);
  return ((data ?? []) as RawRow[]).map(({ customers, ...rest }) => ({
    ...rest,
    customer_name: customers?.full_name ?? null,
    worker_name: null,
  }));
}

export async function transitionContract(id: string, toStatus: ContractStatus): Promise<void> {
  if (isDemoId(id)) {
    // demo contract — keep the demo store in step with the optimistic status change
    demoMutateContract(id, {
      status: toStatus,
      ...(toStatus === 'signed' ? { signed_at: new Date().toISOString() } : {}),
    });
    return;
  }
  const { error } = await supabase.rpc('transition_contract', {
    p_contract_id: id,
    p_to_status: toStatus,
  });
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

/** Set/update the Musaned reference number (رقم عقد مساند) for a musaned-origin
 *  contract. Uses the security-definer RPC (0049) so it works past the draft stage. */
export async function setMusanedNo(id: string, no: string): Promise<void> {
  const clean = no.trim();
  if (isDemoId(id)) {
    demoMutateContract(id, { musaned_contract_no: clean || null });
    return;
  }
  const { error } = await supabase.rpc('set_musaned_contract_no', {
    p_contract_id: id,
    p_no: clean,
  });
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

/** Upload customer + company signatures to Storage, record them (with the
 *  signer's name, national id, and IP), then transition the contract to signed. */
export async function signContract(contractId: string, payload: SignPayload): Promise<void> {
  // Demo contract → skip Storage/DB; the UI marks it signed optimistically.
  if (isDemoId(contractId)) return;
  const entries: Array<{
    type: 'customer' | 'company';
    dataUrl: string;
    name: string;
    nationalId: string | null;
  }> = [
    {
      type: 'customer',
      dataUrl: payload.customer,
      name: payload.customerName,
      nationalId: payload.nationalId,
    },
    { type: 'company', dataUrl: payload.company, name: 'ماسية الشرق للاستقدام', nationalId: null },
  ];
  for (const { type, dataUrl, name, nationalId } of entries) {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${contractId}/${type}-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from('signatures')
      .upload(path, blob, { contentType: 'image/png', upsert: true });
    if (upErr && !isIgnorableWriteError(upErr.message)) throw new Error(upErr.message);
    const { error: insErr } = await supabase.from('contract_signatures').insert({
      contract_id: contractId,
      signer_type: type,
      signer_name: name,
      national_id: nationalId,
      ip_address: payload.ipAddress,
      signature_image: path,
    });
    if (insErr && !isIgnorableWriteError(insErr.message)) throw new Error(insErr.message);
  }
  const { error } = await supabase.rpc('transition_contract', {
    p_contract_id: contractId,
    p_to_status: 'signed',
  });
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}
