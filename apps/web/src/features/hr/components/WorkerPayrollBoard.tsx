import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Download,
  Home,
  Plus,
  Printer,
  Send,
  ShieldCheck,
  Users,
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
import { exportCsv, exportPdf } from '@/shared/lib/exportTable';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/store/auth';
import { payrollPeriods } from '@/features/hr/api/hr.api';
import { useHouseWorkers } from '@/features/hr/hooks/useHr';
import {
  useApproveWorkerRun,
  useCalculateWorkerRun,
  useDecideWorkerAdjustment,
  useProposeWorkerAbsences,
  useSubmitWorkerAdjustment,
  useWorkerAdjustments,
  useWorkerRun,
} from '@/features/hr/hooks/useWorkerPayroll';
import { buildWorkerWpsTable } from '@/features/hr/lib/workerPayrollEngine';
import { maskIban } from '@/features/hr/lib/payrollDocs';
import { scopeToViewerBranch } from '@/lib/branchScope';
import {
  ADJ_STATUS_LABEL,
  ADJ_STATUS_TONE,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  WORKER_ADJ_IS_ADDITION,
  WORKER_ADJ_LABEL,
  type WorkerAdjType,
  type WorkerAdjustment,
  type WorkerPayslip,
} from '@/features/hr/types';

const PERIODS = payrollPeriods();

/** «رواتب العاملات» — approvable adjustments → run → approval → WPS (0079). */
export function WorkerPayrollBoard() {
  const { can } = usePermissions();
  const canEdit = can('hr', 'edit');
  const canManage = can('hr', 'manage');
  const myName = useAuth((s) => s.profile?.full_name);
  const [period, setPeriod] = useState(PERIODS[0] ?? new Date().toISOString().slice(0, 7));
  const { data: runData, isLoading, isError, refetch } = useWorkerRun(period);
  const { data: adjustments = [], isLoading: adjLoading } = useWorkerAdjustments(period);
  const calc = useCalculateWorkerRun();
  const approve = useApproveWorkerRun();
  const propose = useProposeWorkerAbsences();
  const decide = useDecideWorkerAdjustment();
  const [adding, setAdding] = useState(false);

  const run = runData?.run ?? null;
  const slips = runData?.slips ?? [];
  const frozen = !!run && run.status !== 'calculated';
  const pending = adjustments.filter((a) => a.status === 'pending');
  const wps = useMemo(() => buildWorkerWpsTable(slips, period), [slips, period]);

  const adjColumns: Column<WorkerAdjustment>[] = [
    {
      key: 'worker',
      header: 'العاملة',
      cell: (a) => (
        <div>
          <span className="font-semibold text-navy">{a.worker_name}</span>
          <div className="text-[11px] text-purple">{a.branch}</div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'النوع',
      cell: (a) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={WORKER_ADJ_IS_ADDITION[a.type] ? 'success' : 'danger'}>
            {WORKER_ADJ_LABEL[a.type]}
          </Badge>
          {a.source === 'housing_absence' && (
            <Badge tone="navy">
              <Home size={11} /> من السكن
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'المبلغ',
      cell: (a) => (
        <span
          className={`num font-semibold ${WORKER_ADJ_IS_ADDITION[a.type] ? 'text-green-700' : 'text-red-600'}`}
        >
          {WORKER_ADJ_IS_ADDITION[a.type] ? '+' : '−'}
          {sar(a.amount)}
        </span>
      ),
    },
    { key: 'reason', header: 'السبب', cell: (a) => <span className="text-xs">{a.reason}</span> },
    {
      key: 'status',
      header: 'الحالة',
      cell: (a) => <Badge tone={ADJ_STATUS_TONE[a.status]}>{ADJ_STATUS_LABEL[a.status]}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      cell: (a) =>
        canManage && a.status === 'pending' && !frozen ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="success"
              loading={decide.isPending}
              onClick={() => decide.mutate({ id: a.id, approve: true })}
            >
              <CheckCircle2 size={14} /> اعتماد
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => decide.mutate({ id: a.id, approve: false })}
            >
              <XCircle size={14} /> رفض
            </Button>
          </div>
        ) : null,
    },
  ];

  const slipColumns: Column<WorkerPayslip>[] = [
    {
      key: 'worker',
      header: 'العاملة',
      sortValue: (s) => s.worker_name,
      cell: (s) => (
        <div>
          <span className="font-semibold text-navy">{s.worker_name}</span>
          <div className="text-[11px] text-purple">
            {s.branch} · <span className="num">{s.iqama_no || s.passport_no || '—'}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'days',
      header: 'الأيام',
      cell: (s) => <span className="num text-xs">{s.eligible_days}</span>,
    },
    {
      key: 'base',
      header: 'الأساسي',
      cell: (s) => <span className="num text-xs">{sar(s.base_pay)}</span>,
    },
    {
      key: 'add',
      header: 'الإضافات',
      cell: (s) => (
        <span className="num text-xs text-green-700">
          {s.additions ? `+${sar(s.additions)}` : '—'}
        </span>
      ),
    },
    {
      key: 'ded',
      header: 'الاستقطاعات',
      cell: (s) =>
        s.total_deductions ? (
          <div className="text-xs text-red-600">
            <span className="num">−{sar(s.total_deductions)}</span>
            <div className="text-[11px] text-purple">
              {[
                s.absence_deduction ? `غياب ${s.absence_days} يوم` : '',
                s.advance_deductions ? 'سلفة' : '',
                s.penalty_deductions ? 'جزاء' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        ) : (
          <span className="text-xs text-purple">—</span>
        ),
    },
    {
      key: 'net',
      header: 'الصافي',
      sortValue: (s) => s.net,
      cell: (s) => <span className="num font-bold text-navy">{sar(s.net)}</span>,
    },
    {
      key: 'pay',
      header: 'الصرف',
      cell: (s) =>
        s.payment_method === 'cash' ? (
          <Badge tone="gold">نقدًا</Badge>
        ) : s.iban ? (
          <span className="text-xs">
            {s.bank_name} <span className="num">{maskIban(s.iban)}</span>
          </span>
        ) : (
          <Badge tone="danger">بلا آيبان</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-44">
          <Select
            label="الشهر"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={PERIODS.map((p) => ({ value: p, label: p }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-purple">
          <Badge tone={pending.length ? 'gold' : 'success'}>
            1. التعديلات {pending.length ? `(${pending.length} بانتظار الاعتماد)` : '✓'}
          </Badge>
          <span>←</span>
          <Badge tone={run ? RUN_STATUS_TONE[run.status] : 'neutral'}>
            2. {run ? RUN_STATUS_LABEL[run.status] : 'لم يُحتسب'}
          </Badge>
          <span>←</span>
          <Badge tone={run?.posted_at ? 'success' : 'neutral'}>
            3. {run?.posted_at ? 'مُرحَّل' : 'الترحيل (المحاسبة)'}
          </Badge>
        </div>
      </Card>

      {/* ---- approvable adjustments ---- */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-navy">الإضافات والخصومات</h3>
            <p className="text-[11px] text-purple">
              لا يدخل المسير إلا ما اعتمده مدير الموارد البشرية — وغياب السكن يُقترح خصمًا ولا يُخصم
              آليًا.
            </p>
          </div>
          {canEdit && !frozen && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                loading={propose.isPending}
                onClick={() => propose.mutate(period)}
              >
                <Home size={15} /> اقتراح خصومات الغياب من السكن
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={15} /> تعديل جديد
              </Button>
            </div>
          )}
        </div>
        <Table
          columns={adjColumns}
          rows={adjustments}
          rowKey={(a) => a.id}
          isLoading={adjLoading}
          emptyTitle="لا توجد إضافات أو خصومات لهذا الشهر"
        />
      </Card>

      {/* ---- the run ---- */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
              <Wallet size={16} /> مسير رواتب العاملات {period}
            </h3>
            {run && (
              <p className="text-[11px] text-purple">
                أعدّه {run.run_by_name}
                {run.calculated_at && (
                  <>
                    {' '}
                    · <span className="num">{dateAr(run.calculated_at)}</span>
                  </>
                )}
                {run.approved_by_name && <> · اعتمده {run.approved_by_name}</>}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && !frozen && (
              <Button loading={calc.isPending} onClick={() => calc.mutate(period)}>
                <Calculator size={16} /> {run ? 'إعادة الاحتساب' : 'احتساب المسير'}
              </Button>
            )}
            {canManage && run?.status === 'calculated' && (
              <Button
                variant="success"
                loading={approve.isPending}
                disabled={run.run_by_name === myName}
                title={
                  run.run_by_name === myName
                    ? 'يعتمده شخص غير من أعدّه (الأربع أعين)'
                    : 'اعتماد المسير'
                }
                onClick={() => approve.mutate({ period, runId: run.id })}
              >
                <ShieldCheck size={16} /> اعتماد المسير
              </Button>
            )}
            {slips.length > 0 && (
              <>
                <Button
                  variant="outline"
                  disabled={!frozen}
                  title={frozen ? '' : 'يُصدَّر بعد الاعتماد'}
                  onClick={() => exportCsv(wps.table, `wps-workers-${period}`)}
                >
                  <Download size={16} /> ملف حماية الأجور (WPS)
                </Button>
                <Button
                  variant="ghost"
                  aria-label="طباعة المسير"
                  onClick={() => exportPdf(wps.table)}
                >
                  <Printer size={16} />
                </Button>
              </>
            )}
          </div>
        </div>
        {!frozen && pending.length > 0 && (
          <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle size={14} /> <span className="num">{pending.length}</span> تعديل بانتظار
            الاعتماد لن يدخل المسير حتى يُعتمد.
          </p>
        )}
        {run && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="العاملات" value={run.employee_count} icon={Users} />
            <StatTile label="الإجمالي" value={sar(run.total_gross)} icon={Wallet} />
            <StatTile
              label="الاستقطاعات"
              value={sar(run.total_deductions)}
              tone="danger"
              icon={Wallet}
            />
            <StatTile label="الصافي" value={sar(run.total_net)} tone="success" icon={Send} />
            <StatTile
              label="صرف نقدي / بلا آيبان"
              value={wps.flagged.length}
              tone={wps.flagged.length ? 'warning' : 'neutral'}
              icon={AlertTriangle}
            />
          </div>
        )}
        {isError ? (
          <Card className="flex items-center justify-between text-sm text-red-700">
            تعذّر تحميل المسير
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              إعادة المحاولة
            </Button>
          </Card>
        ) : (
          <Table
            columns={slipColumns}
            rows={slips}
            rowKey={(s) => s.worker_id}
            isLoading={isLoading}
            emptyTitle={run ? 'لا توجد قسائم' : 'لم يُحتسب مسير العاملات لهذا الشهر بعد'}
          />
        )}
        {frozen && (
          <p className="text-[11px] text-purple">
            المسير معتمد ومجمّد — الترحيل والصرف من شاشة «رواتب العاملات» في المحاسبة، والتصحيح
            بتعديل في الشهر التالي.
          </p>
        )}
      </Card>

      {adding && <WorkerAdjustmentModal period={period} onClose={() => setAdding(false)} />}
    </div>
  );
}

function WorkerAdjustmentModal({ period, onClose }: { period: string; onClose: () => void }) {
  const { data: all = [] } = useHouseWorkers();
  const workers = scopeToViewerBranch(all, (w) => w.branch);
  const submit = useSubmitWorkerAdjustment();
  const [workerId, setWorkerId] = useState('');
  const [type, setType] = useState<WorkerAdjType>('bonus');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!workerId) return setError('اختر العاملة');
    if (!(Number(amount) > 0)) return setError('المبلغ يجب أن يكون أكبر من صفر');
    if (!reason.trim()) return setError('اذكر سبب التعديل');
    setError(null);
    submit.mutate(
      { worker_id: workerId, type, amount: Number(amount), reason, period },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title={`تعديل على راتب عاملة — ${period}`}>
      <div className="space-y-3">
        <Select
          label="العاملة"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          options={[
            { value: '', label: 'اختر…' },
            ...workers.map((w) => ({
              value: w.id,
              label: `${w.full_name} — ${w.branch || 'بلا فرع'}`,
            })),
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="النوع"
            value={type}
            onChange={(e) => setType(e.target.value as WorkerAdjType)}
            options={(Object.keys(WORKER_ADJ_LABEL) as WorkerAdjType[]).map((t) => ({
              value: t,
              label: WORKER_ADJ_LABEL[t],
            }))}
          />
          <Input
            label="المبلغ"
            type="number"
            min={0}
            suffix="ر.س"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <Input label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="text-[11px] text-purple">
          يُرفع «بانتظار الاعتماد» ولا يؤثر على الراتب حتى يعتمده مدير الموارد البشرية.
        </p>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button className="w-full" loading={submit.isPending} onClick={save}>
          <Plus size={16} /> رفع التعديل للاعتماد
        </Button>
      </div>
    </Modal>
  );
}
