import { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Coins, Lock, Scale, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Button, Card, Select } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import {
  balanceSheet,
  buildClosingEntry,
  cashFlow,
  costCenters,
  incomeStatement,
  type ReportLine,
} from '@/features/accounting/data/reports';
import {
  useClosedPeriods,
  useJournal,
  usePostClosing,
} from '@/features/accounting/hooks/useAccounting';

type Tab = 'income' | 'balance' | 'cashflow' | 'centers' | 'close';
const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'income', label: 'قائمة الدخل', icon: TrendingUp },
  { key: 'balance', label: 'المركز المالي', icon: Scale },
  { key: 'cashflow', label: 'التدفقات النقدية', icon: Coins },
  { key: 'centers', label: 'مراكز التكلفة', icon: BarChart3 },
  { key: 'close', label: 'إقفال الفترة', icon: Lock },
];
const PERIODS = ['all', '2026-04', '2026-05', '2026-06'] as const;
const periodLabel = (p: string) => (p === 'all' ? 'كل الفترات' : p);

export function ReportsScreen() {
  const [tab, setTab] = useState<Tab>('income');
  const [period, setPeriod] = useState('all');
  const { data: entries = [] } = useJournal();
  const f = period === 'all' ? {} : { period };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                tab === t.key ? 'bg-navy text-white' : 'text-purple hover:bg-navy-50'
              }`}
            >
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>
        {tab !== 'balance' && (
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={PERIODS.map((p) => ({ value: p, label: periodLabel(p) }))}
          />
        )}
      </div>

      {tab === 'income' && <IncomeReport entries={entries} f={f} />}
      {tab === 'balance' && <BalanceReport entries={entries} />}
      {tab === 'cashflow' && <CashFlowReport entries={entries} f={f} />}
      {tab === 'centers' && <CostCentersReport entries={entries} f={f} />}
      {tab === 'close' && <CloseReport entries={entries} />}
    </div>
  );
}

function Section({
  title,
  rows,
  total,
  totalLabel,
  tone,
}: {
  title: string;
  rows: ReportLine[];
  total: number;
  totalLabel: string;
  tone: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-navy">{title}</p>
      <div className="rounded-xl border border-navy-100 px-3">
        {rows.length === 0 && (
          <p className="py-3 text-center text-xs text-purple">لا توجد حركات.</p>
        )}
        {rows.map((r) => (
          <div
            key={r.code}
            className="flex justify-between border-b border-navy-50 py-2 text-sm last:border-0"
          >
            <span className="text-purple">
              <span className="num text-navy-300 text-xs">{r.code}</span> {r.name}
            </span>
            <span className="num font-semibold text-navy">{sar(r.amount)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between px-3 text-sm font-bold">
        <span className="text-navy">{totalLabel}</span>
        <span className={`num ${tone}`}>{sar(total)} ر.س</span>
      </div>
    </div>
  );
}

function IncomeReport({
  entries,
  f,
}: {
  entries: Parameters<typeof incomeStatement>[0];
  f: { period?: string };
}) {
  const is = useMemo(() => incomeStatement(entries, f), [entries, f]);
  return (
    <Card className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
        <TrendingUp size={16} /> قائمة الدخل (الأرباح والخسائر)
      </h2>
      <Section
        title="الإيرادات"
        rows={is.revenue}
        total={is.totalRevenue}
        totalLabel="إجمالي الإيرادات"
        tone="text-green-600"
      />
      <Section
        title="المصروفات"
        rows={is.expenses}
        total={is.totalExpenses}
        totalLabel="إجمالي المصروفات"
        tone="text-red-600"
      />
      <div className="bg-gold-50 flex items-center justify-between rounded-xl px-4 py-3">
        <span className="text-sm font-bold text-navy">
          {is.netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
        </span>
        <span className="num text-xl font-bold text-gold-600">
          {sar(Math.abs(is.netProfit))} ر.س
        </span>
      </div>
      <p className="text-xs text-purple">
        الإيراد بالمبلغ قبل الضريبة؛ ضريبة القيمة المضافة التزام مستقل وليست إيرادًا.
      </p>
    </Card>
  );
}

function BalanceReport({ entries }: { entries: Parameters<typeof balanceSheet>[0] }) {
  const bs = useMemo(() => balanceSheet(entries), [entries]);
  return (
    <Card className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
        <Scale size={16} /> المركز المالي (الميزانية العمومية) — تراكمي
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="الأصول"
          rows={bs.assets}
          total={bs.totalAssets}
          totalLabel="إجمالي الأصول"
          tone="text-navy"
        />
        <div className="space-y-4">
          <Section
            title="الخصوم"
            rows={bs.liabilities}
            total={bs.totalLiabilities}
            totalLabel="إجمالي الخصوم"
            tone="text-gold-600"
          />
          <Section
            title="حقوق الملكية (شاملة صافي ربح الفترة)"
            rows={[
              ...bs.equity,
              { code: '—', name: 'صافي ربح الفترة (غير مُقفل)', amount: bs.netProfit },
            ]}
            total={bs.totalEquity}
            totalLabel="إجمالي حقوق الملكية"
            tone="text-teal"
          />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3 text-sm">
        <span className="text-purple">
          الأصول <span className="num font-semibold text-navy">{sar(bs.totalAssets)}</span> = الخصوم
          + حقوق الملكية{' '}
          <span className="num font-semibold text-navy">
            {sar(bs.totalLiabilities + bs.totalEquity)}
          </span>
        </span>
        {bs.balanced ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
            <CheckCircle2 size={14} /> متوازن
          </span>
        ) : (
          <Badge tone="danger">غير متوازن</Badge>
        )}
      </div>
    </Card>
  );
}

function CashFlowReport({
  entries,
  f,
}: {
  entries: Parameters<typeof cashFlow>[0];
  f: { period?: string };
}) {
  const cf = useMemo(() => cashFlow(entries, f), [entries, f]);
  return (
    <Card className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
        <Coins size={16} /> التدفقات النقدية
      </h2>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="مقبوضات" value={sar(cf.inflow)} tone="text-green-600" />
        <Stat label="مدفوعات" value={sar(cf.outflow)} tone="text-red-600" />
        <Stat label="صافي التغير النقدي" value={sar(cf.net)} tone="text-gold-600" />
      </div>
      <Section
        title="الحركة حسب الحساب النقدي/البنكي"
        rows={cf.byAccount}
        total={cf.net}
        totalLabel="صافي الحركة"
        tone="text-navy"
      />
    </Card>
  );
}

function CostCentersReport({
  entries,
  f,
}: {
  entries: Parameters<typeof costCenters>[0];
  f: { period?: string };
}) {
  const rows = useMemo(() => costCenters(entries, BRANCHES_AR, f), [entries, f]);
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <BarChart3 size={16} /> مقارنة مراكز التكلفة (الفروع)
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy-100 text-xs text-purple">
            <th className="py-2 text-right">الفرع</th>
            <th className="py-2 text-left">الإيرادات</th>
            <th className="py-2 text-left">المصروفات</th>
            <th className="py-2 text-left">صافي الربح</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.branch} className="border-b border-navy-50">
              <td className="py-2 font-semibold text-navy">{r.branch}</td>
              <td className="num py-2 text-left text-green-600">{sar(r.revenue)}</td>
              <td className="num py-2 text-left text-red-600">{sar(r.expenses)}</td>
              <td className="num py-2 text-left font-bold text-navy">{sar(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CloseReport({ entries }: { entries: Parameters<typeof buildClosingEntry>[0] }) {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: closed = [] } = useClosedPeriods();
  const post = usePostClosing();
  const [period, setPeriod] = useState('2026-06');
  const entry = useMemo(() => buildClosingEntry(entries, period), [entries, period]);
  const isClosed = closed.includes(period);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Lock size={16} /> إقفال الفترة (ترحيل الأرباح للأرباح المحتجزة)
        </h2>
        <div className="flex items-end gap-2">
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={['2026-04', '2026-05', '2026-06'].map((p) => ({ value: p, label: p }))}
          />
          {editable &&
            (isClosed ? (
              <Badge tone="success">مُقفلة</Badge>
            ) : (
              <Button onClick={() => post.mutate(entry)} disabled={entry.lines.length === 0}>
                <Lock size={16} /> ترحيل قيد الإقفال
              </Button>
            ))}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy-100 text-xs text-purple">
            <th className="py-2 text-right">الحساب</th>
            <th className="py-2 text-left">مدين</th>
            <th className="py-2 text-left">دائن</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l, i) => (
            <tr key={i} className="border-b border-navy-50">
              <td className="py-2">
                <span className="num text-navy-300 text-xs">{l.account_code}</span> {l.description}
              </td>
              <td className="num py-2 text-left text-green-600">
                {l.debit > 0 ? sar(l.debit) : '—'}
              </td>
              <td className="num py-2 text-left text-red-600">
                {l.credit > 0 ? sar(l.credit) : '—'}
              </td>
            </tr>
          ))}
          {entry.lines.length === 0 && (
            <tr>
              <td colSpan={3} className="py-3 text-center text-xs text-purple">
                لا توجد أرباح/مصروفات لإقفالها في هذه الفترة.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs leading-relaxed text-purple">
        قيد الإقفال يُصفّر حسابات الإيرادات والمصروفات وينقل صافي النتيجة إلى الأرباح المحتجزة
        (٣٢٠٠). بعد الإقفال تُمنع الترحيلات في الفترة (تصحيحها بقيد عكسي أو إعادة فتح بصلاحية).
      </p>
    </Card>
  );
}

function Stat({
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
