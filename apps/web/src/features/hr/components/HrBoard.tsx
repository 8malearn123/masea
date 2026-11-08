import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Award,
  Building2,
  CalendarCheck,
  Clock,
  Coins,
  Link2,
  HeartHandshake,
  IdCard,
  Pencil,
  RotateCcw,
  Search,
  TrendingUp,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import { sectionFromSlug } from '@/features/hr/sections';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Modal,
  Select,
  SkeletonCard,
  Table,
  type Column,
} from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { ROLE_META } from '@/lib/permissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { EmployeeProfile } from '@/features/hr/components/EmployeeProfile';
import { EmployeeForm } from '@/features/hr/components/EmployeeForm';
import { LeaveBoard } from '@/features/hr/components/LeaveBoard';
import { PayrollBoard } from '@/features/hr/components/PayrollBoard';
import { AttendanceBoard } from '@/features/hr/components/AttendanceBoard';
import { EosBoard } from '@/features/hr/components/EosBoard';
import { PerformanceBoard } from '@/features/hr/components/PerformanceBoard';
import { HrReports } from '@/features/hr/components/HrReports';
import { useHrLookups } from '@/features/hr/hooks/useHrLookups';
import { WorkerFileForm } from '@/features/hr/components/WorkerFileForm';
import PayrollSettings from '@/features/hr/components/PayrollSettings';
import {
  DocumentsRegister,
  IqamasVisasBoard,
  OwnerDocuments,
} from '@/features/hr/components/DocumentsBoard';
import {
  useAttendance,
  useEmployees,
  useHouseWorkers,
  useEosPreview,
  useLeaveRequests,
  usePayrollSettings,
  useReactivateEmployee,
  useSaveEmployee,
  useTerminateEmployee,
} from '@/features/hr/hooks/useHr';
import {
  buildEmployee,
  currentEmployees,
  monthlyCost,
  workedHours,
  type EmployeeInput,
} from '@/features/hr/api/hr.api';
import {
  EMP_STATUS_LABEL,
  EMP_STATUS_TONE,
  WORKER_STATUS_LABEL,
  WORKER_STATUS_TONE,
  type Employee,
  type EmployeeStatus,
  type HouseWorker,
  TERMINATION_REASON_LABEL,
  type TerminationReason,
  type WorkerStatus,
  PAYMENT_METHOD_LABEL,
} from '@/features/hr/types';
import { maskIban } from '@/features/hr/lib/payrollDocs';

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

export default function HrBoard() {
  const { section } = useParams();
  const tab = sectionFromSlug(section);
  const {
    data: employees = [],
    isLoading: empLoading,
    isError: empError,
    refetch: refetchEmployees,
  } = useEmployees();

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Users size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">الموارد البشرية</h1>
          <p className="text-sm text-purple">
            نظام متكامل لإدارة الموظفين والحضور والإجازات والرواتب.
          </p>
        </div>
      </div>

      {tab === 'overview' && <Overview employees={employees} />}
      {tab === 'employees' && (
        <Employees
          employees={employees}
          isLoading={empLoading}
          isError={empError}
          onRetry={() => void refetchEmployees()}
        />
      )}
      {tab === 'attendance' && <AttendanceBoard employees={employees} />}
      {tab === 'leave' && <LeaveBoard employees={employees} />}
      {tab === 'payroll' && <PayrollBoard employees={employees} />}
      {tab === 'eos' && <EosBoard employees={employees} />}
      {tab === 'documents' && <DocumentsRegister />}
      {tab === 'performance' && <PerformanceBoard employees={employees} />}
      {tab === 'visas' && <IqamasVisasBoard />}
      {tab === 'reports' && <HrReports />}
      {tab === 'settings' && <PayrollSettings />}
    </div>
  );
}

/* ------------------------------- overview -------------------------------- */
function MiniBar({
  name,
  value,
  max,
  suffix,
  tone = 'bg-navy',
}: {
  name: string;
  value: number;
  max: number;
  suffix: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-sm text-navy-900">{name}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-navy-50">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
      <span className="num w-16 shrink-0 whitespace-nowrap text-left text-sm font-semibold text-navy">
        {value} {suffix}
      </span>
    </div>
  );
}

function Overview({ employees: all }: { employees: Employee[] }) {
  const employees = currentEmployees(all); // terminated are off the books
  usePayrollSettings(); // re-render costs when GOSI settings change
  const { data: attendance = [] } = useAttendance();
  const { data: leave = [] } = useLeaveRequests();

  const totalCost = employees.reduce((s, e) => s + monthlyCost(e), 0);
  const avgCost = employees.length ? Math.round(totalCost / employees.length) : 0;
  const saudis = employees.filter((e) => e.nationality === 'السعودية').length;
  const saudization = employees.length ? Math.round((saudis / employees.length) * 100) : 0;
  const pendingLeave = leave.filter((l) => l.status === 'pending').length;

  const present = attendance.filter((a) => a.status === 'present').length;
  const late = attendance.filter((a) => a.status === 'late').length;
  const absent = attendance.filter((a) => a.status === 'absent').length;
  const onLeaveToday = attendance.filter((a) => a.status === 'leave').length;
  const rate = attendance.length ? Math.round(((present + late) / attendance.length) * 100) : 0;

  const byBranch = BRANCHES_AR.map((b) => {
    const list = employees.filter((e) => e.branch === b);
    return { branch: b, count: list.length, cost: list.reduce((s, e) => s + monthlyCost(e), 0) };
  }).filter((x) => x.count > 0);
  const maxBranchCount = Math.max(1, ...byBranch.map((x) => x.count));
  const costliest = [...byBranch].sort((a, b) => b.cost - a.cost)[0];

  const topHours = attendance
    .map((a) => ({ name: a.employee_name, hours: workedHours(a.check_in, a.check_out) }))
    .filter((x) => x.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);
  const maxHours = Math.max(1, ...topHours.map((x) => x.hours));

  const leaveByEmp = new Map<string, number>();
  leave
    .filter((l) => l.status === 'approved')
    .forEach((l) =>
      leaveByEmp.set(l.employee_name, (leaveByEmp.get(l.employee_name) ?? 0) + l.days),
    );
  const topLeave = [...leaveByEmp.entries()]
    .map(([name, days]) => ({ name, days }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);
  const maxLeave = Math.max(1, ...topLeave.map((x) => x.days));

  const topCost = employees
    .map((e) => ({ name: e.full_name, branch: e.branch, cost: monthlyCost(e) }))
    .sort((a, b) => b.cost - a.cost);
  const chartData = byBranch.map((b) => ({ name: b.branch, التكلفة: b.cost }));

  const costColumns: Column<{ name: string; branch: string; cost: number }>[] = [
    {
      key: 'name',
      header: 'الموظف',
      cell: (r) => <span className="font-semibold text-navy">{r.name}</span>,
    },
    { key: 'branch', header: 'الفرع', cell: (r) => r.branch },
    {
      key: 'cost',
      header: 'التكلفة الشهرية الكاملة',
      cell: (r) => <span className="num font-bold text-gold-600">{sar(r.cost)} ر.س</span>,
    },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="عدد الموظفين" value={String(employees.length)} />
        <Stat label="التكلفة الشهرية" value={sar(totalCost)} tone="text-gold-600" />
        <Stat label="متوسط تكلفة الموظف" value={sar(avgCost)} />
        <Stat label="نسبة الحضور اليوم" value={`${rate}٪`} tone="text-green-600" />
        <Stat label="نسبة التوطين" value={`${saudization}٪`} tone="text-teal" />
        <Stat label="طلبات إجازة معلّقة" value={String(pendingLeave)} tone="text-gold-600" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* daily report */}
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <Clock size={16} /> تقرير اليوم
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-green-50 p-3 text-center">
              <p className="num text-xl font-bold text-green-600">{present}</p>
              <p className="text-[11px] text-green-700">حاضر</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-center">
              <p className="num text-xl font-bold text-gold-600">{late}</p>
              <p className="text-[11px] text-amber-700">متأخر</p>
            </div>
            <div className="rounded-xl bg-red-50 p-3 text-center">
              <p className="num text-xl font-bold text-red-600">{absent}</p>
              <p className="text-[11px] text-red-700">غائب</p>
            </div>
            <div className="rounded-xl bg-teal-100 p-3 text-center">
              <p className="num text-xl font-bold text-teal">{onLeaveToday}</p>
              <p className="text-[11px] text-teal">إجازة</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-purple">
              <span>معدل الحضور</span>
              <span className="num">{rate}٪</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-navy-50">
              <div className="h-full rounded-full bg-green-500" style={{ width: `${rate}%` }} />
            </div>
          </div>
        </Card>

        {/* cost by branch chart */}
        <Card className="lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <Coins size={16} /> التكلفة الشهرية حسب الفرع
          </h2>
          <div className="h-56" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E3E1ED" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} width={64} />
                <Tooltip formatter={(v: number) => `${sar(v)} ر.س`} />
                <Bar dataKey="التكلفة" fill="#1B1564" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <Building2 size={16} /> الموظفون حسب الفرع
          </h2>
          <div className="space-y-3">
            {byBranch.map((b) => (
              <MiniBar
                key={b.branch}
                name={b.branch}
                value={b.count}
                max={maxBranchCount}
                suffix="موظف"
              />
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <Award size={16} /> أكثر الموظفين ساعات حضور
          </h2>
          <div className="space-y-3">
            {topHours.map((x) => (
              <MiniBar
                key={x.name}
                name={x.name}
                value={x.hours}
                max={maxHours}
                suffix="س"
                tone="bg-teal"
              />
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <CalendarCheck size={16} /> أكثر الموظفين إجازةً
          </h2>
          {topLeave.length === 0 ? (
            <p className="text-sm text-purple">لا توجد إجازات.</p>
          ) : (
            <div className="space-y-3">
              {topLeave.map((x) => (
                <MiniBar
                  key={x.name}
                  name={x.name}
                  value={x.days}
                  max={maxLeave}
                  suffix="يوم"
                  tone="bg-gold"
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* per-employee cost */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <Coins size={16} /> التكلفة الشهرية لكل موظف
        </h2>
        <Table
          columns={costColumns}
          rows={topCost}
          rowKey={(r) => r.name}
          emptyTitle="لا يوجد موظفون"
        />
      </div>

      {/* executive insights */}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <TrendingUp size={16} /> ملخص تنفيذي لدعم القرار
        </h2>
        <ul className="grid gap-2 text-sm text-navy-900 sm:grid-cols-2">
          <li>
            • إجمالي التكلفة الشهرية للقوى العاملة:{' '}
            <span className="num font-semibold text-gold-600">{sar(totalCost)} ر.س</span>.
          </li>
          <li>
            • أعلى فرع تكلفةً:{' '}
            <span className="font-semibold text-navy">{costliest?.branch ?? '—'}</span> بـ{' '}
            <span className="num">{sar(costliest?.cost ?? 0)} ر.س</span>.
          </li>
          <li>
            • متوسط تكلفة الموظف الواحد:{' '}
            <span className="num font-semibold">{sar(avgCost)} ر.س</span>.
          </li>
          <li>
            • نسبة التوطين: <span className="num font-semibold text-teal">{saudization}٪</span> (
            {saudis} من {employees.length}).
          </li>
          <li>
            • معدل الحضور اليوم: <span className="num font-semibold text-green-600">{rate}٪</span> (
            {absent} غياب).
          </li>
          <li>
            • طلبات إجازة بانتظار الاعتماد:{' '}
            <span className="num font-semibold text-gold-600">{pendingLeave}</span>.
          </li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------- employees ------------------------------- */
interface LoadState {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function Employees({ employees, ...load }: { employees: Employee[] } & LoadState) {
  const [view, setView] = useState<'admins' | 'workers'>('admins');
  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl border border-navy-100 bg-white p-1">
        <button
          type="button"
          onClick={() => setView('admins')}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${view === 'admins' ? 'bg-navy text-white' : 'text-purple hover:text-navy'}`}
        >
          <Users size={15} /> الإداريون
        </button>
        <button
          type="button"
          onClick={() => setView('workers')}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${view === 'workers' ? 'bg-navy text-white' : 'text-purple hover:text-navy'}`}
        >
          <HeartHandshake size={15} /> العاملات
        </button>
      </div>
      {view === 'admins' ? <AdminEmployees employees={employees} {...load} /> : <HouseWorkers />}
    </div>
  );
}

function AdminEmployees({
  employees,
  isLoading,
  isError,
  onRetry,
}: { employees: Employee[] } & LoadState) {
  const { can } = usePermissions();
  const editable = can('hr', 'edit');
  // pay is money: only hr.manage sets salaries (guard_employee_pay, 0068)
  const canManagePay = can('hr', 'manage');
  const lk = useHrLookups();
  const saveEmp = useSaveEmployee();
  const [branch, setBranch] = useState('all');
  const [dept, setDept] = useState('all');
  const [search, setSearch] = useState('');
  // terminated staff stay on file (soft delete) but are hidden by default
  const [statusFilter, setStatusFilter] = useState<'current' | EmployeeStatus | 'all'>('current');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);
  const [terminating, setTerminating] = useState<Employee | null>(null);
  const reactivate = useReactivateEmployee();

  const q = search.trim();
  const rows = employees.filter(
    (e) =>
      (branch === 'all' || e.branch === branch) &&
      (dept === 'all' || e.department === dept) &&
      (statusFilter === 'all' ||
        (statusFilter === 'current' ? e.status !== 'terminated' : e.status === statusFilter)) &&
      (!q ||
        e.full_name.includes(q) ||
        (e.employee_no ?? '').includes(q) ||
        (e.national_id ?? e.iqama_no ?? '').includes(q)),
  );

  function save(input: EmployeeInput) {
    const isNew = !editTarget;
    const employee = editTarget ? { ...editTarget, ...input } : buildEmployee(input);
    saveEmp.mutate(
      { employee, isNew, canManagePay },
      {
        onSuccess: () => {
          setAddOpen(false);
          setEditTarget(null);
        },
      },
    );
  }

  const columns: Column<Employee>[] = [
    {
      key: 'full_name',
      header: 'الموظف',
      cell: (e) => (
        <div>
          <span className="font-semibold text-navy">{e.full_name}</span>
          {e.employee_no && (
            <div className="text-[11px] text-purple">
              <span className="num">{e.employee_no}</span>
            </div>
          )}
        </div>
      ),
    },
    { key: 'job_title', header: 'الوظيفة', cell: (e) => e.job_title },
    { key: 'department', header: 'القسم', cell: (e) => e.department },
    { key: 'branch', header: 'الفرع', cell: (e) => e.branch },
    {
      key: 'role',
      header: 'الدور (الصلاحيات)',
      cell: (e) => <Badge tone="teal">{ROLE_META[e.role].label}</Badge>,
    },
    {
      key: 'base_salary',
      header: 'الراتب',
      cell: (e) => <span className="num">{sar(e.base_salary)}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (e) => (
        <div>
          <Badge tone={EMP_STATUS_TONE[e.status]}>{EMP_STATUS_LABEL[e.status]}</Badge>
          {e.termination_date && (
            <span className="block text-[11px] text-purple">
              {e.termination_reason ? TERMINATION_REASON_LABEL[e.termination_reason] : ''} ·{' '}
              <span className="num">{dateAr(e.termination_date)}</span>
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (e: Employee) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewing(e)}
            className="inline-flex items-center gap-1 rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium text-white hover:bg-navy-700"
          >
            <IdCard size={13} /> الملف
          </button>
          {editable && (
            <button
              type="button"
              onClick={() => setEditTarget(e)}
              className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
            >
              <Pencil size={13} /> تعديل
            </button>
          )}
          {canManagePay && e.status !== 'terminated' && (
            <button
              type="button"
              onClick={() => setTerminating(e)}
              className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <UserMinus size={13} /> إنهاء الخدمة
            </button>
          )}
          {canManagePay && e.status === 'terminated' && (
            <button
              type="button"
              disabled={reactivate.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `إعادة تفعيل ${e.full_name}؟ يُستخدم لتصحيح إنهاء خدمة سُجّل بالخطأ، ويُحفظ في سجل التدقيق.`,
                  )
                )
                  reactivate.mutate(e.id);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
            >
              <RotateCcw size={13} /> إعادة تفعيل
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-4">
          <div className="relative">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
              <Search size={16} />
            </span>
            <Input
              placeholder="بحث بالاسم أو الرقم الوظيفي أو الهوية"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <Select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={[
              { value: 'all', label: 'كل الفروع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
          />
          <Select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            options={[
              { value: 'all', label: 'كل الأقسام' },
              ...lk.ofKind('department').map((d) => ({ value: d.name_ar, label: d.name_ar })),
            ]}
          />
          <Select
            aria-label="حالة الموظف"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            options={[
              { value: 'current', label: 'الموظفون الحاليون' },
              { value: 'active', label: EMP_STATUS_LABEL.active },
              { value: 'on_leave', label: EMP_STATUS_LABEL.on_leave },
              { value: 'terminated', label: EMP_STATUS_LABEL.terminated },
              { value: 'all', label: 'الكل' },
            ]}
          />
        </div>
        {editable && (
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus size={16} /> إضافة موظف
          </Button>
        )}
      </div>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        emptyTitle="لا يوجد موظفون"
      />

      {(addOpen || editTarget) && (
        <EmployeeForm
          key={editTarget?.id ?? 'new'}
          employee={editTarget}
          employees={employees}
          canManagePay={canManagePay}
          saving={saveEmp.isPending}
          onSave={save}
          onClose={() => {
            setAddOpen(false);
            setEditTarget(null);
          }}
        />
      )}
      {viewing && (
        <EmployeeProfile employee={viewing} editable={editable} onClose={() => setViewing(null)} />
      )}
      {terminating && (
        <TerminateModal employee={terminating} onClose={() => setTerminating(null)} />
      )}
    </div>
  );
}

/** Estimated entitlement for the chosen date/reason (the settlement fixes it after approval). */
function EosPreviewLine({
  employee,
  date,
  reason,
}: {
  employee: Employee;
  date: string;
  reason: TerminationReason;
}) {
  const { data: c } = useEosPreview(employee, date, reason);
  if (!c) return null;
  return (
    <div className="rounded-xl bg-navy-50 px-3 py-2 text-xs text-navy">
      المستحق التقديري: مكافأة <span className="num font-semibold">{sar(c.award)}</span>
      {c.award_ratio < 1 && c.award_ratio > 0 && ` (${Math.round(c.award_ratio * 100)}٪ — استقالة)`}
      {c.award_ratio === 0 && ' (لا يستحق)'} + بدل إجازات{' '}
      <span className="num font-semibold">{sar(c.leave_amount)}</span> ={' '}
      <span className="num font-bold">{sar(c.total)}</span> ر.س · خدمة{' '}
      <span className="num">{c.service_years.toFixed(2)}</span> سنة
    </div>
  );
}

/** End of service — date + reason (base of the EOS settlement). Reversible by reactivation. */
function TerminateModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const terminate = useTerminateEmployee();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<TerminationReason>('resignation');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!date) return setError('تاريخ إنهاء الخدمة مطلوب');
    if (employee.join_date && date < employee.join_date)
      return setError('تاريخ إنهاء الخدمة قبل تاريخ التعيين');
    setError(null);
    terminate.mutate({ id: employee.id, input: { date, reason, note } }, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title={`إنهاء خدمة — ${employee.full_name}`}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="تاريخ آخر يوم عمل"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            label="سبب إنهاء الخدمة"
            value={reason}
            onChange={(e) => setReason(e.target.value as TerminationReason)}
            options={(Object.keys(TERMINATION_REASON_LABEL) as TerminationReason[]).map((r) => ({
              value: r,
              label: TERMINATION_REASON_LABEL[r],
            }))}
          />
        </div>
        <Input label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        <EosPreviewLine employee={employee} date={date} reason={reason} />
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
          يخرج الموظف من مسيرات الرواتب القادمة ويبقى ملفه محفوظًا. يُعتمد السبب في حساب مكافأة
          نهاية الخدمة. للتصحيح استخدم «إعادة تفعيل».
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button variant="danger" className="w-full" loading={terminate.isPending} onClick={submit}>
          <UserMinus size={16} /> تأكيد إنهاء الخدمة
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------- house workers (عاملات) ---------------------- */
function WorkerAvatar({ worker, size = 'h-14 w-14' }: { worker: HouseWorker; size?: string }) {
  if (worker.photo_url) {
    return (
      <img
        src={worker.photo_url}
        alt={worker.full_name}
        className={`${size} shrink-0 rounded-2xl object-cover`}
      />
    );
  }
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-2xl bg-navy-50 text-navy`}>
      <UserRound size={24} />
    </span>
  );
}

function HouseWorkers() {
  const { can } = usePermissions();
  const editable = can('hr', 'edit');
  const { data: workers = [], isLoading, isError, refetch } = useHouseWorkers();
  const lk = useHrLookups();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [nat, setNat] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<HouseWorker | null>(null);
  const [viewing, setViewing] = useState<HouseWorker | null>(null);

  const rows = workers.filter(
    (w) =>
      (status === 'all' || w.status === status) &&
      (nat === 'all' || w.nationality === nat) &&
      (!search.trim() || w.full_name.includes(search.trim())),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <div className="relative">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
              <Search size={16} />
            </span>
            <Input
              placeholder="بحث باسم العاملة"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'all', label: 'كل الحالات' },
              ...(Object.keys(WORKER_STATUS_LABEL) as WorkerStatus[]).map((s) => ({
                value: s,
                label: WORKER_STATUS_LABEL[s],
              })),
            ]}
          />
          <Select
            value={nat}
            onChange={(e) => setNat(e.target.value)}
            options={[
              { value: 'all', label: 'كل الجنسيات' },
              ...lk
                .ofKind('nationality')
                .filter((n) => n.scope !== 'staff')
                .map((n) => ({ value: n.name_ar, label: n.name_ar })),
            ]}
          />
        </div>
        {editable && (
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus size={16} /> إضافة عاملة
          </Button>
        )}
      </div>

      <p className="mb-3 flex items-center gap-1.5 text-xs text-purple">
        <Link2 size={13} /> نفس ملف العاملة الذي يظهر للعملاء في الكتالوج وفي العقود وعروض الأسعار —
        أي تعديل هنا ينعكس هناك مباشرة.
      </p>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title="تعذّر تحميل العاملات" onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <Card className="py-12 text-center text-sm text-purple">لا توجد عاملات مطابقات.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((w) => (
            <Card
              key={w.id}
              className="flex cursor-pointer flex-col transition hover:-translate-y-0.5 hover:shadow-lg"
              onClick={() => setViewing(w)}
            >
              <div className="flex items-center gap-3">
                <WorkerAvatar worker={w} size="h-16 w-16" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-navy">{w.full_name}</p>
                  <p className="text-xs text-purple">
                    {w.nationality} · {w.profession}
                  </p>
                  <div className="mt-1.5">
                    <Badge tone={WORKER_STATUS_TONE[w.status]}>
                      {WORKER_STATUS_LABEL[w.status]}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-navy-50 py-2 text-center">
                  <p className="num text-sm font-bold text-navy">{w.age}</p>
                  <p className="text-[10px] text-purple">العمر</p>
                </div>
                <div className="rounded-xl bg-navy-50 py-2 text-center">
                  <p className="num text-sm font-bold text-navy">{w.experience_years}</p>
                  <p className="text-[10px] text-purple">سنوات خبرة</p>
                </div>
                <div className="rounded-xl bg-gold-100 py-2 text-center">
                  <p className="num text-sm font-bold text-gold-600">{w.monthly_salary}</p>
                  <p className="text-[10px] text-gold-600">ر.س / شهر</p>
                </div>
              </div>
              {w.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {w.skills.slice(0, 3).map((s) => (
                    <span
                      key={s}
                      className="rounded-md bg-navy-50 px-2 py-0.5 text-[11px] text-navy"
                    >
                      {s}
                    </span>
                  ))}
                  {w.skills.length > 3 && (
                    <span className="num self-center text-[11px] text-purple">
                      +{w.skills.length - 3}
                    </span>
                  )}
                </div>
              )}
              {w.bio && (
                <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-purple">{w.bio}</p>
              )}
              <div className="mt-4 flex items-center justify-between border-t border-navy-100 pt-3 text-[11px]">
                <span className="num text-purple">إقامة: {w.iqama_no}</span>
                {editable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditTarget(w);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1 font-medium text-navy hover:bg-navy-100"
                  >
                    <Pencil size={12} /> تعديل
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {viewing && (
        <WorkerDetailModal
          worker={viewing}
          editable={editable}
          onEdit={() => {
            setEditTarget(viewing);
            setViewing(null);
          }}
          onClose={() => setViewing(null)}
        />
      )}
      {(addOpen || editTarget) && (
        <WorkerFileForm
          key={editTarget?.id ?? 'new'}
          worker={editTarget}
          onClose={() => {
            setAddOpen(false);
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-navy-50 p-3">
      <p className="text-[11px] text-purple">{label}</p>
      {/* numbers/codes read left-to-right; Arabic text keeps its own direction */}
      <p
        className={`${/[\u0600-\u06FF]/.test(value) ? '' : 'num'}mt-0.5 text-sm font-semibold text-navy`}
      >
        {value}
      </p>
    </div>
  );
}

function ChipsRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-navy">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <span key={i} className="rounded-lg bg-navy-50 px-2.5 py-1 text-xs text-navy">
            {i}
          </span>
        ))}
      </div>
    </div>
  );
}

function WorkerDetailModal({
  worker,
  editable,
  onEdit,
  onClose,
}: {
  worker: HouseWorker;
  editable: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const canManageDocs = usePermissions().can('hr', 'manage');
  return (
    <Modal open onClose={onClose} title="ملف العاملة" size="lg">
      <div className="max-h-[74vh] space-y-5 overflow-y-auto pl-1">
        <div className="flex items-center gap-4">
          <WorkerAvatar worker={worker} size="h-20 w-20" />
          <div>
            <p className="text-lg font-bold text-navy">{worker.full_name}</p>
            <p className="text-sm text-purple">
              {worker.nationality} · {worker.profession}
            </p>
            <div className="mt-1.5">
              <Badge tone={WORKER_STATUS_TONE[worker.status]}>
                {WORKER_STATUS_LABEL[worker.status]}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <DetailField label="العمر" value={`${worker.age} سنة`} />
          <DetailField
            label="تاريخ الميلاد"
            value={worker.birth_date ? dateAr(worker.birth_date) : '—'}
          />
          <DetailField label="الخبرة" value={`${worker.experience_years} سنوات`} />
          <DetailField label="الفرع" value={worker.branch} />
          <DetailField label="الجوال" value={worker.phone || '—'} />
          <DetailField label="السكن" value={worker.dorm || 'بدون سكن'} />
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-navy">الهوية والإقامة</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailField label="رقم الجواز" value={worker.passport_no || '—'} />
            <DetailField label="رقم الإقامة" value={worker.iqama_no || '—'} />
            <DetailField label="رقم الحدود" value={worker.border_no || '—'} />
            <DetailField
              label="تاريخ الوصول"
              value={worker.arrival_date ? dateAr(worker.arrival_date) : '—'}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-navy">الراتب والحساب البنكي</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailField label="الراتب الشهري" value={`${sar(worker.monthly_salary)} ر.س`} />
            <DetailField label="طريقة الصرف" value={PAYMENT_METHOD_LABEL[worker.payment_method]} />
            {worker.payment_method === 'bank' && (
              <>
                <DetailField label="البنك" value={worker.bank_name || '—'} />
                <DetailField label="الآيبان" value={maskIban(worker.iban)} />
              </>
            )}
          </div>
        </div>

        <DetailField label="باركود السكن" value={worker.barcode || 'يُولَّد عند الحفظ'} />

        {worker.languages.length > 0 && <ChipsRow label="اللغات" items={worker.languages} />}
        {worker.skills.length > 0 && <ChipsRow label="المهارات والصفات" items={worker.skills} />}
        {worker.bio && (
          <div>
            <p className="mb-1 text-sm font-semibold text-navy">نبذة</p>
            <p className="text-sm leading-relaxed text-purple">{worker.bio}</p>
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-navy">الوثائق والإقامة</p>
          <OwnerDocuments
            kind="worker"
            ownerId={worker.id}
            ownerName={worker.full_name}
            editable={canManageDocs}
          />
        </div>

        {editable && (
          <Button onClick={onEdit} className="w-full">
            <Pencil size={16} /> تعديل ملف العاملة
          </Button>
        )}
      </div>
    </Modal>
  );
}
