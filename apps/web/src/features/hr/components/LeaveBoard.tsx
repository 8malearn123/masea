import { useMemo, useState } from 'react';
import {
  Ban,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  Plus,
  Search,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
  StatTile,
  Table,
  type Column,
} from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useAddLeave,
  useLeaveBalance,
  useLeaveBalances,
  useLeaveRequests,
  useLeaveTypes,
  useUpdateLeave,
} from '@/features/hr/hooks/useHr';
import { currentEmployees } from '@/features/hr/api/hr.api';
import { daysInclusive } from '@/features/hr/lib/leaveEngine';
import {
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  type Employee,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveTypeConfig,
} from '@/features/hr/types';

const today = () => new Date().toISOString().slice(0, 10);
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function LeaveBoard({ employees }: { employees: Employee[] }) {
  const { can } = usePermissions();
  // approvers: HR, and the branch manager for his branch (matrix 0036)
  const canApprove = can('hr', 'approve');
  const canRequest = can('hr', 'create') || canApprove;
  const [view, setView] = useState<'requests' | 'balances'>('requests');
  const { data: leaves = [] } = useLeaveRequests();
  const { data: types = [] } = useLeaveTypes();

  const t = today();
  const pending = leaves.filter((l) => l.status === 'pending').length;
  const awayToday = leaves.filter(
    (l) => l.status === 'approved' && l.from_date <= t && l.to_date >= t,
  ).length;
  const upcoming = leaves.filter((l) => l.status === 'approved' && l.from_date > t).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="بانتظار الاعتماد" value={pending} icon={Hourglass} tone="warning" />
        <StatTile label="في إجازة اليوم" value={awayToday} icon={CalendarCheck} tone="navy" />
        <StatTile
          label="إجازات قادمة معتمدة"
          value={upcoming}
          icon={CalendarClock}
          tone="success"
        />
        <StatTile label="أنواع الإجازات المفعّلة" value={types.filter((x) => x.is_active).length} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-navy-100 bg-white p-1">
          {(
            [
              ['requests', 'الطلبات'],
              ['balances', 'الأرصدة'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${view === k ? 'bg-navy text-white' : 'text-purple hover:text-navy'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'requests' ? (
        <Requests
          employees={employees}
          types={types}
          canApprove={canApprove}
          canRequest={canRequest}
        />
      ) : (
        <Balances employees={currentEmployees(employees)} />
      )}
    </div>
  );
}

/* -------------------------------- requests -------------------------------- */
function Requests({
  employees,
  types,
  canApprove,
  canRequest,
}: {
  employees: Employee[];
  types: LeaveTypeConfig[];
  canApprove: boolean;
  canRequest: boolean;
}) {
  const { data: rows = [], isLoading, isError, refetch } = useLeaveRequests();
  const update = useUpdateLeave();
  const [status, setStatus] = useState<'all' | LeaveStatus>('all');
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [deciding, setDeciding] = useState<{ leave: LeaveRequest; to: LeaveStatus } | null>(null);
  const typeName = (code: string) => types.find((x) => x.code === code)?.name_ar ?? code;

  const q = search.trim();
  const filtered = rows.filter(
    (l) =>
      (status === 'all' || l.status === status) &&
      (type === 'all' || l.type === type) &&
      (!q || l.employee_name.includes(q)),
  );

  const columns: Column<LeaveRequest>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (l) => <span className="font-semibold text-navy">{l.employee_name}</span>,
    },
    { key: 'type', header: 'النوع', cell: (l) => typeName(l.type) },
    {
      key: 'period',
      header: 'الفترة',
      cell: (l) => (
        <span className="num text-xs">
          {dateAr(l.from_date)} → {dateAr(l.to_date)}
        </span>
      ),
    },
    { key: 'days', header: 'الأيام', cell: (l) => <span className="num">{l.days}</span> },
    {
      key: 'status',
      header: 'الحالة',
      cell: (l) => (
        <div>
          <Badge tone={LEAVE_STATUS_TONE[l.status]}>{LEAVE_STATUS_LABEL[l.status]}</Badge>
          {l.decision_note && (
            <span
              className="block max-w-[14rem] truncate text-[11px] text-purple"
              title={l.decision_note}
            >
              {l.decision_note}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (l) =>
        !canApprove ? null : l.status === 'pending' ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: l.id, status: 'approved' })}
              className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
            >
              <CheckCircle2 size={13} /> اعتماد
            </button>
            <button
              type="button"
              onClick={() => setDeciding({ leave: l, to: 'rejected' })}
              className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <XCircle size={13} /> رفض
            </button>
          </div>
        ) : l.status === 'approved' ? (
          <button
            type="button"
            onClick={() => setDeciding({ leave: l, to: 'cancelled' })}
            className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
          >
            <Ban size={13} /> إلغاء
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[12rem] flex-1">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
              <Search size={16} />
            </span>
            <Input
              placeholder="بحث باسم الموظف"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <Select
            aria-label="حالة الطلب"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            options={[
              { value: 'all', label: 'كل الحالات' },
              ...(Object.keys(LEAVE_STATUS_LABEL) as LeaveStatus[]).map((s) => ({
                value: s,
                label: LEAVE_STATUS_LABEL[s],
              })),
            ]}
          />
          <Select
            aria-label="نوع الإجازة"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={[
              { value: 'all', label: 'كل الأنواع' },
              ...types.map((x) => ({ value: x.code, label: x.name_ar })),
            ]}
          />
          {canRequest && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={16} /> طلب إجازة
            </Button>
          )}
        </div>
      </Card>
      <Table
        columns={columns}
        rows={filtered}
        rowKey={(l) => l.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد طلبات إجازة مطابقة"
      />
      {addOpen && (
        <LeaveRequestModal
          employees={currentEmployees(employees)}
          types={types.filter((x) => x.is_active)}
          canApprove={canApprove}
          onClose={() => setAddOpen(false)}
        />
      )}
      {deciding && (
        <DecisionModal
          leave={deciding.leave}
          to={deciding.to}
          typeName={typeName(deciding.leave.type)}
          onClose={() => setDeciding(null)}
        />
      )}
    </div>
  );
}

/** Reject / cancel with a reason (kept on the request — the audit shows who and when). */
function DecisionModal({
  leave,
  to,
  typeName,
  onClose,
}: {
  leave: LeaveRequest;
  to: LeaveStatus;
  typeName: string;
  onClose: () => void;
}) {
  const update = useUpdateLeave();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reject = to === 'rejected';
  return (
    <Modal open onClose={onClose} title={reject ? 'رفض طلب الإجازة' : 'إلغاء إجازة معتمدة'}>
      <div className="space-y-3">
        <p className="text-sm text-purple">
          {leave.employee_name} · {typeName} ·{' '}
          <span className="num">
            {dateAr(leave.from_date)} → {dateAr(leave.to_date)}
          </span>
        </p>
        {!reject && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            الإلغاء يعيد الأيام إلى الرصيد ويُلغي أثرها على الراتب، ويبقى مسجلًا في سجل التدقيق.
          </p>
        )}
        <Input
          label={reject ? 'سبب الرفض' : 'سبب الإلغاء'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          {...(error ? { error } : {})}
        />
        <Button
          variant="danger"
          className="w-full"
          loading={update.isPending}
          onClick={() => {
            if (note.trim().length < 3) return setError('اكتب السبب');
            update.mutate({ id: leave.id, status: to, note: note.trim() }, { onSuccess: onClose });
          }}
        >
          {reject ? 'تأكيد الرفض' : 'تأكيد الإلغاء'}
        </Button>
      </div>
    </Modal>
  );
}

/** New request — shows days, balance and eligibility live; the server re-checks it. */
function LeaveRequestModal({
  employees,
  types,
  canApprove,
  onClose,
}: {
  employees: Employee[];
  types: LeaveTypeConfig[];
  canApprove: boolean;
  onClose: () => void;
}) {
  const add = useAddLeave();
  const [empId, setEmpId] = useState(employees[0]?.id ?? '');
  const emp = employees.find((e) => e.id === empId);
  const eligible = useMemo(
    () => types.filter((x) => !x.gender || !emp?.gender || x.gender === emp.gender),
    [types, emp?.gender],
  );
  const [typeCode, setTypeCode] = useState(eligible[0]?.code ?? 'annual');
  const type = eligible.find((x) => x.code === typeCode) ?? eligible[0];
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [approveNow, setApproveNow] = useState(canApprove);
  const [error, setError] = useState<string | null>(null);
  const days = daysInclusive(from, to);
  const { data: balance } = useLeaveBalance(emp, to || today());

  const usesAnnual = !!type && (type.category === 'annual' || type.deducts_from_annual);
  const available = balance ? Math.floor(balance.annual_remaining - balance.annual_pending) : null;

  function submit() {
    if (!emp || !type) return setError('اختر الموظف ونوع الإجازة');
    if (!from || !to) return setError('حدد تاريخ البداية والنهاية');
    if (days <= 0) return setError('تاريخ النهاية قبل تاريخ البداية');
    setError(null);
    add.mutate(
      {
        id: `l-${Date.now()}`,
        employee_id: emp.id,
        employee_name: emp.full_name,
        type: type.code,
        from_date: from,
        to_date: to,
        days,
        status: canApprove && approveNow ? 'approved' : 'pending',
        reason: reason.trim(),
      },
      { onSuccess: onClose, onError: (e) => setError(e.message) },
    );
  }

  return (
    <Modal open onClose={onClose} title="طلب إجازة">
      <div className="space-y-3">
        <Select
          label="الموظف"
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          options={employees.map((e) => ({ value: e.id, label: e.full_name }))}
        />
        <Select
          label="نوع الإجازة"
          value={type?.code ?? ''}
          onChange={(e) => setTypeCode(e.target.value)}
          options={eligible.map((x) => ({ value: x.code, label: x.name_ar }))}
        />
        {type && <TypeRule type={type} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="من تاريخ"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input label="إلى تاريخ" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Input label="السبب (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} />

        <div className="grid grid-cols-2 gap-2 rounded-xl bg-navy-50 p-3 text-xs">
          <span className="text-purple">
            عدد الأيام: <span className="num font-semibold text-navy">{days || '—'}</span>
          </span>
          {usesAnnual && (
            <span className="text-purple">
              المتاح من الرصيد السنوي:{' '}
              <span
                className={`num font-semibold ${available !== null && days > available ? 'text-red-600' : 'text-navy'}`}
              >
                {available === null ? '…' : `${Math.max(available, 0)} يوم`}
              </span>
            </span>
          )}
          {type?.category === 'sick' && balance && (
            <span className="text-purple">
              المرضية هذا العام:{' '}
              <span className="num font-semibold text-navy">
                {balance.sick_used_this_year} / {balance.sick_total_limit}
              </span>
            </span>
          )}
        </div>

        {canApprove && (
          <label className="flex items-center gap-2 text-sm text-navy">
            <input
              type="checkbox"
              checked={approveNow}
              onChange={(e) => setApproveNow(e.target.checked)}
            />
            اعتماد مباشرة
          </label>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button onClick={submit} className="w-full" loading={add.isPending}>
          <CalendarCheck size={16} />{' '}
          {canApprove && approveNow ? 'تعيين الإجازة' : 'رفع الطلب للاعتماد'}
        </Button>
      </div>
    </Modal>
  );
}

/** One-line summary of a leave type's rule (from the managed config). */
export function TypeRule({ type }: { type: LeaveTypeConfig }) {
  let text = '';
  if (type.category === 'annual')
    text = `${type.entitlement_days ?? 0} يومًا سنويًا، ثم ${type.entitlement_days_after ?? type.entitlement_days ?? 0} بعد ${type.after_years ?? '—'} سنوات — رصيد تراكمي.`;
  else if (type.category === 'sick')
    text = `${type.entitlement_days ?? 0} يومًا بأجر كامل، ثم ${type.sick_partial_days ?? 0} بـ ${type.sick_partial_pay_pct ?? 0}٪، ثم ${type.sick_unpaid_days ?? 0} بدون أجر — في السنة.`;
  else if (type.category === 'unpaid') text = 'تُخصم أيامها من الراتب.';
  else if (type.category === 'other')
    text = `حتى ${type.entitlement_days ?? '—'} أيام في السنة${type.deducts_from_annual ? '، تُخصم من الرصيد السنوي' : ''}.`;
  else text = `حتى ${type.entitlement_days ?? '—'} يومًا بأجر كامل.`;
  if (type.min_service_months) text += ` تتطلب خدمة ${type.min_service_months} شهرًا.`;
  if (type.once_per_service) text += ' مرة واحدة طوال الخدمة.';
  if (type.requires_attachment) text += ' يُرفق المستند المؤيد.';
  return <p className="text-xs leading-relaxed text-purple">{text}</p>;
}

/* -------------------------------- balances -------------------------------- */
function Balances({ employees }: { employees: Employee[] }) {
  const t = today();
  const { data: map, isLoading, isError, refetch } = useLeaveBalances(employees, t);
  const rows = employees.map((e) => ({ e, b: map?.get(e.id) }));

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'الموظف',
      cell: (r) => (
        <div>
          <span className="font-semibold text-navy">{r.e.full_name}</span>
          <div className="text-[11px] text-purple">
            <span className="num">منذ {r.e.join_date ? dateAr(r.e.join_date) : '—'}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'accrued',
      header: 'المستحق حتى اليوم',
      cell: (r) => <span className="num">{r.b ? fmtDays(r.b.annual_accrued) : '…'}</span>,
    },
    {
      key: 'used',
      header: 'المستخدم',
      cell: (r) => <span className="num">{r.b?.annual_used ?? '…'}</span>,
    },
    {
      key: 'pending',
      header: 'محجوز (معلّق)',
      cell: (r) => <span className="num text-gold-600">{r.b?.annual_pending ?? '…'}</span>,
    },
    {
      key: 'remaining',
      header: 'الرصيد المتبقي',
      cell: (r) =>
        r.b ? (
          <span
            className={`num font-bold ${r.b.annual_remaining < 0 ? 'text-red-600' : 'text-green-700'}`}
          >
            {fmtDays(r.b.annual_remaining)} يوم
          </span>
        ) : (
          '…'
        ),
    },
    {
      key: 'sick',
      header: 'المرضية هذا العام',
      cell: (r) => (
        <span className="num">
          {r.b ? `${r.b.sick_used_this_year} / ${r.b.sick_total_limit}` : '…'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-purple">
        <Wallet size={13} /> الرصيد السنوي تراكمي من تاريخ التعيين، ولا يسقط؛ يُصرف بدل المتبقي عند
        نهاية الخدمة.
      </p>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.e.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا يوجد موظفون"
      />
    </div>
  );
}
