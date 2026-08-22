import { Target, Trophy, Medal, Star } from 'lucide-react';
import { Badge, Card, Table, type Column } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { useTargets } from '@/features/targets/hooks/useTargets';
import { achievementPct, type TargetRow } from '@/features/targets/types';

function Kpi({
  label,
  value,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="text-xs text-purple">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

const MEDAL = ['text-gold-600', 'text-purple', 'text-gold-600'];

export default function TargetsBoard() {
  const { data: rows = [], isLoading, isError, refetch } = useTargets();

  const leaderboard = [...rows].sort((a, b) => achievementPct(b) - achievementPct(a));
  const top3 = leaderboard.slice(0, 3);

  const totalContractsTarget = rows.reduce((s, r) => s + r.contracts_target, 0);
  const totalContractsAchieved = rows.reduce((s, r) => s + r.contracts_achieved, 0);
  const totalRewards = rows.reduce((s, r) => s + r.reward_amount, 0);
  const overallPct = totalContractsTarget
    ? Math.round((totalContractsAchieved / totalContractsTarget) * 100)
    : 0;

  const columns: Column<TargetRow>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (t) => (
        <div>
          <span className="font-semibold text-navy">{t.employee_name}</span>
          <span className="block text-[11px] text-purple">
            {t.role_label} · {t.branch}
          </span>
        </div>
      ),
    },
    {
      key: 'contracts',
      header: 'العقود',
      cell: (t) => (
        <span className="num text-xs">
          {t.contracts_achieved} / {t.contracts_target}
        </span>
      ),
    },
    {
      key: 'collection',
      header: 'التحصيل',
      cell: (t) => (
        <span className="num text-xs">
          {sar(t.collection_achieved)} / {sar(t.collection_target)}
        </span>
      ),
    },
    {
      key: 'rating',
      header: 'التقييم',
      cell: (t) => (
        <span className="num flex items-center gap-0.5 text-xs text-gold-600">
          {t.avg_rating.toFixed(1)} <Star size={11} className="fill-gold text-gold" />
        </span>
      ),
    },
    {
      key: 'pct',
      header: 'الإنجاز',
      cell: (t) => {
        const p = achievementPct(t);
        return (
          <div className="flex items-center gap-2">
            <div className="h-2 w-20 overflow-hidden rounded-full bg-navy-50">
              <div
                className={`h-full rounded-full ${p >= 100 ? 'bg-green-500' : p >= 75 ? 'bg-navy' : 'bg-red-400'}`}
                style={{ width: `${Math.min(p, 100)}%` }}
              />
            </div>
            <Badge tone={p >= 100 ? 'success' : p >= 75 ? 'navy' : 'danger'}>{p}٪</Badge>
          </div>
        );
      },
    },
    {
      key: 'reward',
      header: 'المكافأة',
      cell: (t) => (
        <span className="num text-xs font-bold text-green-600">
          {t.reward_amount ? `${sar(t.reward_amount)} ر.س` : '—'}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Target size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">الأهداف ولوحة الشرف</h1>
          <p className="text-sm text-purple">أهداف الموظفين الشهرية، نسب الإنجاز، والمكافآت.</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="إجمالي الإنجاز" value={`${overallPct}٪`} tone="text-teal" />
        <Kpi label="عقود محققة" value={`${totalContractsAchieved} / ${totalContractsTarget}`} />
        <Kpi label="عدد الموظفين" value={String(rows.length)} />
        <Kpi label="إجمالي المكافآت" value={`${sar(totalRewards)} ر.س`} tone="text-gold-600" />
      </div>

      {/* honor board — top 3 */}
      <Card className="mb-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
          <Trophy size={16} className="text-gold-600" /> لوحة الشرف
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {top3.map((t, i) => (
            <div
              key={t.id}
              className="rounded-2xl border border-navy-100 bg-navy-50/40 p-4 text-center"
            >
              <Medal size={28} className={`mx-auto ${MEDAL[i]}`} />
              <p className="mt-2 text-sm font-bold text-navy">{t.employee_name}</p>
              <p className="text-[11px] text-purple">
                {t.role_label} · {t.branch}
              </p>
              <p className="num mt-2 text-2xl font-bold text-navy">{achievementPct(t)}٪</p>
              <p className="num mt-1 flex items-center justify-center gap-1 text-[11px] text-gold-600">
                {t.avg_rating.toFixed(1)} <Star size={11} className="fill-gold text-gold" />
              </p>
            </div>
          ))}
        </div>
      </Card>

      <h2 className="mb-3 text-sm font-bold text-navy">تفاصيل الأهداف</h2>
      <Table
        columns={columns}
        rows={leaderboard}
        rowKey={(t) => t.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد أهداف"
      />
    </div>
  );
}
