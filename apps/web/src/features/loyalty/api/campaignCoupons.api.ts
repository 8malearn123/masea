/**
 * كوبونات الحملات (كوبونات الإحالة) — صفوف في promotions مرتبطة بالحملة (0066).
 * الإصدار عبر create_campaign_coupons (النسب المقترحة لمن يملك loyalty.edit،
 * والنسبة المخصّصة لمن يملك الإدارة)، والاستخدامات وإجمالي الخصم من
 * coupon_redemptions (عقد واحد = استخدام واحد، والعقد الملغى لا يُحتسب).
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { findByCode, type Promotion } from '@/shared/lib/pricing';
import { recordAudit } from '@/shared/lib/auditTrail';
import { createPromotion, listPromotions } from '@/features/pricing/api/promotions.api';
import { listContracts } from '@/features/contracts/api/contracts.api';
import type { Campaign } from '@/features/loyalty/types';

export interface CampaignCoupon {
  id: string;
  code: string;
  name: string;
  discount_pct: number | null;
  usage_limit: number | null;
  usage_count: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  referrer_name: string | null;
  uses: number;
  total_discount: number;
  sales_after_discount: number;
  last_used_at: string | null;
  /** the campaign's main coupon (Campaign.coupon_code) */
  is_main: boolean;
}

export interface IssueInput {
  count: number;
  pct: number;
  /** 1 = single use, null = unlimited, n = n uses */
  usageLimit: number | null;
  referrer: { id: string; name: string } | null;
  prefix: string;
}

export interface CouponPolicy {
  presets: number[];
  /** loyalty.manage / pricing.manage — may use a custom percentage */
  canCustom: boolean;
}

/** Same rules as create_campaign_coupons; null = valid. */
export function validateIssue(i: IssueInput, policy: CouponPolicy): string | null {
  if (!Number.isFinite(i.pct) || i.pct <= 0 || i.pct > 100) return 'نسبة الخصم بين 0 و100';
  if (!policy.presets.includes(i.pct) && !policy.canCustom)
    return `نسبة الخصم المخصّصة تحتاج صلاحية الإدارة — استخدم ${policy.presets.join('٪ أو ')}٪`;
  if (!Number.isInteger(i.count) || i.count < 1 || i.count > 200) return 'عدد الكوبونات بين 1 و200';
  if (i.usageLimit !== null && (!Number.isInteger(i.usageLimit) || i.usageLimit < 1))
    return 'عدد مرات الاستخدام 1 على الأقل';
  if (i.referrer && i.count !== 1) return 'كوبون المُحيل يُصدر واحدًا لكل عميل';
  return null;
}

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

export async function listCampaignCoupons(c: Campaign): Promise<CampaignCoupon[]> {
  if (!isDemoMode() && !isDemoId(c.id)) {
    const { data, error } = await supabase
      .from('coupon_stats')
      .select('*')
      .eq('campaign_id', c.id)
      .order('code');
    if (error) throw new Error(`تعذّر جلب الكوبونات: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.promotion_id),
      code: String(r.code ?? ''),
      name: String(r.name ?? ''),
      discount_pct: r.discount_pct == null ? null : Number(r.discount_pct),
      usage_limit: r.usage_limit == null ? null : Number(r.usage_limit),
      usage_count: Number(r.usage_count ?? 0),
      is_active: Boolean(r.is_active),
      starts_at: (r.starts_at as string | null) ?? null,
      ends_at: (r.ends_at as string | null) ?? null,
      referrer_name: (r.referrer_name as string | null) ?? null,
      uses: Number(r.uses ?? 0),
      total_discount: Number(r.total_discount ?? 0),
      sales_after_discount: Number(r.sales_after_discount ?? 0),
      last_used_at: (r.last_used_at as string | null) ?? null,
      is_main:
        !!c.coupon_code && String(r.code ?? '').toUpperCase() === c.coupon_code.toUpperCase(),
    }));
  }
  // demo: the coupons of the campaign + usage derived from the contract store
  const [promos, contracts] = await Promise.all([listPromotions(), listContracts(ALL)]);
  const main = c.coupon_code ? findByCode(promos, c.coupon_code) : null;
  const mine = promos.filter((p) => p.campaign_id === c.id || p.id === main?.id);
  return mine.map((p): CampaignCoupon => {
    const used = contracts.filter((k) => k.promotion_id === p.id && k.status !== 'cancelled');
    const dates = used.map((k) => k.created_at).sort();
    return {
      id: p.id,
      code: p.code ?? '',
      name: p.name,
      discount_pct: p.discount_pct,
      usage_limit: p.usage_limit,
      usage_count: p.usage_count,
      is_active: p.is_active,
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      referrer_name: p.referrer_name ?? null,
      uses: used.length,
      total_discount: Math.round(used.reduce((s, k) => s + k.discount_amount, 0) * 100) / 100,
      sales_after_discount: Math.round(used.reduce((s, k) => s + k.base_amount, 0) * 100) / 100,
      last_used_at: dates.at(-1) ?? null,
      is_main: p.id === main?.id,
    };
  });
}

function couponCode(prefix: string, pct: number, existing: Promotion[]): string {
  const head = `${(prefix.trim() || 'MAS-REF').toUpperCase()}${pct}`;
  for (;;) {
    const code = `${head}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (!findByCode(existing, code)) return code;
  }
}

export async function issueCampaignCoupons(
  c: Campaign,
  input: IssueInput,
  policy: CouponPolicy,
): Promise<CampaignCoupon[]> {
  const err = validateIssue(input, policy);
  if (err) throw new Error(err);
  if (!isDemoMode() && !isDemoId(c.id)) {
    const { error } = await supabase.rpc('create_campaign_coupons', {
      p_campaign_id: c.id,
      p_count: input.count,
      p_pct: input.pct,
      p_usage_limit: input.usageLimit,
      p_referrer: input.referrer && !isDemoId(input.referrer.id) ? input.referrer.id : null,
      p_prefix: input.prefix || null,
    });
    if (error) throw new Error(error.message);
    return listCampaignCoupons(c);
  }
  const existing = await listPromotions();
  for (let i = 0; i < input.count; i++) {
    const code = couponCode(input.prefix, input.pct, existing);
    const p = await createPromotion({
      name: `كوبون ${c.name}${input.referrer ? ` — ${input.referrer.name}` : ''}`,
      code,
      description: `كوبون إحالة لحملة «${c.name}».`,
      discount_pct: input.pct,
      discount_amount: null,
      service_codes: c.service_codes ?? [],
      min_base_amount: null,
      max_discount_amount: null,
      starts_at: c.start_at || null,
      ends_at: c.end_at || null,
      usage_limit: input.usageLimit,
      is_active: c.is_active,
      requires_code: true,
      campaign_id: c.id,
      referrer_name: input.referrer?.name ?? null,
    });
    existing.push(p);
  }
  recordAudit({
    action: 'insert',
    entity: 'promotions',
    record_ref: c.name,
    old_data: null,
    new_data: {
      coupons: input.count,
      discount_pct: input.pct,
      usage_limit: input.usageLimit,
      referrer: input.referrer?.name ?? null,
    },
    branch: null,
  });
  return listCampaignCoupons(c);
}

export interface CampaignPerformance {
  coupons: number;
  activeCoupons: number;
  uses: number;
  totalDiscount: number;
  salesAfterDiscount: number;
}

export function campaignPerformance(rows: CampaignCoupon[]): CampaignPerformance {
  return {
    coupons: rows.length,
    activeCoupons: rows.filter((r) => r.is_active).length,
    uses: rows.reduce((s, r) => s + r.uses, 0),
    totalDiscount: Math.round(rows.reduce((s, r) => s + r.total_discount, 0) * 100) / 100,
    salesAfterDiscount:
      Math.round(rows.reduce((s, r) => s + r.sales_after_discount, 0) * 100) / 100,
  };
}
