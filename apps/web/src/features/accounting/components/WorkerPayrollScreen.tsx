import { useState } from 'react';
import { BookOpenText, Hourglass, Landmark, Link2, Split } from 'lucide-react';
import { Badge, Button, Card, Input, Select, StatTile } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { payrollPeriods } from '@/features/hr/api/hr.api';
import { useWorkerRun } from '@/features/hr/hooks/useWorkerPayroll';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@/features/hr/types';
import { usePayWorkerRun, usePostWorkerRun } from '@/features/accounting/hooks/useAccounting';
import { useAccAccess } from '@/features/accounting/hooks/useAccountingPro';

const PERIODS = payrollPeriods();
const BANKS = [
  { value: '1112', label: 'البنك - مصرف الراجحي (1112)' },
  { value: '1113', label: 'البنك - البنك الأهلي (1113)' },
  { value: '1111', label: 'الصندوق (1111)' },
];

/**
 * Workers payroll in accounting (0079): posts the APPROVED workers run —
 * DR 5120 «رواتب العمالة المنزلية» charged to each worker's branch — then
 * records the WPS transfer. Accounting works from the frozen totals.
 */
export function WorkerPayrollScreen() {
  const { allowed } = useAccAccess();
  const canPost = allowed('gl', 'post');
  const canPay = allowed('bank', 'post');
  const [period, setPeriod] = useState(PERIODS[0] ?? '');
  const [bank, setBank] = useState('1112');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const { data, isLoading, isError, refetch } = useWorkerRun(period);
  const post = usePostWorkerRun();
  const pay = usePayWorkerRun();
  const run = data?.run ?? null;
  const approved = !!run && run.status !== 'calculated';
  const payable = run
    ? Math.round((run.total_earnings - run.total_advances - run.total_penalties) * 100) / 100
    : 0;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 border-teal/30 bg-teal-50/40 text-sm">
        <Link2 size={16} className="text-teal" />
        <span className="font-semibold text-navy">
          مصدر البيانات: مسير العاملات المعتمد من الموارد البشرية
        </span>
        <span className="text-purple">— المصروف يُحمَّل على فرع كل عاملة آليًا.</span>
      </Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Select
          label="فترة المسير"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          options={PERIODS.map((p) => ({ value: p, label: p }))}
        />
        {run && <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>}
      </div>
      {isLoading ? (
        <Card className="py-10 text-center text-sm text-purple">جارٍ التحميل…</Card>
      ) : isError ? (
        <Card className="py-8 text-center text-sm text-red-600">
          تعذّر تحميل المسير.{' '}
          <button type="button" className="underline" onClick={() => void refetch()}>
            إعادة المحاولة
          </button>
        </Card>
      ) : !run ? (
        <Card className="py-10 text-center text-sm text-purple">
          لم يُحتسب مسير العاملات لهذا الشهر بعد.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="مصروف رواتب العمالة (5120)"
              value={sar(run.total_earnings)}
              icon={BookOpenText}
            />
            <StatTile label="سلف مستردة (1160)" value={sar(run.total_advances)} icon={Landmark} />
            <StatTile label="جزاءات (2170)" value={sar(run.total_penalties)} icon={Landmark} />
            <StatTile
              label="صافي مستحق الدفع (2130)"
              value={sar(payable)}
              tone="success"
              icon={Landmark}
            />
          </div>
          <Card className="flex items-center gap-2 text-xs text-purple">
            <Split size={14} /> القيد سطور لكل فرع (مركز تكلفة) بحسب فرع كل عاملة في المسير المجمّد.
          </Card>
          {!approved ? (
            <Card className="flex items-center gap-2 text-sm text-amber-700">
              <Hourglass size={16} /> بانتظار اعتماد المسير من الإدارة قبل الترحيل.
            </Card>
          ) : (
            <Card className="grid gap-3 sm:grid-cols-4">
              <div className="self-end">
                {run.posted_at ? (
                  <Badge tone="success">
                    مُرحَّل <span className="num">{dateAr(run.posted_at)}</span>
                  </Badge>
                ) : (
                  <Button
                    disabled={!canPost}
                    loading={post.isPending}
                    onClick={() => post.mutate({ period, runId: run.id })}
                  >
                    <BookOpenText size={16} /> ترحيل قيد الاستحقاق
                  </Button>
                )}
              </div>
              <Select
                label="حساب الصرف"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                options={BANKS}
              />
              <Input
                label="تاريخ الصرف"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
              <div className="self-end">
                {run.status === 'paid' ? (
                  <Badge tone="success">
                    مصروف <span className="num">{dateAr(run.paid_at ?? '')}</span>
                  </Badge>
                ) : (
                  <Button
                    variant="success"
                    disabled={!canPay || !run.posted_at}
                    loading={pay.isPending}
                    onClick={() => pay.mutate({ period, runId: run.id, paidOn, bankCode: bank })}
                  >
                    <Landmark size={16} /> تسجيل صرف الرواتب
                  </Button>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
