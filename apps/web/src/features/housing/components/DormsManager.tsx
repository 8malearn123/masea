import { useMemo, useState } from 'react';
import { BedDouble, Pencil, Plus, Power, Save } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { useDorms, useHousingSupervisors, useSaveDorm } from '@/features/housing/hooks/useHousing';
import { dormChangeError, dormInputOf, type DormInput } from '@/features/housing/lib/dormRules';
import type { Dorm } from '@/features/housing/types';

const EMPTY: DormInput = {
  id: null,
  name: '',
  branch: '',
  capacity: null,
  supervisor_id: null,
  notes: null,
  is_active: true,
};

/**
 * «إدارة المساكن» (0081): إضافة/تعديل/تعطيل السكن وسعته ومشرفته. الإشغال محسوب
 * من العاملات المسكّنات. الإدارة بصلاحية housing.manage ضمن نطاق الفرع.
 */
export function DormsManager() {
  const { can, meta, branchLabel } = usePermissions();
  const editable = can('housing', 'manage');
  const crossBranch = meta?.crossBranch ?? false;
  const { data: dorms = [], isLoading, isError, refetch } = useDorms();
  const { data: supervisors = [] } = useHousingSupervisors(editable);
  const save = useSaveDorm();
  const [form, setForm] = useState<{ input: DormInput; current: Dorm | null } | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // الفروع التي يستطيع المستخدم إدارة مساكنها
  const branches = useMemo(() => {
    if (crossBranch) return [...BRANCHES_AR] as string[];
    const own = [branchLabel, ...dorms.map((d) => d.branch), ...supervisors.map((s) => s.branch)];
    return [...new Set(own.filter((b): b is string => !!b))];
  }, [crossBranch, branchLabel, dorms, supervisors]);

  const rows = showInactive ? dorms : dorms.filter((d) => d.is_active);
  const inactiveCount = dorms.filter((d) => !d.is_active).length;

  function toggle(d: Dorm) {
    save.mutate({
      input: { ...dormInputOf(d), is_active: !d.is_active },
      done: d.is_active ? `تم تعطيل «${d.name}»` : `تم تفعيل «${d.name}»`,
    });
  }

  const columns: Column<Dorm>[] = [
    {
      key: 'name',
      header: 'السكن',
      cell: (d) => (
        <div>
          <p className="font-semibold text-navy">{d.name}</p>
          {d.notes && <p className="text-[11px] text-purple">{d.notes}</p>}
        </div>
      ),
    },
    { key: 'branch', header: 'الفرع', cell: (d) => d.branch || '—' },
    {
      key: 'supervisor',
      header: 'المشرفة',
      cell: (d) => d.supervisor || <span className="text-xs text-purple/60">غير مُسندة</span>,
    },
    {
      key: 'occupancy',
      header: 'الإشغال',
      sortValue: (d) => (d.capacity ? d.occupied / d.capacity : 0),
      cell: (d) =>
        d.capacity === null ? (
          <span className="text-xs text-gold-600">
            <span className="num">{d.occupied}</span> — حدّد السعة
          </span>
        ) : (
          <span
            className={`num text-sm ${d.occupied >= d.capacity ? 'font-semibold text-red-600' : 'text-navy'}`}
          >
            {d.occupied} / {d.capacity}
          </span>
        ),
    },
    {
      key: 'is_active',
      header: 'الحالة',
      cell: (d) => (
        <Badge tone={d.is_active ? 'success' : 'neutral'}>{d.is_active ? 'نشط' : 'معطّل'}</Badge>
      ),
    },
    ...(editable
      ? [
          {
            key: 'actions',
            header: 'إجراءات',
            cell: (d: Dorm) => (
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`تعديل ${d.name}`}
                  onClick={() => setForm({ input: dormInputOf(d), current: d })}
                >
                  <Pencil size={13} /> تعديل
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${d.is_active ? 'تعطيل' : 'تفعيل'} ${d.name}`}
                  disabled={save.isPending}
                  onClick={() => toggle(d)}
                >
                  <Power size={13} /> {d.is_active ? 'تعطيل' : 'تفعيل'}
                </Button>
              </div>
            ),
          } satisfies Column<Dorm>,
        ]
      : []),
  ];

  return (
    <div>
      <Card className="mb-4 flex flex-wrap items-center gap-3">
        <BedDouble size={18} className="text-navy" />
        <p className="text-sm text-purple">
          <span className="num font-semibold text-navy">
            {dorms.filter((d) => d.is_active).length}
          </span>{' '}
          سكن نشط · الإشغال يُحسب تلقائيًا من العاملات المسكّنات في ملفاتهن.
        </p>
        <div className="ms-auto flex items-center gap-2">
          {inactiveCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? 'إخفاء المعطّلة' : `عرض المعطّلة (${inactiveCount})`}
            </Button>
          )}
          {editable && (
            <Button
              size="sm"
              onClick={() =>
                setForm({
                  input: { ...EMPTY, branch: branches.length === 1 ? branches[0]! : '' },
                  current: null,
                })
              }
            >
              <Plus size={15} /> سكن جديد
            </Button>
          )}
        </div>
      </Card>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد مساكن — أضف أول سكن"
      />

      {form && (
        <DormForm
          key={form.current?.id ?? 'new'}
          initial={form.input}
          current={form.current}
          dorms={dorms}
          branches={branches}
          supervisors={supervisors}
          saving={save.isPending}
          onClose={() => setForm(null)}
          onSave={(input) =>
            save.mutate(
              { input, done: form.current ? 'تم حفظ السكن' : `تمت إضافة «${input.name.trim()}»` },
              { onSuccess: () => setForm(null) },
            )
          }
        />
      )}
    </div>
  );
}

function DormForm({
  initial,
  current,
  dorms,
  branches,
  supervisors,
  saving,
  onClose,
  onSave,
}: {
  initial: DormInput;
  current: Dorm | null;
  dorms: Dorm[];
  branches: string[];
  supervisors: { id: string; full_name: string; branch: string | null }[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: DormInput) => void;
}) {
  const [d, setD] = useState<DormInput>(initial);
  const [touched, setTouched] = useState(false);
  const branchSupervisors = supervisors.filter((s) => !s.branch || s.branch === d.branch);
  const error = dormChangeError(d, { current, others: dorms, supervisors });

  return (
    <Modal open onClose={onClose} title={current ? `تعديل ${current.name}` : 'سكن جديد'}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!error) onSave(d);
        }}
      >
        <Input
          label="اسم السكن"
          placeholder="مثال: سكن نجران - ج"
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="الفرع"
            value={d.branch}
            onChange={(e) => setD({ ...d, branch: e.target.value, supervisor_id: null })}
            options={[
              { value: '', label: 'اختر الفرع' },
              ...branches.map((b) => ({ value: b, label: b })),
            ]}
          />
          <Input
            label="السعة (عدد الأسرّة)"
            type="number"
            min={1}
            suffix="سرير"
            value={d.capacity ?? ''}
            onChange={(e) =>
              setD({ ...d, capacity: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </div>
        {current && (
          <p className="text-xs text-purple">
            المقيمات حاليًا: <span className="num font-semibold text-navy">{current.occupied}</span>
          </p>
        )}
        <Select
          label="المشرفة"
          value={d.supervisor_id ?? ''}
          onChange={(e) => setD({ ...d, supervisor_id: e.target.value || null })}
          options={[
            { value: '', label: d.branch ? 'بدون مشرفة' : 'اختر الفرع أولًا' },
            ...branchSupervisors.map((s) => ({ value: s.id, label: s.full_name })),
          ]}
        />
        {d.branch && branchSupervisors.length === 0 && (
          <p className="text-xs text-gold-600">
            لا توجد مستخدمة بدور «مشرفة السكن» في فرع {d.branch} — أضفها من إدارة المستخدمين.
          </p>
        )}
        <Input
          label="ملاحظات"
          placeholder="الموقع، المرافق…"
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
