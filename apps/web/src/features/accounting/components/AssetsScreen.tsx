import { useState } from 'react';
import { Building, CheckCircle2, Plus, TrendingDown } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { monthlyDepreciation, netBookValue } from '@/features/accounting/data/assets';
import {
  useAddFixedAsset,
  useChart,
  useFixedAssets,
  usePostDepreciation,
  usePostedDepreciation,
} from '@/features/accounting/hooks/useAccounting';
import {
  ASSET_CATEGORY_LABEL,
  type AssetCategory,
  type FixedAsset,
} from '@/features/accounting/types';

const branchOptions = [
  { value: 'head', label: 'المركز الرئيسي' },
  ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
];
const CATEGORIES: AssetCategory[] = ['furniture', 'devices', 'vehicles'];
const PERIODS = ['2026-04', '2026-05', '2026-06'] as const;

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

export function AssetsScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: assets = [], isLoading, isError, refetch } = useFixedAssets();
  const { data: depPosted = [] } = usePostedDepreciation();
  const postDep = usePostDepreciation();
  const [adding, setAdding] = useState(false);
  const [period, setPeriod] = useState('2026-06');

  const active = assets.filter((a) => a.status === 'active');
  const totalCost = active.reduce((s, a) => s + a.cost, 0);
  const totalDep = active.reduce((s, a) => s + a.accumulated_dep, 0);
  const totalNbv = active.reduce((s, a) => s + netBookValue(a), 0);
  const monthlyTotal = active.reduce((s, a) => s + monthlyDepreciation(a), 0);
  const isPosted = depPosted.includes(period);

  const columns: Column<FixedAsset>[] = [
    {
      key: 'name',
      header: 'الأصل',
      cell: (a) => <span className="font-semibold text-navy">{a.name}</span>,
    },
    {
      key: 'category',
      header: 'الفئة',
      cell: (a) => <Badge tone="navy">{ASSET_CATEGORY_LABEL[a.category]}</Badge>,
    },
    { key: 'branch', header: 'الفرع', cell: (a) => a.branch ?? 'المركز' },
    { key: 'cost', header: 'التكلفة', cell: (a) => <span className="num">{sar(a.cost)}</span> },
    {
      key: 'dep',
      header: 'مجمع الإهلاك',
      cell: (a) => <span className="num text-red-600">{sar(a.accumulated_dep)}</span>,
    },
    {
      key: 'nbv',
      header: 'القيمة الدفترية',
      cell: (a) => <span className="num font-bold text-navy">{sar(netBookValue(a))}</span>,
    },
    {
      key: 'monthly',
      header: 'إهلاك شهري',
      cell: (a) => <span className="num text-purple">{sar(monthlyDepreciation(a))}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="عدد الأصول" value={String(active.length)} />
        <Stat label="إجمالي التكلفة" value={sar(totalCost)} />
        <Stat label="مجمع الإهلاك" value={sar(totalDep)} tone="text-red-600" />
        <Stat label="صافي القيمة الدفترية" value={sar(totalNbv)} tone="text-gold-600" />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <Select
            label="فترة الإهلاك"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={PERIODS.map((p) => ({ value: p, label: p }))}
          />
          {editable &&
            (isPosted ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">
                <CheckCircle2 size={14} /> إهلاك الفترة مُرحَّل
              </span>
            ) : (
              <Button
                variant="outline"
                onClick={() => postDep.mutate(period)}
                disabled={monthlyTotal <= 0}
              >
                <TrendingDown size={16} /> ترحيل إهلاك الفترة ({sar(monthlyTotal)})
              </Button>
            ))}
        </div>
        {editable && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> إضافة أصل ثابت
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        rows={assets}
        rowKey={(a) => a.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد أصول ثابتة"
      />
      <p className="text-xs leading-relaxed text-purple">
        الشراء يُرحَّل: مدين حساب الأصل / دائن البنك. الإهلاك الشهري (القسط الثابت): مدين مصروف
        الإهلاك (٥٩٠٠) / دائن مجمع الإهلاك (١٢٩٠). القيمة الدفترية = التكلفة − مجمع الإهلاك.
      </p>

      {adding && <AddAssetModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddAssetModal({ onClose }: { onClose: () => void }) {
  const add = useAddFixedAsset();
  const { data: chart = [] } = useChart();
  const cashOptions = chart
    .filter((a) => ['1111', '1112', '1113'].includes(a.code))
    .map((a) => ({ value: a.code, label: `${a.code} — ${a.name_ar}` }));
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AssetCategory>('devices');
  const [cost, setCost] = useState(0);
  const [salvage, setSalvage] = useState(0);
  const [life, setLife] = useState(5);
  const [date, setDate] = useState('2026-03-01');
  const [branch, setBranch] = useState('نجران');
  const [pay, setPay] = useState('1112');

  function submit() {
    add.mutate(
      {
        name,
        category,
        cost,
        salvage_value: salvage,
        useful_life_years: life,
        acquisition_date: date,
        branch: branch === 'head' ? null : branch,
        pay_code: pay,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="إضافة أصل ثابت">
      <div className="space-y-3">
        <Input label="اسم الأصل" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="الفئة"
            value={category}
            onChange={(e) => setCategory(e.target.value as AssetCategory)}
            options={CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABEL[c] }))}
          />
          <Select
            label="السداد من"
            value={pay}
            onChange={(e) => setPay(e.target.value)}
            options={cashOptions}
          />
          <Input
            label="التكلفة"
            type="number"
            min={0}
            value={cost}
            onChange={(e) => setCost(Number(e.target.value))}
          />
          <Input
            label="القيمة التخريدية"
            type="number"
            min={0}
            value={salvage}
            onChange={(e) => setSalvage(Number(e.target.value))}
          />
          <Input
            label="العمر الإنتاجي (سنوات)"
            type="number"
            min={1}
            value={life}
            onChange={(e) => setLife(Number(e.target.value))}
          />
          <Input
            label="تاريخ الشراء"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions}
          />
        </div>
        {cost > 0 && (
          <p className="text-xs text-purple">
            الإهلاك الشهري المتوقّع:{' '}
            <span className="num font-semibold text-navy">
              {sar(Math.round(((cost - salvage) / (life * 12)) * 100) / 100)}
            </span>{' '}
            ر.س
          </p>
        )}
        <Button onClick={submit} disabled={cost <= 0} className="w-full">
          <Building size={16} /> إضافة الأصل وترحيل الشراء
        </Button>
      </div>
    </Modal>
  );
}
