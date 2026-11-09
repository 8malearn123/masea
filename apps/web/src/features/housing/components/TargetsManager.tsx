import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Power, Save, Target } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useHousingSupervisors,
  useHousingTargets,
  useSaveHousingTarget,
} from '@/features/housing/hooks/useHousing';
import {
  targetChangeError,
  targetInputOf,
  type HousingTargetInput,
} from '@/features/housing/lib/targetRules';
import type { HousingSupervisor, HousingTarget } from '@/features/housing/types';

export const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

function Progress({ actual, target }: { actual: number; target: number }) {
  const met = actual >= target;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`num font-semibold ${met ? 'text-green-600' : 'text-gold-600'}`}>
        {actual}٪
      </span>
      <span className="num text-xs text-purple">/ {target}٪</span>
    </span>
  );
}

/**
 * «إسناد مستهدفات السكن» (0083): لكل مشرفة مستهدف شهري للإشغال والحضور، والمحقَّق
 * محسوب من السكن. الإدارة بصلاحية housing.manage ضمن نطاق الفرع.
 */
export function TargetsManager() {
  const { can } = usePermissions();
  const editable = can('housing', 'manage');
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const { data: targets = [], isLoading, isError, refetch } = useHousingTargets(period);
  const { data: supervisors = [] } = useHousingSupervisors(editable);
  const save = useSaveHousingTarget();
  const [form, setForm] = useState<HousingTargetInput | null>(null);

  const free = useMemo(
    () => supervisors.filter((s) => !targets.some((t) => t.supervisor_id === s.id)),
    [supervisors, targets],
  );

  function shift(delta: number) {
    setPeriod((p) => {
      const m = p.month + delta;
      return m < 1
        ? { year: p.year - 1, month: 12 }
        : m > 12
          ? { year: p.year + 1, month: 1 }
          : { ...p, month: m };
    });
  }

  const columns: Column<HousingTarget>[] = [
    {
      key: 'supervisor',
      header: 'المشرفة',
      cell: (t) => (
        <div>
          <p className="font-semibold text-navy">{t.supervisor}</p>
          {t.notes && <p className="text-[11px] text-purple">{t.notes}</p>}
        </div>
      ),
    },
    { key: 'branch', header: 'الفرع', cell: (t) => t.branch || '—' },
    {
      key: 'occ',
      header: 'الإشغال (المحقَّق / المستهدف)',
      cell: (t) => <Progress actual={t.occupancy_actual_pct} target={t.occupancy_target_pct} />,
    },
    {
      key: 'att',
      header: 'الحضور (المحقَّق / المستهدف)',
      cell: (t) => <Progress actual={t.attendance_actual_pct} target={t.attendance_target_pct} />,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (t) => (
        <Badge tone={t.is_active ? 'success' : 'neutral'}>{t.is_active ? 'نشط' : 'معطّل'}</Badge>
      ),
    },
    ...(editable
      ? [
          {
            key: 'actions',
            header: 'إجراءات',
            cell: (t: HousingTarget) => (
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`تعديل مستهدف ${t.supervisor}`}
                  onClick={() => setForm(targetInputOf(t))}
                >
                  <Pencil size={13} /> تعديل
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${t.is_active ? 'تعطيل' : 'تفعيل'} مستهدف ${t.supervisor}`}
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      input: { ...targetInputOf(t), is_active: !t.is_active },
                      done: t.is_active ? 'تم تعطيل المستهدف' : 'تم تفعيل المستهدف',
                    })
                  }
                >
                  <Power size={13} /> {t.is_active ? 'تعطيل' : 'تفعيل'}
                </Button>
              </div>
            ),
          } satisfies Column<HousingTarget>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3">
        <Target size={18} className="text-navy" />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="الشهر السابق" onClick={() => shift(-1)}>
            <ChevronRight size={16} />
          </Button>
          <span className="min-w-28 text-center text-sm font-bold text-navy">
            {MONTHS_AR[period.month - 1]} <span className="num">{period.year}</span>
          </span>
          <Button size="sm" variant="ghost" aria-label="الشهر التالي" onClick={() => shift(1)}>
            <ChevronLeft size={16} />
          </Button>
        </div>
        <p className="text-xs text-purple">
          المحقَّق يُحسب تلقائيًا من مساكن المشرفة: الإشغال من المقيمات، والحضور من سجلات الشهر.
        </p>
        {editable && (
          <Button
            size="sm"
            className="ms-auto"
            disabled={free.length === 0}
            title={free.length === 0 ? 'لكل مشرفة مستهدف لهذا الشهر' : undefined}
            onClick={() =>
              setForm({
                id: null,
                supervisor_id: free.length === 1 ? free[0]!.id : '',
                month: period.month,
                year: period.year,
                occupancy_target_pct: 85,
                attendance_target_pct: 95,
                notes: null,
                is_active: true,
              })
            }
          >
            <Plus size={15} /> مستهدف جديد
          </Button>
        )}
      </Card>

      <Table
        columns={columns}
        rows={targets}
        rowKey={(t) => t.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد مستهدفات لهذا الشهر"
      />

      {form && (
        <TargetForm
          key={form.id ?? 'new'}
          initial={form}
          supervisors={form.id ? supervisors : free}
          existing={targets}
          saving={save.isPending}
          onClose={() => setForm(null)}
          onSave={(input) =>
            save.mutate(
              { input, done: input.id ? 'تم حفظ المستهدف' : 'تم إسناد المستهدف' },
              { onSuccess: () => setForm(null) },
            )
          }
        />
      )}
    </div>
  );
}

function TargetForm({
  initial,
  supervisors,
  existing,
  saving,
  onClose,
  onSave,
}: {
  initial: HousingTargetInput;
  supervisors: HousingSupervisor[];
  existing: HousingTarget[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: HousingTargetInput) => void;
}) {
  const [d, setD] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = targetChangeError(d, existing);
  const owner = existing.find((t) => t.id === d.id)?.supervisor;
  const num = (v: string) => (v === '' ? Number.NaN : Number(v));

  return (
    <Modal
      open
      onClose={onClose}
      title={`${d.id ? 'تعديل مستهدف' : 'مستهدف جديد'} — ${MONTHS_AR[d.month - 1]} ${d.year}`}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!error) onSave(d);
        }}
      >
        {d.id ? (
          <p className="text-sm text-purple">
            المشرفة: <span className="font-semibold text-navy">{owner}</span>
          </p>
        ) : (
          <Select
            label="المشرفة"
            value={d.supervisor_id}
            onChange={(e) => setD({ ...d, supervisor_id: e.target.value })}
            options={[
              { value: '', label: 'اختر المشرفة' },
              ...supervisors.map((s) => ({
                value: s.id,
                label: s.branch ? `${s.full_name} — ${s.branch}` : s.full_name,
              })),
            ]}
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="مستهدف الإشغال"
            type="number"
            min={0}
            max={100}
            suffix="٪"
            value={Number.isNaN(d.occupancy_target_pct) ? '' : d.occupancy_target_pct}
            onChange={(e) => setD({ ...d, occupancy_target_pct: num(e.target.value) })}
          />
          <Input
            label="مستهدف الحضور"
            type="number"
            min={0}
            max={100}
            suffix="٪"
            value={Number.isNaN(d.attendance_target_pct) ? '' : d.attendance_target_pct}
            onChange={(e) => setD({ ...d, attendance_target_pct: num(e.target.value) })}
          />
        </div>
        <Input
          label="ملاحظات للمشرفة"
          value={d.notes ?? ''}
          onChange={(e) => setD({ ...d, notes: e.target.value || null })}
        />
        {touched && error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            <Save size={15} /> حفظ
          </Button>
        </div>
      </form>
    </Modal>
  );
}
