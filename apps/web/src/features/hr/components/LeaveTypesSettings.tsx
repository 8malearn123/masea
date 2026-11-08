import { useState } from 'react';
import { CalendarRange, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Modal, Select, Skeleton } from '@/shared/ui';
import { useLeaveTypes, useSaveLeaveType } from '@/features/hr/hooks/useHr';
import { leaveTypeSchema } from '@/features/hr/lib/leaveTypeSchema';
import { TypeRule } from '@/features/hr/components/LeaveBoard';
import {
  LEAVE_CATEGORY_LABEL,
  type LeaveCategory,
  type LeaveTypeConfig,
} from '@/features/hr/types';

/** «أنواع الإجازات» — every leave rule is data HR manages, not code (0070). */
export function LeaveTypesSettings({ editable }: { editable: boolean }) {
  const { data: types = [], isLoading, isError, refetch } = useLeaveTypes();
  const save = useSaveLeaveType();
  const [editing, setEditing] = useState<{ type: LeaveTypeConfig; isNew: boolean } | null>(null);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
          <CalendarRange size={16} /> أنواع الإجازات وقواعدها
        </h3>
        {editable && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setEditing({
                isNew: true,
                type: {
                  code: '',
                  name_ar: '',
                  category: 'statutory',
                  entitlement_days: 1,
                  entitlement_days_after: null,
                  after_years: null,
                  sick_partial_days: null,
                  sick_partial_pay_pct: null,
                  sick_unpaid_days: null,
                  paid: true,
                  deducts_from_annual: false,
                  gender: null,
                  min_service_months: 0,
                  once_per_service: false,
                  requires_attachment: false,
                  is_active: true,
                  sort_order: (types.at(-1)?.sort_order ?? 0) + 1,
                },
              })
            }
          >
            <Plus size={14} /> نوع جديد
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-purple">
        القيم الافتراضية وفق نظام العمل السعودي. أي تعديل يُطبَّق على الطلبات الجديدة والأرصدة فورًا
        ويُسجَّل في سجل التدقيق. لإيقاف نوع عطّله بدل حذفه.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <ErrorState title="تعذّر تحميل أنواع الإجازات" onRetry={() => void refetch()} />
      ) : (
        <ul className="divide-y divide-navy-50">
          {types.map((t) => (
            <li key={t.code} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-navy">
                  {t.name_ar}
                  <Badge tone={t.paid ? 'success' : 'neutral'}>
                    {t.paid ? 'بأجر' : 'بدون أجر'}
                  </Badge>
                  {t.gender && (
                    <Badge tone="teal">{t.gender === 'female' ? 'للموظفات' : 'للموظفين'}</Badge>
                  )}
                  {!t.is_active && <Badge tone="danger">معطّل</Badge>}
                </p>
                <TypeRule type={t} />
              </div>
              {editable && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutate({ type: { ...t, is_active: !t.is_active }, isNew: false })
                    }
                    className="rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
                  >
                    {t.is_active ? 'تعطيل' : 'تفعيل'}
                  </button>
                  <button
                    type="button"
                    aria-label={`تعديل ${t.name_ar}`}
                    onClick={() => setEditing({ type: t, isNew: false })}
                    className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
                  >
                    <Pencil size={13} /> تعديل
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <LeaveTypeModal
          initial={editing.type}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

type NumKey =
  | 'entitlement_days'
  | 'entitlement_days_after'
  | 'after_years'
  | 'sick_partial_days'
  | 'sick_partial_pay_pct'
  | 'sick_unpaid_days'
  | 'min_service_months'
  | 'sort_order';

function LeaveTypeModal({
  initial,
  isNew,
  onClose,
}: {
  initial: LeaveTypeConfig;
  isNew: boolean;
  onClose: () => void;
}) {
  const save = useSaveLeaveType();
  const [t, setT] = useState<LeaveTypeConfig>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const num = (k: NumKey, label: string, suffix: string, nullable = true) => (
    <Input
      label={label}
      type="number"
      min={0}
      suffix={suffix}
      value={t[k] ?? ''}
      onChange={(e) =>
        setT((x) => ({
          ...x,
          [k]: e.target.value === '' ? (nullable ? null : 0) : Number(e.target.value),
        }))
      }
      {...(errors[k] ? { error: errors[k] } : {})}
    />
  );
  const check = (
    k: 'paid' | 'deducts_from_annual' | 'once_per_service' | 'requires_attachment',
    label: string,
  ) => (
    <label className="flex items-center gap-2 text-sm text-navy">
      <input
        type="checkbox"
        checked={t[k]}
        onChange={(e) => setT((x) => ({ ...x, [k]: e.target.checked }))}
      />
      {label}
    </label>
  );

  function submit() {
    const next = { ...t, paid: t.category === 'unpaid' ? false : t.paid };
    const r = leaveTypeSchema.safeParse(next);
    if (!r.success) {
      const e: Record<string, string> = {};
      r.error.issues.forEach((i) => {
        const k = String(i.path[0] ?? '');
        if (k && !e[k]) e[k] = i.message;
      });
      return setErrors(e);
    }
    setErrors({});
    save.mutate({ type: r.data, isNew }, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'نوع إجازة جديد' : `تعديل إجازة «${initial.name_ar}»`}
    >
      <div className="max-h-[66vh] space-y-3 overflow-y-auto pl-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="اسم الإجازة"
            value={t.name_ar}
            onChange={(e) => setT((x) => ({ ...x, name_ar: e.target.value }))}
            {...(errors.name_ar ? { error: errors.name_ar } : {})}
          />
          <Input
            label="الرمز"
            dir="ltr"
            value={t.code}
            disabled={!isNew}
            placeholder="exam"
            onChange={(e) => setT((x) => ({ ...x, code: e.target.value.trim().toLowerCase() }))}
            {...(errors.code ? { error: errors.code } : {})}
          />
          <Select
            label="طريقة الاحتساب"
            value={t.category}
            disabled={!isNew && (initial.code === 'annual' || initial.code === 'sick')}
            onChange={(e) => setT((x) => ({ ...x, category: e.target.value as LeaveCategory }))}
            options={(Object.keys(LEAVE_CATEGORY_LABEL) as LeaveCategory[]).map((c) => ({
              value: c,
              label: LEAVE_CATEGORY_LABEL[c],
            }))}
          />
          <Select
            label="تنطبق على"
            value={t.gender ?? ''}
            onChange={(e) =>
              setT((x) => ({
                ...x,
                gender: e.target.value === '' ? null : (e.target.value as 'male' | 'female'),
              }))
            }
            options={[
              { value: '', label: 'الجميع' },
              { value: 'male', label: 'الموظفين' },
              { value: 'female', label: 'الموظفات' },
            ]}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {t.category === 'annual' && (
            <>
              {num('entitlement_days', 'أيام السنة', 'يوم')}
              {num('entitlement_days_after', 'الأيام بعد', 'يوم')}
              {num('after_years', 'بعد عدد سنوات', 'سنة')}
            </>
          )}
          {t.category === 'sick' && (
            <>
              {num('entitlement_days', 'بأجر كامل', 'يوم')}
              {num('sick_partial_days', 'بأجر جزئي', 'يوم')}
              {num('sick_partial_pay_pct', 'نسبة الأجر الجزئي', '٪')}
              {num('sick_unpaid_days', 'بدون أجر', 'يوم')}
            </>
          )}
          {(t.category === 'statutory' || t.category === 'other') &&
            num(
              'entitlement_days',
              t.category === 'other' ? 'الحد في السنة' : 'الحد لكل مرة',
              'يوم',
            )}
          {num('min_service_months', 'حد أدنى للخدمة', 'شهر', false)}
          {num('sort_order', 'الترتيب', '#', false)}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {t.category !== 'unpaid' && check('paid', 'بأجر')}
          {t.category === 'other' && check('deducts_from_annual', 'تُخصم من الرصيد السنوي')}
          {check('once_per_service', 'مرة واحدة طوال الخدمة')}
          {check('requires_attachment', 'تتطلب مستندًا مؤيدًا')}
        </div>
        <div className="rounded-xl bg-navy-50 p-3">
          <TypeRule type={t} />
        </div>
        <Button className="w-full" loading={save.isPending} onClick={submit}>
          حفظ
        </Button>
      </div>
    </Modal>
  );
}
