import { supabase } from '@/lib/supabase';

export type LatestStatus = 'active' | 'approved' | 'awaiting_signature' | 'signed' | 'completed';

export interface Kpi {
  value: number;
  delta: number; // % change vs previous period
  money?: boolean;
}
export interface RevenuePoint {
  month: string;
  value: number; // بالألف ريال
}
export interface ServiceSlice {
  code: string;
  label: string;
  count: number;
  pct: number;
}
export interface LatestContract {
  contract_no: string;
  customer: string;
  worker: string;
  total: number;
  status: LatestStatus;
}
export interface NationalityRow {
  name: string;
  count: number;
}

export interface Overview {
  kpis: { workers: Kpi; activeContracts: Kpi; newRequests: Kpi; monthRevenue: Kpi };
  revenue: RevenuePoint[];
  services: ServiceSlice[];
  latest: LatestContract[];
  nationalities: NationalityRow[];
}

/* representative demo aggregates (presentation-focused; real Supabase overrides counts) */
const DEMO: Overview = {
  kpis: {
    workers: { value: 2048, delta: 12 },
    activeContracts: { value: 312, delta: 8 },
    newRequests: { value: 47, delta: 23 },
    monthRevenue: { value: 840000, delta: 15, money: true },
  },
  revenue: [
    { month: 'ينا', value: 610 },
    { month: 'فبر', value: 680 },
    { month: 'مار', value: 720 },
    { month: 'أبر', value: 700 },
    { month: 'ماي', value: 780 },
    { month: 'يون', value: 760 },
    { month: 'يول', value: 810 },
    { month: 'أغس', value: 840 },
  ],
  services: [
    { code: 'recruitment', label: 'استقدام', count: 140, pct: 45 },
    { code: 'monthly_rental', label: 'تأجير شهري', count: 78, pct: 25 },
    { code: 'daily_rental', label: 'تأجير يومي', count: 56, pct: 18 },
    { code: 'sponsorship_transfer', label: 'نقل كفالة', count: 38, pct: 12 },
  ],
  latest: [
    {
      contract_no: 'MAS-2026-00112',
      customer: 'محمد الأحمدي',
      worker: 'ماريا سانتوس',
      total: 18400,
      status: 'active',
    },
    {
      contract_no: 'MAS-2026-00111',
      customer: 'نورة الشهري',
      worker: 'سيتي نورهاليزا',
      total: 16100,
      status: 'approved',
    },
    {
      contract_no: 'MAS-2026-00110',
      customer: 'عبدالعزيز اليامي',
      worker: 'غريس وانجيرو',
      total: 17825,
      status: 'awaiting_signature',
    },
    {
      contract_no: 'MAS-2026-00109',
      customer: 'سارة القحطاني',
      worker: 'نيلوكا فرناندو',
      total: 7590,
      status: 'active',
    },
    {
      contract_no: 'MAS-2026-00108',
      customer: 'فهد العنزي',
      worker: 'روكسانا بيغم',
      total: 540,
      status: 'completed',
    },
  ],
  nationalities: [
    { name: 'إندونيسيا', count: 640 },
    { name: 'الفلبين', count: 520 },
    { name: 'كينيا', count: 380 },
    { name: 'إثيوبيا', count: 310 },
    { name: 'سريلانكا', count: 198 },
  ],
};

/** Company overview: real counts from Supabase when connected; demo aggregates otherwise. */
export async function getOverview(): Promise<Overview> {
  try {
    const [workers, active, contracts] = await Promise.all([
      supabase.from('workers').select('id', { count: 'exact', head: true }),
      supabase
        .from('contracts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase.from('contracts').select('total_amount, status'),
    ]);
    if ((workers.count ?? 0) > 0 && contracts.data && contracts.data.length > 0) {
      const revenue = (contracts.data as { total_amount: number; status: string }[])
        .filter((c) => c.status === 'active')
        .reduce((s, c) => s + Number(c.total_amount ?? 0), 0);
      return {
        ...DEMO,
        kpis: {
          workers: { value: workers.count ?? 0, delta: 12 },
          activeContracts: { value: active.count ?? 0, delta: 8 },
          newRequests: DEMO.kpis.newRequests,
          monthRevenue: { value: revenue, delta: 15, money: true },
        },
      };
    }
  } catch {
    /* fall through to demo */
  }
  return DEMO;
}
