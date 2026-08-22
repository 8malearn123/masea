import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Award,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  Download,
  FileText,
  Gauge,
  HandCoins,
  HeartHandshake,
  IdCard,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { sectionFromSlug } from '@/features/hr/sections';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Table,
  useToast,
  type Column,
} from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { MODULES, ROLE_META, roleCan, type RoleCode } from '@/lib/permissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { EmployeeProfile } from '@/features/hr/components/EmployeeProfile';
import {
  useAddAdjustment,
  useAdjustments,
  useAttendance,
  useDecideAdjustment,
  useDocuments,
  useEmployees,
  useHouseWorkers,
  useIqamas,
  useLeaveRequests,
  usePerformance,
  useUpdateLeave,
} from '@/features/hr/hooks/useHr';
import {
  ADJUSTMENT_TYPES,
  buildEmployee,
  buildHouseWorker,
  buildWpsCsv,
  computeEos,
  expiryStatus,
  monthlyCost,
  PAYROLL_CONFIG,
  ratingLabel,
  runPayroll,
  workedHours,
  type EmployeeInput,
  type HouseWorkerInput,
} from '@/features/hr/api/hr.api';
import {
  ADJ_STATUS_LABEL,
  ADJ_STATUS_TONE,
  ADJ_TYPE_LABEL,
  ATT_STATUS_LABEL,
  ATT_STATUS_TONE,
  DEPARTMENTS,
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  EMP_STATUS_LABEL,
  EMP_STATUS_TONE,
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  LEAVE_TYPE_LABEL,
  NATIONALITY_OPTIONS,
  SKILL_OPTIONS,
  WORKER_LANGUAGES,
  WORKER_PROFESSIONS,
  WORKER_STATUS_LABEL,
  WORKER_STATUS_TONE,
  type AdjustmentType,
  type AttendanceRecord,
  type DocStatus,
  type Employee,
  type EmployeeDocument,
  type EmployeeStatus,
  type HouseWorker,
  type IqamaRecord,
  type LeaveRequest,
  type LeaveType,
  type Payslip,
  type PerformanceReview,
  type WorkerStatus,
} from '@/features/hr/types';

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
  const { data: employees = [] } = useEmployees();

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
      {tab === 'employees' && <Employees employees={employees} />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'leave' && <Leave employees={employees} />}
      {tab === 'payroll' && <Payroll employees={employees} />}
      {tab === 'eos' && <Eos employees={employees} />}
      {tab === 'documents' && <Documents />}
      {tab === 'performance' && <Performance employees={employees} />}
      {tab === 'visas' && <Visas />}
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
      <span className="num w-14 text-left text-sm font-semibold text-navy">
        {value} {suffix}
      </span>
    </div>
  );
}

function Overview({ employees }: { employees: Employee[] }) {
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
    .filter((l) => l.status !== 'rejected')
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
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E3E1ED" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} width={56} />
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
function Employees({ employees }: { employees: Employee[] }) {
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
      {view === 'admins' ? <AdminEmployees employees={employees} /> : <HouseWorkers />}
    </div>
  );
}

function AdminEmployees({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const toast = useToast();
  const editable = can('hr', 'edit');
  const [branch, setBranch] = useState('all');
  const [dept, setDept] = useState('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);

  const rows = employees.filter(
    (e) =>
      (branch === 'all' || e.branch === branch) &&
      (dept === 'all' || e.department === dept) &&
      (!search.trim() || e.full_name.includes(search.trim())),
  );

  function save(input: EmployeeInput) {
    if (editTarget) {
      const updated: Employee = { ...editTarget, ...input };
      qc.setQueryData<Employee[]>(['hr', 'employees'], (old) =>
        old?.map((e) => (e.id === updated.id ? updated : e)),
      );
      toast.success('تم تحديث بيانات الموظف');
    } else {
      const created = buildEmployee(input);
      qc.setQueryData<Employee[]>(['hr', 'employees'], (old) =>
        old ? [created, ...old] : [created],
      );
      toast.success('تمت إضافة الموظف');
    }
    setAddOpen(false);
    setEditTarget(null);
  }

  const columns: Column<Employee>[] = [
    {
      key: 'full_name',
      header: 'الموظف',
      cell: (e) => <span className="font-semibold text-navy">{e.full_name}</span>,
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
      cell: (e) => <Badge tone={EMP_STATUS_TONE[e.status]}>{EMP_STATUS_LABEL[e.status]}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      cell: (e: Employee) => (
        <div className="flex items-center gap-1.5">
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
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <div className="relative">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
              <Search size={16} />
            </span>
            <Input
              placeholder="بحث بالاسم"
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
              ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
            ]}
          />
        </div>
        {editable && (
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus size={16} /> إضافة موظف
          </Button>
        )}
      </div>
      <Table columns={columns} rows={rows} rowKey={(e) => e.id} emptyTitle="لا يوجد موظفون" />

      {(addOpen || editTarget) && (
        <EmployeeModal
          key={editTarget?.id ?? 'new'}
          employee={editTarget}
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
    </div>
  );
}

function EmployeeModal({
  employee,
  onSave,
  onClose,
}: {
  employee: Employee | null;
  onSave: (input: EmployeeInput) => void;
  onClose: () => void;
}) {
  const e = employee;
  const [full_name, setFullName] = useState(e?.full_name ?? '');
  const [job_title, setJobTitle] = useState(e?.job_title ?? '');
  const [department, setDepartment] = useState(e?.department ?? 'الإدارة');
  const [branch, setBranch] = useState(e?.branch ?? 'نجران');
  const [nationality, setNationality] = useState(e?.nationality ?? 'السعودية');
  const [base_salary, setBase] = useState(e?.base_salary ?? 5000);
  const [allowances, setAllow] = useState(e?.allowances ?? 0);
  const [status, setStatus] = useState<EmployeeStatus>(e?.status ?? 'active');
  const [role, setRole] = useState<RoleCode>(e?.role ?? 'sales');
  const [join_date, setJoin] = useState(e?.join_date ?? '');
  const [phone, setPhone] = useState(e?.phone ?? '');
  const [email, setEmail] = useState(e?.email ?? '');
  const [error, setError] = useState<string | null>(null);

  const grantedModules = MODULES.filter((m) => roleCan(role, m.module, 'view'));

  function submit() {
    if (!full_name.trim()) {
      setError('اسم الموظف مطلوب');
      return;
    }
    onSave({
      full_name,
      job_title,
      department,
      branch,
      nationality,
      base_salary,
      allowances,
      status,
      role,
      join_date,
      phone,
      email,
    });
  }

  return (
    <Modal open onClose={onClose} title={employee ? 'تعديل بيانات الموظف' : 'إضافة موظف'}>
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pl-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="الاسم الكامل"
            value={full_name}
            onChange={(ev) => setFullName(ev.target.value)}
            error={error ?? undefined}
          />
          <Input
            label="المسمى الوظيفي"
            value={job_title}
            onChange={(ev) => setJobTitle(ev.target.value)}
          />
          <Select
            label="القسم"
            value={department}
            onChange={(ev) => setDepartment(ev.target.value)}
            options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
          />
          <Select
            label="الفرع"
            value={branch}
            onChange={(ev) => setBranch(ev.target.value)}
            options={BRANCHES_AR.map((b) => ({ value: b, label: b }))}
          />
          <Select
            label="الجنسية"
            value={nationality}
            onChange={(ev) => setNationality(ev.target.value)}
            options={NATIONALITY_OPTIONS.map((n) => ({ value: n, label: n }))}
          />
          <Input
            label="الراتب الأساسي"
            type="number"
            min={0}
            value={base_salary}
            onChange={(ev) => setBase(Number(ev.target.value))}
          />
          <Input
            label="البدلات"
            type="number"
            min={0}
            value={allowances}
            onChange={(ev) => setAllow(Number(ev.target.value))}
          />
          <Input
            label="تاريخ التعيين"
            type="date"
            value={join_date}
            onChange={(ev) => setJoin(ev.target.value)}
          />
          <Input label="الجوال" value={phone} onChange={(ev) => setPhone(ev.target.value)} />
          <Input
            label="البريد الإلكتروني"
            type="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
          />
          <Select
            label="الحالة"
            value={status}
            onChange={(ev) => setStatus(ev.target.value as EmployeeStatus)}
            options={(Object.keys(EMP_STATUS_LABEL) as EmployeeStatus[]).map((s) => ({
              value: s,
              label: EMP_STATUS_LABEL[s],
            }))}
          />
          <Select
            label="الدور (الصلاحيات)"
            value={role}
            onChange={(ev) => setRole(ev.target.value as RoleCode)}
            options={(Object.keys(ROLE_META) as RoleCode[]).map((r) => ({
              value: r,
              label: ROLE_META[r].label,
            }))}
          />
        </div>

        <div className="rounded-xl bg-navy-50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-navy">
            <ShieldCheck size={14} /> الصلاحيات الممنوحة لهذا الدور
          </p>
          <div className="flex flex-wrap gap-1.5">
            {grantedModules.length === 0 ? (
              <span className="text-xs text-purple">
                لا صلاحيات إدارية على الويب (دور ميداني عبر التطبيق).
              </span>
            ) : (
              grantedModules.map((m) => (
                <span
                  key={m.module}
                  className="rounded-md bg-white px-2 py-1 text-[11px] text-navy"
                >
                  {m.label}
                </span>
              ))
            )}
          </div>
        </div>

        <Button onClick={submit} className="w-full">
          {employee ? 'حفظ التعديلات' : 'إضافة الموظف'}
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------ attendance ------------------------------- */
function Attendance() {
  const { data: all = [], isLoading, isError, refetch } = useAttendance();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [dept, setDept] = useState('all');

  const rows = all.filter(
    (a) =>
      (status === 'all' || a.status === status) &&
      (dept === 'all' || a.department === dept) &&
      (!search.trim() || a.employee_name.includes(search.trim())),
  );

  const present = all.filter((a) => a.status === 'present').length;
  const late = all.filter((a) => a.status === 'late').length;
  const absent = all.filter((a) => a.status === 'absent').length;

  const statusOptions = [
    { value: 'all', label: 'كل الحالات' },
    ...(Object.keys(ATT_STATUS_LABEL) as Array<keyof typeof ATT_STATUS_LABEL>).map((s) => ({
      value: s,
      label: ATT_STATUS_LABEL[s],
    })),
  ];

  const columns: Column<AttendanceRecord>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (a) => <span className="font-semibold text-navy">{a.employee_name}</span>,
    },
    { key: 'department', header: 'القسم', cell: (a) => a.department },
    {
      key: 'check_in',
      header: 'الحضور',
      cell: (a) => <span className="num">{a.check_in ?? '—'}</span>,
    },
    {
      key: 'check_out',
      header: 'الانصراف',
      cell: (a) => <span className="num">{a.check_out ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (a) => <Badge tone={ATT_STATUS_TONE[a.status]}>{ATT_STATUS_LABEL[a.status]}</Badge>,
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="حاضر" value={String(present)} tone="text-green-600" />
        <Stat label="متأخر" value={String(late)} tone="text-gold-600" />
        <Stat label="غائب" value={String(absent)} tone="text-red-600" />
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative">
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
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={statusOptions}
          />
          <Select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            options={[
              { value: 'all', label: 'كل الأقسام' },
              ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
            ]}
          />
        </div>
        <p className="mt-3 text-xs text-purple">
          عدد النتائج: <span className="num font-semibold text-navy">{rows.length}</span> من{' '}
          {all.length}
        </p>
      </Card>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا يوجد سجل مطابق"
      />
    </div>
  );
}

/* -------------------------------- leave ---------------------------------- */
function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  const d = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;
  return d > 0 ? d : 0;
}

function Leave({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const toast = useToast();
  const canApprove = can('hr', 'edit') || can('hr', 'approve');
  const { data: rows = [], isLoading, isError, refetch } = useLeaveRequests();
  const update = useUpdateLeave();
  const [addOpen, setAddOpen] = useState(false);

  function addLeave(l: LeaveRequest) {
    qc.setQueryData<LeaveRequest[]>(['hr', 'leave'], (old) => (old ? [l, ...old] : [l]));
    toast.success('تم تعيين الإجازة للموظف');
    setAddOpen(false);
  }

  const columns: Column<LeaveRequest>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (l) => <span className="font-semibold text-navy">{l.employee_name}</span>,
    },
    { key: 'type', header: 'النوع', cell: (l) => LEAVE_TYPE_LABEL[l.type] },
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
      cell: (l) => <Badge tone={LEAVE_STATUS_TONE[l.status]}>{LEAVE_STATUS_LABEL[l.status]}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      cell: (l) =>
        canApprove && l.status === 'pending' ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => update.mutate({ id: l.id, status: 'approved' })}
              className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
            >
              <CheckCircle2 size={13} /> اعتماد
            </button>
            <button
              type="button"
              onClick={() => update.mutate({ id: l.id, status: 'rejected' })}
              className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <XCircle size={13} /> رفض
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      {canApprove && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} /> تعيين إجازة لموظف
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد طلبات إجازة"
      />
      {addOpen && (
        <LeaveModal employees={employees} onAdd={addLeave} onClose={() => setAddOpen(false)} />
      )}
    </div>
  );
}

function LeaveModal({
  employees,
  onAdd,
  onClose,
}: {
  employees: Employee[];
  onAdd: (l: LeaveRequest) => void;
  onClose: () => void;
}) {
  const [empName, setEmpName] = useState(employees[0]?.full_name ?? '');
  const [type, setType] = useState<LeaveType>('annual');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const days = daysBetween(from, to);

  function submit() {
    if (!empName || !from || !to || days <= 0) {
      setError('أكمل بيانات الإجازة (الموظف والتواريخ).');
      return;
    }
    onAdd({
      id: `l-${Date.now()}`,
      employee_name: empName,
      type,
      from_date: from,
      to_date: to,
      days,
      status: 'approved',
      reason,
    });
  }

  return (
    <Modal open onClose={onClose} title="تعيين إجازة لموظف">
      <div className="space-y-3">
        <Select
          label="الموظف"
          value={empName}
          onChange={(e) => setEmpName(e.target.value)}
          options={employees.map((e) => ({ value: e.full_name, label: e.full_name }))}
        />
        <Select
          label="نوع الإجازة"
          value={type}
          onChange={(e) => setType(e.target.value as LeaveType)}
          options={(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((t) => ({
            value: t,
            label: LEAVE_TYPE_LABEL[t],
          }))}
        />
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
        {days > 0 && (
          <p className="text-xs text-purple">
            عدد الأيام: <span className="num font-semibold text-navy">{days}</span>
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button onClick={submit} className="w-full">
          <CalendarCheck size={16} /> تعيين الإجازة
        </Button>
      </div>
    </Modal>
  );
}

/* -------------------------------- payroll -------------------------------- */
const PAYROLL_PERIODS = ['2026-04', '2026-05', '2026-06', '2026-07'] as const;

function Payroll({ employees }: { employees: Employee[] }) {
  const { can } = usePermissions();
  const editable = can('hr', 'edit');
  const toast = useToast();
  const { data: adjustments = [] } = useAdjustments();
  const [period, setPeriod] = useState('2026-06');
  const [slips, setSlips] = useState<Payslip[] | null>(null);
  const [ranPeriod, setRanPeriod] = useState('');
  const [openSlip, setOpenSlip] = useState<Payslip | null>(null);

  const pendingThisPeriod = adjustments.filter(
    (a) => a.period === period && a.status === 'pending',
  ).length;

  const totals = useMemo(() => {
    const list = slips ?? [];
    return {
      net: list.reduce((s, r) => s + r.net, 0),
      gross: list.reduce((s, r) => s + r.gross, 0),
      ded: list.reduce((s, r) => s + r.total_deductions, 0),
      gosi: list.reduce((s, r) => s + r.gosi_employee, 0),
    };
  }, [slips]);

  function run() {
    const result = runPayroll(employees, period, adjustments);
    setSlips(result);
    setRanPeriod(period);
    toast.success(`تم تشغيل مسير رواتب ${period} لعدد ${result.length} موظف من المصادر`);
  }

  function exportWps() {
    if (!slips) return;
    const blob = new Blob(['\ufeff', buildWpsCsv(slips)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wps-${ranPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('تم تنزيل ملف حماية الأجور (WPS)');
  }

  const columns: Column<Payslip>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (r) => <span className="font-semibold text-navy">{r.employee_name}</span>,
    },
    { key: 'basic', header: 'الأساسي', cell: (r) => <span className="num">{sar(r.basic)}</span> },
    {
      key: 'overtime',
      header: 'الإضافي',
      cell: (r) => (
        <span className="num text-green-600" title={`${r.overtime_hours} ساعة`}>
          {r.overtime_amount > 0 ? `+${sar(r.overtime_amount)}` : '—'}
        </span>
      ),
    },
    {
      key: 'additions',
      header: 'إضافات معتمدة',
      cell: (r) => (
        <span className="num text-green-600">{r.additions > 0 ? `+${sar(r.additions)}` : '—'}</span>
      ),
    },
    {
      key: 'deductions',
      header: 'الاستقطاعات',
      cell: (r) => (
        <span
          className="num text-red-600"
          title={`تأمينات ${sar(r.gosi_employee)} · تغيّب ${sar(r.absence_deduction)} · تأخير ${sar(r.late_deduction)} · جزاءات/سلف ${sar(r.manual_deductions)}`}
        >
          {r.total_deductions > 0 ? `-${sar(r.total_deductions)}` : '0.00'}
        </span>
      ),
    },
    {
      key: 'net',
      header: 'الصافي',
      cell: (r) => <span className="num font-bold text-navy">{sar(r.net)} ر.س</span>,
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <button
          type="button"
          onClick={() => setOpenSlip(r)}
          className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
        >
          <ChevronDown size={13} /> تفصيل القسيمة
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* run controls — salary computed from sources, not typed by hand */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
              <Wallet size={16} /> تشغيل مسير الرواتب
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-purple">
              يُحسب الراتب آليًا من المصادر: الحضور (تغيّب/تأخير/عمل إضافي) + ملف الموظف
              (الأساسي/البدلات/الجنسية/نظام التأمينات) + التعديلات المعتمدة. لا تُدخل أي أرقام
              يدويًا.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <Select
              label="الشهر"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              options={PAYROLL_PERIODS.map((p) => ({ value: p, label: p }))}
            />
            {editable ? (
              <Button onClick={run}>
                <Play size={16} /> تشغيل المسير
              </Button>
            ) : (
              <span className="pb-2 text-xs text-purple">عرض فقط</span>
            )}
          </div>
        </div>
        {pendingThisPeriod > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
            <AlertTriangle size={16} /> يوجد{' '}
            <span className="num font-semibold">{pendingThisPeriod}</span> طلب تعديل بانتظار
            الاعتماد لهذا الشهر — لن يُحتسب في المسير حتى يُعتمد.
          </div>
        )}
      </Card>

      {slips === null ? (
        <Card className="py-10 text-center">
          <Wallet size={28} className="mx-auto text-navy-200" />
          <p className="mt-3 text-sm text-purple">
            لم يُشغّل المسير بعد. اختر الشهر واضغط «تشغيل المسير» لاحتساب الرواتب من المصادر.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label={`مسير ${ranPeriod}`} value={`${slips.length} موظف`} />
            <Stat label="إجمالي المستحق" value={sar(totals.gross)} tone="text-green-600" />
            <Stat label="إجمالي صافي الرواتب" value={sar(totals.net)} tone="text-gold-600" />
            <Stat label="إجمالي الاستقطاعات" value={sar(totals.ded)} tone="text-red-600" />
            <Stat label="إجمالي التأمينات (GOSI)" value={sar(totals.gosi)} />
          </div>
          {editable && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={exportWps}>
                <Download size={16} /> تنزيل ملف الأجور (WPS)
              </Button>
            </div>
          )}
          <Table
            columns={columns}
            rows={slips}
            rowKey={(r) => r.employee_id}
            emptyTitle="لا يوجد مسير رواتب"
          />
        </>
      )}

      <AdjustmentsPanel employees={employees} period={period} editable={editable} />

      <PayslipModal slip={openSlip} period={ranPeriod} onClose={() => setOpenSlip(null)} />
    </div>
  );
}

/* ---- payslip detail (every number traceable to its source) ---- */
function SlipLine({
  label,
  value,
  tone = 'text-navy',
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-navy-50 py-2 text-sm last:border-0">
      <span className="text-purple">
        {label}
        {hint && <span className="text-navy-300 mr-1 text-[11px]">({hint})</span>}
      </span>
      <span className={`num font-semibold ${tone}`}>{value}</span>
    </div>
  );
}

function PayslipModal({
  slip,
  period,
  onClose,
}: {
  slip: Payslip | null;
  period: string;
  onClose: () => void;
}) {
  if (!slip) return null;
  const allowances = slip.housing_allowance + slip.transport_allowance + slip.other_allowance;
  return (
    <Modal open onClose={onClose} title={`قسيمة راتب — ${slip.employee_name}`}>
      <div className="max-h-[72vh] space-y-4 overflow-y-auto pl-1">
        <div className="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3 text-sm">
          <span className="text-purple">
            الشهر: <span className="num font-semibold text-navy">{period}</span>
          </span>
          <span className="text-purple">
            حضور <span className="num font-semibold text-navy">{slip.present_days}</span> يوم · غياب{' '}
            <span className="num font-semibold text-red-600">{slip.absent_days}</span> · تأخير{' '}
            <span className="num font-semibold text-gold-600">{slip.late_count}</span>
          </span>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold text-green-700">المستحقات</p>
          <div className="rounded-xl border border-navy-100 px-3">
            <SlipLine label="الراتب الأساسي" value={sar(slip.basic)} tone="text-green-600" />
            <SlipLine label="البدلات" value={sar(allowances)} tone="text-green-600" />
            <SlipLine
              label="العمل الإضافي"
              value={slip.overtime_amount > 0 ? sar(slip.overtime_amount) : '0.00'}
              tone="text-green-600"
              hint={`${slip.overtime_hours} ساعة × ${PAYROLL_CONFIG.overtimeMultiplier}`}
            />
            <SlipLine
              label="تعديلات معتمدة (مكافآت/بدلات)"
              value={slip.additions > 0 ? sar(slip.additions) : '0.00'}
              tone="text-green-600"
            />
            <SlipLine label="إجمالي المستحق" value={`${sar(slip.gross)} ر.س`} />
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold text-red-700">الاستقطاعات</p>
          <div className="rounded-xl border border-navy-100 px-3">
            <SlipLine
              label="التأمينات الاجتماعية (GOSI)"
              value={slip.gosi_employee > 0 ? sar(slip.gosi_employee) : '0.00'}
              tone="text-red-600"
              hint={slip.nationality === 'السعودية' ? `نظام ${slip.gosi_system}` : 'وافد — معفى'}
            />
            <SlipLine
              label="خصم التغيّب"
              value={slip.absence_deduction > 0 ? sar(slip.absence_deduction) : '0.00'}
              tone="text-red-600"
              hint={`${slip.absent_days} يوم`}
            />
            <SlipLine
              label="خصم التأخير"
              value={slip.late_deduction > 0 ? sar(slip.late_deduction) : '0.00'}
              tone="text-red-600"
              hint={`${slip.late_minutes} دقيقة`}
            />
            <SlipLine
              label="جزاءات/سلف معتمدة"
              value={slip.manual_deductions > 0 ? sar(slip.manual_deductions) : '0.00'}
              tone="text-red-600"
            />
            <SlipLine label="إجمالي الاستقطاعات" value={`${sar(slip.total_deductions)} ر.س`} />
          </div>
        </div>

        <div className="bg-gold-50 flex items-center justify-between rounded-xl px-4 py-3">
          <span className="text-sm font-bold text-navy">صافي الراتب</span>
          <span className="num text-xl font-bold text-gold-600">{sar(slip.net)} ر.س</span>
        </div>

        <Button variant="outline" className="w-full" onClick={() => window.print()}>
          <FileText size={16} /> طباعة / حفظ PDF
        </Button>
      </div>
    </Modal>
  );
}

/* ---- adjustment requests: submit → HR approves → flows into the run ---- */
function AdjustmentsPanel({
  employees,
  period,
  editable,
}: {
  employees: Employee[];
  period: string;
  editable: boolean;
}) {
  const { can } = usePermissions();
  const canApprove = can('hr', 'approve') || can('hr', 'edit');
  const { data: adjustments = [] } = useAdjustments();
  const decide = useDecideAdjustment();
  const [addOpen, setAddOpen] = useState(false);

  const rows = adjustments.filter((a) => a.period === period);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <HandCoins size={16} /> طلبات التعديل — {period}
        </h2>
        {editable && (
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Send size={15} /> رفع طلب تعديل
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-purple">
        يرفع المدير/المشرف طلب مكافأة أو جزاء أو سلفة، ويعتمده مسؤول الموارد البشرية. لا يدخل في
        المسير إلا الطلب <span className="font-semibold text-green-700">المعتمد</span>.
      </p>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-purple">لا توجد طلبات تعديل لهذا الشهر.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-100 px-3 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <span className="font-semibold text-navy">{a.employee_name}</span>
                <span className="mr-2 text-purple">— {ADJ_TYPE_LABEL[a.type]}</span>
                {a.reason && <span className="block text-xs text-purple">{a.reason}</span>}
                <span className="text-navy-300 text-[11px]">طلب: {a.submitted_by}</span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`num font-semibold ${
                    a.type === 'penalty' || a.type === 'advance' ? 'text-red-600' : 'text-green-600'
                  }`}
                >
                  {a.type === 'penalty' || a.type === 'advance' ? '-' : '+'}
                  {sar(a.amount)}
                </span>
                <Badge tone={ADJ_STATUS_TONE[a.status]}>{ADJ_STATUS_LABEL[a.status]}</Badge>
                {canApprove && a.status === 'pending' && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => decide.mutate({ id: a.id, status: 'approved' })}
                      className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
                    >
                      <CheckCircle2 size={13} /> اعتماد
                    </button>
                    <button
                      type="button"
                      onClick={() => decide.mutate({ id: a.id, status: 'rejected' })}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      <XCircle size={13} /> رفض
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {addOpen && (
        <AdjustmentModal employees={employees} period={period} onClose={() => setAddOpen(false)} />
      )}
    </Card>
  );
}

function AdjustmentModal({
  employees,
  period,
  onClose,
}: {
  employees: Employee[];
  period: string;
  onClose: () => void;
}) {
  const add = useAddAdjustment();
  const [empId, setEmpId] = useState(employees[0]?.id ?? '');
  const [type, setType] = useState<AdjustmentType>('bonus');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const emp = employees.find((e) => e.id === empId);
    if (!emp || amount <= 0) {
      setError('اختر الموظف وأدخل مبلغًا صحيحًا.');
      return;
    }
    add.mutate(
      {
        employee_id: emp.id,
        employee_name: emp.full_name,
        type,
        amount,
        reason,
        period,
        submitted_by: 'المدير المباشر',
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title={`رفع طلب تعديل — ${period}`}>
      <div className="space-y-3">
        <Select
          label="الموظف"
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          options={employees.map((e) => ({ value: e.id, label: e.full_name }))}
        />
        <Select
          label="نوع التعديل"
          value={type}
          onChange={(e) => setType(e.target.value as AdjustmentType)}
          options={ADJUSTMENT_TYPES.map((t) => ({ value: t, label: ADJ_TYPE_LABEL[t] }))}
        />
        <Input
          label="المبلغ (ر.س)"
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
        <Input label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button onClick={submit} className="w-full">
          <Send size={16} /> رفع الطلب للاعتماد
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------- end of service ------------------------------ */
interface EosRow {
  id: string;
  name: string;
  years: number;
  wage: number;
  amount: number;
}

function Eos({ employees }: { employees: Employee[] }) {
  const rows: EosRow[] = employees
    .filter((e) => e.status !== 'terminated')
    .map((e) => {
      const { years, wage, amount } = computeEos(e);
      return { id: e.id, name: e.full_name, years, wage, amount };
    });
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const columns: Column<EosRow>[] = [
    {
      key: 'name',
      header: 'الموظف',
      cell: (r) => <span className="font-semibold text-navy">{r.name}</span>,
    },
    { key: 'years', header: 'سنوات الخدمة', cell: (r) => <span className="num">{r.years}</span> },
    {
      key: 'wage',
      header: 'الأجر الشامل',
      cell: (r) => <span className="num">{sar(r.wage)}</span>,
    },
    {
      key: 'amount',
      header: 'مكافأة نهاية الخدمة',
      cell: (r) => <span className="num font-bold text-gold-600">{sar(r.amount)} ر.س</span>,
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat label="إجمالي التزام نهاية الخدمة" value={sar(total)} tone="text-gold-600" />
        <Stat label="عدد المستحقّين" value={String(rows.length)} />
      </div>
      <Card className="mb-4 text-xs leading-relaxed text-purple">
        تُحتسب وفق نظام العمل السعودي: نصف شهر عن كل سنة من السنوات الخمس الأولى، وشهر كامل عن كل
        سنة بعدها (على أساس الأجر الشامل). تُطبَّق نسب الاستقالة عند انتهاء الخدمة باستقالة الموظف.
      </Card>
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} emptyTitle="لا يوجد مستحقّون" />
    </div>
  );
}

/* ------------------------------ documents -------------------------------- */
type DocRow = EmployeeDocument & { status: DocStatus };

function Documents() {
  const { data: docs = [], isLoading, isError, refetch } = useDocuments();
  const [filter, setFilter] = useState('all');
  const withStatus: DocRow[] = docs.map((d) => ({ ...d, status: expiryStatus(d.expiry_date) }));
  const rows = filter === 'all' ? withStatus : withStatus.filter((d) => d.status === filter);
  const expiring = withStatus.filter((d) => d.status === 'expiring').length;
  const expired = withStatus.filter((d) => d.status === 'expired').length;

  const columns: Column<DocRow>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (d) => <span className="font-semibold text-navy">{d.employee_name}</span>,
    },
    { key: 'type', header: 'المستند', cell: (d) => d.type },
    {
      key: 'number',
      header: 'الرقم',
      cell: (d) => <span className="num text-xs">{d.number}</span>,
    },
    {
      key: 'expiry_date',
      header: 'تاريخ الانتهاء',
      cell: (d) => (
        <span className="num text-xs">{d.expiry_date ? dateAr(d.expiry_date) : 'دائم'}</span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (d) => <Badge tone={DOC_STATUS_TONE[d.status]}>{DOC_STATUS_LABEL[d.status]}</Badge>,
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat
          label="مستندات سارية"
          value={String(withStatus.length - expiring - expired)}
          tone="text-green-600"
        />
        <Stat label="قاربت الانتهاء" value={String(expiring)} tone="text-gold-600" />
        <Stat label="منتهية" value={String(expired)} tone="text-red-600" />
      </div>
      {expiring + expired > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertTriangle size={16} /> يوجد {expiring + expired} مستند يحتاج تجديدًا أو متابعة.
        </div>
      )}
      <Card className="mb-4">
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          options={[
            { value: 'all', label: 'كل المستندات' },
            ...(Object.keys(DOC_STATUS_LABEL) as DocStatus[]).map((s) => ({
              value: s,
              label: DOC_STATUS_LABEL[s],
            })),
          ]}
        />
      </Card>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد مستندات"
      />
    </div>
  );
}

/* ----------------------------- performance ------------------------------- */
function Performance({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const toast = useToast();
  const { data: reviews = [], isLoading, isError, refetch } = usePerformance();
  const [addOpen, setAddOpen] = useState(false);
  const avg = reviews.length
    ? Math.round(reviews.reduce((s, r) => s + r.score, 0) / reviews.length)
    : 0;
  const top = [...reviews].sort((a, b) => b.score - a.score)[0];

  function addReview(r: PerformanceReview) {
    qc.setQueryData<PerformanceReview[]>(['hr', 'performance'], (old) => (old ? [r, ...old] : [r]));
    toast.success('تم حفظ التقييم');
    setAddOpen(false);
  }

  const columns: Column<PerformanceReview>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (r) => <span className="font-semibold text-navy">{r.employee_name}</span>,
    },
    { key: 'period', header: 'الفترة', cell: (r) => r.period },
    {
      key: 'score',
      header: 'الدرجة',
      cell: (r) => <span className="num font-bold text-navy">{r.score}٪</span>,
    },
    {
      key: 'rating',
      header: 'التقدير',
      cell: (r) => (
        <Badge tone={r.score >= 80 ? 'success' : r.score >= 70 ? 'gold' : 'danger'}>
          {ratingLabel(r.score)}
        </Badge>
      ),
    },
    { key: 'reviewer', header: 'المُقيّم', cell: (r) => r.reviewer },
    {
      key: 'date',
      header: 'التاريخ',
      cell: (r) => <span className="num text-xs">{dateAr(r.date)}</span>,
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="متوسط الأداء" value={`${avg}٪`} tone="text-navy" />
        <Stat label="عدد التقييمات" value={String(reviews.length)} />
        <Stat label="الأعلى أداءً" value={top ? `${top.score}٪` : '—'} tone="text-green-600" />
      </div>
      {can('hr', 'edit') && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} /> تقييم جديد
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={reviews}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد تقييمات"
      />
      {addOpen && (
        <PerformanceModal
          employees={employees}
          onAdd={addReview}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

function PerformanceModal({
  employees,
  onAdd,
  onClose,
}: {
  employees: Employee[];
  onAdd: (r: PerformanceReview) => void;
  onClose: () => void;
}) {
  const [empName, setEmpName] = useState(employees[0]?.full_name ?? '');
  const [period, setPeriod] = useState('الربع الثاني 2026');
  const [score, setScore] = useState(80);
  const [reviewer, setReviewer] = useState('المدير المباشر');

  function submit() {
    if (!empName) return;
    onAdd({
      id: `p-${Date.now()}`,
      employee_name: empName,
      period,
      score,
      reviewer,
      date: new Date().toISOString().slice(0, 10),
    });
  }

  return (
    <Modal open onClose={onClose} title="تقييم أداء جديد">
      <div className="space-y-3">
        <Select
          label="الموظف"
          value={empName}
          onChange={(e) => setEmpName(e.target.value)}
          options={employees.map((e) => ({ value: e.full_name, label: e.full_name }))}
        />
        <Input label="الفترة" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <Input
          label="الدرجة (٠–١٠٠)"
          type="number"
          min={0}
          max={100}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
        />
        <Input label="المُقيّم" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        <p className="text-xs text-purple">
          التقدير: <span className="font-semibold text-navy">{ratingLabel(score)}</span>
        </p>
        <Button onClick={submit} className="w-full">
          <Gauge size={16} /> حفظ التقييم
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------- visas / iqamas ------------------------------ */
type IqamaRow = IqamaRecord & { status: DocStatus };

function Visas() {
  const { data: iqamas = [], isLoading, isError, refetch } = useIqamas();
  const rows: IqamaRow[] = iqamas.map((i) => ({ ...i, status: expiryStatus(i.expiry_date) }));
  const expiring = rows.filter((r) => r.status === 'expiring').length;
  const expired = rows.filter((r) => r.status === 'expired').length;

  const columns: Column<IqamaRow>[] = [
    {
      key: 'employee_name',
      header: 'الاسم',
      cell: (r) => <span className="font-semibold text-navy">{r.employee_name}</span>,
    },
    {
      key: 'iqama_no',
      header: 'رقم الإقامة',
      cell: (r) => <span className="num text-xs">{r.iqama_no}</span>,
    },
    { key: 'profession', header: 'المهنة', cell: (r) => r.profession },
    {
      key: 'expiry_date',
      header: 'انتهاء الإقامة',
      cell: (r) => <span className="num text-xs">{dateAr(r.expiry_date)}</span>,
    },
    {
      key: 'work_permit',
      header: 'رخصة العمل',
      cell: (r) => (
        <Badge tone={r.work_permit ? 'success' : 'danger'}>
          {r.work_permit ? 'سارية' : 'منتهية'}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'حالة الإقامة',
      cell: (r) => <Badge tone={DOC_STATUS_TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge>,
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat
          label="إقامات سارية"
          value={String(rows.length - expiring - expired)}
          tone="text-green-600"
        />
        <Stat label="قاربت الانتهاء" value={String(expiring)} tone="text-gold-600" />
        <Stat label="منتهية" value={String(expired)} tone="text-red-600" />
      </div>
      {expiring + expired > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertTriangle size={16} /> {expiring + expired} إقامة تحتاج تجديدًا عاجلاً — تابع مع
          الجوازات/أبشر أعمال.
        </div>
      )}
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد إقامات"
      />
    </div>
  );
}

/* --------------------------- house workers (عاملات) ---------------------- */
function ChipMulti({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-navy-900">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              className={`rounded-lg px-2.5 py-1 text-xs transition ${on ? 'bg-navy text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'}`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const qc = useQueryClient();
  const { can } = usePermissions();
  const toast = useToast();
  const editable = can('hr', 'edit');
  const { data: workers = [] } = useHouseWorkers();
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

  function save(input: HouseWorkerInput) {
    if (editTarget) {
      const updated: HouseWorker = { ...editTarget, ...input };
      qc.setQueryData<HouseWorker[]>(['hr', 'workers'], (old) =>
        old?.map((w) => (w.id === updated.id ? updated : w)),
      );
      toast.success('تم تحديث بيانات العاملة');
    } else {
      const created = buildHouseWorker(input);
      qc.setQueryData<HouseWorker[]>(['hr', 'workers'], (old) =>
        old ? [created, ...old] : [created],
      );
      toast.success('تمت إضافة العاملة');
    }
    setAddOpen(false);
    setEditTarget(null);
  }

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
              ...NATIONALITY_OPTIONS.map((n) => ({ value: n, label: n })),
            ]}
          />
        </div>
        {editable && (
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus size={16} /> إضافة عاملة
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
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
        <WorkerModal
          key={editTarget?.id ?? 'new'}
          worker={editTarget}
          onSave={save}
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
      <p className="num mt-0.5 text-sm font-semibold text-navy">{value}</p>
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
  return (
    <Modal open onClose={onClose} title="ملف العاملة">
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
          <DetailField label="الخبرة" value={`${worker.experience_years} سنوات`} />
          <DetailField label="الراتب الشهري" value={`${sar(worker.monthly_salary)} ر.س`} />
          <DetailField label="الفرع" value={worker.branch} />
          <DetailField label="رقم الجواز" value={worker.passport_no || '—'} />
          <DetailField label="رقم الإقامة" value={worker.iqama_no || '—'} />
        </div>

        {worker.languages.length > 0 && <ChipsRow label="اللغات" items={worker.languages} />}
        {worker.skills.length > 0 && <ChipsRow label="المهارات والصفات" items={worker.skills} />}
        {worker.bio && (
          <div>
            <p className="mb-1 text-sm font-semibold text-navy">نبذة</p>
            <p className="text-sm leading-relaxed text-purple">{worker.bio}</p>
          </div>
        )}

        {editable && (
          <Button onClick={onEdit} className="w-full">
            <Pencil size={16} /> تعديل البيانات
          </Button>
        )}
      </div>
    </Modal>
  );
}

function WorkerModal({
  worker,
  onSave,
  onClose,
}: {
  worker: HouseWorker | null;
  onSave: (input: HouseWorkerInput) => void;
  onClose: () => void;
}) {
  const w = worker;
  const [full_name, setFullName] = useState(w?.full_name ?? '');
  const [photoUrl, setPhotoUrl] = useState(w?.photo_url ?? '');
  const [nationality, setNationality] = useState(w?.nationality ?? 'الفلبين');
  const [profession, setProfession] = useState(w?.profession ?? 'عاملة منزلية');
  const [age, setAge] = useState(w?.age ?? 30);
  const [experience_years, setExp] = useState(w?.experience_years ?? 3);
  const [monthly_salary, setSalary] = useState(w?.monthly_salary ?? 1400);
  const [passport_no, setPassport] = useState(w?.passport_no ?? '');
  const [iqama_no, setIqama] = useState(w?.iqama_no ?? '');
  const [status, setStatus] = useState<WorkerStatus>(w?.status ?? 'available');
  const [branch, setBranch] = useState(w?.branch ?? 'نجران');
  const [languages, setLanguages] = useState<string[]>(w?.languages ?? []);
  const [skills, setSkills] = useState<string[]>(w?.skills ?? []);
  const [bio, setBio] = useState(w?.bio ?? '');
  const [error, setError] = useState<string | null>(null);

  function toggle(list: string[], setList: (v: string[]) => void, v: string) {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function submit() {
    if (!full_name.trim()) {
      setError('اسم العاملة مطلوب');
      return;
    }
    onSave({
      full_name,
      photo_url: photoUrl || null,
      nationality,
      profession,
      age,
      experience_years,
      monthly_salary,
      languages,
      skills,
      passport_no,
      iqama_no,
      status,
      branch,
      bio,
    });
  }

  return (
    <Modal open onClose={onClose} title={worker ? 'تعديل بيانات العاملة' : 'إضافة عاملة'}>
      <div className="max-h-[74vh] space-y-3 overflow-y-auto pl-1">
        <div className="flex items-center gap-3">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" />
          ) : (
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-navy-50 text-navy">
              <UserRound size={28} />
            </span>
          )}
          <div className="flex-1">
            <Input
              label="رابط الصورة (اختياري)"
              placeholder="https://…"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="الاسم الكامل"
            value={full_name}
            onChange={(e) => setFullName(e.target.value)}
            error={error ?? undefined}
          />
          <Select
            label="الجنسية"
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
            options={NATIONALITY_OPTIONS.map((n) => ({ value: n, label: n }))}
          />
          <Select
            label="المهنة"
            value={profession}
            onChange={(e) => setProfession(e.target.value)}
            options={WORKER_PROFESSIONS.map((p) => ({ value: p, label: p }))}
          />
          <Input
            label="العمر"
            type="number"
            min={18}
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
          />
          <Input
            label="سنوات الخبرة"
            type="number"
            min={0}
            value={experience_years}
            onChange={(e) => setExp(Number(e.target.value))}
          />
          <Input
            label="الراتب الشهري"
            type="number"
            min={0}
            value={monthly_salary}
            onChange={(e) => setSalary(Number(e.target.value))}
          />
          <Input
            label="رقم الجواز"
            value={passport_no}
            onChange={(e) => setPassport(e.target.value)}
          />
          <Input label="رقم الإقامة" value={iqama_no} onChange={(e) => setIqama(e.target.value)} />
          <Select
            label="الحالة"
            value={status}
            onChange={(e) => setStatus(e.target.value as WorkerStatus)}
            options={(Object.keys(WORKER_STATUS_LABEL) as WorkerStatus[]).map((s) => ({
              value: s,
              label: WORKER_STATUS_LABEL[s],
            }))}
          />
          <Select
            label="الفرع"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={BRANCHES_AR.map((b) => ({ value: b, label: b }))}
          />
        </div>
        <ChipMulti
          label="اللغات"
          options={WORKER_LANGUAGES}
          selected={languages}
          onToggle={(v) => toggle(languages, setLanguages, v)}
        />
        <ChipMulti
          label="المهارات والصفات"
          options={SKILL_OPTIONS}
          selected={skills}
          onToggle={(v) => toggle(skills, setSkills, v)}
        />
        <div>
          <p className="mb-1.5 text-sm font-medium text-navy-900">نبذة / ملاحظات</p>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-navy-100 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-navy focus:ring-2 focus:ring-navy/15"
          />
        </div>
        <Button onClick={submit} className="w-full">
          {worker ? 'حفظ التعديلات' : 'إضافة العاملة'}
        </Button>
      </div>
    </Modal>
  );
}
