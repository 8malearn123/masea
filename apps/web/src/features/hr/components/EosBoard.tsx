import { useMemo, useState } from 'react';
import { Calculator, FileSignature, Printer, ShieldCheck, Users, XCircle } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, StatTile, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/store/auth';
import {
  useApproveEos,
  useCancelEos,
  useEosPreview,
  useEosSettlements,
  useLeaveRequests,
  useLeaveTypes,
  usePayrollSettings,
  usePrepareEos,
} from '@/features/hr/hooks/useHr';
import { currentEmployees } from '@/features/hr/api/hr.api';
import { eosCalculate } from '@/features/hr/lib/eosEngine';
import { printSettlement } from '@/features/hr/lib/eosDocs';
import { DEFAULT_LEAVE_TYPES } from '@/features/hr/lib/leaveEngine';
import {
  EOS_STATUS_LABEL,
  EOS_STATUS_TONE,
  EOS_WAGE_BASIS_LABEL,
  TERMINATION_REASON_LABEL,
  type EosSettlement,
  type Employee,
} from '@/features/hr/types';

const today = () => new Date().toISOString().slice(0, 10);
const yrs = (n: number) => n.toFixed(2);

export function EosBoard({ employees }: { employees: Employee[] }) {
  const [view, setView] = useState<'liability' | 'settlements'>('liability');
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-navy-100 bg-white p-1">
        {(
          [
            ['liability', 'الالتزام الحالي', Users],
            ['settlements', 'التسويات النهائية', FileSignature],
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
      {view === 'liability' ? (
        <Liability employees={employees} />
      ) : (
        <Settlements employees={employees} />
      )}
    </div>
  );
}

/* ------------------------------- liability -------------------------------- */
interface LiabilityRow {
  e: Employee;
  years: number;
  wage: number;
  award: number;
  resign: number;
  leaveDays: number;
  leaveAmount: number;
}

function Liability({ employees }: { employees: Employee[] }) {
  const { data: settings } = usePayrollSettings();
  const { data: leaves = [] } = useLeaveRequests();
  const { data: types = DEFAULT_LEAVE_TYPES } = useLeaveTypes();
  const basis = settings?.payroll.eosWageBasis ?? 'full';
  const t = today();
  const rows: LiabilityRow[] = useMemo(
    () =>
      currentEmployees(employees).map((e) => {
        const term = eosCalculate(e, t, 'employer_termination', false, basis, leaves, types);
        const resign = eosCalculate(e, t, 'resignation', false, basis, leaves, types);
        return {
          e,
          years: term.service_years,
          wage: term.wage,
          award: term.award,
          resign: resign.award,
          leaveDays: term.leave_days,
          leaveAmount: term.leave_amount,
        };
      }),
    [employees, leaves, types, basis, t],
  );
  const total = rows.reduce((s, r) => s + r.award, 0);
  const leaveTotal = rows.reduce((s, r) => s + r.leaveAmount, 0);

  const columns: Column<LiabilityRow>[] = [
    {
      key: 'name',
      header: 'الموظف',
      cell: (r) => <span className="font-semibold text-navy">{r.e.full_name}</span>,
    },
    {
      key: 'years',
      header: 'سنوات الخدمة',
      cell: (r) => <span className="num">{yrs(r.years)}</span>,
    },
    {
      key: 'wage',
      header: 'أجر الاحتساب',
      cell: (r) => <span className="num">{sar(r.wage)}</span>,
    },
    {
      key: 'award',
      header: 'المكافأة (إنهاء من المنشأة)',
      cell: (r) => <span className="num font-bold text-gold-600">{sar(r.award)}</span>,
    },
    {
      key: 'resign',
      header: 'لو استقال اليوم',
      cell: (r) => (
        <span className="num text-purple">{r.resign > 0 ? sar(r.resign) : 'لا يستحق'}</span>
      ),
    },
    {
      key: 'leave',
      header: 'بدل رصيد الإجازات',
      cell: (r) => (
        <span className="num">
          {sar(r.leaveAmount)}{' '}
          <span className="text-[11px] text-purple">({r.leaveDays.toFixed(1)} يوم)</span>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="التزام مكافأة نهاية الخدمة" value={sar(total)} tone="warning" />
        <StatTile label="التزام بدل رصيد الإجازات" value={sar(leaveTotal)} />
        <StatTile label="عدد الموظفين" value={rows.length} />
      </div>
      <Card className="text-xs leading-relaxed text-purple">
        وفق نظام العمل: نصف شهر عن كل سنة من الخمس الأولى ثم شهر عن كل سنة بعدها، وكسور السنة
        بنسبتها (م84). الاستقالة: أقل من سنتين لا شيء، 2–5 ثلث، 5–10 ثلثان، 10 فأكثر كاملة (م85).
        أجر الاحتساب: <b className="text-navy">{EOS_WAGE_BASIS_LABEL[basis]}</b> — يُغيَّر من
        «الإعدادات». يُرحَّل هذا الالتزام شهريًا كمخصص في المحاسبة.
      </Card>
      <Table columns={columns} rows={rows} rowKey={(r) => r.e.id} emptyTitle="لا يوجد موظفون" />
    </div>
  );
}

/* ------------------------------ settlements ------------------------------- */
function Settlements({ employees }: { employees: Employee[] }) {
  const { can } = usePermissions();
  const canManage = can('hr', 'manage');
  const me = useAuth((s) => s.profile?.id ?? '');
  const { data: list = [], isLoading, isError, refetch } = useEosSettlements();
  const approve = useApproveEos();
  const cancel = useCancelEos();
  const [preparing, setPreparing] = useState<Employee | null>(null);

  const leavers = employees.filter((e) => e.status === 'terminated');
  const pending = leavers.filter((e) => !list.some((s) => s.employee_id === e.id));

  const columns: Column<EosSettlement>[] = [
    {
      key: 'name',
      header: 'الموظف',
      cell: (s) => (
        <div>
          <span className="font-semibold text-navy">{s.employee_name}</span>
          <div className="text-[11px] text-purple">
            {TERMINATION_REASON_LABEL[s.reason]} · <span className="num">{dateAr(s.end_date)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'years',
      header: 'الخدمة',
      cell: (s) => <span className="num">{yrs(s.service_years)} سنة</span>,
    },
    { key: 'award', header: 'المكافأة', cell: (s) => <span className="num">{sar(s.award)}</span> },
    {
      key: 'leave',
      header: 'بدل الإجازات',
      cell: (s) => <span className="num">{sar(s.leave_amount)}</span>,
    },
    {
      key: 'net',
      header: 'الصافي',
      cell: (s) => <span className="num font-bold text-navy">{sar(s.net)} ر.س</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (s) => (
        <div>
          <Badge tone={EOS_STATUS_TONE[s.status]}>{EOS_STATUS_LABEL[s.status]}</Badge>
          <div className="text-[11px] text-purple">
            أعدّها {s.prepared_by_name}
            {s.approved_by_name && ` · اعتمدها ${s.approved_by_name}`}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (s) => (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => printSettlement(s)}
            className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
          >
            <Printer size={13} /> المخالصة
          </button>
          {canManage && s.status === 'draft' && (
            <>
              <button
                type="button"
                disabled={s.prepared_by === me || approve.isPending}
                title={
                  s.prepared_by === me ? 'لا يعتمد التسوية من أعدّها (مبدأ الأربع أعين)' : undefined
                }
                onClick={() => approve.mutate(s.id)}
                className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
              >
                <ShieldCheck size={13} /> اعتماد
              </button>
              <button
                type="button"
                onClick={() => cancel.mutate(s.id)}
                className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <XCircle size={13} /> إلغاء
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {canManage && pending.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-navy">منتهية خدمتهم بلا تسوية</h3>
          <ul className="space-y-2">
            {pending.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-100 px-3 py-2 text-sm"
              >
                <span>
                  <b className="text-navy">{e.full_name}</b>{' '}
                  <span className="text-xs text-purple">
                    {e.termination_reason ? TERMINATION_REASON_LABEL[e.termination_reason] : ''} ·{' '}
                    <span className="num">
                      {e.termination_date ? dateAr(e.termination_date) : ''}
                    </span>
                  </span>
                </span>
                <Button size="sm" onClick={() => setPreparing(e)}>
                  <Calculator size={14} /> إعداد التسوية
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Table
        columns={columns}
        rows={list}
        rowKey={(s) => s.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد تسويات — سجّل إنهاء الخدمة من «الموظفون» ثم أعدّ التسوية هنا"
      />
      {preparing && <PrepareModal employee={preparing} onClose={() => setPreparing(null)} />}
    </div>
  );
}

function PrepareModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const prepare = usePrepareEos();
  const reason = employee.termination_reason ?? 'other';
  const end = employee.termination_date ?? today();
  const [art77, setArt77] = useState(false);
  const [add, setAdd] = useState('0');
  const [ded, setDed] = useState('0');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: c, isLoading } = useEosPreview(employee, end, reason, art77);
  const n = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const net = c ? Math.round((c.total + n(add) - n(ded)) * 100) / 100 : 0;

  function submit() {
    if (n(add) < 0 || n(ded) < 0 || Number.isNaN(n(add)) || Number.isNaN(n(ded)))
      return setError('المبالغ لا تكون سالبة');
    if ((n(add) > 0 || n(ded) > 0) && !note.trim())
      return setError('اذكر سبب الإضافات أو الخصومات');
    setError(null);
    prepare.mutate(
      { employee_id: employee.id, art77, other_additions: n(add), other_deductions: n(ded), note },
      { onSuccess: onClose, onError: (e) => setError(e.message) },
    );
  }

  const line = (label: string, v: number, hint?: string) => (
    <div className="flex items-center justify-between border-b border-navy-50 py-1.5 text-sm last:border-0">
      <span className="text-purple">
        {label}
        {hint && <span className="mr-1 text-[11px]">({hint})</span>}
      </span>
      <span className="num font-semibold text-navy">{sar(v)}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`تسوية نهاية خدمة — ${employee.full_name}`}>
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pl-1">
        <p className="text-xs text-purple">
          {TERMINATION_REASON_LABEL[reason]} · آخر يوم عمل{' '}
          <span className="num">{dateAr(end)}</span>
        </p>
        {isLoading || !c ? (
          <p className="text-sm text-purple">جارٍ الاحتساب…</p>
        ) : (
          <div className="rounded-xl border border-navy-100 px-3">
            {line('مدة الخدمة', c.service_years, 'سنة')}
            {line('أجر الاحتساب', c.wage, EOS_WAGE_BASIS_LABEL[c.wage_basis])}
            {line('أصل المكافأة (م84)', c.award_full)}
            {line(
              'المكافأة المستحقة',
              c.award,
              c.award_ratio === 1
                ? 'كاملة'
                : c.award_ratio === 0
                  ? 'لا تستحق'
                  : `${Math.round(c.award_ratio * 100)}٪ (م85)`,
            )}
            {line('بدل رصيد الإجازات (م111)', c.leave_amount, `${c.leave_days} يوم`)}
            {art77 &&
              line('تعويض المادة 77', c.art77_amount, '15 يومًا عن كل سنة، وبحد أدنى شهران')}
          </div>
        )}
        {reason === 'employer_termination' && (
          <label className="flex items-start gap-2 rounded-xl bg-navy-50 p-3 text-sm text-navy">
            <input
              type="checkbox"
              className="mt-1"
              checked={art77}
              onChange={(e) => setArt77(e.target.checked)}
            />
            <span>
              إنهاء بلا سبب مشروع — تعويض المادة 77
              <span className="block text-xs text-purple">
                أجر 15 يومًا عن كل سنة خدمة، وبحد أدنى أجر شهرين.
              </span>
            </span>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="مستحقات أخرى"
            type="number"
            min={0}
            suffix="ر.س"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
          />
          <Input
            label="يُخصم (سلف/عهد)"
            type="number"
            min={0}
            suffix="ر.س"
            value={ded}
            onChange={(e) => setDed(e.target.value)}
          />
        </div>
        <Input label="السبب / ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="bg-gold-50 flex items-center justify-between rounded-xl px-4 py-3">
          <span className="text-sm font-bold text-navy">صافي المستحق</span>
          <span className="num text-xl font-bold text-gold-600">{sar(net)} ر.س</span>
        </div>
        <p className="text-xs text-purple">
          راتب الشهر الأخير حتى آخر يوم عمل يُصرف في مسير ذلك الشهر (احتساب جزئي) — لا يُكرَّر هنا.
        </p>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button className="w-full" loading={prepare.isPending} onClick={submit}>
          <Calculator size={16} /> إعداد التسوية للاعتماد
        </Button>
      </div>
    </Modal>
  );
}
