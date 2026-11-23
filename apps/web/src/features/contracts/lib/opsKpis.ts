/**
 * مؤشرات «لوحة متابعة العقود» — دالة واحدة للوضعين (الحي والتجريبي). المدخلات قوائم
 * تمرّ بصلاحيات المستخدم ونطاق فرعه (RLS)، والفلاتر تُطبَّق على العقد الأصلي.
 */
import type { ContractListItem } from '@/features/contracts/types';
import type {
  ContractServiceCode,
  ContractStatus,
} from '@/features/contracts/schemas/contract.schema';
import type { Refund, Replacement, Settlement } from '@/features/contracts/api/contractOps.api';
import type { Trial } from '@/features/contracts/api/trials.api';

export interface OpsFilters {
  branch: string | 'all';
  employee: string | 'all';
  service: ContractServiceCode | 'all';
  status: ContractStatus | 'all';
  from: string;
  to: string;
}

export const EMPTY_OPS_FILTERS: OpsFilters = {
  branch: 'all',
  employee: 'all',
  service: 'all',
  status: 'all',
  from: '',
  to: '',
};

export type KpiKey =
  | 'active'
  | 'cancelled'
  | 'awaiting_settlement'
  | 'refunds_pending'
  | 'refunded_total'
  | 'replacements'
  | 'trials_active'
  | 'trials_expiring'
  | 'transfers_pending';

export interface OpsData {
  contracts: ContractListItem[];
  settlements: Settlement[];
  refunds: Refund[];
  replacements: Replacement[];
  trials: Trial[];
}

export interface OpsKpis {
  values: Record<KpiKey, number>;
  /** the rows behind each KPI (contract ids) for the drill-down table */
  rows: Record<KpiKey, string[]>;
}

const SETTLEMENT_OPEN = ['draft', 'pending_review', 'pending_finance', 'approved'];
const REFUND_OPEN = [
  'draft',
  'pending_review',
  'pending_finance',
  'approved',
  'pending_payout',
  'partially_refunded',
];
const REPLACEMENT_OPEN = ['requested', 'pending_exception', 'eligible', 'scheduled'];

function dayOf(c: ContractListItem): string {
  return (c.start_date ?? c.created_at ?? '').slice(0, 10);
}

export function contractMatches(c: ContractListItem, f: OpsFilters): boolean {
  const branch = c.branch_name ?? c.branch_id ?? '';
  if (f.branch !== 'all' && branch !== f.branch && c.branch_id !== f.branch) return false;
  if (f.employee !== 'all' && c.created_by !== f.employee) return false;
  if (f.service !== 'all' && c.service_code !== f.service) return false;
  if (f.status !== 'all' && c.status !== f.status) return false;
  const d = dayOf(c);
  if (f.from && d < f.from) return false;
  if (f.to && d > f.to) return false;
  return true;
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function computeOpsKpis(
  data: OpsData,
  f: OpsFilters,
  opts: { today: string; expiringDays: number },
): OpsKpis {
  const inScope = new Map(
    data.contracts.filter((c) => contractMatches(c, f)).map((c) => [c.id, c]),
  );
  const scoped = <T extends { contract_id: string }>(xs: T[]) =>
    xs.filter((x) => inScope.has(x.contract_id));
  const ids = <T extends { contract_id: string }>(xs: T[]) => [
    ...new Set(xs.map((x) => x.contract_id)),
  ];

  const contracts = [...inScope.values()];
  const active = contracts.filter((c) => c.status === 'active');
  const cancelled = contracts.filter((c) => c.status === 'cancelled');
  const settlements = scoped(data.settlements).filter((s) => SETTLEMENT_OPEN.includes(s.status));
  const refunds = scoped(data.refunds);
  const refundsOpen = refunds.filter((r) => REFUND_OPEN.includes(r.status));
  const refundedRows = refunds.filter((r) => r.paid_total > 0);
  const replacements = scoped(data.replacements).filter((r) => REPLACEMENT_OPEN.includes(r.status));
  const trials = scoped(data.trials);
  const trialsActive = trials.filter((t) => t.status === 'in_trial');
  const horizon = addDays(opts.today, opts.expiringDays);
  const expiring = trialsActive.filter((t) => t.end_date >= opts.today && t.end_date <= horizon);
  const byId = new Map(data.contracts.map((c) => [c.id, c]));
  const transfers = trials.filter((t) => {
    if (t.status !== 'wants_transfer') return false;
    const x = t.transfer_contract_id ? byId.get(t.transfer_contract_id) : undefined;
    return !x || !['musaned_signed', 'active', 'completed'].includes(x.status);
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    values: {
      active: active.length,
      cancelled: cancelled.length,
      awaiting_settlement: settlements.length,
      refunds_pending: refundsOpen.length,
      refunded_total: round2(refunds.reduce((s, r) => s + r.paid_total, 0)),
      replacements: replacements.length,
      trials_active: trialsActive.length,
      trials_expiring: expiring.length,
      transfers_pending: transfers.length,
    },
    rows: {
      active: active.map((c) => c.id),
      cancelled: cancelled.map((c) => c.id),
      awaiting_settlement: ids(settlements),
      refunds_pending: ids(refundsOpen),
      refunded_total: ids(refundedRows),
      replacements: ids(replacements),
      trials_active: ids(trialsActive),
      trials_expiring: ids(expiring),
      transfers_pending: ids(transfers),
    },
  };
}

export const KPI_LABEL: Record<KpiKey, string> = {
  active: 'العقود النشطة',
  cancelled: 'العقود الملغاة',
  awaiting_settlement: 'بانتظار التسوية',
  refunds_pending: 'استردادات معلّقة',
  refunded_total: 'إجمالي المسترد',
  replacements: 'طلبات الاستبدال',
  trials_active: 'تجارب نشطة',
  trials_expiring: 'تجارب تنتهي قريباً',
  transfers_pending: 'نقل خدمات بانتظار الإجراء',
};
