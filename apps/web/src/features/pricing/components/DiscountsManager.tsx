import { useState } from 'react';
import {
  BadgePercent,
  CalendarClock,
  CircleSlash,
  FlaskConical,
  Info,
  Pencil,
  Plus,
  Power,
  Repeat,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Drawer,
  Input,
  Select,
  StatTile,
  Table,
  type Column,
} from '@/shared/ui';
import { evaluatePromotion } from '@/shared/lib/pricing';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { FilterSelect, SearchBox, Toolbar } from '@/features/pricing/components/shared';
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
  if (p.min_base_amount != null) parts.push(`حد أدنى للطلب ${sar(p.min_base_amount)} ر.س`);
  if (p.requires_code) parts.push('بإدخال الرمز فقط');
  return parts.join(' · ');
}

export type PromoState = 'active' | 'scheduled' | 'expired' | 'exhausted' | 'disabled';
export const PROMO_STATE: Record<
  PromoState,
  { label: string; tone: 'success' | 'navy' | 'gold' | 'danger' | 'neutral' }
> = {
  active: { label: 'نشط', tone: 'success' },
  scheduled: { label: 'مجدول', tone: 'navy' },
  expired: { label: 'منتهٍ', tone: 'gold' },
  exhausted: { label: 'استُنفد', tone: 'danger' },
  disabled: { label: 'معطّل', tone: 'neutral' },
};
export function promoState(p: Promotion, now = new Date()): PromoState {
  if (!p.is_active) return 'disabled';
  if (p.ends_at && now > new Date(p.ends_at)) return 'expired';
  if (p.usage_limit != null && p.usage_count >= p.usage_limit) return 'exhausted';
  if (p.starts_at && now < new Date(p.starts_at)) return 'scheduled';
  return 'active';
}
const validityOf = (p: Promotion) =>
  p.starts_at || p.ends_at
    ? `${p.starts_at ? dateAr(p.starts_at) : '—'} ← ${p.ends_at ? dateAr(p.ends_at) : 'مفتوح'}`
    : 'بلا تاريخ انتهاء';

/**
 * Discount catalogue (CRUD) — the ONLY place discounts are defined. Contracts,
 * quotes and the calculator pick from this list; nothing is typed freely.
 */
export function DiscountsManager({ editable }: { editable: boolean }) {
  const { data = [], isLoading, isError, refetch } = usePromotions();
  const toggle = useTogglePromotion();
  const { data: cfgItems = [] } = useConfig();
  const soonDays = configValue(cfgItems, 'pricing_coupon_expiry_alert_days', 14);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState<'all' | PromoState | 'soon'>('all');
  const now = new Date();
  const soonLimit = new Date(now.getTime() + soonDays * 86400000);
  const isSoon = (p: Promotion) =>
    promoState(p, now) === 'active' && !!p.ends_at && new Date(p.ends_at) <= soonLimit;
  const kpi = {
    active: data.filter((p) => promoState(p, now) === 'active').length,
    expired: data.filter((p) => promoState(p, now) === 'expired').length,
    uses: data.reduce((n, p) => n + p.usage_count, 0),
    soon: data.filter(isSoon).length,
  };
  const rows = data.filter(
    (p) =>
      (state === 'all' || (state === 'soon' ? isSoon(p) : promoState(p, now) === state)) &&
      (!q.trim() || `${p.name} ${p.code ?? ''}`.toUpperCase().includes(q.trim().toUpperCase())),
  );

  const columns: Column<Promotion>[] = [
    {
      key: 'name',
      header: 'اسم الخصم',
      sortValue: (p) => p.name,
      cell: (p) => <span className="text-sm font-semibold text-navy-900">{p.name}</span>,
    },
    {
      key: 'code',
      header: 'الكود',
      cell: (p) => <span className="num text-xs">{p.code ?? '—'}</span>,
    },
    {
      key: 'kind',
      header: 'النوع',
      cell: (p) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone="navy">{p.discount_pct != null ? 'نسبة' : 'مبلغ ثابت'}</Badge>
          {p.requires_code && <Badge tone="gold">كوبون</Badge>}
        </span>
      ),
    },
    {
      key: 'value',
      header: 'القيمة',
      cell: (p) => (
        <span className="num text-sm font-semibold text-green-700">
          {p.discount_pct != null ? `${p.discount_pct}٪` : `${sar(p.discount_amount ?? 0)} ر.س`}
        </span>
      ),
    },
    {
      key: 'max',
      header: 'الحد الأقصى',
      cell: (p) => (
        <span className="num text-xs">
          {p.max_discount_amount != null ? `${sar(p.max_discount_amount)} ر.س` : '—'}
        </span>
      ),
    },
    {
      key: 'conditions',
      header: 'شروط التطبيق',
      cell: (p) => <span className="text-xs text-purple">{conditionsOf(p)}</span>,
    },
    {
      key: 'validity',
      header: 'فترة الصلاحية',
      cell: (p) => (
        <span className={`text-xs ${isSoon(p) ? 'text-amber-700' : 'text-purple'}`}>
          {validityOf(p)}
        </span>
      ),
    },
    {
      key: 'usage',
      header: 'الاستخدامات',
      sortValue: (p) => p.usage_count,
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
      cell: (p) => {
        const st = PROMO_STATE[promoState(p, now)];
        return <Badge tone={st.tone}>{st.label}</Badge>;
      },
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
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="الخصومات النشطة"
          value={kpi.active}
          icon={BadgePercent}
          tone="success"
          active={state === 'active'}
          onClick={() => setState(state === 'active' ? 'all' : 'active')}
        />
        <StatTile
          label="الخصومات المنتهية"
          value={kpi.expired}
          icon={CircleSlash}
          tone="neutral"
          active={state === 'expired'}
          onClick={() => setState(state === 'expired' ? 'all' : 'expired')}
        />
        <StatTile
          label="إجمالي مرات الاستخدام"
          value={kpi.uses}
          icon={Repeat}
          hint="يزيد عند إنشاء عقد بالخصم"
        />
        <StatTile
          label={`تنتهي خلال ${soonDays} يومًا`}
          value={kpi.soon}
          icon={CalendarClock}
          tone="warning"
          active={state === 'soon'}
          onClick={() => setState(state === 'soon' ? 'all' : 'soon')}
        />
      </div>
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
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="بحث باسم الخصم أو الكود" />
        <FilterSelect
          label="الحالة"
          value={state}
          onChange={(v) => setState(v as typeof state)}
          options={[
            { value: 'all', label: 'كل الحالات' },
            ...(Object.keys(PROMO_STATE) as PromoState[]).map((k) => ({
              value: k,
              label: PROMO_STATE[k].label,
            })),
            { value: 'soon', label: 'تنتهي قريبًا' },
          ]}
        />
      </Toolbar>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle={data.length ? 'لا خصومات مطابقة' : 'لا توجد خصومات معرّفة'}
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
    <Drawer
      open
      width="lg"
      onClose={onClose}
      title={promotion ? 'تعديل خصم' : 'خصم جديد'}
      subtitle="الشروط تُعاد مراجعتها في الخادم (evaluate_promotion) عند كل تطبيق"
      footer={
        <div className="flex gap-2">
          <Button onClick={submit} loading={save.isPending} className="flex-1">
            حفظ الخصم
          </Button>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      }
    >
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
        <ImpactPreview form={form} />
        <p className="flex items-start gap-1.5 rounded-xl border border-navy-100 px-3 py-2 text-[11px] leading-relaxed text-purple">
          <Info size={13} className="mt-0.5 shrink-0" />
          غير مدعوم حاليًا في قواعد التسعير: حد استخدام لكل عميل، ودمج الخصم مع خصومات أخرى (يُطبَّق
          خصم واحد فقط في كل حساب). تُضاف بعد تحديد قاعدتها التجارية.
        </p>
      </div>
    </Drawer>
  );
}

/** Try the discount on a sample service/amount before saving — same evaluator as the calculator. */
function ImpactPreview({ form }: { form: PromotionInput }) {
  const [service, setService] = useState(form.service_codes[0] ?? 'recruitment');
  const [base, setBase] = useState(15000);
  const parsed = promotionInputSchema.safeParse(form);
  const promo: Promotion | null = parsed.success
    ? {
        ...toPromotionRow(parsed.data),
        id: 'preview',
        usage_count: 0,
        starts_at: null,
        ends_at: null,
      }
    : null;
  const check = promo ? evaluatePromotion(promo, service, base, new Date(), promo.code) : null;
  return (
    <div className="rounded-xl bg-navy-50/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-navy">
        <FlaskConical size={13} /> معاينة الأثر قبل الاعتماد
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          aria-label="الخدمة"
          value={service}
          onChange={(e) => setService(e.target.value)}
          options={Object.entries(PRICING_SERVICE_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Input
          aria-label="المبلغ قبل الخصم"
          type="number"
          min={0}
          suffix="ر.س"
          value={base}
          onChange={(e) => setBase(e.target.valueAsNumber || 0)}
        />
      </div>
      {!promo ? (
        <p className="mt-2 text-xs text-purple">أكمل الحقول المطلوبة لعرض الأثر.</p>
      ) : check?.ok ? (
        <p className="mt-2 text-xs text-navy-900">
          الخصم <span className="num font-bold text-green-700">{sar(check.amount)}</span> ر.س ←
          السعر بعد الخصم <span className="num font-bold">{sar(base - check.amount)}</span> ر.س (قبل
          الضريبة، ويُقيَّد بالحد الأدنى لقاعدة السعر).
        </p>
      ) : (
        <p className="mt-2 text-xs text-red-600">لن يُطبَّق: {check?.reason}</p>
      )}
    </div>
  );
}
