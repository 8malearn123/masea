import { Fragment, useMemo, useState } from 'react';
import {
  ChevronDown,
  FileSpreadsheet,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  Skeleton,
  paginate,
} from '@/shared/ui';
import { dateAr, dateTimeAr, sar } from '@/shared/lib/format';
import { exportExcel } from '@/shared/lib/exportTable';
import { usePermissions } from '@/hooks/usePermissions';
import { NATIONALITIES, TASK_TYPES } from '@/lib/orderTypes';
import {
  useAllPricingRules,
  useCreatePricingRule,
  useRuleChanges,
  useTogglePricingRule,
  useUpdatePricingRule,
} from '@/features/pricing/hooks/usePricingRules';
import { PRICING_SERVICE_LABEL, UNIT_LABEL, type PricingRule } from '@/features/pricing/types';
import {
  FilterSelect,
  Money,
  SearchBox,
  SectionTitle,
  Toolbar,
  today,
  useUrlState,
} from '@/features/pricing/components/shared';

const PAGE = 10;
const SERVICE_UNIT: Record<string, string> = {
  recruitment: 'fixed',
  monthly_rental: 'month',
  daily_rental: 'day',
  sponsorship_transfer: 'fixed',
};
const keyOf = (r: PricingRule) => r.nationality ?? r.profession ?? 'عام';

export function PriceListTab() {
  const { can, fullName } = usePermissions();
  const { data: rules = [], isLoading, isError, refetch } = useAllPricingRules();
  const toggle = useTogglePricingRule();
  const [q, setQ] = useUrlState('lq', '');
  const [service, setService] = useUrlState('ls', 'all');
  const [key, setKey] = useUrlState('lk', 'all');
  const [status, setStatus] = useUrlState('lst', 'active');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<PricingRule | 'new' | null>(null);

  const keys = useMemo(() => [...new Set(rules.map(keyOf))].sort(), [rules]);
  const rows = useMemo(() => {
    const s = q.trim();
    return rules
      .filter(
        (r) =>
          (service === 'all' || r.service_code === service) && (key === 'all' || keyOf(r) === key),
      )
      .filter((r) => (status === 'all' ? true : status === 'active' ? r.is_active : !r.is_active))
      .filter((r) => !s || `${PRICING_SERVICE_LABEL[r.service_code] ?? ''} ${keyOf(r)}`.includes(s))
      .sort((a, b) => a.service_code.localeCompare(b.service_code) || b.base_price - a.base_price);
  }, [rules, q, service, key, status]);
  const view = paginate(rows, page, PAGE);

  function exportRows() {
    exportExcel({
      title: 'قائمة الأسعار الأساسية',
      subtitle: `تاريخ التصدير ${today()}`,
      headers: [
        'الخدمة',
        'الجنسية/المهنة',
        'الوحدة',
        'السعر الأساسي',
        'الحد الأدنى',
        'الحالة',
        'آخر تحديث',
      ],
      rows: rows.map((r) => [
        PRICING_SERVICE_LABEL[r.service_code] ?? r.service_code,
        keyOf(r),
        UNIT_LABEL[r.duration_unit ?? 'fixed'] ?? r.duration_unit,
        r.base_price,
        r.min_price ?? '',
        r.is_active ? 'نشطة' : 'معطلة',
        r.updated_at ? r.updated_at.slice(0, 10) : '',
      ]),
    });
  }

  return (
    <div>
      <SectionTitle
        title="قائمة الأسعار الأساسية"
        desc="المصدر الوحيد للسعر في الحاسبة والعقود والطلبات. تعديل السعر يسري على الحسابات القادمة فقط."
        actions={
          <>
            {can('pricing', 'export') && (
              <Button variant="outline" size="sm" onClick={exportRows} disabled={!rows.length}>
                <FileSpreadsheet size={14} /> تصدير Excel
              </Button>
            )}
            {can('pricing', 'create') && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus size={14} /> سعر جديد
              </Button>
            )}
          </>
        }
      />
      <Card>
        <Toolbar>
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="بحث باسم الخدمة أو الجنسية"
          />
          <FilterSelect
            label="نوع الخدمة"
            value={service}
            onChange={(v) => {
              setService(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'كل الخدمات' },
              ...Object.entries(PRICING_SERVICE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FilterSelect
            label="الجنسية / المهنة"
            value={key}
            onChange={(v) => {
              setKey(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'كل الجنسيات والمهن' },
              ...keys.map((k) => ({ value: k, label: k })),
            ]}
          />
          <FilterSelect
            label="الحالة"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: 'active', label: 'النشطة' },
              { value: 'inactive', label: 'المعطلة' },
              { value: 'all', label: 'الكل' },
            ]}
          />
        </Toolbar>

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, n) => (
              <Skeleton key={n} className="h-11 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : !rows.length ? (
          <EmptyState
            title="لا توجد قواعد مطابقة"
            description="غيّر الفلاتر أو أضف سعرًا جديدًا."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-xs text-purple">
                  <th className="w-8 px-2 py-3" />
                  <th className="px-3 py-3 font-semibold">الخدمة</th>
                  <th className="px-3 py-3 font-semibold">الجنسية / المهنة</th>
                  <th className="px-3 py-3 font-semibold">وحدة التسعير</th>
                  <th className="px-3 py-3 text-left font-semibold">السعر الأساسي</th>
                  <th className="px-3 py-3 text-left font-semibold">الحد الأدنى</th>
                  <th className="px-3 py-3 font-semibold">الحالة</th>
                  <th className="px-3 py-3 font-semibold">آخر تحديث</th>
                  <th className="px-3 py-3 font-semibold">
                    <span className="sr-only">الإجراءات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <Fragment key={r.id}>
                    <tr
                      className={`border-b border-navy-50 hover:bg-navy-50/40 ${r.is_active ? '' : 'opacity-60'}`}
                    >
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          aria-expanded={open === r.id}
                          aria-label="تفاصيل"
                          onClick={() => setOpen(open === r.id ? null : r.id)}
                          className="text-purple hover:text-navy"
                        >
                          <ChevronDown
                            size={15}
                            className={`transition ${open === r.id ? 'rotate-180' : ''}`}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-3 font-semibold text-navy-900">
                        {PRICING_SERVICE_LABEL[r.service_code] ?? r.service_code}
                      </td>
                      <td className="px-3 py-3">{keyOf(r)}</td>
                      <td className="px-3 py-3">
                        <Badge tone="navy">
                          {UNIT_LABEL[r.duration_unit ?? 'fixed'] ?? r.duration_unit}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-left">
                        <Money v={r.base_price} strong className="text-navy" />
                      </td>
                      <td className="px-3 py-3 text-left">
                        {r.min_price != null ? (
                          <Money v={r.min_price} className="text-purple" />
                        ) : (
                          <span className="text-purple">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={r.is_active ? 'success' : 'neutral'}>
                          {r.is_active ? 'نشطة' : 'معطلة'}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-purple">
                        {r.updated_at ? dateAr(r.updated_at) : '—'}
                      </td>
                      <td className="relative px-3 py-3">
                        {(can('pricing', 'edit') || can('pricing', 'delete')) && (
                          <>
                            <button
                              type="button"
                              aria-haspopup="menu"
                              aria-expanded={menu === r.id}
                              aria-label="الإجراءات"
                              onClick={() => setMenu(menu === r.id ? null : r.id)}
                              className="rounded-lg p-1.5 text-purple hover:bg-navy-50 hover:text-navy"
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {menu === r.id && (
                              <div
                                role="menu"
                                className="absolute left-3 top-10 z-20 w-40 rounded-xl border border-navy-100 bg-white p-1 shadow-lg"
                                onMouseLeave={() => setMenu(null)}
                              >
                                {can('pricing', 'edit') && r.is_active && (
                                  <MenuItem
                                    icon={Pencil}
                                    label="تعديل السعر"
                                    onClick={() => {
                                      setMenu(null);
                                      setEditing(r);
                                    }}
                                  />
                                )}
                                <MenuItem
                                  icon={History}
                                  label="سجل التعديلات"
                                  onClick={() => {
                                    setMenu(null);
                                    setOpen(r.id);
                                  }}
                                />
                                {can('pricing', 'edit') && (
                                  <MenuItem
                                    icon={Power}
                                    label={r.is_active ? 'تعطيل' : 'تفعيل'}
                                    danger={r.is_active}
                                    onClick={() => {
                                      setMenu(null);
                                      toggle.mutate({ rule: r, actor: fullName });
                                    }}
                                  />
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr className="bg-navy-50/40">
                        <td colSpan={9} className="px-6 py-3">
                          <RuleHistory rule={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <Pagination page={page} size={PAGE} total={rows.length} onChange={setPage} />
          </div>
        )}
      </Card>
      {editing === 'new' && <NewRuleDrawer onClose={() => setEditing(null)} />}
      {editing && editing !== 'new' && (
        <EditRuleDrawer rule={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${danger ? 'text-red-700 hover:bg-red-50' : 'text-navy-900 hover:bg-navy-50'}`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

function RuleHistory({ rule }: { rule: PricingRule }) {
  const { data: changes = [], isLoading } = useRuleChanges(rule.id);
  return (
    <div className="text-xs">
      <p className="mb-1.5 font-semibold text-navy">سجل تعديل السعر</p>
      {isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : changes.length ? (
        <ul className="space-y-1">
          {changes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-navy-900">
              <span className="num text-purple">{dateTimeAr(c.changed_at)}</span>
              <span>
                <span className="num">{sar(c.old_base ?? 0)}</span> ←{' '}
                <span className="num font-semibold">{sar(c.new_base)}</span>
              </span>
              <span className="text-purple">
                يسري من <span className="num">{c.effective_from}</span>
              </span>
              <span>{c.reason}</span>
              <span className="text-purple">— {c.changed_by}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-purple">
          لا تعديلات مسجلة على هذه القاعدة (السجل يبدأ من تفعيل تتبّع التعديلات).
        </p>
      )}
    </div>
  );
}

function EditRuleDrawer({ rule, onClose }: { rule: PricingRule; onClose: () => void }) {
  const { fullName } = usePermissions();
  const update = useUpdatePricingRule();
  const [base, setBase] = useState(rule.base_price);
  const [min, setMin] = useState<number | null>(rule.min_price);
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState('');
  const errs = {
    base: !(base > 0) ? 'السعر يجب أن يكون أكبر من صفر' : undefined,
    min: min != null && (min < 0 || min > base) ? 'الحد الأدنى بين صفر والسعر الأساسي' : undefined,
    reason: reason.trim().length < 5 ? 'اذكر سبب التعديل (5 أحرف على الأقل)' : undefined,
    from: from < today() ? 'تاريخ السريان لا يسبق اليوم' : undefined,
  };
  const valid = !errs.base && !errs.min && !errs.reason && !errs.from;
  const delta = base - rule.base_price;
  return (
    <Drawer
      open
      onClose={onClose}
      title="تعديل سعر"
      subtitle={`${PRICING_SERVICE_LABEL[rule.service_code] ?? rule.service_code} · ${keyOf(rule)}`}
      footer={
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!valid || update.isPending}
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                {
                  id: rule.id,
                  actor: fullName,
                  base_price: base,
                  min_price: min,
                  effective_from: from,
                  reason,
                },
                { onSuccess: onClose },
              )
            }
          >
            حفظ التعديل
          </Button>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-navy-50 p-3">
            <p className="text-xs text-purple">السعر الحالي</p>
            <Money v={rule.base_price} strong className="text-lg text-navy" />
            <p className="mt-1 text-[11px] text-purple">
              الحد الأدنى {rule.min_price != null ? sar(rule.min_price) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-navy-100 p-3">
            <p className="text-xs text-purple">السعر الجديد</p>
            <Money v={base || 0} strong className="text-lg text-navy" />
            <p
              className={`mt-1 text-[11px] ${delta === 0 ? 'text-purple' : delta > 0 ? 'text-amber-700' : 'text-green-700'}`}
            >
              {delta === 0
                ? 'بدون تغيير'
                : `${delta > 0 ? 'زيادة' : 'تخفيض'} ${sar(Math.abs(delta))}`}
            </p>
          </div>
        </div>
        <Input
          label="السعر الأساسي الجديد"
          type="number"
          min={0}
          suffix="ر.س"
          value={Number.isFinite(base) ? base : ''}
          onChange={(e) => setBase(e.target.valueAsNumber)}
          error={errs.base}
        />
        <Input
          label="الحد الأدنى (اختياري)"
          type="number"
          min={0}
          suffix="ر.س"
          value={min ?? ''}
          onChange={(e) => setMin(e.target.value === '' ? null : e.target.valueAsNumber)}
          error={errs.min}
          hint="لا ينزل السعر بعد الخصومات عن هذا الحد"
        />
        <Input
          label="تاريخ السريان"
          type="date"
          min={today()}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          error={errs.from}
        />
        <Input
          label="سبب التعديل"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={reason ? errs.reason : undefined}
          hint="يُسجل في سجل التعديلات مع اسمك والوقت"
        />
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          العروض والعقود السابقة لا تتغير — كلٌّ منها يحتفظ بنسخة ثابتة من سعره. في الوضع الحالي
          يُطبَّق السعر الجديد على الحسابات فور الحفظ؛ تاريخ السريان يُسجَّل للتدقيق.
        </p>
      </div>
    </Drawer>
  );
}

function NewRuleDrawer({ onClose }: { onClose: () => void }) {
  const { fullName } = usePermissions();
  const create = useCreatePricingRule();
  const [service, setService] = useState('recruitment');
  const [key, setKey] = useState('');
  const [base, setBase] = useState(0);
  const [min, setMin] = useState<number | null>(null);
  const isDaily = service === 'daily_rental';
  const keyOptions: readonly string[] =
    service === 'sponsorship_transfer' ? [] : isDaily ? TASK_TYPES : NATIONALITIES;
  const valid =
    base > 0 &&
    (min == null || (min >= 0 && min <= base)) &&
    (keyOptions.length === 0 || key !== '');
  return (
    <Drawer
      open
      onClose={onClose}
      title="سعر جديد"
      footer={
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!valid || create.isPending}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                {
                  input: {
                    service_code: service,
                    nationality: !isDaily && keyOptions.length ? key : null,
                    profession: isDaily ? key : null,
                    duration_unit: SERVICE_UNIT[service] ?? 'fixed',
                    base_price: base,
                    min_price: min,
                  },
                  actor: fullName,
                },
                { onSuccess: onClose },
              )
            }
          >
            إضافة السعر
          </Button>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Select
          label="الخدمة"
          value={service}
          onChange={(e) => {
            setService(e.target.value);
            setKey('');
          }}
          options={Object.entries(PRICING_SERVICE_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        {keyOptions.length > 0 && (
          <Select
            label={isDaily ? 'المهنة' : 'الجنسية'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            options={[
              { value: '', label: 'اختر…' },
              ...keyOptions.map((k) => ({ value: k, label: k })),
            ]}
          />
        )}
        <p className="text-xs text-purple">
          وحدة التسعير: {UNIT_LABEL[SERVICE_UNIT[service] ?? 'fixed']}
        </p>
        <Input
          label="السعر الأساسي"
          type="number"
          min={0}
          suffix="ر.س"
          value={base || ''}
          onChange={(e) => setBase(e.target.valueAsNumber)}
        />
        <Input
          label="الحد الأدنى (اختياري)"
          type="number"
          min={0}
          suffix="ر.س"
          value={min ?? ''}
          onChange={(e) => setMin(e.target.value === '' ? null : e.target.valueAsNumber)}
          error={min != null && min > base ? 'أعلى من السعر الأساسي' : undefined}
        />
      </div>
    </Drawer>
  );
}
