import { useMemo, useState, type ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlarmClock,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CheckCircle2,
  Coins,
  FileWarning,
  Landmark,
  Percent,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { BRANCHES_AR } from '@/lib/funnel';
import {
  agingPair,
  byBranch,
  dashboardKpis,
  expenseDistribution,
  monthlySeries,
} from '@/features/accounting/data/analytics';
import { budgetVsActual } from '@/features/accounting/data/budgets';
import { centerProfitability } from '@/features/accounting/data/budgets';
import { AGING_LABEL, type AgingBucketKey } from '@/features/accounting/types';
import {
  useBills,
  useChart,
  useInvoices,
  useJournal,
} from '@/features/accounting/hooks/useAccounting';
import { useBudgets, useCostCenters } from '@/features/accounting/hooks/useAccountingPro';
import {
  AXIS,
  CHART_COLORS,
  DataState,
  Delta,
  ExportButtons,
  FilterBar,
  GRID,
  KpiCard,
  LastUpdated,
  SectionCard,
  defaultRange,
  rangeLabel,
  sarTip,
  toLedger,
  type RangeFilter,
} from '@/features/accounting/components/kit';

const AGING_KEYS: AgingBucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
const pct = (v: number | null) => (v === null ? '—' : `${v}٪`);
const short = (m: string) => m.slice(2).replace('-', '/');

/**
 * Financial dashboard — every number is computed from the posted journal and
 * the AR/AP documents (data/analytics), so it always agrees with the statements.
 */
export function FinanceDashboard({ onNavigate }: { onNavigate: (key: string) => void }) {
  const journal = useJournal();
  const chartQ = useChart();
  const invQ = useInvoices();
  const billQ = useBills();
  const { data: budgets = [] } = useBudgets();
  const { data: centers = [] } = useCostCenters();
  const [f, setF] = useState<RangeFilter>(defaultRange);

  const entries = journal.data ?? [];
  const chart = chartQ.data ?? [];
  const invoices = invQ.data ?? [];
  const bills = billQ.data ?? [];
  const df = useMemo(() => ({ ...toLedger(f), from: f.from, to: f.to }), [f]);

  const k = useMemo(
    () => dashboardKpis(entries, chart, invoices, bills, df),
    [entries, chart, invoices, bills, df],
  );
  const series = useMemo(() => monthlySeries(entries, chart, df, 12), [entries, chart, df]);
  const expenses = useMemo(() => expenseDistribution(entries, chart, df), [entries, chart, df]);
  const branches = useMemo(() => byBranch(entries, chart, df, BRANCHES_AR), [entries, chart, df]);
  const projects = useMemo(
    () => centerProfitability(entries, chart, centers, { from: f.from, to: f.to }),
    [entries, chart, centers, f.from, f.to],
  );
  const aging = useMemo(() => agingPair(invoices, bills, f.to), [invoices, bills, f.to]);
  const budget = budgets.find(
    (b) => b.scope === 'company' && b.is_active && b.year === Number(f.to.slice(0, 4)),
  );
  const bva = useMemo(
    () => (budget ? budgetVsActual(budget, entries, chart, Number(f.to.slice(5, 7))) : []),
    [budget, entries, chart, f.to],
  );

  const loading = journal.isLoading || chartQ.isLoading || invQ.isLoading || billQ.isLoading;
  const error = journal.isError || chartQ.isError || invQ.isError || billQ.isError;
  const noData = !loading && !entries.some((e) => e.status === 'posted');
  const agingRows = AGING_KEYS.map((key) => ({
    name: AGING_LABEL[key],
    ar: aging.ar[key],
    ap: aging.ap[key],
  }));

  const exportKpis = () => ({
    title: 'مؤشرات لوحة البيانات المالية',
    subtitle: rangeLabel(f),
    headers: ['المؤشر', 'القيمة'],
    rows: [
      ['الإيراد قبل الضريبة', k.revenue],
      ['المصروفات', k.expenses],
      ['صافي الربح', k.netProfit],
      ['ضريبة القيمة المضافة المستحقة', k.vatPayable],
      ['ذمم العملاء (الأستاذ 1120)', k.receivables],
      ['الرصيد النقدي والبنوك', k.cash],
      ['إجمالي الذمم المدينة', k.totalAR],
      ['إجمالي الذمم الدائنة', k.totalAP],
      ['الفواتير المستحقة', k.invoicesDue.amount],
      ['الفواتير المتأخرة', k.invoicesOverdue.amount],
      ['الفواتير غير المدفوعة', k.invoicesUnpaid.amount],
      ['إجمالي التحصيلات', k.collections],
      ['إجمالي المدفوعات', k.payments],
      ['صافي التدفق النقدي', k.netCashFlow],
      ['هامش الربح الإجمالي ٪', k.grossMargin ?? '—'],
      ['هامش صافي الربح ٪', k.netMargin ?? '—'],
      ['نمو الإيرادات ٪', k.revenueGrowth ?? '—'],
      ['تغير المصروفات ٪', k.expenseChange ?? '—'],
      ['إجمالي الأصول', k.totalAssets],
      ['إجمالي الالتزامات', k.totalLiabilities],
    ],
  });

  return (
    <div className="space-y-4">
      <FilterBar
        value={f}
        onChange={setF}
        costCenters={centers}
        extra={
          <div className="mr-auto flex flex-wrap items-center gap-3">
            <LastUpdated at={journal.dataUpdatedAt} onRefresh={() => void journal.refetch()} />
            <ExportButtons build={exportKpis} disabled={loading} />
          </div>
        }
      />

      <DataState
        isLoading={loading}
        isError={error}
        onRetry={() => void journal.refetch()}
        empty={noData}
        emptyTitle="لا توجد قيود مرحّلة بعد"
        emptyHint="تظهر المؤشرات تلقائيًا بعد ترحيل أول عملية."
      >
        {/* headline — existing indicators kept */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard
            label="الإيراد (قبل الضريبة)"
            value={sar(k.revenue)}
            icon={TrendingUp}
            tone="text-green-600"
            hint={<Delta value={k.revenueGrowth} />}
            onClick={() => onNavigate('statements')}
          />
          <KpiCard
            label="المصروفات"
            value={sar(k.expenses)}
            icon={TrendingDown}
            tone="text-red-600"
            hint={<Delta value={k.expenseChange} goodWhenUp={false} />}
            onClick={() => onNavigate('statements')}
          />
          <KpiCard
            label="صافي الربح"
            value={sar(k.netProfit)}
            icon={Coins}
            tone={k.netProfit < 0 ? 'text-red-600' : 'text-gold-600'}
            hint={`هامش صافي ${pct(k.netMargin)}`}
            onClick={() => onNavigate('statements')}
          />
          <KpiCard
            label="ضريبة مستحقة (VAT)"
            value={sar(k.vatPayable)}
            icon={Receipt}
            tone="text-gold-600"
            hint="مخرجات − مدخلات"
            onClick={() => onNavigate('vat')}
          />
          <KpiCard
            label="ذمم العملاء"
            value={sar(k.receivables)}
            icon={Wallet}
            tone="text-teal"
            hint="رصيد حساب الرقابة 1120"
            onClick={() => onNavigate('receivables')}
          />
          <KpiCard
            label="الرصيد النقدي والبنوك"
            value={sar(k.cash)}
            icon={Landmark}
            onClick={() => onNavigate('banks')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="إجمالي الذمم المدينة"
            value={sar(k.totalAR)}
            icon={ArrowDownCircle}
            onClick={() => onNavigate('receivables')}
          />
          <KpiCard
            label="إجمالي الذمم الدائنة"
            value={sar(k.totalAP)}
            icon={ArrowUpCircle}
            onClick={() => onNavigate('payables')}
          />
          <KpiCard
            label="الفواتير المستحقة"
            value={sar(k.invoicesDue.amount)}
            icon={AlarmClock}
            hint={`${k.invoicesDue.count} فاتورة لم يحل أجلها`}
          />
          <KpiCard
            label="الفواتير المتأخرة"
            value={sar(k.invoicesOverdue.amount)}
            icon={FileWarning}
            tone="text-red-600"
            hint={`${k.invoicesOverdue.count} فاتورة`}
            onClick={() => onNavigate('receivables')}
          />
          <KpiCard
            label="الفواتير غير المدفوعة"
            value={sar(k.invoicesUnpaid.amount)}
            icon={FileWarning}
            hint={`${k.invoicesUnpaid.count} فاتورة بلا أي تحصيل`}
          />
          <KpiCard
            label="إجمالي التحصيلات"
            value={sar(k.collections)}
            icon={Banknote}
            tone="text-green-600"
          />
          <KpiCard
            label="إجمالي المدفوعات"
            value={sar(k.payments)}
            icon={Banknote}
            tone="text-red-600"
          />
          <KpiCard
            label="صافي التدفق النقدي"
            value={sar(k.netCashFlow)}
            icon={Coins}
            tone={k.netCashFlow < 0 ? 'text-red-600' : 'text-navy'}
          />
          <KpiCard label="هامش الربح الإجمالي" value={pct(k.grossMargin)} icon={Percent} />
          <KpiCard label="هامش صافي الربح" value={pct(k.netMargin)} icon={Percent} />
          <KpiCard
            label="إجمالي الأصول"
            value={sar(k.totalAssets)}
            icon={Scale}
            onClick={() => onNavigate('statements')}
          />
          <KpiCard
            label="إجمالي الالتزامات"
            value={sar(k.totalLiabilities)}
            icon={Scale}
            onClick={() => onNavigate('statements')}
          />
        </div>

        <SectionCard title="سلامة الدفتر" icon={Scale}>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-purple">
              مدين: <span className="num font-semibold text-navy">{sar(k.ledgerDebit)}</span>
            </span>
            <span className="text-purple">
              دائن: <span className="num font-semibold text-navy">{sar(k.ledgerCredit)}</span>
            </span>
            {k.balanced ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                <CheckCircle2 size={14} /> الدفتر متوازن
              </span>
            ) : (
              <Badge tone="danger">غير متوازن!</Badge>
            )}
          </div>
          <p className="mt-2 text-xs text-purple">
            المؤشرات محسوبة من القيود المرحّلة فقط وتتحدّث فور أي ترحيل. الإيراد قبل الضريبة، وضريبة
            القيمة المضافة التزام مستقل. {rangeLabel(f)}.
          </p>
        </SectionCard>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="الإيرادات مقابل المصروفات شهريًا">
            <BarChart data={series} barGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tickFormatter={short} tick={{ fill: AXIS, fontSize: 11 }} />
              <YAxis
                tick={{ fill: AXIS, fontSize: 11 }}
                width={70}
                tickFormatter={(v: number) => sar(v).replace('.00', '')}
              />
              <Tooltip formatter={sarTip} />
              <Legend />
              <Bar
                dataKey="revenue"
                name="الإيرادات"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="expenses"
                name="المصروفات"
                fill={CHART_COLORS.secondary}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>
          <ChartCard title="صافي الربح — آخر 12 شهرًا">
            <LineChart data={series}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tickFormatter={short} tick={{ fill: AXIS, fontSize: 11 }} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} width={70} />
              <Tooltip formatter={sarTip} />
              <Line
                type="monotone"
                dataKey="profit"
                name="صافي الربح"
                stroke={CHART_COLORS.tertiary}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ChartCard>
          <ChartCard title="التدفقات النقدية الشهرية">
            <BarChart data={series} barGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tickFormatter={short} tick={{ fill: AXIS, fontSize: 11 }} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} width={70} />
              <Tooltip formatter={sarTip} />
              <Legend />
              <Bar
                dataKey="inflow"
                name="وارد"
                fill={CHART_COLORS.tertiary}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="outflow"
                name="صادر"
                fill={CHART_COLORS.secondary}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>
          <ChartCard title="توزيع المصروفات حسب التصنيف" empty={!expenses.length}>
            <BarChart data={expenses.slice(0, 8)} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fill: AXIS, fontSize: 11 }}
              />
              <Tooltip formatter={sarTip} />
              <Bar
                dataKey="value"
                name="المبلغ"
                fill={CHART_COLORS.primary}
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartCard>
          <ChartCard title="الإيرادات والأرباح حسب الفرع">
            <BarChart data={branches} barGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="branch" tick={{ fill: AXIS, fontSize: 11 }} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} width={70} />
              <Tooltip formatter={sarTip} />
              <Legend />
              <Bar
                dataKey="revenue"
                name="الإيراد"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="profit"
                name="صافي الربح"
                fill={CHART_COLORS.tertiary}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>
          <ChartCard
            title="الأرباح حسب مركز التكلفة (أقسام ومشاريع)"
            empty={!projects.some((p) => p.revenue || p.expenses)}
          >
            <BarChart data={projects} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fill: AXIS, fontSize: 11 }}
              />
              <Tooltip formatter={sarTip} />
              <Bar
                dataKey="profit"
                name="الربح"
                fill={CHART_COLORS.primary}
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartCard>
          <ChartCard title="أعمار الذمم المدينة والدائنة">
            <BarChart data={agingRows} barGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} width={70} />
              <Tooltip formatter={sarTip} />
              <Legend />
              <Bar
                dataKey="ar"
                name="مدينة (عملاء)"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="ap"
                name="دائنة (موردون)"
                fill={CHART_COLORS.secondary}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>
          <ChartCard
            title={budget ? `الفعلي مقابل الموازنة — ${budget.name}` : 'الفعلي مقابل الموازنة'}
            empty={!bva.length}
            emptyText="لا توجد موازنة معتمدة لهذه السنة — أنشئها من «الموازنات»."
          >
            <BarChart data={bva} barGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} width={70} />
              <Tooltip formatter={sarTip} />
              <Legend />
              <Bar
                dataKey="budget"
                name="الموازنة"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="actual"
                name="الفعلي"
                fill={CHART_COLORS.secondary}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>
        </div>
      </DataState>
    </div>
  );
}

function ChartCard({
  title,
  children,
  empty,
  emptyText = 'لا توجد بيانات في النطاق المحدد',
}: {
  title: string;
  children: ReactElement;
  empty?: boolean;
  emptyText?: string;
}) {
  return (
    <SectionCard title={title}>
      {empty ? (
        <p className="grid h-60 place-items-center text-sm text-purple">{emptyText}</p>
      ) : (
        <div className="h-64" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}
