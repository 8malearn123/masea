import { useMemo, useState } from 'react';
import {
  CalendarDays,
  ClipboardCheck,
  Lock,
  MapPin,
  Pencil,
  QrCode,
  Search,
  UserX,
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
import { useAuth } from '@/store/auth';
import {
  useAttendance,
  useAttendanceConfig,
  useCloseDay,
  useHolidays,
  useLeaveRequests,
  useManualAttendance,
  useMonthAttendance,
} from '@/features/hr/hooks/useHr';
import { currentEmployees, payrollPeriods } from '@/features/hr/api/hr.api';
import {
  isHoliday,
  isWorkday,
  methodsFor,
  nowRiyadh,
  DEFAULT_ATTENDANCE_CONFIG,
} from '@/features/hr/lib/attendanceEngine';
import {
  ATT_METHOD_LABEL,
  ATT_STATUS_LABEL,
  ATT_STATUS_TONE,
  DEPARTMENTS,
  WEEKDAY_LABEL,
  type AttendanceConfig,
  type AttendanceMethod,
  type AttendanceRecord,
  type AttendanceStatus,
  type Employee,
  type LeaveRequest,
  type PublicHoliday,
} from '@/features/hr/types';

const METHOD_ICON: Record<AttendanceMethod, typeof QrCode> = {
  qr: QrCode,
  gps: MapPin,
  manual: Pencil,
};

function MethodTag({ m }: { m?: AttendanceMethod }) {
  if (!m) return null;
  const Icon = METHOD_ICON[m];
  return (
    <span
      className="mr-1 inline-flex items-center gap-0.5 rounded bg-navy-50 px-1 text-[10px] text-purple"
      title={ATT_METHOD_LABEL[m]}
    >
      <Icon size={10} /> {ATT_METHOD_LABEL[m]}
    </span>
  );
}

export function AttendanceBoard({ employees }: { employees: Employee[] }) {
  const [view, setView] = useState<'day' | 'month'>('day');
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-navy-100 bg-white p-1">
        {(
          [
            ['day', 'كشف اليوم', ClipboardCheck],
            ['month', 'التقويم الشهري', CalendarDays],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setView(k)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${view === k ? 'bg-navy text-white' : 'text-purple hover:text-navy'}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {view === 'day' ? <DaySheet employees={employees} /> : <MonthView employees={employees} />}
    </div>
  );
}

/* --------------------------------- day ------------------------------------ */
interface DayRow {
  employee: Employee;
  rec: AttendanceRecord | null;
}

function DaySheet({ employees }: { employees: Employee[] }) {
  const { can } = usePermissions();
  const role = useAuth((s) => s.profile?.role);
  const today = nowRiyadh().date;
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const [status, setStatus] = useState<'all' | AttendanceStatus | 'none'>('all');
  const [editing, setEditing] = useState<DayRow | null>(null);
  const { data: records = [], isLoading, isError, refetch } = useAttendance(date);
  const { data: cfg = DEFAULT_ATTENDANCE_CONFIG } = useAttendanceConfig();
  const { data: holidays = [] } = useHolidays();
  const close = useCloseDay();
  const methods = methodsFor(role, cfg);
  const workday = isWorkday(date, cfg, holidays);
  const holiday = isHoliday(date, holidays);

  const people = currentEmployees(employees).filter((e) => !e.join_date || e.join_date <= date);
  const rows: DayRow[] = people.map((e) => ({
    employee: e,
    rec:
      records.find(
        (r) => r.employee_id === e.id || (!r.employee_id && r.employee_name === e.full_name),
      ) ?? null,
  }));
  const q = search.trim();
  const filtered = rows.filter(
    (r) =>
      (dept === 'all' || r.employee.department === dept) &&
      (!q || r.employee.full_name.includes(q)) &&
      (status === 'all' || (status === 'none' ? !r.rec : r.rec?.status === status)),
  );
  const count = (s: AttendanceStatus) => rows.filter((r) => r.rec?.status === s).length;
  const missing = rows.filter((r) => !r.rec).length;

  const columns: Column<DayRow>[] = [
    {
      key: 'name',
      header: 'الموظف',
      cell: (r) => (
        <div>
          <span className="font-semibold text-navy">{r.employee.full_name}</span>
          <div className="text-[11px] text-purple">{r.employee.department}</div>
        </div>
      ),
    },
    {
      key: 'in',
      header: 'الحضور',
      cell: (r) =>
        r.rec?.check_in ? (
          <span>
            <span className="num">{r.rec.check_in}</span>
            <MethodTag {...(r.rec.check_in_method ? { m: r.rec.check_in_method } : {})} />
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'out',
      header: 'الانصراف',
      cell: (r) =>
        r.rec?.check_out ? (
          <span>
            <span className="num">{r.rec.check_out}</span>
            <MethodTag {...(r.rec.check_out_method ? { m: r.rec.check_out_method } : {})} />
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) =>
        r.rec ? (
          <div>
            <Badge tone={ATT_STATUS_TONE[r.rec.status]}>{ATT_STATUS_LABEL[r.rec.status]}</Badge>
            {!!r.rec.late_minutes && (
              <div className="text-[11px] text-gold-600">
                تأخير <span className="num">{r.rec.late_minutes}</span> د
              </div>
            )}
          </div>
        ) : (
          <Badge tone="neutral">لم يسجّل</Badge>
        ),
    },
    {
      key: 'detail',
      header: 'التفاصيل',
      cell: (r) => (
        <div className="max-w-[14rem] text-[11px] text-purple">
          {r.rec?.distance_m != null && (
            <div>
              على بُعد <span className="num">{r.rec.distance_m}</span> م
            </div>
          )}
          {r.rec?.note && (
            <div className="truncate" title={r.rec.note}>
              {r.rec.note}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (r) =>
        methods.manual ? (
          <button
            type="button"
            onClick={() => setEditing(r)}
            className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
          >
            <Pencil size={13} /> {r.rec ? 'تصحيح' : 'تسجيل يدوي'}
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="اليوم"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value || today)}
          />
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
            aria-label="الحالة"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            options={[
              { value: 'all', label: 'كل الحالات' },
              { value: 'none', label: 'لم يسجّل' },
              ...(Object.keys(ATT_STATUS_LABEL) as AttendanceStatus[]).map((s) => ({
                value: s,
                label: ATT_STATUS_LABEL[s],
              })),
            ]}
          />
          <Select
            aria-label="القسم"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            options={[
              { value: 'all', label: 'كل الأقسام' },
              ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
            ]}
          />
          {can('hr', 'manage') && date < today && workday && (
            <Button
              variant="outline"
              loading={close.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `إغلاق يوم ${date}؟ من لم يسجّل يُحتسب غائبًا (إلا من في إجازة معتمدة).`,
                  )
                )
                  close.mutate(date);
              }}
            >
              <Lock size={15} /> إغلاق اليوم
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-purple">
          {WEEKDAY_LABEL[new Date(`${date}T00:00:00Z`).getUTCDay()]} {dateAr(date)} ·{' '}
          {workday ? 'يوم عمل' : holiday ? `عطلة رسمية: ${holiday.name_ar}` : 'عطلة أسبوعية'}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="حاضر" value={count('present')} tone="success" />
        <StatTile label="متأخر" value={count('late')} tone="warning" />
        <StatTile label="غائب" value={count('absent')} tone="danger" />
        <StatTile label="إجازة" value={count('leave')} tone="navy" />
        <StatTile label="لم يسجّل" value={missing} icon={UserX} tone="neutral" />
      </div>

      <Table
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.employee.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا يوجد سجل مطابق"
      />
      {editing && <ManualModal row={editing} date={date} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ManualModal({ row, date, onClose }: { row: DayRow; date: string; onClose: () => void }) {
  const save = useManualAttendance();
  const [status, setStatus] = useState<AttendanceStatus>(row.rec?.status ?? 'present');
  const [inT, setIn] = useState(row.rec?.check_in ?? '');
  const [outT, setOut] = useState(row.rec?.check_out ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const timed = status === 'present' || status === 'late';

  function submit() {
    if (!note.trim()) return setError('سبب التعديل اليدوي مطلوب');
    if (timed && !inT) return setError('وقت الحضور مطلوب');
    if (timed && inT && outT && outT <= inT) return setError('وقت الانصراف قبل وقت الحضور');
    setError(null);
    save.mutate(
      {
        employee_id: row.employee.id,
        date,
        status,
        check_in: timed ? inT : null,
        check_out: timed && outT ? outT : null,
        note: note.trim(),
      },
      { onSuccess: onClose, onError: (e) => setError(e.message) },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${row.rec ? 'تصحيح' : 'تسجيل'} حضور — ${row.employee.full_name}`}
    >
      <div className="space-y-3">
        <p className="text-xs text-purple">
          {dateAr(date)} · يُحسب التأخير تلقائيًا من بداية الوردية وفترة السماح.
        </p>
        <Select
          label="الحالة"
          value={status}
          onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
          options={(['present', 'absent', 'leave'] as AttendanceStatus[]).map((s) => ({
            value: s,
            label: ATT_STATUS_LABEL[s],
          }))}
        />
        {timed && (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="وقت الحضور"
              type="time"
              value={inT}
              onChange={(e) => setIn(e.target.value)}
            />
            <Input
              label="وقت الانصراف"
              type="time"
              value={outT}
              onChange={(e) => setOut(e.target.value)}
            />
          </div>
        )}
        <Input
          label="سبب التعديل (إلزامي)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button className="w-full" loading={save.isPending} onClick={submit}>
          حفظ
        </Button>
      </div>
    </Modal>
  );
}

/* -------------------------------- month ----------------------------------- */
function MonthView({ employees }: { employees: Employee[] }) {
  const people = currentEmployees(employees);
  const [empId, setEmpId] = useState(people[0]?.id ?? '');
  const [period, setPeriod] = useState(payrollPeriods()[0] ?? '');
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="الموظف"
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          options={people.map((e) => ({ value: e.id, label: e.full_name }))}
        />
        <Select
          label="الشهر"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          options={payrollPeriods().map((p) => ({ value: p, label: p }))}
        />
      </div>
      <MonthCalendar employeeId={empId} period={period} />
    </Card>
  );
}

type DayKind = AttendanceStatus | 'weekend' | 'holiday' | 'onleave' | 'none' | 'future';
const KIND_STYLE: Record<DayKind, string> = {
  present: 'bg-green-50 text-green-700 border-green-200',
  late: 'bg-amber-50 text-amber-700 border-amber-200',
  absent: 'bg-red-50 text-red-700 border-red-200',
  leave: 'bg-teal-100 text-teal border-teal/30',
  onleave: 'bg-teal-100 text-teal border-teal/30',
  weekend: 'bg-gray-50 text-gray-400 border-gray-100',
  holiday: 'bg-purple/10 text-purple border-purple/20',
  none: 'bg-white text-navy-300 border-navy-100',
  future: 'bg-white text-navy-200 border-navy-50',
};
const KIND_LABEL: Record<DayKind, string> = {
  ...ATT_STATUS_LABEL,
  onleave: 'إجازة',
  weekend: 'عطلة',
  holiday: 'عطلة رسمية',
  none: 'لم يسجّل',
  future: '',
};

function dayKind(
  date: string,
  today: string,
  rec: AttendanceRecord | undefined,
  leaves: LeaveRequest[],
  cfg: AttendanceConfig,
  holidays: PublicHoliday[],
): DayKind {
  if (rec) return rec.status;
  if (date > today) return 'future';
  if (isHoliday(date, holidays)) return 'holiday';
  if (!isWorkday(date, cfg, holidays)) return 'weekend';
  if (leaves.some((l) => l.status === 'approved' && l.from_date <= date && l.to_date >= date))
    return 'onleave';
  return 'none';
}

/** One employee's month: records + leave + holidays + weekends, with totals. */
export function MonthCalendar({ employeeId, period }: { employeeId: string; period: string }) {
  const { data: records = [], isLoading } = useMonthAttendance(employeeId, period);
  const { data: allLeave = [] } = useLeaveRequests();
  const { data: cfg = DEFAULT_ATTENDANCE_CONFIG } = useAttendanceConfig();
  const { data: holidays = [] } = useHolidays();
  const today = nowRiyadh().date;
  const leaves = allLeave.filter((l) => l.employee_id === employeeId);

  const days = useMemo(() => {
    const first = new Date(`${period}-01T00:00:00Z`);
    const n = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => {
      const d = `${period}-${String(i + 1).padStart(2, '0')}`;
      const rec = records.find((r) => r.date === d);
      return { d, rec, kind: dayKind(d, today, rec, leaves, cfg, holidays) };
    });
  }, [period, records, leaves, cfg, holidays, today]);
  const lead = new Date(`${period}-01T00:00:00Z`).getUTCDay();
  const total = (k: DayKind[]) => days.filter((x) => k.includes(x.kind)).length;
  const lateMins = records.reduce((s, r) => s + (r.late_minutes ?? 0), 0);

  if (isLoading) return <p className="text-sm text-purple">جارٍ التحميل…</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-purple">
        {WEEKDAY_LABEL.map((w) => (
          <div key={w}>{w}</div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((x) => (
          <div
            key={x.d}
            title={`${x.d} — ${KIND_LABEL[x.kind]}${x.rec?.check_in ? ` · ${x.rec.check_in}–${x.rec.check_out ?? '…'}` : ''}`}
            className={`rounded-lg border px-1 py-1.5 ${KIND_STYLE[x.kind]}`}
          >
            <div className="num text-xs font-bold">{Number(x.d.slice(8))}</div>
            <div className="truncate text-[9px]">{KIND_LABEL[x.kind]}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="success">حضور {total(['present'])}</Badge>
        <Badge tone="gold">
          تأخير {total(['late'])} ({lateMins} د)
        </Badge>
        <Badge tone="danger">غياب {total(['absent'])}</Badge>
        <Badge tone="teal">إجازة {total(['leave', 'onleave'])}</Badge>
        <Badge tone="neutral">لم يسجّل {total(['none'])}</Badge>
      </div>
    </div>
  );
}
