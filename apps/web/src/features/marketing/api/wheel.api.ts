/**
 * عجلة الحظ (0101 + 0104): رابط آمن مربوط بحملة نشطة، تحقق هوية العميل (آخر 4 من الهوية
 * والجوال المسجّلين)، مشاركة واحدة لكل عميل في كل حملة، العجلة لا تعمل إلا إذا كان مجموع
 * احتمالات الجوائز المفعّلة 100٪، جوائز معرّفة (خدمات/حد/صلاحية/استخدام/عدد أقصى/شروط)،
 * مرجع الجائزة في ملف العميل واستخدامها على عقد، والتقرير.
 * مع قاعدة البيانات كل ذلك على الخادم؛ الوضع التجريبي مرآة في متصفح العرض فقط.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode, isDemoId } from '@/shared/lib/demoBackend';
import {
  addWheelPrize,
  generateCouponCode,
  listWheelPrizes,
  removeWheelPrize,
  updateWheelPrize,
} from '@/features/loyalty/data/engine';
import type { WheelPrize, WheelPrizeInput } from '@/features/loyalty/types';

export const WHEEL_NOT_READY =
  'إعدادات العجلة غير مكتملة: مجموع احتمالات الجوائز المفعّلة يجب أن يساوي 100٪';

/** شرط تفعيل الجائزة (مرآة wheel_prizes_guard — 0104): لا تُفعَّل جائزة غير معرّفة. */
export function prizeActivationError(
  p: Pick<
    WheelPrize,
    | 'prize_type'
    | 'value'
    | 'service_codes'
    | 'max_discount_amount'
    | 'coupon_valid_days'
    | 'active'
  > & { terms?: string | null },
): string | null {
  if (p.prize_type === 'discount' && !(p.value > 0 && p.value <= 100))
    return 'نسبة الخصم بين 1 و100';
  if (!p.active) return null;
  const services = (p.service_codes ?? []).length;
  if (p.prize_type === 'discount' && (services === 0 || p.max_discount_amount == null))
    return 'لا تُفعَّل جائزة الخصم قبل تحديد الخدمات المشمولة والحد الأعلى للخصم بالريال';
  if (
    p.prize_type === 'free_service' &&
    ((p.terms ?? '').trim().length < 10 || services === 0 || p.coupon_valid_days == null)
  )
    return 'لا تُفعَّل هذه الجائزة قبل اعتماد تعريفها وشروطها وخدماتها ومدة صلاحيتها';
  return null;
}

/** مجموع احتمالات الجوائز المفعّلة (العجلة تعمل عند 100 فقط — لا تُعدَّل النسب تلقائياً). */
export function probabilityTotal(prizes: Pick<WheelPrize, 'active' | 'probability'>[]): number {
  return (
    Math.round(prizes.filter((p) => p.active).reduce((s, p) => s + p.probability, 0) * 100) / 100
  );
}

/* ------------------------------ prizes (CRUD) ------------------------------ */
const PRIZE_COLUMNS =
  'id, label, prize_type, value, probability, is_active, sort_order, service_codes, max_discount_amount, coupon_valid_days, usage_limit, max_awards, terms';

function fromPrizeRow(r: Record<string, unknown>): WheelPrize {
  return {
    id: String(r.id),
    label: String(r.label ?? ''),
    prize_type: r.prize_type as WheelPrize['prize_type'],
    value: Number(r.value ?? 0),
    probability: Number(r.probability ?? 0),
    active: Boolean(r.is_active),
    coupon_code: null,
    service_codes: (r.service_codes as string[] | null) ?? [],
    max_discount_amount: r.max_discount_amount == null ? null : Number(r.max_discount_amount),
    coupon_valid_days: r.coupon_valid_days == null ? null : Number(r.coupon_valid_days),
    usage_limit: Number(r.usage_limit ?? 1),
    max_awards: r.max_awards == null ? null : Number(r.max_awards),
    terms: (r.terms as string | null) ?? null,
  };
}
function toPrizeRow(p: Partial<WheelPrizeInput>): Record<string, unknown> {
  const { active, coupon_code: _c, ...rest } = p;
  void _c;
  return {
    ...rest,
    ...(active === undefined ? {} : { is_active: active }),
    ...('service_codes' in p
      ? { service_codes: p.service_codes?.length ? p.service_codes : null }
      : {}),
  };
}
const liveMode = () => !isDemoMode();

export async function listPrizes(): Promise<WheelPrize[]> {
  if (!liveMode()) return listWheelPrizes();
  const { data, error } = await supabase
    .from('wheel_prizes')
    .select(PRIZE_COLUMNS)
    .order('sort_order');
  if (error) throw new Error(`تعذّر تحميل الجوائز: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(fromPrizeRow);
}

export async function addPrize(input: WheelPrizeInput): Promise<WheelPrize> {
  const rule = prizeActivationError(input);
  if (rule) throw new Error(rule);
  if (!liveMode()) return addWheelPrize(input);
  const { data, error } = await supabase
    .from('wheel_prizes')
    .insert(toPrizeRow(input))
    .select(PRIZE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return fromPrizeRow(data as Record<string, unknown>);
}

export async function updatePrize(
  id: string,
  patch: Partial<WheelPrizeInput>,
): Promise<WheelPrize> {
  const current = (await listPrizes()).find((p) => p.id === id);
  if (!current) throw new Error('الجائزة غير موجودة');
  const rule = prizeActivationError({ ...current, ...patch });
  if (rule) throw new Error(rule);
  if (!liveMode() || isDemoId(id)) return updateWheelPrize(id, patch);
  const { data, error } = await supabase
    .from('wheel_prizes')
    .update(toPrizeRow(patch))
    .eq('id', id)
    .select(PRIZE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return fromPrizeRow(data as Record<string, unknown>);
}

/** الحذف = تعطيل مع قاعدة البيانات (الجائزة مرتبطة بدورات سابقة)؛ التجريبي يحذف من المخزن. */
export async function removePrize(id: string): Promise<void> {
  if (!liveMode() || isDemoId(id)) {
    removeWheelPrize(id);
    return;
  }
  await updatePrize(id, { active: false });
}

/* ------------------------------- demo links -------------------------------- */
export interface WheelResult {
  label: string;
  prize_type: string;
  coupon_code: string | null;
  reference: string | null;
  valid_until: string | null;
  terms: string | null;
  exhausted?: boolean;
}

export interface WheelPublicPrize {
  label: string;
  prize_type: string;
  chance: number;
  terms: string | null;
  services: string[] | null;
  max_discount_amount: number | null;
  valid_days: number | null;
  usage_limit: number;
}

export interface WheelPublicView {
  first_name: string | null;
  campaign_name: string | null;
  campaign_terms: string | null;
  campaign_active: boolean;
  ready: boolean;
  expired: boolean;
  used: boolean;
  locked: boolean;
  prizes: WheelPublicPrize[];
  result: WheelResult | null;
}

interface DemoUse {
  contract_id: string;
  renewal: boolean;
  value: number;
}
interface DemoLink {
  customer_id: string;
  first_name: string;
  campaign_id: string;
  campaign_name: string;
  campaign_terms: string | null;
  id4: string;
  phone4: string;
  failed: number;
  expires_at: string;
  used: boolean;
  result: (WheelResult & { prize_id: string }) | null;
  spun_at: string | null;
  uses?: DemoUse[];
}
const LS = 'masea_wheel_links';
function readLinks(): Record<string, DemoLink> {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}') as Record<string, DemoLink>;
  } catch {
    return {};
  }
}
function writeLinks(v: Record<string, DemoLink>): void {
  try {
    localStorage.setItem(LS, JSON.stringify(v));
  } catch {
    /* demo storage best-effort */
  }
}
export function resetWheelLinksDemo(): void {
  writeLinks({});
}
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
const last4 = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-4);

export function wheelLinkUrl(token: string): string {
  return `${window.location.origin}/w/${token}`;
}

export interface WheelLinkInput {
  customerId: string;
  fullName: string;
  nationalId: string | null;
  phone: string | null;
  campaign: { id: string; name: string; terms?: string | null };
  validHours: number;
}

export async function createWheelLink(
  i: WheelLinkInput,
): Promise<{ token: string; expires_at: string }> {
  if (isDemoMode() || isDemoId(i.campaign.id)) {
    if (last4(i.nationalId).length < 4 || !/^05\d{8}$/.test(i.phone ?? ''))
      throw new Error('لا يمكن التحقق من هوية العميل — أكمل رقم الهوية والجوال في ملفه أولاً');
    if (probabilityTotal(listWheelPrizes()) !== 100) throw new Error(WHEEL_NOT_READY);
    const token = randomToken();
    const expires_at = new Date(Date.now() + i.validHours * 3600000).toISOString();
    writeLinks({
      ...readLinks(),
      [token]: {
        customer_id: i.customerId,
        first_name: i.fullName.split(' ')[0] ?? i.fullName,
        campaign_id: i.campaign.id,
        campaign_name: i.campaign.name,
        campaign_terms: i.campaign.terms ?? null,
        id4: last4(i.nationalId),
        phone4: last4(i.phone),
        failed: 0,
        expires_at,
        used: false,
        result: null,
        spun_at: null,
      },
    });
    return { token, expires_at };
  }
  const { data, error } = await supabase.rpc('create_wheel_link', {
    p_customer: i.customerId,
    p_campaign: i.campaign.id,
  });
  if (error) throw new Error(error.message);
  return data as { token: string; expires_at: string };
}

const publicPrize = (p: WheelPrize): WheelPublicPrize => ({
  label: p.label,
  prize_type: p.prize_type,
  chance: p.probability,
  terms: p.terms ?? null,
  services: p.service_codes?.length ? p.service_codes : null,
  max_discount_amount: p.max_discount_amount ?? null,
  valid_days: p.coupon_valid_days ?? null,
  usage_limit: p.usage_limit ?? 1,
});

export async function wheelPublicView(
  token: string,
  maxAttempts: number,
): Promise<WheelPublicView> {
  if (isDemoMode()) {
    const l = readLinks()[token];
    if (!l) throw new Error('الرابط غير صحيح');
    const prizes = listWheelPrizes().filter((p) => p.active);
    return {
      first_name: l.first_name,
      campaign_name: l.campaign_name,
      campaign_terms: l.campaign_terms,
      campaign_active: true,
      ready: probabilityTotal(prizes) === 100,
      expired: l.expires_at < new Date().toISOString(),
      used: l.used,
      locked: l.failed >= maxAttempts,
      prizes: prizes.map(publicPrize),
      result: l.result,
    };
  }
  const { data, error } = await supabase.rpc('wheel_public_view', { p_token: token });
  if (error) throw new Error(error.message);
  return data as WheelPublicView;
}

/** الدورة: التحقق من الهوية ثم السحب — على الخادم (spin_wheel_by_token). */
export async function spinByToken(
  token: string,
  idLast4: string,
  phoneLast4: string,
  maxAttempts: number,
): Promise<WheelResult> {
  if (!/^\d{4}$/.test(idLast4) || !/^\d{4}$/.test(phoneLast4))
    throw new Error('أدخل آخر 4 أرقام من الهوية ومن الجوال');
  if (isDemoMode()) {
    const r = demoSpin(token, idLast4, phoneLast4, maxAttempts);
    const prize = listWheelPrizes().find((p) => p.id === r.prize_id);
    if (prize && r.coupon_code) {
      // كوبون الجائزة يُقبل في تسعير «عقد جديد» بقيوده (مرآة spin_wheel_core)
      const { issueWheelCoupon } = await import('@/features/loyalty/api/loyalty.api');
      await issueWheelCoupon({ ...prize, coupon_code: r.coupon_code }, r.label);
    }
    return r;
  }
  const { data, error } = await supabase.rpc('spin_wheel_by_token', {
    p_token: token,
    p_id_last4: idLast4,
    p_phone_last4: phoneLast4,
  });
  if (error) throw new Error(error.message);
  const r = data as WheelResult & { error?: string };
  if (r.error) throw new Error(r.error);
  return r;
}

function demoSpin(
  token: string,
  id4: string,
  phone4: string,
  maxAttempts: number,
): WheelResult & { prize_id: string } {
  const links = readLinks();
  const l = links[token];
  if (!l) throw new Error('الرابط غير صحيح');
  if (l.used) throw new Error('استُخدم هذا الرابط مسبقاً');
  if (l.expires_at < new Date().toISOString()) throw new Error('انتهت صلاحية الرابط');
  if (l.failed >= maxAttempts)
    throw new Error('أُوقف الرابط بعد محاولات تحقق خاطئة — تواصل مع الفرع');
  if (l.id4 !== id4 || l.phone4 !== phone4) {
    links[token] = { ...l, failed: l.failed + 1 };
    writeLinks(links);
    throw new Error('بيانات التحقق غير مطابقة');
  }
  const all = Object.values(links);
  if (all.some((x) => x.customer_id === l.customer_id && x.campaign_id === l.campaign_id && x.used))
    throw new Error('سبق لك المشاركة في هذه الحملة');
  const pool = listWheelPrizes().filter((p) => p.active);
  if (probabilityTotal(pool) !== 100) throw new Error(WHEEL_NOT_READY);
  let r = Math.random() * 100;
  let prize = pool[pool.length - 1]!;
  for (const p of pool) {
    r -= p.probability;
    if (r <= 0) {
      prize = p;
      break;
    }
  }
  const awarded = all.filter((x) => x.result?.prize_id === prize.id && !x.result.exhausted).length;
  const out = prize.max_awards != null && awarded >= prize.max_awards;
  const until = new Date(Date.now() + (prize.coupon_valid_days ?? 30) * 86400000).toISOString();
  const code =
    !out && prize.prize_type === 'discount' ? generateCouponCode('discount', prize.value) : null;
  const ref =
    code ??
    (!out && prize.prize_type === 'free_service'
      ? `MAS-PRIZE-${randomToken().slice(0, 6).toUpperCase()}`
      : null);
  const result: WheelResult & { prize_id: string } = {
    prize_id: prize.id,
    label: out ? 'نفدت هذه الجائزة — حظاً أوفر' : prize.label,
    prize_type: out ? 'none' : prize.prize_type,
    coupon_code: code,
    reference: ref,
    valid_until:
      !out && (prize.prize_type === 'discount' || prize.prize_type === 'free_service')
        ? until
        : null,
    terms: prize.terms ?? null,
    exhausted: out,
  };
  links[token] = { ...l, used: true, result, spun_at: new Date().toISOString() };
  writeLinks(links);
  return result;
}

/* --------------------------- customer prizes / use -------------------------- */
export interface CustomerPrize {
  spin_id: string;
  spun_at: string;
  campaign_name: string | null;
  label: string;
  prize_type: string;
  reference: string | null;
  coupon_code: string | null;
  valid_until: string | null;
  services: string[] | null;
  max_discount_amount: number | null;
  usage_limit: number;
  uses: number;
  terms: string | null;
  exhausted: boolean;
}

export async function customerWheelPrizes(customerId: string): Promise<CustomerPrize[]> {
  if (isDemoMode() || isDemoId(customerId)) {
    const prizes = listWheelPrizes();
    return Object.entries(readLinks())
      .filter(([, l]) => l.customer_id === customerId && l.result)
      .map(([token, l]) => {
        const p = prizes.find((x) => x.id === l.result!.prize_id);
        return {
          spin_id: token,
          spun_at: l.spun_at ?? '',
          campaign_name: l.campaign_name,
          label: l.result!.label,
          prize_type: l.result!.prize_type,
          reference: l.result!.reference,
          coupon_code: l.result!.coupon_code,
          valid_until: l.result!.valid_until,
          services: p?.service_codes?.length ? p.service_codes : null,
          max_discount_amount: p?.max_discount_amount ?? null,
          usage_limit: p?.usage_limit ?? 1,
          uses: (l.uses ?? []).length,
          terms: l.result!.terms,
          exhausted: Boolean(l.result!.exhausted),
        };
      })
      .sort((a, b) => b.spun_at.localeCompare(a.spun_at));
  }
  const { data, error } = await supabase.rpc('customer_wheel_prizes', { p_customer: customerId });
  if (error) throw new Error(`تعذّر تحميل جوائز العميل: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    spin_id: String(r.spin_id),
    spun_at: String(r.spun_at ?? ''),
    campaign_name: (r.campaign_name as string | null) ?? null,
    label: String(r.label),
    prize_type: String(r.prize_type),
    reference: (r.reference as string | null) ?? null,
    coupon_code: (r.coupon_code as string | null) ?? null,
    valid_until: (r.valid_until as string | null) ?? null,
    services: (r.services as string[] | null) ?? null,
    max_discount_amount: r.max_discount_amount == null ? null : Number(r.max_discount_amount),
    usage_limit: Number(r.usage_limit ?? 1),
    uses: Number(r.uses ?? 0),
    terms: (r.terms as string | null) ?? null,
    exhausted: Boolean(r.exhausted),
  }));
}

/** حالة الجائزة للعرض: النقاط/المحفظة تُضاف للرصيد فوراً؛ الخصم/الخدمة لها مرجع وصلاحية. */
export function prizeState(
  p: CustomerPrize,
  now = new Date().toISOString(),
): 'valid' | 'used' | 'expired' | 'credited' | 'none' {
  if (p.exhausted || p.prize_type === 'none') return 'none';
  if (p.prize_type === 'points' || p.prize_type === 'wallet') return 'credited';
  if (!p.reference) return 'none';
  if (p.uses >= p.usage_limit) return 'used';
  if (p.valid_until && p.valid_until < now) return 'expired';
  return 'valid';
}

export interface RedeemContract {
  id: string;
  customer_id: string;
  service_code: string | null;
  total_amount: number;
  parent_contract_id: string | null;
}

/** استخدام جائزة غير نقدية (مرجع MAS-PRIZE) على عقد — الخصم يُطبَّق بكوده في التسعير. */
export async function redeemWheelPrize(reference: string, contract: RedeemContract): Promise<void> {
  const ref = reference.trim().toUpperCase();
  if (isDemoMode() || isDemoId(contract.id)) {
    const links = readLinks();
    const entry = Object.entries(links).find(([, l]) => l.result?.reference === ref);
    if (!entry || entry[1].result?.exhausted) throw new Error('مرجع الجائزة غير صحيح');
    const [token, l] = entry;
    const p = listWheelPrizes().find((x) => x.id === l.result!.prize_id);
    if (l.result!.prize_type === 'discount')
      throw new Error('جائزة الخصم تُطبَّق بإدخال الكود في التسعير');
    if (contract.customer_id !== l.customer_id) throw new Error('الجائزة تخص عميلاً آخر');
    if (l.result!.valid_until && l.result!.valid_until < new Date().toISOString())
      throw new Error('انتهت صلاحية الجائزة');
    if (p?.service_codes?.length && !p.service_codes.includes(contract.service_code ?? ''))
      throw new Error('الجائزة لا تشمل خدمة هذا العقد');
    if ((l.uses ?? []).length >= (p?.usage_limit ?? 1))
      throw new Error('استُخدمت الجائزة بالعدد المسموح');
    links[token] = {
      ...l,
      uses: [
        ...(l.uses ?? []),
        {
          contract_id: contract.id,
          renewal: contract.parent_contract_id !== null,
          value: contract.total_amount,
        },
      ],
    };
    writeLinks(links);
    return;
  }
  const { error } = await supabase.rpc('redeem_wheel_prize', {
    p_reference: ref,
    p_contract: contract.id,
  });
  if (error) throw new Error(error.message);
}

/* ---------------------------------- report ---------------------------------- */
export interface WheelReportRow {
  prize_label: string;
  prize_type: string;
  participants: number;
  spins: number;
  winners: number;
  used: number;
  discount_total: number;
  contracts: number;
  renewals: number;
  contracts_value: number;
  renewals_value: number;
}

export interface WheelReportFilter {
  from: string;
  to: string;
  campaignId: string | null;
  /** اسم الفرع كما في قائمة الفروع؛ null = كل الفروع (النطاق يُفرض على الخادم) */
  branch: string | null;
}

export async function wheelReport(f: WheelReportFilter): Promise<WheelReportRow[]> {
  if (isDemoMode()) {
    const map = new Map<string, WheelReportRow & { _c: Set<string> }>();
    for (const l of Object.values(readLinks())) {
      if (!l.result || !l.spun_at) continue;
      const day = l.spun_at.slice(0, 10);
      if (day < f.from || day > f.to || (f.campaignId && l.campaign_id !== f.campaignId)) continue;
      const key = l.result.exhausted ? 'نفدت' : l.result.label;
      const row = map.get(key) ?? {
        prize_label: l.result.label,
        prize_type: l.result.prize_type,
        participants: 0,
        spins: 0,
        winners: 0,
        used: 0,
        discount_total: 0,
        contracts: 0,
        renewals: 0,
        contracts_value: 0,
        renewals_value: 0,
        _c: new Set<string>(),
      };
      row.spins += 1;
      row._c.add(l.customer_id);
      row.participants = row._c.size;
      if (!l.result.exhausted && l.result.prize_type !== 'none') row.winners += 1;
      const uses = l.uses ?? [];
      if (uses.length) row.used += 1;
      for (const u of uses) {
        if (u.renewal) {
          row.renewals += 1;
          row.renewals_value += u.value;
        } else {
          row.contracts += 1;
          row.contracts_value += u.value;
        }
      }
      map.set(key, row);
    }
    return [...map.values()].map(({ _c, ...r }) => (void _c, r));
  }
  let branchId: string | null = null;
  if (f.branch) {
    const { data: b } = await supabase
      .from('branches')
      .select('id')
      .eq('city', f.branch)
      .maybeSingle();
    branchId = (b as { id: string } | null)?.id ?? null;
  }
  const { data, error } = await supabase.rpc('wheel_report', {
    p_from: f.from,
    p_to: f.to,
    p_campaign: f.campaignId,
    p_branch: branchId,
  });
  if (error) throw new Error(`تعذّر تحميل تقرير العجلة: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    prize_label: String(r.prize_label),
    prize_type: String(r.prize_type),
    participants: Number(r.participants),
    spins: Number(r.spins),
    winners: Number(r.winners),
    used: Number(r.used),
    discount_total: Number(r.discount_total),
    contracts: Number(r.contracts),
    renewals: Number(r.renewals),
    contracts_value: Number(r.contracts_value),
    renewals_value: Number(r.renewals_value),
  }));
}

/** تمديد حملة بصلاحية إدارية مع سبب (extend_campaign — 0101). */
export async function extendCampaign(
  campaignId: string,
  until: string,
  reason: string,
  role: string | null,
): Promise<void> {
  if (reason.trim().length < 5) throw new Error('سبب التمديد مطلوب');
  if (until <= new Date().toISOString()) throw new Error('تاريخ التمديد بعد اليوم');
  if (isDemoMode() || campaignId.startsWith('cm')) {
    if (!['admin', 'operations_manager', 'branch_manager'].includes(role ?? ''))
      throw new Error('تمديد الحملة بصلاحية إدارية (مدير الفرع/العمليات/المدير العام)');
    const { updateCampaign } = await import('@/features/loyalty/api/loyalty.api');
    await updateCampaign(campaignId, { extended_until: until });
    return;
  }
  const { error } = await supabase.rpc('extend_campaign', {
    p_campaign: campaignId,
    p_until: until,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}
