import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardList, Loader, PackageCheck, Inbox } from 'lucide-react';
import { Badge, Card, EmptyState, Skeleton } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useContracts } from '@/features/contracts/hooks/useContracts';
import { useRecruitmentStages } from '@/features/contracts/hooks/useRecruitment';

const ALL_FILTERS = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

function Kpi({
  label,
  value,
  icon: Icon,
  tone = 'text-navy',
}: {
  label: string;
  value: number;
  icon: typeof Loader;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-purple">{label}</p>
        <Icon size={16} className="text-navy-200" />
      </div>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

/**
 * Tailored home for the external recruitment office: the requests assigned to
 * it (RLS-scoped) broken down by recruitment stage, with quick follow-up links.
 */
export function ExternalOfficeDashboard() {
  const { data: contracts = [], isLoading } = useContracts(ALL_FILTERS);
  const { data: stages = [] } = useRecruitmentStages();

  const stageName = (code: string | null) =>
    stages.find((s) => s.code === code)?.name_ar ?? 'بانتظار البدء';

  const stats = useMemo(() => {
    const total = contracts.length;
    const completed = contracts.filter((c) => c.recruitment_stage === 'handover').length;
    const notStarted = contracts.filter((c) => !c.recruitment_stage).length;
    return { total, completed, inProgress: total - completed - notStarted, notStarted };
  }, [contracts]);

  const byStage = useMemo(() => {
    const map = new Map<string, number>();
    contracts.forEach((c) => {
      const key = c.recruitment_stage ?? '∅';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return stages
      .map((s) => ({ name: s.name_ar, count: map.get(s.code) ?? 0 }))
      .filter((r) => r.count > 0);
  }, [contracts, stages]);
  const maxCount = Math.max(1, ...byStage.map((r) => r.count));

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <Skeleton className="h-16 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="طلبات الاستقدام المُسندة"
          value={stats.total}
          icon={ClipboardList}
          tone="text-navy"
        />
        <Kpi label="قيد التنفيذ" value={stats.inProgress} icon={Loader} tone="text-gold-600" />
        <Kpi
          label="بانتظار البدء"
          value={stats.notStarted}
          icon={PackageCheck}
          tone="text-purple"
        />
        <Kpi label="تم التسليم" value={stats.completed} icon={CheckCircle2} tone="text-green-600" />
      </div>

      {stats.total === 0 ? (
        <EmptyState
          icon={Inbox}
          title="لا توجد طلبات مُسندة"
          description="ستظهر هنا طلبات الاستقدام عندما يُسندها فريق المبيعات أو الإدارة لمكتبك."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* distribution by stage */}
          <Card>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
              <ClipboardList size={16} /> التوزيع حسب المرحلة
            </h2>
            <div className="space-y-3">
              {byStage.map((r) => (
                <div key={r.name} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm text-navy-900">{r.name}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-navy-50">
                    <div
                      className="h-full rounded-full bg-navy"
                      style={{ width: `${(r.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="num w-8 text-left text-sm font-semibold text-navy">
                    {r.count}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* assigned requests */}
          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
              <ClipboardList size={16} /> الطلبات المُسندة لمتابعتها
            </h2>
            <ul className="space-y-1.5">
              {contracts.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/contracts/${c.id}`}
                    className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-navy-50"
                  >
                    <span className="flex items-center gap-2">
                      <span className="num font-semibold text-navy">{c.contract_no ?? '—'}</span>
                      <span className="text-navy-900">{c.customer_name ?? '—'}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={c.recruitment_stage === 'handover' ? 'success' : 'teal'}>
                        {stageName(c.recruitment_stage)}
                      </Badge>
                      <ArrowLeft size={14} className="text-purple" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="num mt-3 text-[11px] text-purple">
              آخر تحديث: {dateAr(new Date().toISOString())}
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
