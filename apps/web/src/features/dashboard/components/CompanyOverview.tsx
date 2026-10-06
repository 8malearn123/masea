import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import {
  ArrowLeft,
  ClipboardList,
  FileText,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card, FlagCircle, Skeleton } from '@/shared/ui';
import type { BadgeTone } from '@/shared/ui/Badge';
import { sar } from '@/shared/lib/format';
import { DocExpiryAlerts } from '@/features/hr/components/DocExpiryAlerts';
import { ContractExpiryWidget } from '@/features/contracts/components/ContractExpiryWidget';
import { getOverview, type Kpi, type LatestStatus } from '@/features/dashboard/api/overview.api';

const SERVICE_COLORS = ['#1f58a8', '#c9a24a', '#2e9e5b', '#65738c'];

const STATUS_LABEL: Record<LatestStatus, string> = {
  active: 'نشط',
  approved: 'معتمد',
  awaiting_signature: 'بانتظار التوقيع',
  signed: 'موقّع',
  completed: 'مكتمل',
};
const STATUS_TONE: Record<LatestStatus, BadgeTone> = {
  active: 'success',
  approved: 'teal',
  awaiting_signature: 'gold',
  signed: 'navy',
  completed: 'neutral',
};

function KpiTile({
  icon: Icon,
  label,
  kpi,
  bg,
}: {
  icon: LucideIcon;
  label: string;
  kpi: Kpi;
  bg: string;
}) {
  const up = kpi.delta >= 0;
  return (
    <Card className="py-4">
      <div className="flex items-start justify-between">
        <span className={`grid h-11 w-11 place-items-center rounded-xl ${bg}`}>
          <Icon size={20} />
        </span>
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            up ? 'bg-teal-100 text-teal' : 'bg-red-100 text-red-600'
          }`}
        >
          {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span className="num">{Math.abs(kpi.delta)}٪</span>
        </span>
      </div>
      <p className="num mt-3 text-2xl font-bold text-navy-900">
        {kpi.money ? sar(kpi.value) : kpi.value.toLocaleString('en-US')}
      </p>
      <p className="mt-0.5 text-xs text-purple">{label}</p>
    </Card>
  );
}

/** Company overview dashboard — admin / operations / branch managers. */
export function CompanyOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getOverview,
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <Skeleton className="h-20 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  const { kpis, revenue, services, latest, nationalities } = data;
  const maxRev = Math.max(...revenue.map((r) => r.value));
  const maxNat = Math.max(...nationalities.map((n) => n.count));

  return (
    <div className="space-y-5">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile icon={Users} label="إجمالي العمالة" kpi={kpis.workers} bg="bg-navy-50 text-navy" />
        <KpiTile
          icon={FileText}
          label="عقود نشطة"
          kpi={kpis.activeContracts}
          bg="bg-teal-100 text-teal"
        />
        <KpiTile
          icon={ClipboardList}
          label="طلبات جديدة هذا الأسبوع"
          kpi={kpis.newRequests}
          bg="bg-gold-100 text-gold-600"
        />
        <KpiTile
          icon={Wallet}
          label="إيرادات الشهر · ريال"
          kpi={kpis.monthRevenue}
          bg="bg-navy-50 text-navy"
        />
      </div>

      {/* تنبيهات انتهاء العقود — لمن يملك صلاحية عرض العقود، ضمن نطاق فرعه */}
      <ContractExpiryWidget />

      {/* revenue + service mix */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-navy">الإيرادات الشهرية</h2>
              <p className="text-[11px] text-purple">آخر ٨ أشهر · بالألف ريال</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-purple">
              <span className="h-2 w-2 rounded-full bg-navy" /> المحقّق
            </span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenue} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: '#65738c' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(31,88,168,0.06)' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e3e9f2', fontSize: 12 }}
                  formatter={(v: number) => [`${v} ألف`, 'الإيراد']}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {revenue.map((r, i) => (
                    <Cell
                      key={r.month}
                      fill={r.value === maxRev ? '#c9a24a' : '#1f58a8'}
                      opacity={i === revenue.length - 1 ? 1 : 0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-navy">توزيع الخدمات</h2>
          <p className="text-[11px] text-purple">حسب نوع التعاقد</p>
          <div className="relative mx-auto mt-2 h-40 w-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={services}
                  dataKey="pct"
                  nameKey="label"
                  innerRadius={48}
                  outerRadius={70}
                  paddingAngle={2}
                  stroke="none"
                >
                  {services.map((s, i) => (
                    <Cell key={s.code} fill={SERVICE_COLORS[i % SERVICE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="num text-xl font-bold text-navy-900">
                  {services.reduce((s, x) => s + x.count, 0)}
                </p>
                <p className="text-[10px] text-purple">عقد نشط</p>
              </div>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5">
            {services.map((s, i) => (
              <li key={s.code} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: SERVICE_COLORS[i % SERVICE_COLORS.length] }}
                  />
                  {s.label}
                </span>
                <span className="num font-semibold text-navy">{s.pct}٪</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* latest contracts + nationalities */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-navy">أحدث العقود</h2>
            <Link
              to="/contracts"
              className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
            >
              عرض الكل <ArrowLeft size={13} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-right text-[11px] text-purple">
                  <th className="pb-2 font-medium">العميل</th>
                  <th className="pb-2 font-medium">العاملة</th>
                  <th className="pb-2 font-medium">القيمة</th>
                  <th className="pb-2 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((c) => (
                  <tr key={c.contract_no} className="border-b border-navy-50 last:border-0">
                    <td className="py-2.5 font-medium text-navy-900">{c.customer}</td>
                    <td className="py-2.5 text-navy-800">{c.worker}</td>
                    <td className="num py-2.5 text-navy-900">{sar(c.total)} ر.س</td>
                    <td className="py-2.5">
                      <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-navy">العاملات حسب الجنسية</h2>
          <p className="text-[11px] text-purple">الأكثر توفّراً</p>
          <div className="mt-4 space-y-3">
            {nationalities.map((n) => (
              <div key={n.name}>
                <div className="mb-1 flex items-center justify-between text-[13px]">
                  <span className="flex items-center gap-2 text-navy-900">
                    <FlagCircle nationality={n.name} size="sm" /> {n.name}
                  </span>
                  <span className="num font-semibold text-navy">{n.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-navy-50">
                  <div
                    className="h-full rounded-full bg-navy"
                    style={{ width: `${(n.count / maxNat) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* document expiry alerts (kept — operationally important) */}
      <DocExpiryAlerts />
    </div>
  );
}
