import { useState } from 'react';
import { Gauge, Medal, Target, Trophy } from 'lucide-react';
import { Badge, Card, Input, StatTile, Table, type Column } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { ROLE_META, type RoleCode } from '@/lib/permissions';
import { useTargetBoard } from '@/features/hr/hooks/usePerformance';
import { achievementPct, type TargetRow } from '@/features/targets/types';

const MEDAL = ['text-gold-600', 'text-purple', 'text-gold-600'];

/**
 * «الأهداف ولوحة الشرف» — monthly targets set by HR (targets) against the
 * actual sales (sales, created from signed contracts). No manual numbers.
 */
export default function TargetsBoard() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const { data: rows = [], isLoading, isError, refetch } = useTargetBoard(period);

  const leaderboard = [...rows].sort((a, b) => achievementPct(b) - achievementPct(a));
  const top3 = leaderboard.slice(0, 3);
  const ct = rows.reduce((s, r) => s + r.contracts_target, 0);
  const ca = rows.reduce((s, r) => s + r.contracts_achieved, 0);
  const sa = rows.reduce((s, r) => s + r.sales_achieved, 0);
  const st = rows.reduce((s, r) => s + r.sales_target, 0);
  const overall = rows.length
    ? Math.round(rows.reduce((s, r) => s + achievementPct(r), 0) / rows.length)
    : 0;
  const roleLabel = (r: string) => ROLE_META[r as RoleCode]?.label ?? r;

  const columns: Column<TargetRow>[] = [
    {
      key: 'employee',
      header: 'الموظف',
      cell: (t) => (
        <div>
          <span className="font-semibold text-navy">{t.employee_name}</span>
          <span className="block text-[11px] text-purple">
            {roleLabel(t.role)} · {t.branch}
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
      key: 'sales',
      header: 'قيمة المبيعات',
      cell: (t) => (
        <span className="num text-xs">
          {sar(t.sales_achieved)} / {sar(t.sales_target)}
        </span>
      ),
    },
    {
      key: 'perf',
      header: 'آخر تقييم أداء',
      cell: (t) => (
        <span className="num text-xs">{t.performance === null ? '—' : `${t.performance}٪`}</span>
      ),
    },
    {
      key: 'pct',
      header: 'الإنجاز',
      sortValue: (t) => achievementPct(t),
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
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <Target size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">الأهداف ولوحة الشرف</h1>
            <p className="text-sm text-purple">
              مستهدفات الموارد البشرية الشهرية مقابل المبيعات الفعلية من العقود الموقّعة.
            </p>
          </div>
        </div>
        <div className="w-44">
          <Input
            label="الشهر"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="متوسط الإنجاز" value={`${overall}٪`} icon={Gauge} />
        <StatTile label="عقود محققة" value={`${ca} / ${ct}`} icon={Target} />
        <StatTile
          label="قيمة المبيعات"
          value={sar(sa)}
          hint={`المستهدف ${sar(st)}`}
          tone="success"
          icon={Trophy}
        />
        <StatTile label="عدد الموظفين" value={rows.length} icon={Medal} />
      </div>

      {top3.length > 0 && (
        <Card className="mb-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <Trophy size={16} className="text-gold-600" /> لوحة الشرف
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {top3.map((t, i) => (
              <div
                key={t.employee_id}
                className="rounded-2xl border border-navy-100 bg-navy-50/40 p-4 text-center"
              >
                <Medal size={28} className={`mx-auto ${MEDAL[i]}`} />
                <p className="mt-2 text-sm font-bold text-navy">{t.employee_name}</p>
                <p className="text-[11px] text-purple">
                  {roleLabel(t.role)} · {t.branch}
                </p>
                <p className="num mt-2 text-2xl font-bold text-navy">{achievementPct(t)}٪</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-bold text-navy">تفاصيل الأهداف</h2>
      <Table
        columns={columns}
        rows={leaderboard}
        rowKey={(t) => t.employee_id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد مستهدفات لهذا الشهر — تُحدَّد من الموارد البشرية ← الأداء ← المستهدفات"
      />
    </div>
  );
}
