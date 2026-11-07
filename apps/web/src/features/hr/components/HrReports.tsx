import { useMemo, useState } from 'react';
import { BarChart3, Download, Flag, Printer, Repeat, UserX, Users, Wallet } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Select, Skeleton, StatTile } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { exportCsv, exportPdf, type ExportTable } from '@/shared/lib/exportTable';
import { configValue } from '@/features/settings/api/settings.api';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { useHrReportRows, useNitaqatBands } from '@/features/hr/hooks/useHrReports';
import {
  DEFAULT_FULL_WAGE,
  DEFAULT_HALF_WEIGHT,
  groupBy,
  isActive,
  nitaqatBand,
  presetRange,
  SAUDI_FULL_WAGE_KEY,
  SAUDI_HALF_WEIGHT_KEY,
  saudisNeeded,
  saudization,
  turnover,
  absenceRate,
  type Group,
} from '@/features/hr/lib/hrReports';
import {
  TERMINATION_REASON_LABEL,
  type HrReportRow,
  type NitaqatBand,
  type TerminationReason,
} from '@/features/hr/types';

type Dim = 'branch' | 'department' | 'nationality';
const DIM_LABEL: Record<Dim, string> = {
  branch: 'الفرع',
  department: 'القسم',
  nationality: 'الجنسية',
};
const pct = (n: number) => `${n}٪`;

function ExportButtons({ table }: { table: () => ExportTable }) {
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label="تصدير CSV"
        title="تصدير CSV"
        onClick={() => exportCsv(table())}
      >
        <Download size={15} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label="طباعة"
        title="طباعة / PDF"
        onClick={() => exportPdf(table())}
      >
        <Printer size={15} />
      </Button>
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 w-24 overflow-hidden rounded-full bg-navy-50" aria-hidden>
      <div
        className="h-full rounded-full bg-navy"
        style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }}
      />
    </div>
  );
}

/** «التقارير» — cost, workforce, Saudization/Nitaqat, turnover, absence. */
export function HrReports() {
  const [range, setRange] = useState(() => presetRange('month'));
  const { data: rows, isLoading, isError, error, refetch } = useHrReportRows(range.from, range.to);
  const { data: cfg = [] } = useConfig();
  const bands = useNitaqatBands();
  const rule = {
    fullWage: configValue(cfg, SAUDI_FULL_WAGE_KEY, DEFAULT_FULL_WAGE),
    halfWeight: configValue(cfg, SAUDI_HALF_WEIGHT_KEY, DEFAULT_HALF_WEIGHT),
  };
  const subtitle = `من ${dateAr(range.from)} إلى ${dateAr(range.to)}`;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3">
        {(
          [
            ['month', 'هذا الشهر'],
            ['quarter', 'هذا الربع'],
            ['year', 'هذه السنة'],
          ] as const
        ).map(([k, label]) => (
          <Button key={k} variant="outline" size="sm" onClick={() => setRange(presetRange(k))}>
            {label}
          </Button>
        ))}
        <div className="w-40">
          <Input
            label="من"
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
        </div>
        <div className="w-40">
          <Input
            label="إلى"
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
        </div>
        {range.from > range.to && <p className="pb-2 text-xs text-red-600">الفترة غير صحيحة</p>}
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <ErrorState
          title={(error as Error)?.message || 'تعذّر تحميل التقارير'}
          onRetry={() => void refetch()}
        />
      ) : !rows || rows.length === 0 ? (
        <Card className="py-10 text-center text-sm text-purple">
          لا يوجد موظفون في هذه الفترة ضمن نطاقك.
        </Card>
      ) : (
        <ReportBody
          rows={rows}
          from={range.from}
          to={range.to}
          subtitle={subtitle}
          bands={bands}
          rule={rule}
        />
      )}
    </div>
  );
}

function ReportBody({
  rows,
  from,
  to,
  subtitle,
  bands,
  rule,
}: {
  rows: HrReportRow[];
  from: string;
  to: string;
  subtitle: string;
  bands: NitaqatBand[];
  rule: { fullWage: number; halfWeight: number };
}) {
  const [dim, setDim] = useState<Dim>('branch');
  const [absDim, setAbsDim] = useState<Dim>('department');
  const groups = useMemo(() => groupBy(rows, dim), [rows, dim]);
  const absGroups = useMemo(() => groupBy(rows, absDim), [rows, absDim]);
  const money = rows.every((r) => r.cost !== null);
  const totalCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const estimated = rows.some((r) => r.cost_estimated);
  const company = saudization(rows, rule);
  const band = nitaqatBand(company.pct, bands);
  const to_ = turnover(rows, from, to);
  const present = rows.reduce((s, r) => s + r.present_days, 0);
  const late = rows.reduce((s, r) => s + r.late_days, 0);
  const absent = rows.reduce((s, r) => s + r.absent_days, 0);
  const branches = groupBy(rows, 'branch').map((g) => g.key);
  const nextBand = bands
    .filter((b) => b.is_active && b.min_pct > company.pct)
    .sort((a, b) => a.min_pct - b.min_pct)[0];
  const maxCost = Math.max(...groups.map((g) => g.cost ?? 0), 0);
  const maxHead = Math.max(...groups.map((g) => g.headcount), 0);

  const leavers = rows.filter(
    (r) => r.termination_date && r.termination_date >= from && r.termination_date <= to,
  );
  const topAbsent = [...rows]
    .filter((r) => r.absent_days > 0)
    .sort((a, b) => b.absent_days - a.absent_days)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="القوى العاملة" value={rows.filter(isActive).length} icon={Users} />
        <StatTile
          label="تكلفة القوى العاملة"
          value={money ? sar(totalCost) : '—'}
          hint={
            money
              ? estimated
                ? 'يشمل تقديرًا لأشهر لم تُعتمد'
                : 'من مسيرات معتمدة'
              : 'الرواتب للموارد البشرية والمحاسبة'
          }
          icon={Wallet}
        />
        <StatTile
          label="نسبة السعودة"
          value={pct(company.pct)}
          hint={band?.name_ar ?? ''}
          tone={band?.tone === 'danger' ? 'danger' : 'success'}
          icon={Flag}
        />
        <StatTile
          label="معدل الدوران"
          value={pct(to_.rate)}
          hint={`${to_.leavers} مغادر`}
          tone={to_.rate > 10 ? 'warning' : 'navy'}
          icon={Repeat}
        />
        <StatTile
          label="نسبة الغياب"
          value={pct(absenceRate(present, late, absent))}
          hint={`${absent} يوم غياب`}
          tone="warning"
          icon={UserX}
        />
      </div>

      {/* cost & workforce */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
            <BarChart3 size={16} /> التكلفة والقوى العاملة حسب {DIM_LABEL[dim]}
          </h3>
          <div className="flex items-center gap-2">
            <Select
              aria-label="التجميع"
              value={dim}
              onChange={(e) => setDim(e.target.value as Dim)}
              options={(Object.keys(DIM_LABEL) as Dim[]).map((d) => ({
                value: d,
                label: DIM_LABEL[d],
              }))}
            />
            <ExportButtons
              table={() => ({
                title: `تكلفة القوى العاملة حسب ${DIM_LABEL[dim]}`,
                subtitle,
                headers: [
                  DIM_LABEL[dim],
                  'عدد الموظفين',
                  'التكلفة',
                  'متوسط التكلفة للموظف',
                  'المغادرون',
                ],
                rows: groups.map((g) => [
                  g.key,
                  g.headcount,
                  g.cost ?? '',
                  g.cost !== null && g.headcount ? Math.round(g.cost / g.headcount) : '',
                  g.leavers,
                ]),
                footer: [
                  'الإجمالي',
                  rows.filter(isActive).length,
                  money ? Math.round(totalCost * 100) / 100 : '',
                  '',
                  to_.leavers,
                ],
              })}
            />
          </div>
        </div>
        <GroupTable
          groups={groups}
          money={money}
          maxCost={maxCost}
          maxHead={maxHead}
          label={DIM_LABEL[dim]}
        />
        {estimated && money && (
          <p className="text-[11px] text-purple">
            الأشهر التي لم يُعتمد مسيرها بعد تُقدَّر بمحرك الرواتب نفسه (الإجمالي + حصة المنشأة من
            التأمينات).
          </p>
        )}
      </Card>

      {/* saudization */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
            <Flag size={16} /> السعودة ونطاقات
          </h3>
          <ExportButtons
            table={() => ({
              title: 'السعودة ونطاقات',
              subtitle,
              headers: [
                'الفرع',
                'السعوديون (محتسبون)',
                'إجمالي الموظفين',
                'نسبة السعودة',
                'النطاق',
              ],
              rows: branches.map((b) => {
                const s = saudization(
                  rows.filter((r) => (r.branch || 'غير محدد') === b),
                  rule,
                );
                return [b, s.saudis, s.total, s.pct, nitaqatBand(s.pct, bands)?.name_ar ?? ''];
              }),
              footer: ['المنشأة', company.saudis, company.total, company.pct, band?.name_ar ?? ''],
            })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-navy-50 px-3 py-2 text-sm text-navy">
          المنشأة: <span className="num font-bold">{pct(company.pct)}</span>
          {band && <Badge tone={band.tone}>{band.name_ar}</Badge>}
          <span className="text-xs text-purple">
            (<span className="num">{company.saudis}</span> سعودي محتسب من{' '}
            <span className="num">{company.total}</span>)
          </span>
          {nextBand && (
            <span className="text-xs text-gold-600">
              للوصول إلى «{nextBand.name_ar}» يلزم{' '}
              <span className="num">{saudisNeeded(company, nextBand.min_pct)}</span> سعودي إضافي
              بأجر <span className="num">{sar(rule.fullWage)}</span> فأكثر.
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-purple">
              <tr>
                <th className="py-2 text-right">الفرع</th>
                <th className="py-2 text-right">السعوديون المحتسبون</th>
                <th className="py-2 text-right">الإجمالي</th>
                <th className="py-2 text-right">النسبة</th>
                <th className="py-2 text-right">النطاق</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const s = saudization(
                  rows.filter((r) => (r.branch || 'غير محدد') === b),
                  rule,
                );
                const nb = nitaqatBand(s.pct, bands);
                return (
                  <tr key={b} className="border-t border-navy-50">
                    <td className="py-2 font-medium text-navy">{b}</td>
                    <td className="py-2">
                      <span className="num">{s.saudis}</span>
                    </td>
                    <td className="py-2">
                      <span className="num">{s.total}</span>
                    </td>
                    <td className="py-2">
                      <span className="num">{pct(s.pct)}</span>
                    </td>
                    <td className="py-2">{nb && <Badge tone={nb.tone}>{nb.name_ar}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-purple">
          السعودي بأجر أقل من <span className="num">{sar(rule.fullWage)}</span> ريال يُحتسب بوزن{' '}
          <span className="num">{rule.halfWeight}</span> — والنطاقات وحدودها تُعدَّل من الإعدادات
          حسب نشاط المنشأة في «قوى».
        </p>
      </Card>

      {/* turnover */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
            <Repeat size={16} /> الدوران الوظيفي
          </h3>
          <ExportButtons
            table={() => ({
              title: 'الدوران الوظيفي',
              subtitle: `${subtitle} — المعدل ${to_.rate}٪`,
              headers: ['الموظف', 'الفرع', 'القسم', 'تاريخ المغادرة', 'السبب'],
              rows: leavers.map((r) => [
                r.full_name,
                r.branch,
                r.department,
                r.termination_date ?? '',
                TERMINATION_REASON_LABEL[r.termination_reason as TerminationReason] ??
                  r.termination_reason ??
                  '',
              ]),
            })}
          />
        </div>
        <p className="text-sm text-navy">
          عدد الموظفين أول الفترة <span className="num font-semibold">{to_.startHeadcount}</span>{' '}
          وآخرها <span className="num font-semibold">{to_.endHeadcount}</span> — غادر{' '}
          <span className="num font-semibold">{to_.leavers}</span> — المعدل{' '}
          <span className="num font-bold">{pct(to_.rate)}</span>
        </p>
        {to_.byReason.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {to_.byReason.map((b) => (
              <Badge key={b.reason} tone="navy">
                {TERMINATION_REASON_LABEL[b.reason as TerminationReason] ?? b.reason}: {b.count}
              </Badge>
            ))}
          </div>
        )}
        {leavers.length === 0 ? (
          <p className="py-3 text-center text-sm text-purple">لا توجد مغادرات في الفترة.</p>
        ) : (
          <ul className="divide-y divide-navy-50 text-sm">
            {leavers.map((r) => (
              <li key={r.employee_id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-medium text-navy">
                  {r.full_name}{' '}
                  <span className="text-xs text-purple">
                    · {r.branch} · {r.department}
                  </span>
                </span>
                <span className="text-xs text-purple">
                  <span className="num">{dateAr(r.termination_date ?? '')}</span> —{' '}
                  {TERMINATION_REASON_LABEL[r.termination_reason as TerminationReason] ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* absence */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
            <UserX size={16} /> الغياب والتأخير حسب {DIM_LABEL[absDim]}
          </h3>
          <div className="flex items-center gap-2">
            <Select
              aria-label="تجميع الغياب"
              value={absDim}
              onChange={(e) => setAbsDim(e.target.value as Dim)}
              options={(Object.keys(DIM_LABEL) as Dim[]).map((d) => ({
                value: d,
                label: DIM_LABEL[d],
              }))}
            />
            <ExportButtons
              table={() => ({
                title: `الغياب والتأخير حسب ${DIM_LABEL[absDim]}`,
                subtitle,
                headers: [
                  DIM_LABEL[absDim],
                  'أيام الحضور',
                  'أيام التأخير',
                  'دقائق التأخير',
                  'أيام الغياب',
                  'أيام الإجازة',
                  'نسبة الغياب',
                ],
                rows: absGroups.map((g) => [
                  g.key,
                  g.present,
                  g.late,
                  g.lateMinutes,
                  g.absent,
                  g.leaveDays,
                  g.absenceRate,
                ]),
              })}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-purple">
              <tr>
                <th className="py-2 text-right">{DIM_LABEL[absDim]}</th>
                <th className="py-2 text-right">حضور</th>
                <th className="py-2 text-right">تأخير</th>
                <th className="py-2 text-right">دقائق التأخير</th>
                <th className="py-2 text-right">غياب</th>
                <th className="py-2 text-right">إجازات</th>
                <th className="py-2 text-right">نسبة الغياب</th>
              </tr>
            </thead>
            <tbody>
              {absGroups.map((g) => (
                <tr key={g.key} className="border-t border-navy-50">
                  <td className="py-2 font-medium text-navy">{g.key}</td>
                  <td className="py-2">
                    <span className="num">{g.present}</span>
                  </td>
                  <td className="py-2">
                    <span className="num">{g.late}</span>
                  </td>
                  <td className="py-2">
                    <span className="num">{g.lateMinutes}</span>
                  </td>
                  <td className="py-2">
                    <span className="num">{g.absent}</span>
                  </td>
                  <td className="py-2">
                    <span className="num">{g.leaveDays}</span>
                  </td>
                  <td className="py-2">
                    <Badge
                      tone={g.absenceRate > 10 ? 'danger' : g.absenceRate > 5 ? 'gold' : 'success'}
                    >
                      {pct(g.absenceRate)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {topAbsent.length > 0 && (
          <p className="text-xs text-purple">
            الأكثر غيابًا:{' '}
            {topAbsent.map((r, i) => (
              <span key={r.employee_id}>
                {i > 0 && '، '}
                {r.full_name} (<span className="num">{r.absent_days}</span>)
              </span>
            ))}
          </p>
        )}
      </Card>
    </div>
  );
}

function GroupTable({
  groups,
  money,
  maxCost,
  maxHead,
  label,
}: {
  groups: Group[];
  money: boolean;
  maxCost: number;
  maxHead: number;
  label: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-purple">
          <tr>
            <th className="py-2 text-right">{label}</th>
            <th className="py-2 text-right">الموظفون</th>
            {money && <th className="py-2 text-right">التكلفة</th>}
            {money && <th className="py-2 text-right">متوسط للموظف</th>}
            <th className="py-2 text-right">المغادرون</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-t border-navy-50">
              <td className="py-2 font-medium text-navy">{g.key}</td>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <span className="num w-6">{g.headcount}</span>
                  {!money && <Bar value={g.headcount} max={maxHead} />}
                </span>
              </td>
              {money && (
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <span className="num w-28">{sar(g.cost ?? 0)}</span>
                    <Bar value={g.cost ?? 0} max={maxCost} />
                  </span>
                </td>
              )}
              {money && (
                <td className="py-2">
                  <span className="num">
                    {g.headcount && g.cost !== null ? sar(g.cost / g.headcount) : '—'}
                  </span>
                </td>
              )}
              <td className="py-2">
                <span className="num">{g.leavers}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
