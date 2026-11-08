import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  HandCoins,
  Lock,
  Printer,
  RotateCcw,
  Send,
  ShieldCheck,
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
import { dateAr, sar } from '@/shared/lib/format';
import { exportCsv } from '@/shared/lib/exportTable';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/store/auth';
import {
  useAddAdjustment,
  useAdjustments,
  useApproveRun,
  useCalculateRun,
  useDecideAdjustment,
  usePayrollRun,
} from '@/features/hr/hooks/useHr';
import {
  ADJUSTMENT_TYPES,
  currentEmployees,
  PAYROLL_CONFIG,
  payrollPeriods,
} from '@/features/hr/api/hr.api';
import { buildWpsTable, maskIban, printPayslip } from '@/features/hr/lib/payrollDocs';
import {
  ADJ_STATUS_LABEL,
  ADJ_STATUS_TONE,
  ADJ_TYPE_LABEL,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  type AdjustmentType,
  type Employee,
  type PayrollRun,
  type Payslip,
} from '@/features/hr/types';

const PERIODS = payrollPeriods();

function nextPeriod(p: string): string {
  const d = new Date(`${p}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

/** calculate → approve (someone else) → post → pay */
function Stepper({ run }: { run: PayrollRun | null }) {
  const steps = [
    { label: 'احتساب المسير', done: !!run, icon: Calculator },
    { label: 'اعتماد (شخص آخر)', done: !!run && run.status !== 'calculated', icon: ShieldCheck },
    { label: 'ترحيل محاسبي', done: !!run?.posted_at, icon: BookCheck },
    { label: 'صرف الرواتب', done: run?.status === 'paid', icon: Wallet },
  ];
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li
            key={s.label}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${s.done ? 'border-green-200 bg-green-50 text-green-700' : 'border-navy-100 bg-white text-purple'}`}
          >
            <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white">
              {s.done ? <CheckCircle2 size={14} /> : i + 1}
            </span>
            <Icon size={14} /> {s.label}
          </li>
        );
      })}
    </ol>
  );
}

export function PayrollBoard({ employees }: { employees: Employee[] }) {
  const { can } = usePermissions();
  const canPrepare = can('hr', 'manage');
  const me = useAuth((s) => s.profile?.id ?? '');
  const [period, setPeriod] = useState(PERIODS[0] ?? '');
  const { data, isLoading, isError, refetch } = usePayrollRun(period);
  const calc = useCalculateRun();
  const approve = useApproveRun();
  const [openSlip, setOpenSlip] = useState<Payslip | null>(null);
  const [correcting, setCorrecting] = useState<Payslip | null>(null);
  const run = data?.run ?? null;
  const slips = useMemo(() => data?.slips ?? [], [data]);
  const frozen = !!run && run.status !== 'calculated';
  const ownRun = !!run && run.run_by === me;

  const wps = useMemo(() => buildWpsTable(slips, period), [slips, period]);

  const columns: Column<Payslip>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (r) => (
        <div>
          <span className="font-semibold text-navy">{r.employee_name}</span>
          {r.eligible_days > 0 && r.eligible_days < 28 && (
            <div className="text-[11px] text-gold-600">
              شهر جزئي: <span className="num">{r.eligible_days}</span> يوم
            </div>
          )}
        </div>
      ),
    },
    { key: 'basic', header: 'الأساسي', cell: (r) => <span className="num">{sar(r.basic)}</span> },
    {
      key: 'allowances',
      header: 'البدلات والإضافات',
      cell: (r) => (
        <span className="num text-green-600">
          +
          {sar(
            r.housing_allowance +
              r.transport_allowance +
              r.other_allowance +
              r.overtime_amount +
              r.additions,
          )}
        </span>
      ),
    },
    {
      key: 'deductions',
      header: 'الاستقطاعات',
      cell: (r) => (
        <span
          className="num text-red-600"
          title={`تأمينات ${sar(r.gosi_employee)} · غياب ${sar(r.absence_deduction)} · تأخير ${sar(r.late_deduction)} · إجازات ${sar(r.leave_deduction)} · سلف ${sar(r.advance_deductions)} · جزاءات ${sar(r.penalty_deductions)}`}
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
      key: 'iban',
      header: 'الحساب',
      cell: (r) =>
        r.iban ? (
          <span className="num text-xs text-purple">{maskIban(r.iban)}</span>
        ) : (
          <Badge tone="danger">بلا آيبان</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setOpenSlip(r)}
            className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
          >
            <ChevronDown size={13} /> التفاصيل
          </button>
          {frozen && canPrepare && (
            <button
              type="button"
              onClick={() => setCorrecting(r)}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
            >
              <RotateCcw size={13} /> تصحيح
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
              <Wallet size={16} /> مسير رواتب الشهر
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-purple">
              يُحتسب من المصادر (الحضور، ملف الموظف، الإجازات، التعديلات المعتمدة) وتُجمَّد لقطته.
              يعتمده شخص غير من أعدّه، وبعد الاعتماد لا يتغير — التصحيح بتعديل في الشهر التالي.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="الشهر"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              options={PERIODS.map((p) => ({ value: p, label: p }))}
            />
            {run && (
              <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
            )}
          </div>
        </div>
        <div className="mt-4">
          <Stepper run={run} />
        </div>
      </Card>

      {isLoading ? (
        <Table columns={columns} rows={[]} rowKey={(r) => r.employee_id} isLoading />
      ) : isError ? (
        <Table
          columns={columns}
          rows={[]}
          rowKey={(r) => r.employee_id}
          isError
          onRetry={() => void refetch()}
        />
      ) : !run ? (
        <Card className="py-10 text-center">
          <Wallet size={28} className="mx-auto text-navy-200" />
          <p className="mt-3 text-sm text-purple">
            {canPrepare
              ? `لم يُحتسب مسير ${period} بعد. راجع طلبات التعديل أدناه ثم احتسب المسير.`
              : `لا يوجد مسير معتمد لشهر ${period} بعد.`}
          </p>
          {canPrepare && (
            <Button
              className="mx-auto mt-4"
              loading={calc.isPending}
              onClick={() => calc.mutate(period)}
            >
              <Calculator size={16} /> احتساب المسير
            </Button>
          )}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="عدد الموظفين" value={run.employee_count} />
            <StatTile label="إجمالي المستحق" value={sar(run.total_gross)} tone="success" />
            <StatTile label="إجمالي الاستقطاعات" value={sar(run.total_deductions)} tone="danger" />
            <StatTile label="صافي الرواتب" value={sar(run.total_net)} tone="warning" />
            <StatTile
              label="التأمينات (موظف + منشأة)"
              value={sar(run.total_gosi_employee + run.total_gosi_employer)}
            />
          </div>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-purple">
              <span>
                أعدّه <b className="text-navy">{run.run_by_name}</b>
                {run.calculated_at && (
                  <>
                    {' '}
                    في <span className="num">{dateAr(run.calculated_at)}</span>
                  </>
                )}
                {run.approved_at && (
                  <>
                    {' '}
                    · اعتمده <b className="text-navy">{run.approved_by_name}</b> في{' '}
                    <span className="num">{dateAr(run.approved_at)}</span>
                  </>
                )}
                {run.posted_at && ' · رُحّل للمحاسبة'}
                {run.paid_at && (
                  <>
                    {' '}
                    · صُرف في <span className="num">{dateAr(run.paid_at)}</span>
                  </>
                )}
              </span>
              <div className="flex flex-wrap gap-2">
                {!frozen && canPrepare && (
                  <Button
                    variant="outline"
                    loading={calc.isPending}
                    onClick={() => calc.mutate(period)}
                  >
                    <RotateCcw size={15} /> إعادة الاحتساب
                  </Button>
                )}
                {!frozen && canPrepare && (
                  <Button
                    disabled={ownRun}
                    loading={approve.isPending}
                    title={ownRun ? 'لا يعتمد المسير من أعدّه (مبدأ الأربع أعين)' : undefined}
                    onClick={() => approve.mutate({ period, runId: run.id })}
                  >
                    <ShieldCheck size={15} /> اعتماد المسير
                  </Button>
                )}
                {frozen && canPrepare && wps.table.rows.length > 0 && (
                  <Button variant="outline" onClick={() => exportCsv(wps.table, `wps-${period}`)}>
                    <Download size={15} /> ملف حماية الأجور (WPS)
                  </Button>
                )}
              </div>
            </div>
            {!frozen && ownRun && (
              <p className="flex items-center gap-1.5 rounded-xl bg-navy-50 px-3 py-2 text-xs text-navy">
                <ShieldCheck size={14} /> أعددت هذا المسير — يعتمده شخص آخر (المدير العام) قبل
                الترحيل والصرف.
              </p>
            )}
            {frozen && (
              <p className="flex items-center gap-1.5 rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">
                <Lock size={14} /> المسير معتمد ومجمّد. أي تصحيح يُرفع كتعديل على شهر{' '}
                <span className="num">{nextPeriod(period)}</span>.
              </p>
            )}
            {wps.missing.length > 0 && (
              <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  بلا آيبان صحيح (لن يُدرجوا في ملف حماية الأجور — أكمل بياناتهم البنكية في ملف
                  الموظف): {wps.missing.join('، ')}
                </span>
              </p>
            )}
          </Card>

          <Table
            columns={columns}
            rows={slips}
            rowKey={(r) => r.employee_id}
            emptyTitle="لا توجد قسائم ضمن صلاحيتك"
          />
        </>
      )}

      <AdjustmentsPanel employees={employees} period={period} locked={frozen} />

      {openSlip && run && (
        <PayslipModal slip={openSlip} period={period} run={run} onClose={() => setOpenSlip(null)} />
      )}
      {correcting && (
        <AdjustmentModal
          employees={currentEmployees(employees)}
          period={nextPeriod(period)}
          presetEmployeeId={correcting.employee_id}
          presetReason={`تصحيح مسير ${period}`}
          onClose={() => setCorrecting(null)}
        />
      )}
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
  value: number;
  tone?: string;
  hint?: string;
}) {
  if (value === 0 && !hint) return null;
  return (
    <div className="flex items-center justify-between border-b border-navy-50 py-2 text-sm last:border-0">
      <span className="text-purple">
        {label}
        {hint && <span className="text-navy-300 mr-1 text-[11px]">({hint})</span>}
      </span>
      <span className={`num font-semibold ${tone}`}>{sar(value)}</span>
    </div>
  );
}

function PayslipModal({
  slip,
  period,
  run,
  onClose,
}: {
  slip: Payslip;
  period: string;
  run: PayrollRun;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`قسيمة راتب — ${slip.employee_name}`}>
      <div className="max-h-[72vh] space-y-4 overflow-y-auto pl-1">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-50 px-4 py-3 text-sm">
          <span className="text-purple">
            الشهر: <span className="num font-semibold text-navy">{period}</span>
          </span>
          <span className="text-purple">
            حضور <span className="num font-semibold text-navy">{slip.present_days}</span> · غياب{' '}
            <span className="num font-semibold text-red-600">{slip.absent_days}</span> · تأخير{' '}
            <span className="num font-semibold text-gold-600">{slip.late_minutes}</span> د
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs font-bold text-green-700">المستحقات</p>
          <div className="rounded-xl border border-navy-100 px-3">
            <SlipLine
              label="الراتب الأساسي"
              value={slip.basic}
              tone="text-green-600"
              {...(slip.eligible_days > 0 && slip.eligible_days < 28
                ? { hint: `${slip.eligible_days} يوم` }
                : {})}
            />
            <SlipLine label="بدل السكن" value={slip.housing_allowance} tone="text-green-600" />
            <SlipLine label="بدل النقل" value={slip.transport_allowance} tone="text-green-600" />
            <SlipLine label="بدلات أخرى" value={slip.other_allowance} tone="text-green-600" />
            <SlipLine
              label="العمل الإضافي"
              value={slip.overtime_amount}
              tone="text-green-600"
              {...(slip.overtime_hours
                ? { hint: `${slip.overtime_hours} ساعة × ${PAYROLL_CONFIG.overtimeMultiplier}` }
                : {})}
            />
            <SlipLine label="مكافآت وبدلات معتمدة" value={slip.additions} tone="text-green-600" />
            <SlipLine label="إجمالي المستحق" value={slip.gross} hint="ر.س" />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-bold text-red-700">الاستقطاعات</p>
          <div className="rounded-xl border border-navy-100 px-3">
            <SlipLine
              label="التأمينات الاجتماعية (GOSI)"
              value={slip.gosi_employee}
              tone="text-red-600"
              hint={
                slip.nationality === 'السعودية'
                  ? slip.gosi_system === 'old'
                    ? 'النظام القديم'
                    : 'النظام الجديد'
                  : 'وافد — معفى'
              }
            />
            <SlipLine label="خصم الغياب" value={slip.absence_deduction} tone="text-red-600" />
            <SlipLine label="خصم التأخير" value={slip.late_deduction} tone="text-red-600" />
            <SlipLine
              label="خصم الإجازات"
              value={slip.leave_deduction}
              tone="text-red-600"
              {...(slip.leave_deduction
                ? {
                    hint: `${slip.unpaid_leave_days} يوم بدون راتب · ${slip.sick_deduction_days} يوم مرضية مخفّضة`,
                  }
                : {})}
            />
            <SlipLine label="استرداد سلفة" value={slip.advance_deductions} tone="text-red-600" />
            <SlipLine
              label="جزاءات (لصالح العمال)"
              value={slip.penalty_deductions}
              tone="text-red-600"
            />
            <SlipLine label="إجمالي الاستقطاعات" value={slip.total_deductions} hint="ر.س" />
          </div>
        </div>
        <div className="bg-gold-50 flex items-center justify-between rounded-xl px-4 py-3">
          <span className="text-sm font-bold text-navy">صافي الراتب</span>
          <span className="num text-xl font-bold text-gold-600">{sar(slip.net)} ر.س</span>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => printPayslip(slip, period, run.status)}
        >
          <Printer size={16} /> طباعة القسيمة / حفظ PDF
        </Button>
        {run.status === 'calculated' && (
          <p className="flex items-center gap-1.5 text-xs text-purple">
            <FileText size={13} /> المسير غير معتمد بعد — تُطبع القسيمة بعلامة «مسودة».
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ---- adjustment requests: submit → HR approves → flows into the run ---- */
function AdjustmentsPanel({
  employees,
  period,
  locked,
}: {
  employees: Employee[];
  period: string;
  locked: boolean;
}) {
  const { can } = usePermissions();
  // submit: anyone with HR access in scope (branch manager included);
  // decide: hr.manage only — same as payadj_decide (0022)
  const canSubmit = can('hr', 'create') || can('hr', 'manage');
  const canDecide = can('hr', 'manage');
  const { data: adjustments = [] } = useAdjustments();
  const decide = useDecideAdjustment();
  const [addOpen, setAddOpen] = useState(false);
  const rows = adjustments.filter((a) => a.period === period);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <HandCoins size={16} /> طلبات التعديل — <span className="num">{period}</span>
        </h2>
        {canSubmit && !locked && (
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Send size={15} /> رفع طلب تعديل
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-purple">
        {locked
          ? 'مسير هذا الشهر معتمد — لا تُقبل تعديلات عليه. ارفع التصحيح على الشهر التالي.'
          : 'يرفع المدير/المشرف طلب مكافأة أو جزاء أو سلفة، وتعتمده الموارد البشرية. لا يدخل المسير إلا المعتمد، ويُعاد احتساب المسير بعده.'}
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
                  className={`num font-semibold ${a.type === 'penalty' || a.type === 'advance' ? 'text-red-600' : 'text-green-600'}`}
                >
                  {a.type === 'penalty' || a.type === 'advance' ? '-' : '+'}
                  {sar(a.amount)}
                </span>
                <Badge tone={ADJ_STATUS_TONE[a.status]}>{ADJ_STATUS_LABEL[a.status]}</Badge>
                {canDecide && !locked && a.status === 'pending' && (
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
        <AdjustmentModal
          employees={currentEmployees(employees)}
          period={period}
          onClose={() => setAddOpen(false)}
        />
      )}
    </Card>
  );
}

function AdjustmentModal({
  employees,
  period,
  presetEmployeeId,
  presetReason,
  onClose,
}: {
  employees: Employee[];
  period: string;
  presetEmployeeId?: string;
  presetReason?: string;
  onClose: () => void;
}) {
  const add = useAddAdjustment();
  const me = useAuth((s) => s.profile?.full_name ?? '—');
  const [empId, setEmpId] = useState(presetEmployeeId ?? employees[0]?.id ?? '');
  const [type, setType] = useState<AdjustmentType>('bonus');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState(presetReason ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const emp = employees.find((e) => e.id === empId);
    if (!emp || !(amount > 0)) return setError('اختر الموظف وأدخل مبلغًا صحيحًا.');
    if (reason.trim().length < 3) return setError('اكتب سبب التعديل.');
    add.mutate(
      {
        employee_id: emp.id,
        employee_name: emp.full_name,
        type,
        amount,
        reason: reason.trim(),
        period,
        submitted_by: me,
      },
      { onSuccess: onClose, onError: (e) => setError(e.message) },
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
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button onClick={submit} className="w-full" loading={add.isPending}>
          <Send size={16} /> رفع الطلب للاعتماد
        </Button>
      </div>
    </Modal>
  );
}
