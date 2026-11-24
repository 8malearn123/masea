import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Megaphone, Trophy } from 'lucide-react';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
  StatTile,
} from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { BRANCHES_AR } from '@/lib/funnel';
import { SERVICE_LABEL } from '@/features/contracts/types';
import { useSources } from '@/features/settings/hooks/useSettings';
import { useUserNames } from '@/features/contracts/components/details/ContractTabs';
import { sourceLabelOf } from '@/features/marketing/api/attribution.api';
import {
  breakdownReport,
  CAMPAIGN_STATUS_LABEL,
  campaignReport,
  sourceReport,
  type AttributionModel,
  type ReportFilters,
  type SourceRow,
} from '@/features/marketing/api/analytics.api';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}٪`);
const money = (v: number | null) => (v === null ? '—' : sar(v));

const PERIODS = [
  { value: '30', label: 'آخر 30 يوماً' },
  { value: '90', label: 'آخر 90 يوماً' },
  { value: '365', label: 'آخر سنة' },
  { value: 'custom', label: 'فترة محددة' },
];

/**
 * «تحليل مصادر العملاء والمبيعات»: كل عميل من أين جاء، وكم عقداً جلبت كل منصة،
 * وقيمتها، والإيراد المحقق، والمحصّل فعلاً، والمصروف على الإعلان — من البيانات
 * الفعلية (0099). قيمة العقود ≠ الإيراد المحقق ≠ المحصّل.
 */
export default function MarketingAnalytics() {
  const { data: sources = [] } = useSources();
  const [period, setPeriod] = useState('90');
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(today());
  const [branch, setBranch] = useState('');
  const [service, setService] = useState('');
  const [model, setModel] = useState<AttributionModel>('acquisition');
  const [dim, setDim] = useState<'branch' | 'employee' | 'service'>('employee');

  const f: ReportFilters = useMemo(
    () => ({
      from: period === 'custom' ? from : daysAgo(Number(period)),
      to: period === 'custom' ? to : today(),
      branch: branch || null,
      service: service || null,
      model,
    }),
    [period, from, to, branch, service, model],
  );
  const src = useQuery({ queryKey: ['marketing', 'sources', f], queryFn: () => sourceReport(f) });
  const camp = useQuery({
    queryKey: ['marketing', 'campaigns-report', f.from, f.to, f.branch],
    queryFn: () => campaignReport(f),
  });
  const brk = useQuery({
    queryKey: ['marketing', 'breakdown', f.from, f.to, f.branch, dim],
    queryFn: () => breakdownReport(f, dim, null),
  });
  const owners = useUserNames([
    ...(camp.data ?? []).map((c) => c.owner_id),
    ...(dim === 'employee' ? (brk.data ?? []).map((r) => r.dim_key) : []),
  ]);
  const label = (code: string | null) => sourceLabelOf(sources, code);

  const rows = src.data ?? [];
  const tot = rows.reduce(
    (a, r) => ({
      leads: a.leads + r.leads,
      contracts: a.contracts + r.contracts,
      value: a.value + r.contract_value,
      revenue: a.revenue + r.revenue,
      collected: a.collected + r.collected,
      spend: a.spend + r.spend,
      newCustomers: a.newCustomers + r.new_customers,
    }),
    { leads: 0, contracts: 0, value: 0, revenue: 0, collected: 0, spend: 0, newCustomers: 0 },
  );
  const sourced = rows.filter((r) => r.source_code !== null);
  const bestBy = (k: keyof SourceRow) =>
    [...sourced]
      .sort((a, b) => Number(b[k] ?? 0) - Number(a[k] ?? 0))
      .find((r) => Number(r[k] ?? 0) > 0) ?? null;
  const bestContracts = bestBy('contracts');
  const bestRevenue = bestBy('revenue');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <BarChart3 size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">تحليل مصادر العملاء والمبيعات</h1>
            <p className="text-sm text-purple">
              من أين جاء كل عميل، وكم عقداً وإيراداً وتحصيلاً جلبت كل منصة مقابل ما صُرف عليها.
            </p>
          </div>
        </div>
        <Link
          to="/loyalty"
          className="inline-flex items-center gap-1.5 rounded-xl border border-navy px-4 py-2.5 text-sm font-semibold text-navy hover:bg-navy-50"
        >
          <Megaphone size={16} /> الحملات
        </Link>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            label="الفترة"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={PERIODS}
          />
          {period === 'custom' && (
            <>
              <Input
                label="من"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
              <Input
                label="إلى"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
          <Select
            label="الفرع"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={[
              { value: '', label: 'كل الفروع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
          />
          <Select
            label="الخدمة"
            value={service}
            onChange={(e) => setService(e.target.value)}
            options={[
              { value: '', label: 'كل الخدمات' },
              ...Object.entries(SERVICE_LABEL).map(([value, l]) => ({ value, label: l })),
            ]}
          />
          <Select
            label="نسبة العقد إلى"
            value={model}
            onChange={(e) => setModel(e.target.value as AttributionModel)}
            options={[
              { value: 'acquisition', label: 'مصدر العميل الأصلي' },
              { value: 'contract', label: 'مصدر العقد الحالي' },
            ]}
          />
        </div>
      </Card>

      {src.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : src.isError ? (
        <ErrorState
          title="تعذّر تحميل التقرير"
          description={(src.error as Error).message}
          onRetry={() => void src.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="لا بيانات في هذه الفترة"
          description="غيّر الفترة أو الفلاتر."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="العملاء المحتملون"
              value={tot.leads}
              hint={`عملاء جدد متعاقدون ${tot.newCustomers}`}
            />
            <StatTile
              label="العقود"
              value={tot.contracts}
              hint={`قيمتها ${sar(tot.value)} ر.س شامل الضريبة`}
            />
            <StatTile
              label="الإيراد المحقق"
              value={sar(tot.revenue)}
              tone="success"
              hint="صافي العقود الموقّعة قبل الضريبة"
            />
            <StatTile
              label="المحصّل فعلاً"
              value={sar(tot.collected)}
              tone="success"
              hint="الدفعات المستلمة فقط"
            />
            <StatTile
              label="المصروف على الإعلان"
              value={sar(tot.spend)}
              tone="warning"
              hint="قيود مصروف الحملات"
            />
            <StatTile
              label="تكلفة العميل المحتمل CPL"
              value={money(tot.spend > 0 && tot.leads ? tot.spend / tot.leads : null)}
            />
            <StatTile
              label="تكلفة العميل المتعاقد CAC"
              value={money(tot.spend > 0 && tot.newCustomers ? tot.spend / tot.newCustomers : null)}
            />
            <StatTile
              label="العائد على الإنفاق ROAS"
              value={tot.spend > 0 ? `${(tot.revenue / tot.spend).toFixed(2)}×` : '—'}
              hint={tot.spend > 0 ? 'الإيراد المحقق ÷ المصروف' : 'لا مصروف مسجّل'}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <p className="flex items-center gap-2 text-xs text-purple">
                <Trophy size={14} /> أفضل منصة حسب عدد العقود
              </p>
              <p className="mt-1 text-lg font-bold text-navy">
                {bestContracts
                  ? `${label(bestContracts.source_code)} — ${bestContracts.contracts} عقد`
                  : 'لا بيانات كافية'}
              </p>
            </Card>
            <Card>
              <p className="flex items-center gap-2 text-xs text-purple">
                <Trophy size={14} /> أفضل منصة حسب الإيراد المحقق
              </p>
              <p className="mt-1 text-lg font-bold text-navy">
                {bestRevenue
                  ? `${label(bestRevenue.source_code)} — ${sar(bestRevenue.revenue)} ر.س`
                  : 'لا بيانات كافية'}
              </p>
            </Card>
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-bold text-navy">الأداء حسب المصدر</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-navy-100 text-right text-xs text-purple">
                    {[
                      'المصدر',
                      'محتملون',
                      'تحوّلوا',
                      'التحويل',
                      'عملاء (فريدون)',
                      'عقود',
                      'قيمة العقود',
                      'الإيراد المحقق',
                      'المحصّل',
                      'المصروف',
                      'CPL',
                      'CAC',
                      'ROAS',
                    ].map((h) => (
                      <th key={h} className="px-2 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.source_code ?? 'none'} className="border-b border-navy-50">
                      <td className="px-2 py-2 font-semibold text-navy">
                        {r.source_code ? (
                          label(r.source_code)
                        ) : (
                          <Badge tone="neutral">غير محدد</Badge>
                        )}
                      </td>
                      <td className="num px-2 py-2">{r.leads}</td>
                      <td className="num px-2 py-2">{r.converted_leads}</td>
                      <td className="num px-2 py-2">{pct(r.conversion_rate)}</td>
                      <td className="num px-2 py-2">{r.customers}</td>
                      <td className="num px-2 py-2 font-semibold">{r.contracts}</td>
                      <td className="num px-2 py-2">{sar(r.contract_value)}</td>
                      <td className="num px-2 py-2 text-green-700">{sar(r.revenue)}</td>
                      <td className="num px-2 py-2 text-green-700">{sar(r.collected)}</td>
                      <td className="num px-2 py-2 text-gold-600">
                        {r.spend ? sar(r.spend) : '—'}
                      </td>
                      <td className="num px-2 py-2">{money(r.cpl)}</td>
                      <td className="num px-2 py-2">{money(r.cac)}</td>
                      <td className="num px-2 py-2">
                        {r.roas === null ? '—' : `${r.roas.toFixed(2)}×`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-purple">
              قيمة العقود = إجمالي العقود غير الملغاة شامل الضريبة · الإيراد المحقق = صافي العقود
              الموقّعة قبل الضريبة ناقص الإشعارات الدائنة · المحصّل = الدفعات المستلمة فعلاً (لا
              المعلّقة ولا المرتجعة) · العميل يُحسب مرة واحدة حسب مصدره الأصلي · «غير محدد» =
              عملاء/عقود سابقة بلا مصدر مسجّل.
            </p>
          </Card>
        </>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-bold text-navy">أداء الحملات</h2>
        {camp.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : camp.isError ? (
          <ErrorState onRetry={() => void camp.refetch()} />
        ) : (camp.data ?? []).length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="لا حملات"
            description="أنشئ حملة من «الولاء والتسويق»."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-right text-xs text-purple">
                  {[
                    'الحملة',
                    'المنصة',
                    'الحالة',
                    'المسؤول',
                    'الميزانية',
                    'المصروف',
                    'محتملون',
                    'عقود',
                    'قيمة العقود',
                    'الإيراد',
                    'المحصّل',
                  ].map((h) => (
                    <th key={h} className="px-2 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(camp.data ?? []).map((c) => (
                  <tr key={c.campaign_id} className="border-b border-navy-50">
                    <td className="px-2 py-2">
                      <Link
                        to={`/loyalty/campaigns/${c.campaign_id}`}
                        className="font-semibold text-navy hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{label(c.platform_code)}</td>
                    <td className="px-2 py-2">
                      <Badge
                        tone={
                          c.status === 'active'
                            ? 'success'
                            : c.status === 'ended'
                              ? 'neutral'
                              : 'gold'
                        }
                      >
                        {CAMPAIGN_STATUS_LABEL[c.status]}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {(c.owner_id && owners.data?.get(c.owner_id)) || '—'}
                    </td>
                    <td className="num px-2 py-2">{c.budget === null ? '—' : sar(c.budget)}</td>
                    <td className="num px-2 py-2 text-gold-600">{sar(c.spend)}</td>
                    <td className="num px-2 py-2">{c.leads}</td>
                    <td className="num px-2 py-2 font-semibold">{c.contracts}</td>
                    <td className="num px-2 py-2">{sar(c.contract_value)}</td>
                    <td className="num px-2 py-2 text-green-700">{sar(c.revenue)}</td>
                    <td className="num px-2 py-2 text-green-700">{sar(c.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-purple">
          العقد يُحسب للحملة فقط إذا رُبط بها صراحةً — لا يُنسب كل عقد من نفس المنصة للحملة
          تلقائياً.
        </p>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-bold text-navy">
            العقود حسب {dim === 'branch' ? 'الفرع' : dim === 'employee' ? 'الموظف' : 'نوع الخدمة'}{' '}
            والمصدر
          </h2>
          <div className="w-48">
            <Select
              aria-label="التوزيع حسب"
              value={dim}
              onChange={(e) => setDim(e.target.value as typeof dim)}
              options={[
                { value: 'employee', label: 'الموظف' },
                { value: 'branch', label: 'الفرع' },
                { value: 'service', label: 'نوع الخدمة' },
              ]}
            />
          </div>
        </div>
        {brk.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : brk.isError ? (
          <ErrorState onRetry={() => void brk.refetch()} />
        ) : (brk.data ?? []).length === 0 ? (
          <EmptyState icon={BarChart3} title="لا عقود في الفترة" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-right text-xs text-purple">
                  {['البند', 'المصدر', 'عقود', 'قيمة العقود', 'الإيراد المحقق', 'المحصّل'].map(
                    (h) => (
                      <th key={h} className="px-2 py-2 font-semibold">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {[...(brk.data ?? [])]
                  .sort((a, b) => b.contract_value - a.contract_value)
                  .map((r) => (
                    <tr key={`${r.dim_key}|${r.source_code}`} className="border-b border-navy-50">
                      <td className="px-2 py-2 font-semibold text-navy">
                        {dim === 'employee'
                          ? (r.dim_key && owners.data?.get(r.dim_key)) || r.dim_label || 'غير متوفر'
                          : dim === 'service'
                            ? ((SERVICE_LABEL as Record<string, string>)[r.dim_key ?? ''] ??
                              r.dim_label ??
                              '—')
                            : (r.dim_label ?? '—')}
                      </td>
                      <td className="px-2 py-2">{label(r.source_code)}</td>
                      <td className="num px-2 py-2">{r.contracts}</td>
                      <td className="num px-2 py-2">{sar(r.contract_value)}</td>
                      <td className="num px-2 py-2 text-green-700">{sar(r.revenue)}</td>
                      <td className="num px-2 py-2 text-green-700">{sar(r.collected)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
