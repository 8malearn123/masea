import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  FileWarning,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Card } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import {
  useDocuments,
  useEmployees,
  useIqamas,
  useLeaveRequests,
  usePerformance,
} from '@/features/hr/hooks/useHr';
import { expiryStatus, monthlyCost } from '@/features/hr/api/hr.api';
import {
  DOC_STATUS_TONE,
  EMP_STATUS_LABEL,
  EMP_STATUS_TONE,
  LEAVE_STATUS_LABEL,
} from '@/features/hr/types';

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  bg,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  bg: string;
}) {
  return (
    <Card className="flex items-center gap-3 py-4">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${bg}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <p className="num text-2xl font-bold leading-none text-navy">{value}</p>
        <p className="mt-1 text-xs text-purple">{label}</p>
        {sub && <p className="text-[11px] text-purple/70">{sub}</p>}
      </div>
    </Card>
  );
}

/** HR cockpit — workforce, leave, expiring documents, payroll, performance. */
export function HrDashboard() {
  const { data: employees = [] } = useEmployees();
  const { data: leaves = [] } = useLeaveRequests();
  const { data: documents = [] } = useDocuments();
  const { data: iqamas = [] } = useIqamas();
  const { data: performance = [] } = usePerformance();

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.status === 'active').length;
    const onLeave = employees.filter((e) => e.status === 'on_leave').length;
    const payroll = employees.reduce((s, e) => s + monthlyCost(e), 0);
    const pendingLeave = leaves.filter((l) => l.status === 'pending').length;
    const avgScore = performance.length
      ? Math.round(performance.reduce((s, p) => s + p.score, 0) / performance.length)
      : 0;
    return { total: employees.length, active, onLeave, payroll, pendingLeave, avgScore };
  }, [employees, leaves, performance]);

  // expiring/expired docs + iqamas (soonest first)
  const expiring = useMemo(() => {
    const docs = documents.map((d) => ({
      id: d.id,
      name: d.employee_name,
      kind: d.type,
      expiry: d.expiry_date,
      status: expiryStatus(d.expiry_date),
    }));
    const iq = iqamas.map((i) => ({
      id: i.id,
      name: i.employee_name,
      kind: 'الإقامة',
      expiry: i.expiry_date,
      status: expiryStatus(i.expiry_date),
    }));
    return [...docs, ...iq]
      .filter((x) => x.status !== 'valid')
      .sort((a, b) => (a.expiry ?? '').localeCompare(b.expiry ?? ''))
      .slice(0, 8);
  }, [documents, iqamas]);

  const pendingLeaves = useMemo(
    () => leaves.filter((l) => l.status === 'pending').slice(0, 6),
    [leaves],
  );
  const deptMix = useMemo(() => {
    const map = new Map<string, number>();
    employees.forEach((e) => map.set(e.department, (map.get(e.department) ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [employees]);
  const maxDept = Math.max(1, ...deptMix.map(([, n]) => n));

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Users}
          label="إجمالي الموظفين"
          value={String(stats.total)}
          sub={`${stats.active} على رأس العمل`}
          bg="bg-navy-50 text-navy"
        />
        <Kpi
          icon={UserCheck}
          label="في إجازة"
          value={String(stats.onLeave)}
          sub={`${stats.pendingLeave} طلب بانتظار الاعتماد`}
          bg="bg-gold-100 text-gold-600"
        />
        <Kpi
          icon={Wallet}
          label="تكلفة الرواتب الشهرية"
          value={`${sar(stats.payroll)}`}
          sub="ر.س"
          bg="bg-teal-100 text-teal"
        />
        <Kpi
          icon={TrendingUp}
          label="متوسط الأداء"
          value={`${stats.avgScore}٪`}
          bg="bg-navy-50 text-navy"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* expiring documents */}
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
              <FileWarning size={16} /> وثائق وإقامات قاربت على الانتهاء
            </h2>
            <Link
              to="/hr"
              className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
            >
              فتح الموارد البشرية <ArrowLeft size={13} />
            </Link>
          </div>
          {expiring.length === 0 ? (
            <p className="py-6 text-center text-sm text-purple">
              لا توجد وثائق قاربت على الانتهاء. ✓
            </p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {expiring.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    {x.status === 'expired' && <AlertTriangle size={14} className="text-red-600" />}
                    <span className="font-medium text-navy-900">{x.name}</span>
                    <span className="text-[11px] text-purple">{x.kind}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num text-[11px] text-purple">{dateAr(x.expiry)}</span>
                    <Badge tone={DOC_STATUS_TONE[x.status]}>
                      {x.status === 'expired' ? 'منتهية' : 'تقارب الانتهاء'}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* department distribution */}
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <Users size={16} /> التوزيع حسب القسم
          </h2>
          <div className="space-y-3">
            {deptMix.map(([dept, n]) => (
              <div key={dept} className="flex items-center gap-3 text-[13px]">
                <span className="w-24 shrink-0 truncate text-navy-900">{dept}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-navy-50">
                  <div
                    className="h-full rounded-full bg-navy"
                    style={{ width: `${(n / maxDept) * 100}%` }}
                  />
                </div>
                <span className="num w-6 text-left font-semibold text-navy">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* pending leave approvals */}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <CalendarClock size={16} /> طلبات الإجازة بانتظار الاعتماد
        </h2>
        {pendingLeaves.length === 0 ? (
          <p className="text-sm text-purple">لا توجد طلبات معلّقة.</p>
        ) : (
          <ul className="divide-y divide-navy-50">
            {pendingLeaves.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-navy-900">{l.employee_name}</span>
                  <span className="text-[11px] text-purple">{l.reason}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="num text-[11px] text-purple">{l.days} يوم</span>
                  <Badge tone="gold">{LEAVE_STATUS_LABEL[l.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* workforce snapshot */}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <Users size={16} /> حالة القوى العاملة
        </h2>
        <div className="flex flex-wrap gap-2">
          {(['active', 'on_leave', 'terminated'] as const).map((s) => (
            <Badge key={s} tone={EMP_STATUS_TONE[s]}>
              {EMP_STATUS_LABEL[s]}: {employees.filter((e) => e.status === s).length}
            </Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}
