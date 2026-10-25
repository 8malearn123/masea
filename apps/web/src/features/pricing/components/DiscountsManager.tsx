import { useState } from 'react';
import { BadgePercent, Pencil, Plus, Power } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import type { Promotion } from '@/shared/lib/pricing';
import {
  promotionInputSchema,
  toPromotionRow,
  type PromotionInput,
} from '@/features/pricing/api/promotions.api';
import {
  usePromotions,
  useSavePromotion,
  useTogglePromotion,
} from '@/features/pricing/hooks/usePromotions';
import { promotionValueLabel } from '@/features/pricing/components/PromotionPicker';
import { PRICING_SERVICE_LABEL } from '@/features/pricing/types';

const EMPTY: PromotionInput = {
  name: '',
  code: '',
  description: '',
  kind: 'pct',
  value: 5,
  service_codes: [],
  min_base_amount: null,
  max_discount_amount: null,
  starts_at: null,
  ends_at: null,
  usage_limit: null,
  is_active: true,
  requires_code: false,
};

function toForm(p: Promotion): PromotionInput {
  return {
    name: p.name,
    code: p.code ?? '',
    description: p.description ?? '',
    kind: p.discount_pct != null ? 'pct' : 'amount',
    value: p.discount_pct ?? p.discount_amount ?? 0,
    service_codes: [...p.service_codes],
    min_base_amount: p.min_base_amount,
    max_discount_amount: p.max_discount_amount,
    starts_at: p.starts_at ? p.starts_at.slice(0, 10) : null,
    ends_at: p.ends_at ? p.ends_at.slice(0, 10) : null,
    usage_limit: p.usage_limit,
    is_active: p.is_active,
    requires_code: p.requires_code,
  };
}

const optNum = (v: string): number | null => (v.trim() === '' ? null : Number(v));

function conditionsOf(p: Promotion): string {
  const parts: string[] = [];
  parts.push(
    p.service_codes.length === 0
      ? 'كل الخدمات'
      : p.service_codes.map((s) => PRICING_SERVICE_LABEL[s] ?? s).join('، '),
  );
  if (p.min_base_amount != null) parts.push(`حد أدنى ${sar(p.min_base_amount)} ر.س`);
  if (p.usage_limit != null) parts.push(`حتى ${p.usage_limit} استخدام`);
  if (p.ends_at) parts.push(`حتى ${dateAr(p.ends_at)}`);
  return parts.join(' · ');
}

/**
 * Discount catalogue (CRUD) — the ONLY place discounts are defined. Contracts,
 * quotes and the calculator pick from this list; nothing is typed freely.
 */
export function DiscountsManager({ editable }: { editable: boolean }) {
  const { data = [], isLoading, isError, refetch } = usePromotions();
  const toggle = useTogglePromotion();
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);

  const columns: Column<Promotion>[] = [
    {
      key: 'name',
      header: 'الخصم',
      cell: (p) => (
        <div>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-navy-900">
            {p.name}
            {p.requires_code && <Badge tone="gold">كوبون</Badge>}
          </span>
          {p.code && <span className="num block text-[11px] text-purple">{p.code}</span>}
        </div>
      ),
    },
    {
      key: 'value',
      header: 'القيمة',
      cell: (p) => (
        <span className="num text-sm font-semibold text-green-700">{promotionValueLabel(p)}</span>
      ),
    },
    {
      key: 'conditions',
      header: 'شروط التطبيق',
      cell: (p) => <span className="text-xs text-purple">{conditionsOf(p)}</span>,
    },
    {
      key: 'usage',
      header: 'الاستخدام',
      cell: (p) => (
        <span className="num text-xs">
          {p.usage_count}
          {p.usage_limit != null ? ` / ${p.usage_limit}` : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (p) => (
        <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'مفعّل' : 'معطّل'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (p) =>
        editable ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(p)}
              className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
            >
              <Pencil size={13} /> تعديل
            </button>
            <button
              type="button"
              onClick={() => toggle.mutate({ id: p.id, is_active: !p.is_active })}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${p.is_active ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
            >
              <Power size={13} /> {p.is_active ? 'تعطيل' : 'تفعيل'}
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
              <BadgePercent size={16} /> الخصومات المعتمدة
            </h2>
            <p className="mt-1 text-xs text-purple">
              لا يوجد خصم مفتوح — يُختار الخصم في عرض السعر والعقد من هذه القائمة فقط، ويُتحقّق من
              شروطه قبل اعتماده.
            </p>
          </div>
          {editable && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={15} /> خصم جديد
            </Button>
          )}
        </div>
      </Card>
      <Table
        columns={columns}
        rows={data}
        rowKey={(p) => p.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد خصومات معرّفة"
      />
      {editing !== null && (
        <DiscountFormModal
          promotion={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function DiscountFormModal({
  promotion,
  onClose,
}: {
  promotion: Promotion | null;
  onClose: () => void;
}) {
  const save = useSavePromotion();
  const [form, setForm] = useState<PromotionInput>(promotion ? toForm(promotion) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (p: Partial<PromotionInput>) => setForm((f) => ({ ...f, ...p }));

  function toggleService(code: string) {
    set({
      service_codes: form.service_codes.includes(code)
        ? form.service_codes.filter((c) => c !== code)
        : [...form.service_codes, code],
    });
  }

  function submit() {
    const parsed = promotionInputSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0] ?? 'form');
        next[k] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    const row = toPromotionRow(parsed.data);
    save.mutate(
      {
        ...(promotion ? { id: promotion.id } : {}),
        row: {
          ...row,
          starts_at: row.starts_at ? `${row.starts_at}T00:00:00Z` : null,
          ends_at: row.ends_at ? `${row.ends_at}T23:59:59Z` : null,
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title={promotion ? 'تعديل خصم' : 'خصم جديد'}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="اسم الخصم"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            error={errors.name}
          />
          <Input
            label={form.requires_code ? 'رمز الكوبون' : 'الرمز (اختياري)'}
            value={form.code}
            onChange={(e) => set({ code: e.target.value })}
            placeholder="NATIONAL95"
            className="num"
            error={errors.code}
          />
          <Select
            label="نوع الخصم"
            value={form.kind}
            onChange={(e) => set({ kind: e.target.value as 'pct' | 'amount' })}
            options={[
              { value: 'pct', label: 'نسبة مئوية (٪)' },
              { value: 'amount', label: 'قيمة ثابتة (ر.س)' },
            ]}
          />
          <Input
            label={form.kind === 'pct' ? 'النسبة (٪)' : 'القيمة (ر.س)'}
            type="number"
            min={0}
            value={Number.isFinite(form.value) ? form.value : ''}
            onChange={(e) => set({ value: Number(e.target.value) })}
            error={errors.value}
          />
          {form.kind === 'pct' && (
            <Input
              label="سقف قيمة الخصم (ر.س، اختياري)"
              type="number"
              min={0}
              value={form.max_discount_amount ?? ''}
              onChange={(e) => set({ max_discount_amount: optNum(e.target.value) })}
              error={errors.max_discount_amount}
            />
          )}
          <Input
            label="أقل مبلغ أساسي للتطبيق (ر.س، اختياري)"
            type="number"
            min={0}
            value={form.min_base_amount ?? ''}
            onChange={(e) => set({ min_base_amount: optNum(e.target.value) })}
            error={errors.min_base_amount}
          />
          <Input
            label="يبدأ من (اختياري)"
            type="date"
            value={form.starts_at ?? ''}
            onChange={(e) => set({ starts_at: e.target.value || null })}
          />
          <Input
            label="ينتهي في (اختياري)"
            type="date"
            value={form.ends_at ?? ''}
            onChange={(e) => set({ ends_at: e.target.value || null })}
            error={errors.ends_at}
          />
          <Input
            label="الحد الأقصى لمرات الاستخدام (اختياري)"
            type="number"
            min={1}
            value={form.usage_limit ?? ''}
            onChange={(e) => set({ usage_limit: optNum(e.target.value) })}
            error={errors.usage_limit}
          />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-navy-900">الخدمات المشمولة</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PRICING_SERVICE_LABEL).map(([code, label]) => {
              const on = form.service_codes.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleService(code)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${on ? 'border-navy bg-navy text-white' : 'border-navy-100 text-navy hover:border-navy'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-purple">بدون اختيار = يشمل كل الخدمات.</p>
        </div>
        <Input
          label="الوصف (اختياري)"
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set({ is_active: e.target.checked })}
            className="h-4 w-4 rounded border-navy-100"
          />
          مفعّل ومتاح للاختيار
        </label>
        <label className="flex items-start gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={form.requires_code}
            onChange={(e) => set({ requires_code: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-navy-100"
          />
          <span>
            كوبون خصم — لا يظهر في قائمة الخصومات، ويُطبَّق فقط بإدخال رمزه
            <span className="block text-[11px] text-purple">
              يُمنح للعميل (رسالة، حملة، عجلة الحظ) ويُدخله الموظف في خانة الكوبون.
            </span>
          </span>
        </label>
        <Button onClick={submit} loading={save.isPending} className="w-full">
          حفظ الخصم
        </Button>
      </div>
    </Modal>
  );
}
