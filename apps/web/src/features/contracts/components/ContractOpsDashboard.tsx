import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Ban,
  Banknote,
  CircleDollarSign,
  FileCheck2,
  FlaskConical,
  Gauge,
  Hourglass,
  Scale,
  Timer,
} from 'lucide-react';
import { Badge, Card, ErrorState, Input, Select, Skeleton, StatTile, Table } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { BRANCHES_AR } from '@/lib/funnel';
import { useContracts } from '@/features/contracts/hooks/useContracts';
import { opsKeys, useRefunds, useSettlements } from '@/features/contracts/hooks/useContractOps';
import { useTrials } from '@/features/contracts/hooks/useTrials';
import { listReplacements } from '@/features/contracts/api/contractOps.api';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { CONTRACT_STATUS_LABEL } from '@/features/contracts/lib/contractState';
import { StatusBadge } from '@/features/contracts/components/StatusBadge';
import {
  computeOpsKpis,
  EMPTY_OPS_FILTERS,
  KPI_LABEL,
  type KpiKey,
  type OpsFilters,
} from '@/features/contracts/lib/opsKpis';
import { branchLabel, SERVICE_LABEL, type ContractListItem } from '@/features/contracts/types';
import type {
  ContractServiceCode,
  ContractStatus,
} from '@/features/contracts/schemas/contract.schema';
import type { LucideIcon } from 'lucide-react';

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

const TILES: {
  key: KpiKey;
  icon: LucideIcon;
  tone: 'navy' | 'success' | 'warning' | 'danger' | 'neutral';
}[] = [
  { key: 'active', icon: FileCheck2, tone: 'success' },
  { key: 'cancelled', icon: Ban, tone: 'neutral' },
  { key: 'awaiting_settlement', icon: Scale, tone: 'warning' },
  { key: 'refunds_pending', icon: Hourglass, tone: 'warning' },
  { key: 'refunded_total', icon: CircleDollarSign, tone: 'navy' },
  { key: 'replacements', icon: ArrowLeftRight, tone: 'navy' },
  { key: 'trials_active', icon: FlaskConical, tone: 'success' },
  { key: 'trials_expiring', icon: Timer, tone: 'danger' },
  { key: 'transfers_pending', icon: Banknote, tone: 'warning' },
];

function useAllReplacements() {
  return useQuery({
    queryKey: [...opsKeys.all, 'replacements-all'],
    queryFn: () => listReplacements(),
  });
}

/** أسماء منشئي العقود (فلتر الموظف) — من user_profiles عند ربط قاعدة البيانات. */
function useStaffNames(ids: string[]) {
  return useQuery({
    queryKey: ['contract-ops', 'staff-names', ids],
    enabled: ids.length > 0 && !isDemoMode(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name')
        .in('id', ids);
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((r) => [r.id as string, r.full_name as string]));
    },
  });
}

/** «لوحة متابعة العقود» — المؤشرات التشغيلية مع الفلاتر والتفاصيل. */
export default function ContractOpsDashboard() {
  const contractsQ = useContracts(ALL);
  const settlementsQ = useSettlements();
  const refundsQ = useRefunds();
  const replacementsQ = useAllReplacements();
  const trialsQ = useTrials();
  const { data: config = [] } = useConfig();
  const [f, setF] = useState<OpsFilters>(EMPTY_OPS_FILTERS);
  const [selected, setSelected] = useState<KpiKey>('active');

  const contracts = useMemo(() => contractsQ.data ?? [], [contractsQ.data]);
  const creators = useMemo(
    () => [...new Set(contracts.map((c) => c.created_by).filter((x): x is string => Boolean(x)))],
    [contracts],
  );
  const { data: names } = useStaffNames(creators);
  const queries = [contractsQ, settlementsQ, refundsQ, replacementsQ, trialsQ];
  const loading = queries.some((q) => q.isLoading);
  const error = queries.find((q) => q.isError);

  const kpis = useMemo(
    () =>
      computeOpsKpis(
        {
          contracts,
          settlements: settlementsQ.data ?? [],
          refunds: refundsQ.data ?? [],
          replacements: replacementsQ.data ?? [],
          trials: trialsQ.data ?? [],
        },
        f,
        {
          today: new Date().toISOString().slice(0, 10),
          expiringDays: configValue(config, 'trial_expiring_alert_days', 3),
        },
      ),
    [contracts, settlementsQ.data, refundsQ.data, replacementsQ.data, trialsQ.data, f, config],
  );
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const rows = kpis.rows[selected]
    .map((id) => byId.get(id))
    .filter((c): c is ContractListItem => Boolean(c));
  const set = (p: Partial<OpsFilters>) => setF((x) => ({ ...x, ...p }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <Gauge size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">لوحة متابعة العقود</h1>
            <p className="text-sm text-purple">
              الإلغاء والتسوية والاسترداد والاستبدال وتجارب نقل الخدمات في مكان واحد.
            </p>
          </div>
        </div>
        <Link to="/contracts" className="text-sm font-semibold text-navy underline">
          قائمة العقود
        </Link>
      </div>

      <Card>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Select
            label="الفرع"
            value={f.branch}
            onChange={(e) => set({ branch: e.target.value })}
            options={[
              { value: 'all', label: 'كل الفروع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
          />
          <Select
            label="الموظف"
            value={f.employee}
            onChange={(e) => set({ employee: e.target.value })}
            options={[
              { value: 'all', label: 'كل الموظفين' },
              ...creators.map((id) => ({ value: id, label: names?.get(id) ?? 'موظف' })),
            ]}
          />
          <Select
            label="نوع الخدمة"
            value={f.service}
            onChange={(e) => set({ service: e.target.value as ContractServiceCode | 'all' })}
            options={[
              { value: 'all', label: 'كل الخدمات' },
              ...(Object.keys(SERVICE_LABEL) as ContractServiceCode[]).map((s) => ({
                value: s,
                label: SERVICE_LABEL[s],
              })),
            ]}
          />
          <Select
            label="حالة العقد"
            value={f.status}
            onChange={(e) => set({ status: e.target.value as ContractStatus | 'all' })}
            options={[
              { value: 'all', label: 'كل الحالات' },
              ...(Object.keys(CONTRACT_STATUS_LABEL) as ContractStatus[]).map((s) => ({
                value: s,
                label: CONTRACT_STATUS_LABEL[s],
              })),
            ]}
          />
          <Input
            label="من تاريخ"
            type="date"
            value={f.from}
            onChange={(e) => set({ from: e.target.value })}
          />
          <Input
            label="إلى تاريخ"
            type="date"
            value={f.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
        <p className="mt-2 text-[11px] text-purple">
          الفترة على تاريخ بداية العقد. كل المؤشرات ضمن صلاحياتك ونطاق فرعك.
        </p>
      </Card>

      {error ? (
        <ErrorState onRetry={() => queries.forEach((q) => void q.refetch())} />
      ) : loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TILES.map((t) => (
            <Skeleton key={t.key} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TILES.map((t) => (
              <StatTile
                key={t.key}
                label={KPI_LABEL[t.key]}
                value={
                  t.key === 'refunded_total' ? `${sar(kpis.values[t.key])} ر.س` : kpis.values[t.key]
                }
                icon={t.icon}
                tone={t.tone}
                active={selected === t.key}
                onClick={() => setSelected(t.key)}
              />
            ))}
          </div>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
              {KPI_LABEL[selected]} <Badge tone="navy">{rows.length}</Badge>
            </h2>
            <Table<ContractListItem>
              rows={rows}
              rowKey={(c) => c.id}
              emptyTitle="لا عقود في هذا المؤشر ضمن الفلاتر"
              columns={[
                {
                  key: 'no',
                  header: 'العقد',
                  sortValue: (c) => c.contract_no ?? '',
                  cell: (c) => (
                    <Link
                      to={`/contracts/${c.id}`}
                      className="num font-semibold text-navy hover:underline"
                    >
                      {c.contract_no}
                    </Link>
                  ),
                },
                { key: 'customer', header: 'العميل', cell: (c) => c.customer_name ?? '—' },
                { key: 'worker', header: 'العاملة', cell: (c) => c.worker_name ?? '—' },
                {
                  key: 'service',
                  header: 'الخدمة',
                  cell: (c) => (c.service_code ? SERVICE_LABEL[c.service_code] : '—'),
                },
                { key: 'branch', header: 'الفرع', cell: (c) => branchLabel(c) },
                {
                  key: 'start',
                  header: 'البداية',
                  sortValue: (c) => c.start_date ?? '',
                  cell: (c) => <span className="num">{dateAr(c.start_date)}</span>,
                },
                {
                  key: 'total',
                  header: 'القيمة',
                  sortValue: (c) => c.total_amount,
                  cell: (c) => <span className="num">{sar(c.total_amount)}</span>,
                },
                { key: 'status', header: 'الحالة', cell: (c) => <StatusBadge status={c.status} /> },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
