import { useState } from 'react';
import { Package, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { FALLBACK_SERVICES } from '@/lib/funnel';
import { accountName } from '@/features/accounting/data/chart';
import {
  useCatalog,
  useChart,
  useSaveCatalogItem,
  useToggleCatalogItem,
} from '@/features/accounting/hooks/useAccounting';
import {
  CATALOG_KIND_LABEL,
  CATALOG_UNIT_LABEL,
  type CatalogItem,
  type CatalogKind,
  type CatalogUnit,
} from '@/features/accounting/types';
import type { NewCatalogInput } from '@/features/accounting/api/accounting.api';

const UNITS: CatalogUnit[] = ['fixed', 'month', 'day', 'hour', 'unit'];

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

export function ProductsScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: items = [], isLoading, isError, refetch } = useCatalog();
  const toggle = useToggleCatalogItem();
  const [edit, setEdit] = useState<CatalogItem | null>(null);
  const [adding, setAdding] = useState(false);

  const active = items.filter((i) => i.is_active);
  const services = active.filter((i) => i.kind === 'service').length;
  const products = active.filter((i) => i.kind === 'product').length;

  const columns: Column<CatalogItem>[] = [
    {
      key: 'name_ar',
      header: 'الصنف',
      cell: (i) => (
        <span className={i.is_active ? 'font-semibold text-navy' : 'text-navy-300 line-through'}>
          {i.name_ar}
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'النوع',
      cell: (i) => (
        <Badge tone={i.kind === 'service' ? 'teal' : 'navy'}>{CATALOG_KIND_LABEL[i.kind]}</Badge>
      ),
    },
    { key: 'unit', header: 'الوحدة', cell: (i) => CATALOG_UNIT_LABEL[i.unit] },
    {
      key: 'price',
      header: 'السعر الافتراضي',
      cell: (i) => <span className="num font-bold text-navy">{sar(i.default_price)}</span>,
    },
    {
      key: 'revenue',
      header: 'حساب الإيراد',
      cell: (i) => (
        <span className="text-xs text-purple">
          <span className="num text-navy-300">{i.revenue_code}</span> {accountName(i.revenue_code)}
        </span>
      ),
    },
    {
      key: 'taxable',
      header: 'الضريبة',
      cell: (i) =>
        i.taxable ? <Badge tone="gold">خاضع ١٥٪</Badge> : <Badge tone="neutral">معفى</Badge>,
    },
    ...(editable
      ? [
          {
            key: 'actions',
            header: '',
            cell: (i: CatalogItem) => (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEdit(i)}
                  className="text-purple hover:text-navy"
                  title="تعديل"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: i.id, active: !i.is_active })}
                  className="text-purple hover:text-red-600"
                  title={i.is_active ? 'تعطيل' : 'تفعيل'}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ),
          } as Column<CatalogItem>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="الخدمات" value={String(services)} tone="text-teal" />
        <Stat label="المنتجات" value={String(products)} tone="text-navy" />
        <Stat label="إجمالي الأصناف الفعّالة" value={String(active.length)} tone="text-gold-600" />
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> إضافة صنف
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={items}
        rowKey={(i) => i.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد أصناف"
      />
      <p className="text-xs leading-relaxed text-purple">
        كتالوج خدمات ماسية الشرق (استقدام · تأجير · نقل كفالة …) والمنتجات، كلٌّ مربوط بحساب إيراده.
        يُستخدم لتعبئة بنود فواتير المبيعات تلقائيًا.
      </p>
      {(adding || edit) && (
        <CatalogModal
          item={edit}
          onClose={() => {
            setAdding(false);
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function CatalogModal({ item, onClose }: { item: CatalogItem | null; onClose: () => void }) {
  const save = useSaveCatalogItem();
  const { data: chart = [] } = useChart();
  const revenueAccounts = chart.filter(
    (a) => a.type === 'revenue' && a.is_postable && a.is_active !== false,
  );
  const [name, setName] = useState(item?.name_ar ?? '');
  const [kind, setKind] = useState<CatalogKind>(item?.kind ?? 'service');
  const [unit, setUnit] = useState<CatalogUnit>(item?.unit ?? 'fixed');
  const [price, setPrice] = useState(item?.default_price ?? 0);
  const [revenue, setRevenue] = useState(item?.revenue_code ?? revenueAccounts[0]?.code ?? '4100');
  const [service, setService] = useState(item?.service_code ?? '');
  const [taxable, setTaxable] = useState(item?.taxable ?? true);

  function submit() {
    const input: NewCatalogInput = {
      name_ar: name,
      kind,
      unit,
      default_price: price,
      revenue_code: revenue,
      service_code: service || null,
      taxable,
    };
    save.mutate({ ...(item ? { id: item.id } : {}), input }, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title={item ? `تعديل صنف — ${item.name_ar}` : 'إضافة صنف'}>
      <div className="space-y-3">
        <Input label="اسم الصنف" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="النوع"
            value={kind}
            onChange={(e) => setKind(e.target.value as CatalogKind)}
            options={[
              { value: 'service', label: 'خدمة' },
              { value: 'product', label: 'منتج' },
            ]}
          />
          <Select
            label="وحدة التسعير"
            value={unit}
            onChange={(e) => setUnit(e.target.value as CatalogUnit)}
            options={UNITS.map((u) => ({ value: u, label: CATALOG_UNIT_LABEL[u] }))}
          />
          <Input
            label="السعر الافتراضي"
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
          <Select
            label="حساب الإيراد"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            options={revenueAccounts.map((a) => ({
              value: a.code,
              label: `${a.code} — ${a.name_ar}`,
            }))}
          />
          <div className="sm:col-span-2">
            <Select
              label="ربط بخدمة المنصة (اختياري)"
              value={service}
              onChange={(e) => setService(e.target.value)}
              options={[
                { value: '', label: 'بدون ربط' },
                ...FALLBACK_SERVICES.map((s) => ({ value: String(s.code), label: s.name_ar })),
              ]}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />{' '}
          خاضع لضريبة القيمة المضافة (١٥٪)
        </label>
        <Button onClick={submit} disabled={!name.trim()} className="w-full">
          {kind === 'service' ? <Wrench size={16} /> : <Package size={16} />}{' '}
          {item ? 'حفظ التعديلات' : 'إضافة الصنف'}
        </Button>
      </div>
    </Modal>
  );
}
