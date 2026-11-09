import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Link2, Pencil, Plus, Power, Save, Truck } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { useDriverAccounts, useDrivers, useSaveDriver } from '@/features/orders/hooks/useOrders';
import { DRIVER_STATUS_LABEL, DRIVER_STATUS_TONE } from '@/features/orders/lib/orderStatus';
import {
  driverChangeError,
  driverInputOf,
  type DriverAccount,
  type DriverInput,
} from '@/features/orders/lib/driverRules';
import type { Driver } from '@/features/orders/types';

const EMPTY: DriverInput = {
  id: null,
  full_name: '',
  phone: null,
  branch: '',
  vehicle_no: null,
  status: 'available',
  user_id: null,
  is_active: true,
};

/**
 * «إدارة السائقين» (0084): إضافة/تعديل/تعطيل السائق ومركبته وفرعه وحساب دخوله.
 * «في مهمة» آلية من الطلبات؛ الإدارة بصلاحية orders.manage ضمن نطاق الفرع.
 */
export default function DriversManager() {
  const { can, meta, branchLabel } = usePermissions();
  const editable = can('orders', 'manage');
  const crossBranch = meta?.crossBranch ?? false;
  const { data: drivers = [], isLoading, isError, refetch } = useDrivers();
  const { data: accounts = [] } = useDriverAccounts(editable);
  const save = useSaveDriver();
  const [form, setForm] = useState<{ input: DriverInput; current: Driver | null } | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const branches = useMemo(() => {
    if (crossBranch) return [...BRANCHES_AR] as string[];
    const own = [branchLabel, ...drivers.map((d) => d.branch), ...accounts.map((a) => a.branch)];
    return [...new Set(own.filter((b): b is string => !!b))];
  }, [crossBranch, branchLabel, drivers, accounts]);

  const rows = showInactive ? drivers : drivers.filter((d) => d.is_active);
  const inactiveCount = drivers.filter((d) => !d.is_active).length;
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.full_name;

  const columns: Column<Driver>[] = [
    {
      key: 'full_name',
      header: 'السائق',
      cell: (d) => (
        <div>
          <p className="font-semibold text-navy">{d.full_name}</p>
          <p className="num text-[11px] text-purple">{d.phone ?? '—'}</p>
        </div>
      ),
    },
    { key: 'branch', header: 'الفرع', cell: (d) => d.branch ?? '—' },
    {
      key: 'vehicle_no',
      header: 'المركبة',
      cell: (d) => <span className="num text-sm">{d.vehicle_no ?? '—'}</span>,
    },
    {
      key: 'user_id',
      header: 'حساب الدخول',
      cell: (d) =>
        d.user_id ? (
          <span className="inline-flex items-center gap-1 text-sm text-teal">
            <Link2 size={13} /> {accountName(d.user_id) ?? 'مربوط'}
          </span>
        ) : (
          <span className="text-xs text-gold-600">غير مربوط — لا يرى رحلاته</span>
        ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (d) =>
        d.is_active ? (
          <Badge tone={DRIVER_STATUS_TONE[d.status]}>{DRIVER_STATUS_LABEL[d.status]}</Badge>
        ) : (
          <Badge tone="neutral">معطّل</Badge>
        ),
    },
    ...(editable
      ? [
          {
            key: 'actions',
            header: 'إجراءات',
            cell: (d: Driver) => (
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`تعديل ${d.full_name}`}
                  onClick={() => setForm({ input: driverInputOf(d), current: d })}
                >
                  <Pencil size={13} /> تعديل
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${d.is_active ? 'تعطيل' : 'تفعيل'} ${d.full_name}`}
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      input: {
                        ...driverInputOf(d),
                        is_active: !d.is_active,
                        status: d.is_active ? d.status : 'available',
                      },
                      done: d.is_active ? `تم تعطيل ${d.full_name}` : `تم تفعيل ${d.full_name}`,
                    })
                  }
                >
                  <Power size={13} /> {d.is_active ? 'تعطيل' : 'تفعيل'}
                </Button>
              </div>
            ),
          } satisfies Column<Driver>,
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Truck size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">إدارة السائقين</h1>
          <p className="text-sm text-purple">
            السائقون ومركباتهم وحسابات دخولهم — «في مهمة» تُضبط آليًا من الطلبات.
          </p>
        </div>
        <Link
          to="/orders"
          className="ms-auto inline-flex items-center gap-1 text-sm text-navy hover:underline"
        >
          <ArrowRight size={15} /> لوحة الطلبات
        </Link>
      </div>

      <Card className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-purple">
          <span className="num font-semibold text-navy">
            {drivers.filter((d) => d.is_active).length}
          </span>{' '}
          سائق نشط
        </p>
        <div className="ms-auto flex items-center gap-2">
          {inactiveCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? 'إخفاء المعطّلين' : `عرض المعطّلين (${inactiveCount})`}
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
              <Plus size={15} /> سائق جديد
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
        emptyTitle="لا يوجد سائقون — أضف أول سائق"
      />

      {form && (
        <DriverForm
          key={form.current?.id ?? 'new'}
          initial={form.input}
          current={form.current}
          branches={branches}
          accounts={accounts}
          saving={save.isPending}
          onClose={() => setForm(null)}
          onSave={(input) =>
            save.mutate(
              {
                input,
                done: form.current ? 'تم حفظ السائق' : `تمت إضافة ${input.full_name.trim()}`,
              },
              { onSuccess: () => setForm(null) },
            )
          }
        />
      )}
    </div>
  );
}

function DriverForm({
  initial,
  current,
  branches,
  accounts,
  saving,
  onClose,
  onSave,
}: {
  initial: DriverInput;
  current: Driver | null;
  branches: string[];
  accounts: DriverAccount[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: DriverInput) => void;
}) {
  const [d, setD] = useState<DriverInput>(initial);
  const [touched, setTouched] = useState(false);
  const busy = current?.status === 'on_route' ? 1 : 0;
  const error = driverChangeError(d, { current, busy, accounts });
  const usable = accounts.filter(
    (a) => (!a.branch || a.branch === d.branch) && (!a.driver_id || a.driver_id === d.id),
  );

  return (
    <Modal open onClose={onClose} title={current ? `تعديل ${current.full_name}` : 'سائق جديد'}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!error) onSave(d);
        }}
      >
        <Input
          label="اسم السائق"
          value={d.full_name}
          onChange={(e) => setD({ ...d, full_name: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="الجوال"
            inputMode="tel"
            placeholder="05xxxxxxxx"
            value={d.phone ?? ''}
            onChange={(e) => setD({ ...d, phone: e.target.value.trim() || null })}
          />
          <Input
            label="رقم المركبة"
            placeholder="ABC-1234"
            value={d.vehicle_no ?? ''}
            onChange={(e) => setD({ ...d, vehicle_no: e.target.value || null })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="الفرع"
            value={d.branch}
            disabled={busy > 0}
            onChange={(e) => setD({ ...d, branch: e.target.value, user_id: null })}
            options={[
              { value: '', label: 'اختر الفرع' },
              ...branches.map((b) => ({ value: b, label: b })),
            ]}
          />
          {d.status === 'on_route' ? (
            <div>
              <p className="mb-1.5 text-sm font-medium text-navy-900">الحالة</p>
              <p className="rounded-xl bg-navy-50 px-3 py-2.5 text-sm text-navy">
                في مهمة — تتغيّر عند انتهاء طلباته
              </p>
            </div>
          ) : (
            <Select
              label="الحالة"
              value={d.status}
              onChange={(e) => setD({ ...d, status: e.target.value as DriverInput['status'] })}
              options={[
                { value: 'available', label: 'متاح' },
                { value: 'off_duty', label: 'خارج الدوام' },
              ]}
            />
          )}
        </div>
        <Select
          label="حساب الدخول"
          value={d.user_id ?? ''}
          onChange={(e) => setD({ ...d, user_id: e.target.value || null })}
          options={[
            { value: '', label: d.branch ? 'بدون حساب' : 'اختر الفرع أولًا' },
            ...usable.map((a) => ({ value: a.id, label: a.full_name })),
          ]}
        />
        {d.branch && usable.length === 0 && !d.user_id && (
          <p className="text-xs text-gold-600">
            لا يوجد حساب بدور «سائق» غير مربوط في فرع {d.branch} — أضفه من إدارة المستخدمين ليرى
            السائق رحلاته.
          </p>
        )}
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
