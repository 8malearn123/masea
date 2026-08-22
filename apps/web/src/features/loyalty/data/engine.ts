/**
 * Demo loyalty engine — a faithful client-side mirror of the 0020 DB layer
 * (config + tiers + ledgers + wheel + functions). Lets the module work live in
 * demo mode; once Supabase is connected the same logic runs in calc/award/spin
 * RPCs. Points & wallet are ledgers: balance = SUM(entries).
 */
import type {
  LoyaltyAccount,
  LoyaltyConfig,
  LoyaltyCustomerSummary,
  LoyaltyPackage,
  PointsEntry,
  PrizeType,
  TierInfo,
  WalletEntry,
  WheelPrize,
  WheelPrizeInput,
} from '@/features/loyalty/types';

export const LOYALTY_CONFIG: LoyaltyConfig = {
  points_per_riyal: 1,
  redeem_points_per_riyal: 100, // 100 نقطة = 1 ريال
  referral_commission_pct: 5,
  wheel_spins_per_customer: 1,
  first_order_discount_pct: 10,
};

export const TIERS: TierInfo[] = [
  { tier: 'bronze', label: 'برونز', min_spend: 0, multiplier: 1.0 },
  { tier: 'silver', label: 'فضي', min_spend: 10000, multiplier: 1.25 },
  { tier: 'gold', label: 'ذهبي', min_spend: 30000, multiplier: 1.5 },
];

// ---------------------------------------------------------------------------
// Wheel prizes — a mutable, admin-managed store (add / edit / disable / delete
// + coupon codes). Persisted to localStorage in demo mode; once Supabase is
// connected the same shape maps to a wheel_prizes table with RLS + has_perm.
// No hardcoded prize list in the UI: everything below is editable from الإدارة.
// ---------------------------------------------------------------------------
const DEFAULT_WHEEL_PRIZES: WheelPrize[] = [
  { id: 'w1', label: '100 نقطة', prize_type: 'points', value: 100, probability: 30, active: true, coupon_code: null }, // prettier-ignore
  { id: 'w2', label: '20 ريال محفظة', prize_type: 'wallet', value: 20, probability: 20, active: true, coupon_code: null }, // prettier-ignore
  { id: 'w3', label: 'خصم 10٪', prize_type: 'discount', value: 10, probability: 20, active: true, coupon_code: 'MAS-DISC10-7K2A' }, // prettier-ignore
  { id: 'w4', label: '500 نقطة', prize_type: 'points', value: 500, probability: 10, active: true, coupon_code: null }, // prettier-ignore
  { id: 'w5', label: 'تأجيل مجاني', prize_type: 'free_service', value: 1, probability: 8, active: true, coupon_code: 'MAS-FREE-3M9X' }, // prettier-ignore
  { id: 'w6', label: '50 ريال محفظة', prize_type: 'wallet', value: 50, probability: 5, active: true, coupon_code: null }, // prettier-ignore
  { id: 'w7', label: 'حظ أوفر', prize_type: 'none', value: 0, probability: 7, active: true, coupon_code: null }, // prettier-ignore
];

/** ألوان شرائح العجلة — تُستخدم في العجلة ولوحة الإدارة معاً. */
export const WHEEL_COLORS = [
  '#1B1564',
  '#C8970A',
  '#58B3B3',
  '#564E85',
  '#241C82',
  '#A87E08',
  '#16A34A',
];

const PRIZES_LS_KEY = 'masea_wheel_prizes';

function loadWheelPrizes(): WheelPrize[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(PRIZES_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WheelPrize[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    }
  } catch {
    // نتجاهل تلف التخزين ونعود للبذرة الافتراضية
  }
  return DEFAULT_WHEEL_PRIZES.map((p) => ({ ...p }));
}

// المخزن الحي — نفس المرجع يُستخدم في كل مكان؛ نعدّله في مكانه ونحفظه.
export const WHEEL_PRIZES: WheelPrize[] = loadWheelPrizes();

function persistWheelPrizes(): void {
  try {
    localStorage?.setItem(PRIZES_LS_KEY, JSON.stringify(WHEEL_PRIZES));
  } catch {
    // وضع التجربة قد يمنع التخزين — نُبقي التعديل في الذاكرة
  }
}

/** توليد كود كوبون مباشر للجائزة (خصم/خدمة مجانية/محفظة/نقاط). */
export function generateCouponCode(prizeType: PrizeType, value: number): string {
  const token: Record<PrizeType, string> = {
    discount: `DISC${value}`,
    free_service: 'FREE',
    wallet: `WLT${value}`,
    points: `PTS${value}`,
    none: 'LUCK',
  };
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MAS-${token[prizeType]}-${rand}`;
}

export function listWheelPrizes(): WheelPrize[] {
  return WHEEL_PRIZES.map((p) => ({ ...p }));
}

export function addWheelPrize(input: WheelPrizeInput): WheelPrize {
  const prize: WheelPrize = { ...input, id: `w-${Date.now()}` };
  WHEEL_PRIZES.push(prize);
  persistWheelPrizes();
  return { ...prize };
}

export function updateWheelPrize(id: string, patch: Partial<WheelPrizeInput>): WheelPrize {
  const prize = WHEEL_PRIZES.find((p) => p.id === id);
  if (!prize) throw new Error('الجائزة غير موجودة');
  Object.assign(prize, patch);
  persistWheelPrizes();
  return { ...prize };
}

export function removeWheelPrize(id: string): void {
  const idx = WHEEL_PRIZES.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error('الجائزة غير موجودة');
  if (WHEEL_PRIZES.filter((p) => p.active).length <= 1 && WHEEL_PRIZES[idx]!.active) {
    throw new Error('يجب إبقاء جائزة مفعّلة واحدة على الأقل');
  }
  WHEEL_PRIZES.splice(idx, 1);
  persistWheelPrizes();
}

export const PACKAGES: LoyaltyPackage[] = [
  {
    id: 'pk1',
    name: 'باقة العائلة',
    included: ['استقدام', 'خدمة يومية شهر'],
    special_price: 17500,
  },
  {
    id: 'pk2',
    name: 'باقة المنزل المتكامل',
    included: ['تأجير شهري', 'نقل كفالة'],
    special_price: 4200,
  },
];

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface Store {
  id: string;
  customer_name: string;
  phone: string;
  referral_code: string;
  total_spend: number;
  spins_used: number;
  points: PointsEntry[];
  wallet: WalletEntry[];
}

// عملاء ولاء تجريبيون (يماثلون عملاء CRM/مركز الاتصال). أول عميل ثابت البذرة
// لأن اختبارات المحرّك تعتمده كعميل افتراضي.
const STORES: Store[] = [
  {
    id: 'c-mhd',
    customer_name: 'محمد الأحمدي',
    phone: '0555100301',
    referral_code: 'MAS-MHD-7K2',
    total_spend: 21000,
    spins_used: 0,
    points: [
      { id: 'p1', type: 'earn', points: 16000, description: 'عقد استقدام', at: '2026-05-02T09:00:00Z' }, // prettier-ignore
      { id: 'p2', type: 'earn', points: 5000, description: 'تأجير شهري', at: '2026-05-20T09:00:00Z' }, // prettier-ignore
      { id: 'p3', type: 'redeem', points: -3000, description: 'استبدال — خصم تجديد', at: '2026-06-01T09:00:00Z' }, // prettier-ignore
    ],
    wallet: [
      { id: 'wl1', type: 'credit', amount: 200, source: 'referral', description: 'عمولة إحالة', at: '2026-05-10T09:00:00Z' }, // prettier-ignore
      { id: 'wl2', type: 'credit', amount: 50, source: 'cashback', description: 'استرداد نقدي', at: '2026-05-22T09:00:00Z' }, // prettier-ignore
    ],
  },
  {
    id: 'c-sara',
    customer_name: 'سارة القحطاني',
    phone: '0555100302',
    referral_code: 'MAS-SARA-4T9',
    total_spend: 12500,
    spins_used: 0,
    points: [
      { id: 'sp1', type: 'earn', points: 9000, description: 'عقد استقدام', at: '2026-04-18T09:00:00Z' }, // prettier-ignore
      { id: 'sp2', type: 'earn', points: 3500, description: 'تأجير شهري', at: '2026-05-28T09:00:00Z' }, // prettier-ignore
    ],
    wallet: [
      { id: 'swl1', type: 'credit', amount: 120, source: 'cashback', description: 'استرداد نقدي', at: '2026-05-30T09:00:00Z' }, // prettier-ignore
    ],
  },
  {
    id: 'c-fahd',
    customer_name: 'فهد العنزي',
    phone: '0555100303',
    referral_code: 'MAS-FAHD-2P5',
    total_spend: 5200,
    spins_used: 1,
    points: [
      { id: 'fp1', type: 'earn', points: 5200, description: 'تأجير يومي', at: '2026-06-03T09:00:00Z' }, // prettier-ignore
    ],
    wallet: [
      { id: 'fwl1', type: 'credit', amount: 200, source: 'referral', description: 'عمولة إحالة', at: '2026-06-06T09:00:00Z' }, // prettier-ignore
    ],
  },
  {
    id: 'c-noura',
    customer_name: 'نورة الشهري',
    phone: '0555100304',
    referral_code: 'MAS-NOURA-8L3',
    total_spend: 34000,
    spins_used: 0,
    points: [
      { id: 'np1', type: 'earn', points: 20000, description: 'عقد استقدام', at: '2026-03-11T09:00:00Z' }, // prettier-ignore
      { id: 'np2', type: 'earn', points: 14000, description: 'باقة المنزل المتكامل', at: '2026-05-01T09:00:00Z' }, // prettier-ignore
    ],
    wallet: [
      { id: 'nwl1', type: 'credit', amount: 300, source: 'referral', description: 'عمولة إحالة', at: '2026-05-04T09:00:00Z' }, // prettier-ignore
    ],
  },
];

const PRIMARY_ID = STORES[0]!.id;

function findStore(customerId?: string): Store {
  return STORES.find((s) => s.id === customerId) ?? STORES[0]!;
}

function tierFor(spend: number): TierInfo {
  return [...TIERS].reverse().find((t) => spend >= t.min_spend) ?? TIERS[0]!;
}

function balanceOf(store: Store): number {
  return store.points.reduce((s, e) => s + e.points, 0);
}

/** قائمة عملاء الولاء للاستعلام والاختيار. */
export function listLoyaltyCustomers(): LoyaltyCustomerSummary[] {
  return STORES.map((s) => {
    const tier = tierFor(s.total_spend);
    return {
      id: s.id,
      name: s.customer_name,
      phone: s.phone,
      tier: tier.tier,
      tier_label: tier.label,
      points_balance: balanceOf(s),
    };
  });
}

export function getAccount(customerId: string = PRIMARY_ID): LoyaltyAccount {
  const store = findStore(customerId);
  const points_balance = balanceOf(store);
  const wallet_balance = round2(
    store.wallet.reduce((s, e) => s + (e.type === 'credit' ? e.amount : -e.amount), 0),
  );
  const current = tierFor(store.total_spend);
  const next = TIERS.find((t) => t.min_spend > store.total_spend) ?? null;
  const progress_pct = next
    ? Math.min(100, Math.round((store.total_spend / next.min_spend) * 100))
    : 100;

  return {
    customer_id: store.id,
    customer_name: store.customer_name,
    phone: store.phone,
    referral_code: store.referral_code,
    points_balance,
    wallet_balance,
    total_spend: store.total_spend,
    tier: current.tier,
    tier_label: current.label,
    next_tier: next,
    progress_pct,
    multiplier: current.multiplier,
    spins_left: Math.max(LOYALTY_CONFIG.wheel_spins_per_customer - store.spins_used, 0),
    points_ledger: [...store.points].reverse(),
    wallet_ledger: [...store.wallet].reverse(),
  };
}

/** redeem_points mirror — guards balance, returns SAR value. */
export function redeemPoints(points: number, customerId: string = PRIMARY_ID): number {
  const store = findStore(customerId);
  if (points <= 0) throw new Error('عدد النقاط غير صالح');
  if (balanceOf(store) < points) throw new Error('رصيد النقاط غير كافٍ');
  store.points.push({
    id: `p-${Date.now()}`,
    type: 'redeem',
    points: -points,
    description: 'استبدال نقاط',
    at: new Date().toISOString(),
  });
  return round2(points / LOYALTY_CONFIG.redeem_points_per_riyal);
}

/** award_points mirror — points × tier multiplier; bumps spend & tier. */
export function awardPoints(orderTotal: number, customerId: string = PRIMARY_ID): number {
  const store = findStore(customerId);
  const mult = tierFor(store.total_spend).multiplier;
  const pts = Math.floor(orderTotal * LOYALTY_CONFIG.points_per_riyal * mult);
  store.points.push({
    id: `p-${Date.now()}`,
    type: 'earn',
    points: pts,
    description: 'نقاط على طلب مدفوع',
    at: new Date().toISOString(),
  });
  store.total_spend += orderTotal;
  return pts;
}

/** spin_wheel mirror — weighted pick (server-side in production), once per limit. */
export function spinWheel(customerId: string = PRIMARY_ID): WheelPrize {
  const store = findStore(customerId);
  if (store.spins_used >= LOYALTY_CONFIG.wheel_spins_per_customer) {
    throw new Error('تجاوزت عدد محاولات عجلة الحظ المسموحة');
  }
  const pool = WHEEL_PRIZES.filter((p) => p.active);
  if (pool.length === 0) throw new Error('لا توجد جوائز مفعّلة على العجلة');
  const total = pool.reduce((s, p) => s + p.probability, 0);
  let r = Math.random() * total;
  let prize = pool[pool.length - 1]!;
  for (const p of pool) {
    r -= p.probability;
    if (r <= 0) {
      prize = p;
      break;
    }
  }
  store.spins_used += 1;
  if (prize.prize_type === 'points') {
    store.points.push({
      id: `p-${Date.now()}`,
      type: 'prize',
      points: prize.value,
      description: `جائزة عجلة الحظ: ${prize.label}`,
      at: new Date().toISOString(),
    });
  } else if (prize.prize_type === 'wallet') {
    store.wallet.push({
      id: `wl-${Date.now()}`,
      type: 'credit',
      amount: prize.value,
      source: 'prize',
      description: `جائزة عجلة الحظ: ${prize.label}`,
      at: new Date().toISOString(),
    });
  }
  return prize;
}
