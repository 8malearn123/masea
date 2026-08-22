import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Download } from 'lucide-react';
import { Card } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { useReports } from '@/features/reports/hooks/useReports';

const PIE_COLORS = ['#1B1564', '#C8970A', '#58B3B3', '#564E85'];

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

/** Download an array of rows as a UTF-8 CSV (BOM for Arabic). */
function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers, ...rows].map((r) =>
    r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
  );
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsBoard() {
  const { data } = useReports();
  const monthly = data?.monthly ?? [];
  const branches = data?.branches ?? [];
  const services = data?.services ?? [];

  const totalContracts = branches.reduce((s, b) => s + b.contracts, 0);
  const totalRevenue = branches.reduce((s, b) => s + b.revenue, 0);
  const avgContract = totalContracts ? Math.round(totalRevenue / totalContracts) : 0;
  const topBranch = [...branches].sort((a, b) => b.revenue - a.revenue)[0]?.branch ?? '—';

  function handleExport() {
    exportCsv(
      'masiat-branches-report.csv',
      ['الفرع', 'عدد العقود', 'الإيرادات (ر.س)'],
      branches.map((b) => [b.branch, b.contracts, b.revenue]),
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <BarChart3 size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">التقارير</h1>
            <p className="text-sm text-purple">نظرة تحليلية على الأداء والإيرادات.</p>
          </div>
        </div>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-700"
        >
          <Download size={16} /> تصدير CSV
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="إجمالي العقود" value={String(totalContracts)} />
        <Kpi label="إجمالي الإيرادات" value={`${sar(totalRevenue)} ر.س`} tone="text-green-600" />
        <Kpi label="متوسط قيمة العقد" value={`${sar(avgContract)} ر.س`} tone="text-gold-600" />
        <Kpi label="أعلى فرع إيرادًا" value={topBranch} tone="text-teal" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold text-navy">الإيرادات الشهرية</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAE9F3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#564E85" />
                <YAxis tick={{ fontSize: 11 }} stroke="#564E85" />
                <Tooltip formatter={(v: number) => `${sar(v)} ر.س`} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#C8970A"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold text-navy">العقود حسب الفرع</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={branches} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAE9F3" />
                <XAxis dataKey="branch" tick={{ fontSize: 11 }} stroke="#564E85" />
                <YAxis tick={{ fontSize: 11 }} stroke="#564E85" />
                <Tooltip />
                <Bar dataKey="contracts" fill="#1B1564" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold text-navy">توزيع الخدمات</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={services}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={88}
                  label
                >
                  {services.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold text-navy">العقود الشهرية</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAE9F3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#564E85" />
                <YAxis tick={{ fontSize: 11 }} stroke="#564E85" />
                <Tooltip />
                <Bar dataKey="contracts" fill="#58B3B3" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
