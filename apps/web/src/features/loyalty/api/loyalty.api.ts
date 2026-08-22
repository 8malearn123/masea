import type {
  Campaign,
  CampaignInput,
  CampaignType,
  LoyaltyTxn,
  Referral,
} from '@/features/loyalty/types';

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

export function addCampaign(input: CampaignInput): Campaign {
  const campaign: Campaign = { ...input, id: `cm-${Date.now()}`, usage_count: 0 };
  CAMPAIGNS.unshift(campaign);
  persistCampaigns();
  return { ...campaign };
}

export function updateCampaign(id: string, patch: Partial<CampaignInput>): Campaign {
  const campaign = CAMPAIGNS.find((c) => c.id === id);
  if (!campaign) throw new Error('الحملة غير موجودة');
  Object.assign(campaign, patch);
  persistCampaigns();
  return { ...campaign };
}

export function removeCampaign(id: string): void {
  const idx = CAMPAIGNS.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error('الحملة غير موجودة');
  CAMPAIGNS.splice(idx, 1);
  persistCampaigns();
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
  return CAMPAIGNS.map((c) => ({ ...c }));
}

export async function listReferrals(): Promise<Referral[]> {
  return REFERRALS;
}
