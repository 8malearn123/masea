import type {
  Campaign,
  CampaignInput,
  CampaignType,
  LoyaltyTxn,
  Referral,
  WheelPrize,
} from '@/features/loyalty/types';
import {
  disableCouponPromotion,
  syncCampaignCouponsLocal,
  upsertCouponPromotion,
} from '@/features/pricing/api/promotions.api';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';

const TXNS: LoyaltyTxn[] = [
  {
    id: 't1',
    customer_name: 'محمد الأحمدي',
    type: 'earn',
    points: 250,
    amount: 5000,
    description: 'عقد استقدام جديد',
    created_at: '2026-06-12T09:00:00Z',
  },
  {
    id: 't2',
    customer_name: 'سارة القحطاني',
    type: 'redeem',
    points: -150,
    amount: 0,
    description: 'استبدال نقاط — خصم تجديد',
    created_at: '2026-06-11T14:30:00Z',
  },
  {
    id: 't3',
    customer_name: 'فهد العنزي',
    type: 'referral',
    points: 100,
    amount: 0,
    description: 'إحالة عميل جديد',
    created_at: '2026-06-11T11:10:00Z',
  },
  {
    id: 't4',
    customer_name: 'نورة الشهري',
    type: 'earn',
    points: 180,
    amount: 3600,
    description: 'تأجير شهري',
    created_at: '2026-06-10T16:00:00Z',
  },
  {
    id: 't5',
    customer_name: 'عبدالله الدوسري',
    type: 'expire',
    points: -40,
    amount: 0,
    description: 'انتهاء صلاحية نقاط',
    created_at: '2026-06-09T08:00:00Z',
  },
  {
    id: 't6',
    customer_name: 'هند المالكي',
    type: 'earn',
    points: 320,
    amount: 6400,
    description: 'عقد استقدام جديد',
    created_at: '2026-06-08T13:20:00Z',
  },
];

// ---------------------------------------------------------------------------
// Marketing campaigns — an admin-managed store (add / edit / disable / delete
// + coupon codes), persisted to localStorage in demo mode. Once Supabase is
// connected the same shape maps to a marketing_campaigns table with RLS.
// No hardcoded campaign list in the UI: everything is editable from التسويق.
// ---------------------------------------------------------------------------
const DEFAULT_CAMPAIGNS: Campaign[] = [
  {
    id: 'cm1',
    name: 'عرض الصيف — خصم التجديد',
    type: 'seasonal',
    discount_pct: 15,
    start_at: '2026-06-01T00:00:00Z',
    end_at: '2026-08-31T00:00:00Z',
    is_active: true,
    usage_count: 42,
    coupon_code: 'MAS-SUMMER15-A7K2',
  },
  {
    id: 'cm2',
    name: 'استرداد نقدي على الاستقدام',
    type: 'cashback',
    discount_pct: 5,
    start_at: '2026-05-15T00:00:00Z',
    end_at: '2026-07-15T00:00:00Z',
    is_active: true,
    usage_count: 18,
    coupon_code: 'MAS-CASH5-9QF3',
  },
  {
    id: 'cm3',
    name: 'برنامج أحضر صديقًا',
    type: 'referral',
    discount_pct: 10,
    start_at: '2026-01-01T00:00:00Z',
    end_at: '2026-12-31T00:00:00Z',
    is_active: true,
    usage_count: 27,
    coupon_code: 'MAS-REF10-M4X8',
  },
  {
    id: 'cm4',
    name: 'عرض رمضان',
    type: 'seasonal',
    discount_pct: 20,
    start_at: '2026-02-18T00:00:00Z',
    end_at: '2026-03-20T00:00:00Z',
    is_active: false,
    usage_count: 65,
    coupon_code: 'MAS-RAMADAN20-B2C1',
  },
];

const CAMPAIGNS_LS_KEY = 'masea_campaigns';

function loadCampaigns(): Campaign[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(CAMPAIGNS_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Campaign[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    }
  } catch {
    // نتجاهل تلف التخزين ونعود للبذرة
  }
  return DEFAULT_CAMPAIGNS.map((c) => ({ ...c }));
}

const CAMPAIGNS: Campaign[] = loadCampaigns();

function persistCampaigns(): void {
  try {
    localStorage?.setItem(CAMPAIGNS_LS_KEY, JSON.stringify(CAMPAIGNS));
  } catch {
    // وضع التجربة قد يمنع التخزين
  }
}

/** توليد كود كوبون مباشر لحملة تسويقية. */
export function generateCampaignCoupon(type: CampaignType, discountPct: number): string {
  const token: Record<CampaignType, string> = {
    discount: `DISC${discountPct}`,
    cashback: `CASH${discountPct}`,
    seasonal: `SEASON${discountPct}`,
    referral: `REF${discountPct}`,
  };
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MAS-${token[type]}-${rand}`;
}

// With Supabase the campaigns live in `campaigns` (0005 + 0066); the store above
// is the demo fallback (localStorage).
const CAMPAIGN_COLUMNS =
  'id, name, type, discount_pct, start_at, end_at, is_active, usage_count, coupon_code, description, service_codes, platform_code, budget, owner_id, extended_until, is_draft, terms, branches(city)';

function fromCampaignRow(r: Record<string, unknown>): Campaign {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    type: r.type as CampaignType,
    discount_pct: Number(r.discount_pct ?? 0),
    start_at: (r.start_at as string | null) ?? '',
    end_at: (r.end_at as string | null) ?? '',
    is_active: Boolean(r.is_active),
    usage_count: Number(r.usage_count ?? 0),
    coupon_code: (r.coupon_code as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    service_codes: (r.service_codes as string[] | null) ?? [],
    platform_code: (r.platform_code as string | null) ?? null,
    branch: (r.branches as { city: string | null } | null)?.city ?? null,
    budget: r.budget === null || r.budget === undefined ? null : Number(r.budget),
    owner_id: (r.owner_id as string | null) ?? null,
    extended_until: (r.extended_until as string | null) ?? null,
    is_draft: Boolean(r.is_draft),
    terms: (r.terms as string | null) ?? null,
  };
}

const toCampaignRow = (input: Partial<CampaignInput>) => {
  // الحقول المعروضة فقط لا تُكتب؛ الفرع يُحوَّل لمعرّفه في campaignRow
  const { branch: _b, owner_name: _o, extended_until: _e, ...rest } = input;
  void _b;
  void _o;
  void _e;
  return { ...rest, start_at: input.start_at || null, end_at: input.end_at || null };
};

async function campaignRow(input: Partial<CampaignInput>) {
  const row: Record<string, unknown> = toCampaignRow(input);
  if ('branch' in input) {
    let id: string | null = null;
    if (input.branch) {
      const { data } = await supabase
        .from('branches')
        .select('id')
        .eq('city', input.branch)
        .maybeSingle();
      id = (data as { id: string } | null)?.id ?? null;
      if (!id) throw new Error(`الفرع «${input.branch}» غير موجود`);
    }
    row.branch_id = id;
  }
  return row;
}

export async function addCampaign(input: CampaignInput): Promise<Campaign> {
  // الحملة الجديدة تبدأ «مسودة» حتى تُفعَّل (0103)
  input = { ...input, is_draft: true };
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('campaigns')
      .insert(await campaignRow(input))
      .select(CAMPAIGN_COLUMNS)
      .single();
    if (error) throw new Error(`تعذّرت إضافة الحملة: ${error.message}`);
    return fromCampaignRow(data as Record<string, unknown>);
  }
  const campaign: Campaign = { ...input, id: `cm-${Date.now()}`, usage_count: 0 };
  CAMPAIGNS.unshift(campaign);
  persistCampaigns();
  return { ...campaign };
}

export async function updateCampaign(id: string, patch: Partial<CampaignInput>): Promise<Campaign> {
  if (!isDemoMode() && !isDemoId(id)) {
    const { data, error } = await supabase
      .from('campaigns')
      .update({ ...(await campaignRow(patch)), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(CAMPAIGN_COLUMNS)
      .single();
    if (error) throw new Error(`تعذّر تعديل الحملة: ${error.message}`);
    return fromCampaignRow(data as Record<string, unknown>);
  }
  const campaign = CAMPAIGNS.find((c) => c.id === id);
  if (!campaign) throw new Error('الحملة غير موجودة');
  Object.assign(campaign, patch);
  persistCampaigns();
  // the campaign's coupons follow its state and window (evaluate_promotion, 0066)
  syncCampaignCouponsLocal(id, {
    // مسودة = كوبون غير مقبول؛ النهاية تشمل التمديد (0103)
    is_active: campaign.is_active && !campaign.is_draft,
    start_at: campaign.start_at || null,
    end_at: campaign.extended_until || campaign.end_at || null,
    ...(campaign.service_codes ? { service_codes: campaign.service_codes } : {}),
  });
  return { ...campaign };
}

/** تفعيل حملة مسودة (publish_campaign — 0103). */
export async function publishCampaign(id: string): Promise<void> {
  if (!isDemoMode() && !isDemoId(id)) {
    const { error } = await supabase.rpc('publish_campaign', { p_campaign: id });
    if (error) throw new Error(error.message);
    return;
  }
  const c = CAMPAIGNS.find((x) => x.id === id);
  if (!c?.is_draft) throw new Error('الحملة ليست مسودة');
  c.is_draft = false;
  persistCampaigns();
  syncCampaignCouponsLocal(id, {
    is_active: c.is_active,
    start_at: c.start_at || null,
    end_at: c.extended_until || c.end_at || null,
  });
}

export async function removeCampaign(id: string): Promise<Campaign> {
  if (!isDemoMode() && !isDemoId(id)) {
    const { data, error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', id)
      .select(CAMPAIGN_COLUMNS)
      .single();
    if (error) throw new Error(`تعذّر حذف الحملة: ${error.message}`);
    return fromCampaignRow(data as Record<string, unknown>);
  }
  const idx = CAMPAIGNS.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error('الحملة غير موجودة');
  const [removed] = CAMPAIGNS.splice(idx, 1);
  persistCampaigns();
  syncCampaignCouponsLocal(id, {
    is_active: false,
    start_at: removed!.start_at || null,
    end_at: removed!.end_at || null,
  });
  return { ...removed! };
}

/**
 * A campaign's coupon is a real discount: mirror it into `promotions` so the
 * pricing calculator, quotes and contracts accept it. Cashback is not a price
 * discount, so its code is never a price coupon. A replaced code is disabled.
 */
export async function syncCampaignCoupon(c: Campaign, previousCode?: string | null): Promise<void> {
  if (previousCode && previousCode !== c.coupon_code) await disableCouponPromotion(previousCode);
  if (!c.coupon_code) return;
  if (c.type === 'cashback') {
    await disableCouponPromotion(c.coupon_code);
    return;
  }
  await upsertCouponPromotion({
    name: `حملة: ${c.name}`,
    code: c.coupon_code,
    description: 'كوبون حملة تسويقية من قسم الولاء والتسويق.',
    discount_pct: c.discount_pct,
    discount_amount: null,
    service_codes: [],
    min_base_amount: null,
    max_discount_amount: null,
    starts_at: c.start_at || null,
    ends_at: c.end_at || null,
    usage_limit: null,
    is_active: c.is_active && !c.is_draft,
    requires_code: true,
    campaign_id: isDemoId(c.id) && !isDemoMode() ? null : c.id,
  });
}

/**
 * A discount won on the wheel becomes a single-use coupon promotion, so the
 * customer can actually use it in a quote or contract.
 */
export async function issueWheelCoupon(prize: WheelPrize, customerName: string): Promise<void> {
  if (prize.prize_type !== 'discount' || !prize.coupon_code) return;
  await upsertCouponPromotion({
    name: `عجلة الحظ: ${prize.label} — ${customerName}`,
    code: prize.coupon_code,
    description: 'جائزة عجلة الحظ — استخدام واحد.',
    discount_pct: prize.value,
    discount_amount: null,
    // مقيّد بخدمات الجائزة وحدّها الأعلى وصلاحيتها (مرآة spin_wheel_core — 0101)
    service_codes: prize.service_codes ?? [],
    min_base_amount: null,
    max_discount_amount: prize.max_discount_amount ?? null,
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + (prize.coupon_valid_days ?? 30) * 86400000).toISOString(),
    usage_limit: prize.usage_limit ?? 1,
    is_active: true,
    requires_code: true,
  });
}

/** Campaign removed → its coupon stops working (the promotion is kept, disabled). */
export async function retireCampaignCoupon(code: string | null): Promise<void> {
  if (code) await disableCouponPromotion(code);
}

const REFERRALS: Referral[] = [
  {
    id: 'rf1',
    referrer_name: 'محمد الأحمدي',
    referee_name: 'تركي السبيعي',
    commission_amount: 200,
    is_paid: true,
    created_at: '2026-06-05T00:00:00Z',
  },
  {
    id: 'rf2',
    referrer_name: 'فهد العنزي',
    referee_name: 'ريم الحارثي',
    commission_amount: 200,
    is_paid: false,
    created_at: '2026-06-11T00:00:00Z',
  },
  {
    id: 'rf3',
    referrer_name: 'هند المالكي',
    referee_name: 'سعد القرني',
    commission_amount: 200,
    is_paid: false,
    created_at: '2026-06-12T00:00:00Z',
  },
];

export async function listLoyaltyTxns(): Promise<LoyaltyTxn[]> {
  return TXNS;
}

export async function listCampaigns(): Promise<Campaign[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('campaigns')
      .select(CAMPAIGN_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`تعذّر جلب الحملات: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(fromCampaignRow);
  }
  return CAMPAIGNS.map((c) => ({ ...c }));
}

export async function listReferrals(): Promise<Referral[]> {
  return REFERRALS;
}
