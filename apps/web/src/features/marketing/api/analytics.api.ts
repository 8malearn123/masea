/**
 * «تحليل مصادر العملاء والمبيعات» — مع قاعدة البيانات: دوال 0099 (marketing_sources،
 * marketing_campaigns، marketing_breakdown) على البيانات الفعلية. الوضع التجريبي:
 * الحساب نفسه (computeSourceReport) على مخازن العرض — لا أرقام مكتوبة.
 *
 * ثلاثة مؤشرات مالية منفصلة: قيمة العقود (شامل الضريبة، غير الملغاة) ≠ الإيراد المحقق
 * (صافي العقود الموقّعة قبل الضريبة ناقص الإشعارات الدائنة) ≠ المحصّل (الدفعات المستلمة).
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { listLeads } from '@/features/crm/api/crm.api';
import { listContracts } from '@/features/contracts/api/contracts.api';
import { demoCreditNet } from '@/features/contracts/api/contractInvoices.api';
import { listCampaigns } from '@/features/loyalty/api/loyalty.api';
import { demoAcquisitions } from '@/features/marketing/api/attribution.api';
import { demoSpend } from '@/features/marketing/api/campaignSpend.api';
import type { ContractListItem } from '@/features/contracts/types';

export type AttributionModel = 'acquisition' | 'contract';

export interface ReportFilters {
  from: string;
  to: string;
  /** اسم الفرع (يُحوَّل لمعرّفه مع الخادم)؛ null = كل الفروع ضمن صلاحيتك */
  branch: string | null;
  service: string | null;
  model: AttributionModel;
}

export interface SourceRow {
  source_code: string | null;
  leads: number;
  converted_leads: number;
  customers: number;
  new_customers: number;
  contracts: number;
  contract_value: number;
  contract_net: number;
  revenue: number;
  collected: number;
  spend: number;
  conversion_rate: number | null;
  cpl: number | null;
  cac: number | null;
  roas: number | null;
}

export interface CampaignRow {
  campaign_id: string;
  name: string;
  platform_code: string | null;
  branch: string | null;
  status: 'draft' | 'active' | 'scheduled' | 'paused' | 'ended';
  start_at: string | null;
  end_at: string | null;
  budget: number | null;
  owner_id: string | null;
  spend: number;
  leads: number;
  contracts: number;
  contract_value: number;
  revenue: number;
  collected: number;
}

export interface BreakdownRow {
  dim_key: string | null;
  dim_label: string | null;
  source_code: string | null;
  contracts: number;
  contract_value: number;
  revenue: number;
  collected: number;
}

const SOLD = ['signed', 'active', 'musaned_signed', 'completed'];
const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10);
const inRange = (d: string, f: ReportFilters) => d >= f.from && d <= f.to;

export function campaignStatus(
  c: {
    is_draft?: boolean | undefined;
    is_active: boolean;
    start_at: string | null | undefined;
    end_at: string | null | undefined;
    extended_until?: string | null | undefined;
  },
  now = new Date().toISOString(),
): CampaignRow['status'] {
  if (c.is_draft) return 'draft';
  if (!c.is_active) return 'paused';
  if (c.start_at && now < c.start_at) return 'scheduled';
  const end = c.extended_until || c.end_at;
  if (end && now > end) return 'ended';
  return 'active';
}

export const CAMPAIGN_STATUS_LABEL: Record<CampaignRow['status'], string> = {
  draft: 'مسودة',
  active: 'نشطة',
  scheduled: 'مجدولة',
  paused: 'موقوفة',
  ended: 'منتهية',
};

/** تاريخ ووقت بتوقيت الرياض للعرض. */
export function riyadhDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/* --------------------------- pure mirror of 0099 --------------------------- */

export interface ReportData {
  leads: {
    source_code: string | null;
    customer_id: string | null;
    created_at: string;
    branch: string | null;
    service_code: string | null;
    campaign_id?: string | null;
  }[];
  contracts: (Pick<
    ContractListItem,
    | 'id'
    | 'customer_id'
    | 'status'
    | 'created_at'
    | 'total_amount'
    | 'base_amount'
    | 'amount_paid'
    | 'service_code'
    | 'created_by'
  > & {
    branch: string | null;
    source_code?: string | null | undefined;
    acquisition_source_code?: string | null | undefined;
    campaign_id?: string | null | undefined;
    credit_net?: number | undefined;
  })[];
  customers: {
    id: string;
    source_code: string | null;
    first_contact_at: string | null;
    branch: string | null;
  }[];
  spend: {
    campaign_id: string;
    platform_code: string | null;
    branch: string | null;
    service_codes: string[];
    spend_date: string;
    amount: number;
  }[];
}

export function computeSourceReport(d: ReportData, f: ReportFilters): SourceRow[] {
  const live = d.contracts.filter((c) => c.status !== 'cancelled');
  const k = live
    .filter(
      (c) =>
        inRange(day(c.created_at), f) &&
        (!f.branch || c.branch === f.branch) &&
        (!f.service || c.service_code === f.service),
    )
    .map((c) => ({
      ...c,
      src:
        f.model === 'contract'
          ? (c.source_code ?? c.acquisition_source_code ?? null)
          : (c.acquisition_source_code ?? null),
      rev: SOLD.includes(c.status) ? c.base_amount - (c.credit_net ?? 0) : 0,
    }));
  const firstOf = new Map<string, string>();
  for (const c of [...live].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    if (!firstOf.has(c.customer_id)) firstOf.set(c.customer_id, c.id);
  const leads = d.leads.filter(
    (l) =>
      inRange(day(l.created_at), f) &&
      (!f.branch || l.branch === f.branch) &&
      (!f.service || l.service_code === f.service),
  );
  const customers = d.customers.filter(
    (c) =>
      c.first_contact_at && inRange(c.first_contact_at, f) && (!f.branch || c.branch === f.branch),
  );
  const spend = d.spend.filter(
    (s) =>
      inRange(s.spend_date, f) &&
      (!f.branch || !s.branch || s.branch === f.branch) &&
      (!f.service || s.service_codes.length === 0 || s.service_codes.includes(f.service)),
  );
  const keys = new Set<string | null>([
    ...k.map((c) => c.src),
    ...leads.map((l) => l.source_code),
    ...customers.map((c) => c.source_code),
    ...spend.map((s) => s.platform_code),
  ]);
  const hasContract = (customerId: string | null) =>
    Boolean(customerId && live.some((c) => c.customer_id === customerId));
  return [...keys]
    .map((src): SourceRow => {
      const kk = k.filter((c) => c.src === src);
      const ll = leads.filter((l) => l.source_code === src);
      const sp = r2(spend.filter((s) => s.platform_code === src).reduce((a, s) => a + s.amount, 0));
      const converted = ll.filter((l) => hasContract(l.customer_id)).length;
      const newCustomers = new Set(
        kk.filter((c) => firstOf.get(c.customer_id) === c.id).map((c) => c.customer_id),
      ).size;
      const revenue = r2(kk.reduce((a, c) => a + c.rev, 0));
      return {
        source_code: src,
        leads: ll.length,
        converted_leads: converted,
        customers: customers.filter((c) => c.source_code === src).length,
        new_customers: newCustomers,
        contracts: kk.length,
        contract_value: r2(kk.reduce((a, c) => a + c.total_amount, 0)),
        contract_net: r2(kk.reduce((a, c) => a + c.base_amount, 0)),
        revenue,
        collected: r2(kk.reduce((a, c) => a + c.amount_paid, 0)),
        spend: sp,
        conversion_rate: ll.length ? Math.round((converted / ll.length) * 10000) / 10000 : null,
        cpl: sp > 0 && ll.length ? r2(sp / ll.length) : null,
        cac: sp > 0 && newCustomers ? r2(sp / newCustomers) : null,
        roas: sp > 0 ? r2(revenue / sp) : null,
      };
    })
    .sort((a, b) => b.contract_value - a.contract_value || b.leads - a.leads);
}

/* -------------------------------- loaders -------------------------------- */

async function branchIdOf(name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data } = await supabase.from('branches').select('id').eq('city', name).maybeSingle();
  const id = (data as { id: string } | null)?.id;
  if (!id) throw new Error(`الفرع «${name}» غير موجود`);
  return id;
}

async function demoData(): Promise<ReportData> {
  const [leads, contracts, campaigns] = await Promise.all([
    listLeads(),
    listContracts({ status: 'all', service: 'all', branch: 'all', search: '' }),
    listCampaigns(),
  ]);
  const camp = new Map(campaigns.map((c) => [c.id, c]));
  return {
    leads: leads.map((l) => ({
      source_code: l.source_code ?? null,
      customer_id: l.customer_id,
      created_at: l.created_at,
      branch: l.branch ?? null,
      service_code: l.service_code,
      campaign_id: l.campaign_id ?? null,
    })),
    contracts: contracts.map((c) => ({
      ...c,
      branch: c.branch_name ?? c.branch_id ?? null,
      credit_net: demoCreditNet(c.id),
    })),
    customers: demoAcquisitions().map((a) => ({
      id: a.customer_id,
      source_code: a.source_code,
      first_contact_at: a.first_contact_at,
      branch: null,
    })),
    spend: demoSpend().map((s) => {
      const c = camp.get(s.campaign_id);
      return {
        campaign_id: s.campaign_id,
        platform_code: c?.platform_code ?? null,
        branch: c?.branch ?? null,
        service_codes: c?.service_codes ?? [],
        spend_date: s.spend_date,
        amount: s.amount,
      };
    }),
  };
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function sourceReport(f: ReportFilters): Promise<SourceRow[]> {
  if (isDemoMode()) return computeSourceReport(await demoData(), f);
  const { data, error } = await supabase.rpc('marketing_sources', {
    p_from: f.from,
    p_to: f.to,
    p_branch: await branchIdOf(f.branch),
    p_service: f.service,
    p_model: f.model,
  });
  if (error) throw new Error(`تعذّر تحميل تقرير المصادر: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    source_code: (r.source_code as string | null) ?? null,
    leads: Number(r.leads),
    converted_leads: Number(r.converted_leads),
    customers: Number(r.customers),
    new_customers: Number(r.new_customers),
    contracts: Number(r.contracts),
    contract_value: Number(r.contract_value),
    contract_net: Number(r.contract_net),
    revenue: Number(r.revenue),
    collected: Number(r.collected),
    spend: Number(r.spend),
    conversion_rate: num(r.conversion_rate),
    cpl: num(r.cpl),
    cac: num(r.cac),
    roas: num(r.roas),
  }));
}

export async function campaignReport(
  f: Pick<ReportFilters, 'from' | 'to' | 'branch'>,
): Promise<CampaignRow[]> {
  if (isDemoMode()) {
    const [d, campaigns] = await Promise.all([demoData(), listCampaigns()]);
    const inR = (x: string) => x >= f.from && x <= f.to;
    return campaigns
      .filter((c) => !f.branch || !c.branch || c.branch === f.branch)
      .map((c) => {
        const ks = d.contracts.filter(
          (k) => k.campaign_id === c.id && k.status !== 'cancelled' && inR(day(k.created_at)),
        );
        return {
          campaign_id: c.id,
          name: c.name,
          platform_code: c.platform_code ?? null,
          branch: c.branch ?? null,
          status: campaignStatus(c),
          start_at: c.start_at || null,
          end_at: c.extended_until || c.end_at || null,
          budget: c.budget ?? null,
          owner_id: c.owner_id ?? null,
          spend: r2(
            d.spend
              .filter((s) => s.campaign_id === c.id && inR(s.spend_date))
              .reduce((a, s) => a + s.amount, 0),
          ),
          leads: d.leads.filter((l) => l.campaign_id === c.id && inR(day(l.created_at))).length,
          contracts: ks.length,
          contract_value: r2(ks.reduce((a, k) => a + k.total_amount, 0)),
          revenue: r2(
            ks
              .filter((k) => SOLD.includes(k.status))
              .reduce((a, k) => a + k.base_amount - (k.credit_net ?? 0), 0),
          ),
          collected: r2(ks.reduce((a, k) => a + k.amount_paid, 0)),
        };
      });
  }
  const { data, error } = await supabase.rpc('marketing_campaigns', {
    p_from: f.from,
    p_to: f.to,
    p_branch: await branchIdOf(f.branch),
  });
  if (error) throw new Error(`تعذّر تحميل أداء الحملات: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    campaign_id: String(r.campaign_id),
    name: String(r.name),
    platform_code: (r.platform_code as string | null) ?? null,
    branch: null,
    status: r.status as CampaignRow['status'],
    start_at: (r.start_at as string | null) ?? null,
    end_at: (r.end_at as string | null) ?? null,
    budget: num(r.budget),
    owner_id: (r.owner_id as string | null) ?? null,
    spend: Number(r.spend),
    leads: Number(r.leads),
    contracts: Number(r.contracts),
    contract_value: Number(r.contract_value),
    revenue: Number(r.revenue),
    collected: Number(r.collected),
  }));
}

export async function breakdownReport(
  f: Pick<ReportFilters, 'from' | 'to' | 'branch'>,
  dim: 'branch' | 'employee' | 'service',
  campaignId: string | null,
): Promise<BreakdownRow[]> {
  if (isDemoMode()) {
    const d = await demoData();
    const ks = d.contracts.filter(
      (k) =>
        k.status !== 'cancelled' &&
        day(k.created_at) >= f.from &&
        day(k.created_at) <= f.to &&
        (!f.branch || k.branch === f.branch) &&
        (!campaignId || k.campaign_id === campaignId),
    );
    const map = new Map<string, BreakdownRow>();
    for (const k of ks) {
      const key = dim === 'branch' ? k.branch : dim === 'employee' ? k.created_by : k.service_code;
      const src = k.source_code ?? k.acquisition_source_code ?? null;
      const id = `${key}|${src}`;
      const row = map.get(id) ?? {
        dim_key: key ?? null,
        dim_label: key ?? null,
        source_code: src,
        contracts: 0,
        contract_value: 0,
        revenue: 0,
        collected: 0,
      };
      row.contracts += 1;
      row.contract_value = r2(row.contract_value + k.total_amount);
      row.revenue = r2(
        row.revenue + (SOLD.includes(k.status) ? k.base_amount - (k.credit_net ?? 0) : 0),
      );
      row.collected = r2(row.collected + k.amount_paid);
      map.set(id, row);
    }
    return [...map.values()];
  }
  const { data, error } = await supabase.rpc('marketing_breakdown', {
    p_from: f.from,
    p_to: f.to,
    p_dim: dim,
    p_branch: await branchIdOf(f.branch),
    p_campaign: campaignId,
  });
  if (error) throw new Error(`تعذّر تحميل التوزيع: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    dim_key: (r.dim_key as string | null) ?? null,
    dim_label: (r.dim_label as string | null) ?? null,
    source_code: (r.source_code as string | null) ?? null,
    contracts: Number(r.contracts),
    contract_value: Number(r.contract_value),
    revenue: Number(r.revenue),
    collected: Number(r.collected),
  }));
}

export interface CampaignSummary {
  redemptions: number;
  discount_total: number;
  customers: number;
  contracts: number;
  contracts_value: number;
}

/** نتائج الحملة المحفوظة بعد انتهائها (campaign_summary — 0103). */
export async function campaignSummary(campaignId: string): Promise<CampaignSummary> {
  if (isDemoMode()) {
    const { listPromotions } = await import('@/features/pricing/api/promotions.api');
    const [contracts, promos] = await Promise.all([
      listContracts({ status: 'all', service: 'all', branch: 'all', search: '' }),
      listPromotions(),
    ]);
    const ids = new Set(promos.filter((p) => p.campaign_id === campaignId).map((p) => p.id));
    const ks = contracts.filter(
      (k) =>
        k.status !== 'cancelled' &&
        (k.campaign_id === campaignId || (k.promotion_id && ids.has(k.promotion_id))),
    );
    const red = ks.filter((k) => k.promotion_id && ids.has(k.promotion_id));
    return {
      redemptions: red.length,
      discount_total: r2(red.reduce((s, k) => s + (k.discount_amount ?? 0), 0)),
      customers: new Set(ks.map((k) => k.customer_id)).size,
      contracts: ks.length,
      contracts_value: r2(ks.reduce((s, k) => s + k.total_amount, 0)),
    };
  }
  const { data, error } = await supabase.rpc('campaign_summary', { p_campaign: campaignId });
  if (error) throw new Error(error.message);
  const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {};
  return {
    redemptions: Number(r.redemptions ?? 0),
    discount_total: Number(r.discount_total ?? 0),
    customers: Number(r.customers ?? 0),
    contracts: Number(r.contracts ?? 0),
    contracts_value: Number(r.contracts_value ?? 0),
  };
}
