import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FolderKanban,
  PieChart,
  Plus,
  Share2,
  Target,
} from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { BRANCHES_AR } from '@/lib/funnel';
import { byBranch } from '@/features/accounting/data/analytics';
import {
  BUDGET_SCOPE_LABEL,
  COST_CENTER_KIND_LABEL,
  budgetAlerts,
  budgetVsActual,
  centerProfitability,
  spreadAnnual,
  type Budget,
  type BudgetScope,
  type CostCenter,
  type CostCenterKind,
} from '@/features/accounting/data/budgets';
import { sumMoney } from '@/features/accounting/data/money';
import { useChart, useJournal } from '@/features/accounting/hooks/useAccounting';
import {
  useAccAccess,
  useAccConfig,
  useAccMutation,
  useAllocationRules,
  useBudgets,
  useCostCenters,
} from '@/features/accounting/hooks/useAccountingPro';
import * as pro from '@/features/accounting/api/accountingPro.api';
import {
  AXIS,
  CHART_COLORS,
  DataState,
  ExportButtons,
  FilterBar,
  GRID,
  Money,
  SectionCard,
  defaultRange,
  rangeLabel,
  sarTip,
  todayIso,
  type RangeFilter,
} from '@/features/accounting/components/kit';
import { MONTH_AR } from '@/features/accounting/types';

/* ============================== cost centers ============================= */
export function CostCentersProScreen() {
  const journal = useJournal();
  const { data: chart = [] } = useChart();
  const { data: centers = [], isLoading, isError, refetch } = useCostCenters();
  const { data: rules = [] } = useAllocationRules();
  const { allowed, actor } = useAccAccess();
  const [f, setF] = useState<RangeFilter>(defaultRange);
  const [editing, setEditing] = useState<CostCenter | 'new' | null>(null);
  const [period, setPeriod] = useState(todayIso().slice(0, 7));

  const entries = journal.data ?? [];
  const branches = useMemo(
    () => byBranch(entries, chart, { from: f.from, to: f.to }, BRANCHES_AR),
    [entries, chart, f.from, f.to],
  );
  const projects = useMemo(
    () => centerProfitability(entries, chart, centers, { from: f.from, to: f.to }),
    [entries, chart, centers, f.from, f.to],
  );
  const toggle = useAccMutation(
    (c: CostCenter) => pro.saveCostCenter({ ...c, is_active: !c.is_active }, actor, false),
    'تم التحديث',
  );
  const run = useAccMutation(
    (ruleId: string) => pro.runAllocation(ruleId, period, actor),
    'رُحّل قيد توزيع المصروفات المشتركة',
  );

  const columns: Column<CostCenter>[] = [
    {
      key: 'code',
      header: 'الرمز',
      cell: (c) => <span className="num text-xs">{c.code}</span>,
      sortValue: (c) => c.code,
    },
    {
      key: 'name',
      header: 'المركز',
      cell: (c) => <span className="font-semibold text-navy">{c.name}</span>,
      sortValue: (c) => c.name,
    },
    {
      key: 'kind',
      header: 'النوع',
      cell: (c) => <Badge tone="navy">{COST_CENTER_KIND_LABEL[c.kind]}</Badge>,
    },
    { key: 'branch', header: 'الفرع', cell: (c) => c.branch ?? 'الشركة' },
    {
      key: 'st',
      header: 'الحالة',
      cell: (c) => (
        <Badge tone={c.is_active ? 'success' : 'neutral'}>{c.is_active ? 'فعّال' : 'معطّل'}</Badge>
      ),
    },
    {
      key: 'a',
      header: '',
      cell: (c) =>
        allowed('budget', 'edit') && c.kind !== 'branch' ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
              تعديل
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toggle.mutate(c)}>
              {c.is_active ? 'تعطيل' : 'تفعيل'}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar value={f} onChange={setF} showBranch={false} />
      <DataState
        isLoading={isLoading || journal.isLoading}
        isError={isError}
        onRetry={() => void refetch()}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {branches.map((b) => (
            <div key={b.branch} className="rounded-2xl bg-white p-4 shadow-card">
              <p className="flex items-center gap-2 text-sm font-bold text-navy">
                <Building2 size={15} /> {b.branch}
              </p>
              <p className="mt-2 text-xs text-purple">الإيراد</p>
              <Money v={b.revenue} className="font-bold text-green-700" />
              <p className="mt-1 text-xs text-purple">صافي الربح</p>
              <Money v={b.profit} className="text-lg font-bold text-gold-600" />
            </div>
          ))}
        </div>

        <SectionCard
          title="ربحية المشاريع والأقسام"
          icon={FolderKanban}
          actions={
            <ExportButtons
              build={() => ({
                title: 'ربحية مراكز التكلفة',
                subtitle: rangeLabel(f),
                headers: ['المركز', 'الإيراد', 'المصروف', 'الربح', 'الهامش ٪'],
                rows: projects.map((p) => [
                  p.name,
                  p.revenue,
                  p.expenses,
                  p.profit,
                  p.margin ?? '—',
                ]),
              })}
            />
          }
        >
          <Table
            columns={[
              {
                key: 'n',
                header: 'المركز',
                cell: (p) => <span className="font-semibold">{p.name}</span>,
              },
              { key: 'r', header: 'الإيراد', cell: (p) => <Money v={p.revenue} /> },
              { key: 'e', header: 'المصروف', cell: (p) => <Money v={p.expenses} /> },
              {
                key: 'p',
                header: 'الربح',
                cell: (p) => <Money v={p.profit} className="font-bold" />,
                sortValue: (p) => p.profit,
              },
              {
                key: 'm',
                header: 'الهامش',
                cell: (p) => (
                  <span className="num">{p.margin === null ? '—' : `${p.margin}٪`}</span>
                ),
              },
            ]}
            rows={projects}
            rowKey={(p) => p.code}
            emptyTitle="لا مشاريع أو أقسام"
          />
          <p className="mt-2 text-xs text-purple">
            تُنسب الحركات لمشروع/قسم بوسم القيد من شاشة القيود (حقل «المشروع / القسم»).
          </p>
        </SectionCard>

        <SectionCard
          title="توزيع المصروفات المشتركة (المركز الرئيسي ← الفروع)"
          icon={Share2}
          actions={
            <div className="w-36">
              <Input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-label="الفترة"
              />
            </div>
          }
        >
          <ul className="divide-y divide-navy-50 text-sm">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold text-navy">{r.name}</span>
                  <span className="block text-xs text-purple">
                    الحسابات {r.account_codes.join('، ')} ·{' '}
                    {r.basis === 'revenue'
                      ? 'حسب إيراد كل فرع في الفترة'
                      : Object.entries(r.weights)
                          .map(([b, w]) => `${b} ${w}٪`)
                          .join(' · ')}
                  </span>
                </span>
                {allowed('budget', 'edit') && allowed('gl', 'post') && (
                  <Button size="sm" onClick={() => run.mutate(r.id)}>
                    توزيع {period}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-purple">
            التوزيع يُرحّل قيدًا واحدًا لكل فترة (لا يتكرر)، وينقل رصيد المركز الرئيسي للفروع على
            مستوى السطر دون تغيير إجمالي الشركة.
          </p>
        </SectionCard>

        <SectionCard
          title="مراكز التكلفة"
          icon={Building2}
          actions={
            allowed('budget', 'edit') && (
              <Button onClick={() => setEditing('new')}>
                <Plus size={15} /> مركز جديد
              </Button>
            )
          }
        >
          <Table columns={columns} rows={centers} rowKey={(c) => c.code} emptyTitle="لا مراكز" />
        </SectionCard>
      </DataState>
      {editing && (
        <CenterModal center={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function CenterModal({ center, onClose }: { center: CostCenter | null; onClose: () => void }) {
  const { actor } = useAccAccess();
  const [code, setCode] = useState(center?.code ?? 'PRJ-');
  const [name, setName] = useState(center?.name ?? '');
  const [kind, setKind] = useState<CostCenterKind>(center?.kind ?? 'project');
  const [branch, setBranch] = useState(center?.branch ?? '');
  const save = useAccMutation(
    () =>
      pro.saveCostCenter(
        {
          code: code.trim().toUpperCase(),
          name,
          kind,
          branch: branch || null,
          is_active: center?.is_active ?? true,
        },
        actor,
        !center,
      ),
    'حُفظ مركز التكلفة',
  );
  return (
    <Modal open onClose={onClose} title={center ? `تعديل ${center.name}` : 'مركز تكلفة جديد'}>
      <div className="space-y-3">
        <Input
          label="الرمز"
          value={code}
          disabled={!!center}
          onChange={(e) => setCode(e.target.value)}
        />
        <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          label="النوع"
          value={kind}
          onChange={(e) => setKind(e.target.value as CostCenterKind)}
          options={[
            { value: 'project', label: 'مشروع' },
            { value: 'department', label: 'قسم' },
          ]}
        />
        <Select
          label="الفرع"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          options={[
            { value: '', label: 'على مستوى الشركة' },
            ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
          ]}
        />
        <Button className="w-full" onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
          حفظ
        </Button>
      </div>
    </Modal>
  );
}

/* ================================ budgets ================================ */
export function BudgetsScreen() {
  const journal = useJournal();
  const { data: chart = [] } = useChart();
  const { data: budgets = [], isLoading, isError, refetch } = useBudgets();
  const { allowed, actor } = useAccAccess();
  const cfg = useAccConfig();
  const [sel, setSel] = useState<string>('');
  const [through, setThrough] = useState(Math.min(Number(todayIso().slice(5, 7)), 12));
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const budget = budgets.find((b) => b.id === sel) ?? budgets[0];
  const rows = useMemo(
    () => (budget ? budgetVsActual(budget, journal.data ?? [], chart, through) : []),
    [budget, journal.data, chart, through],
  );
  const alerts = useMemo(
    () => budgetAlerts(budgets, journal.data ?? [], chart, cfg.budgetAlertPct, through),
    [budgets, journal.data, chart, cfg.budgetAlertPct, through],
  );
  const setStatus = useAccMutation(
    (b: Budget) =>
      pro.saveBudget({ ...b, status: b.status === 'approved' ? 'draft' : 'approved' }, actor),
    (b) => (b.status === 'approved' ? 'اعتُمدت الموازنة' : 'أُعيدت لمسودة'),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72">
          <Select
            label="الموازنة"
            value={budget?.id ?? ''}
            onChange={(e) => setSel(e.target.value)}
            options={budgets.map((b) => ({
              value: b.id,
              label: `${b.name} (${BUDGET_SCOPE_LABEL[b.scope]})`,
            }))}
          />
        </div>
        <div className="w-40">
          <Select
            label="حتى شهر"
            value={String(through)}
            onChange={(e) => setThrough(Number(e.target.value))}
            options={MONTH_AR.map((m, i) => ({ value: String(i + 1), label: m }))}
          />
        </div>
        {allowed('budget', 'create') && (
          <Button onClick={() => setEditing('new')}>
            <Plus size={15} /> موازنة جديدة
          </Button>
        )}
        {budget && allowed('budget', 'approve') && (
          <Button variant="outline" onClick={() => setStatus.mutate(budget)}>
            {budget.status === 'approved' ? 'إعادة لمسودة' : 'اعتماد الموازنة'}
          </Button>
        )}
        {budget && budget.status === 'draft' && allowed('budget', 'edit') && (
          <Button variant="ghost" onClick={() => setEditing(budget)}>
            تعديل البنود
          </Button>
        )}
      </div>

      {alerts.length > 0 && (
        <SectionCard
          title={`تنبيهات الموازنة (≥ ${cfg.budgetAlertPct}٪ من الإعدادات)`}
          icon={AlertTriangle}
        >
          <ul className="space-y-1 text-sm">
            {alerts.map((a) => (
              <li key={`${a.budget}-${a.code}`} className="flex items-center gap-2">
                <Badge tone={a.overrun ? 'danger' : 'gold'}>{a.overrun ? 'تجاوز' : 'اقتراب'}</Badge>
                {a.budget} — {a.name} <span className="num text-purple">({a.usedPct}٪)</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <DataState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        empty={!budget}
        emptyTitle="لا موازنات بعد"
      >
        {budget && (
          <SectionCard
            title={`${budget.name} — الفعلي مقابل المخطط حتى ${MONTH_AR[through - 1]}`}
            icon={Target}
            actions={
              <>
                <Badge tone={budget.status === 'approved' ? 'success' : 'neutral'}>
                  {budget.status === 'approved' ? 'معتمدة' : 'مسودة'}
                </Badge>
                <ExportButtons
                  build={() => ({
                    title: `الموازنة مقابل الفعلي — ${budget.name}`,
                    subtitle: `حتى ${MONTH_AR[through - 1]} ${budget.year}`,
                    headers: [
                      'الحساب',
                      'المخطط',
                      'الفعلي',
                      'الانحراف (إيجابي = ملائم)',
                      'الاستهلاك ٪',
                    ],
                    rows: rows.map((r) => [
                      `${r.code} ${r.name}`,
                      r.budget,
                      r.actual,
                      r.variance,
                      r.usedPct ?? '—',
                    ]),
                  })}
                />
              </>
            }
          >
            <div className="mb-4 h-64" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 10 }} />
                  <YAxis tick={{ fill: AXIS, fontSize: 11 }} width={70} />
                  <Tooltip formatter={sarTip} />
                  <Legend />
                  <Bar
                    dataKey="budget"
                    name="المخطط"
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
              </ResponsiveContainer>
            </div>
            <Table
              columns={[
                {
                  key: 'n',
                  header: 'الحساب',
                  cell: (r) => (
                    <span>
                      <span className="num text-navy-300 text-xs">{r.code}</span> {r.name}
                    </span>
                  ),
                },
                { key: 'b', header: 'المخطط', cell: (r) => <Money v={r.budget} /> },
                { key: 'a', header: 'الفعلي', cell: (r) => <Money v={r.actual} /> },
                {
                  key: 'v',
                  header: 'الانحراف',
                  cell: (r) => <Money v={r.variance} className="font-bold" />,
                  sortValue: (r) => r.variance,
                },
                {
                  key: 'p',
                  header: 'الحالة',
                  cell: (r) =>
                    r.overrun ? (
                      <Badge tone="danger">تجاوز {r.usedPct}٪</Badge>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700">
                        <CheckCircle2 size={12} /> {r.usedPct === null ? '—' : `${r.usedPct}٪`}
                      </span>
                    ),
                },
              ]}
              rows={rows}
              rowKey={(r) => r.code}
              emptyTitle="لا بنود"
            />
          </SectionCard>
        )}
      </DataState>
      {editing && (
        <BudgetModal budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function BudgetModal({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const { data: chart = [] } = useChart();
  const { data: centers = [] } = useCostCenters();
  const { actor } = useAccAccess();
  const accounts = chart.filter(
    (a) => a.is_postable && (a.type === 'expense' || a.type === 'revenue') && a.is_active !== false,
  );
  const [name, setName] = useState(budget?.name ?? '');
  const [year, setYear] = useState(budget?.year ?? Number(todayIso().slice(0, 4)));
  const [scope, setScope] = useState<BudgetScope>(budget?.scope ?? 'company');
  const [branch, setBranch] = useState(budget?.branch ?? '');
  const [cc, setCc] = useState(budget?.cost_center ?? '');
  const [lines, setLines] = useState<{ account_code: string; annual: number; amounts: number[] }[]>(
    budget?.lines.map((l) => ({
      account_code: l.account_code,
      annual: sumMoney(l.amounts),
      amounts: l.amounts,
    })) ?? [{ account_code: '5400', annual: 0, amounts: Array(12).fill(0) as number[] }],
  );
  const save = useAccMutation(
    () =>
      pro.saveBudget(
        {
          id: budget?.id ?? `bud-${Date.now()}`,
          name: name.trim(),
          year,
          scope,
          branch: scope === 'branch' || scope === 'project' ? branch || null : null,
          cost_center: scope === 'department' || scope === 'project' ? cc || null : null,
          status: 'draft',
          is_active: true,
          lines: lines.map((l) => ({
            account_code: l.account_code,
            amounts: l.amounts.length === 12 ? l.amounts : spreadAnnual(l.annual),
          })),
        },
        actor,
      ),
    'حُفظت الموازنة (مسودة)',
  );
  const setL = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={budget ? `تعديل ${budget.name}` : 'موازنة جديدة'}
    >
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pl-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="السنة"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
          <Select
            label="النطاق"
            value={scope}
            onChange={(e) => setScope(e.target.value as BudgetScope)}
            options={(Object.keys(BUDGET_SCOPE_LABEL) as BudgetScope[]).map((s) => ({
              value: s,
              label: BUDGET_SCOPE_LABEL[s],
            }))}
          />
          {(scope === 'branch' || scope === 'project') && (
            <Select
              label="الفرع"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              options={[
                { value: '', label: '—' },
                ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
              ]}
            />
          )}
          {(scope === 'department' || scope === 'project') && (
            <Select
              label="القسم/المشروع"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              options={[
                { value: '', label: '—' },
                ...centers
                  .filter((c) => c.kind !== 'branch')
                  .map((c) => ({ value: c.code, label: c.name })),
              ]}
            />
          )}
        </div>
        <p className="flex items-center gap-1 text-xs text-purple">
          <PieChart size={13} /> المبلغ السنوي يُوزَّع على 12 شهرًا بالتساوي (بالهللة)، ويمكن تعديل
          أي شهر.
        </p>
        {lines.map((l, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-navy-100 p-3">
            <div className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-7">
                <Select
                  value={l.account_code}
                  onChange={(e) => setL(i, { account_code: e.target.value })}
                  options={accounts.map((a) => ({
                    value: a.code,
                    label: `${a.code} — ${a.name_ar}`,
                  }))}
                />
              </div>
              <div className="col-span-4">
                <Input
                  type="number"
                  min={0}
                  value={l.annual}
                  onChange={(e) =>
                    setL(i, {
                      annual: Number(e.target.value),
                      amounts: spreadAnnual(Number(e.target.value)),
                    })
                  }
                  aria-label="المبلغ السنوي"
                />
              </div>
              <button
                type="button"
                className="col-span-1 pb-2 text-xs text-red-600"
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
              >
                حذف
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-12">
              {l.amounts.map((m, mi) => (
                <input
                  key={mi}
                  type="number"
                  min={0}
                  value={m}
                  title={MONTH_AR[mi]}
                  aria-label={MONTH_AR[mi]}
                  onChange={(e) => {
                    const amounts = l.amounts.map((x, xi) =>
                      xi === mi ? Number(e.target.value) : x,
                    );
                    setL(i, { amounts, annual: sumMoney(amounts) });
                  }}
                  className="num rounded-lg border border-navy-100 px-1 py-1 text-[11px]"
                />
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-navy"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              {
                account_code: accounts[0]?.code ?? '5400',
                annual: 0,
                amounts: Array(12).fill(0) as number[],
              },
            ])
          }
        >
          <Plus size={14} /> بند جديد
        </button>
        <p className="text-sm text-purple">
          الإجمالي السنوي:{' '}
          <span className="num font-bold text-navy">
            {sar(sumMoney(lines.map((l) => l.annual)))}
          </span>
        </p>
        <Button
          className="w-full"
          disabled={!name.trim() || !lines.length}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          حفظ كمسودة
        </Button>
      </div>
    </Modal>
  );
}
