import { useMemo, useState } from 'react';
import { BookOpenText, CheckCircle2, Hourglass, Landmark, Link2, Wallet } from 'lucide-react';
import { Badge, Button, Card, Input, Select, StatTile } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePayrollRun } from '@/features/hr/hooks/useHr';
import { payrollPeriods } from '@/features/hr/api/hr.api';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@/features/hr/types';
import { accountName } from '@/features/accounting/data/chart';
import {
  buildPayrollEntry,
  buildPayrollPaymentEntry,
  totalsFromRun,
} from '@/features/accounting/data/payroll';
import { usePayPayrollRun, usePostPayrollRun } from '@/features/accounting/hooks/useAccounting';
import { useAccAccess } from '@/features/accounting/hooks/useAccountingPro';

const PERIODS = payrollPeriods();
const BANKS = [
  { value: '1112', label: 'البنك - مصرف الراجحي (1112)' },
  { value: '1113', label: 'البنك - البنك الأهلي (1113)' },
  { value: '1111', label: 'الصندوق (1111)' },
];

/**
 * Payroll in accounting: posts the APPROVED, frozen HR run from its totals
 * (accounting never opens individual payslips), then records the WPS transfer.
 * Mirror of post_payroll_run / pay_payroll_run (0071).
 */
export function PayrollScreen() {
  const { allowed } = useAccAccess();
  const canPost = allowed('gl', 'post');
  const canPay = allowed('bank', 'post');
  const [period, setPeriod] = useState(PERIODS[0] ?? '');
  const [bank, setBank] = useState('1112');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const { data, isLoading, isError, refetch } = usePayrollRun(period);
  const post = usePostPayrollRun();
  const pay = usePayPayrollRun();
  const run = data?.run ?? null;
  const totals = useMemo(() => (run ? totalsFromRun(run) : null), [run]);
  const accrual = useMemo(
    () => (totals ? buildPayrollEntry(totals, period, null) : null),
    [totals, period],
  );
  const payment = useMemo(
    () => (totals ? buildPayrollPaymentEntry(totals, period, paidOn, bank) : null),
    [totals, period, paidOn, bank],
  );
  const approved = !!run && run.status !== 'calculated';

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 border-teal/30 bg-teal-50/40 text-sm">
        <Link2 size={16} className="text-teal" />
        <span className="font-semibold text-navy">مصدر البيانات: مسير الموارد البشرية المعتمد</span>
        <span className="text-purple">
          — يُرحَّل القيد من إجماليات المسير المجمّدة بعد اعتماده، ثم يُسجَّل صرف الرواتب من البنك.
        </span>
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
      ) : !run || !totals || !accrual ? (
        <Card className="py-10 text-center text-sm text-purple">
          <Hourglass size={26} className="mx-auto mb-2 text-navy-200" />
          لم يُحتسب مسير {period} في الموارد البشرية بعد.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="عدد الموظفين" value={totals.count} />
            <StatTile label="مصروف الرواتب" value={sar(totals.earnings)} tone="danger" />
            <StatTile
              label="التأمينات (موظف + منشأة)"
              value={sar(totals.employeeGosi + totals.employerGosi)}
            />
            <StatTile label="سلف وجزاءات مقتطعة" value={sar(totals.advances + totals.penalties)} />
            <StatTile label="صافي الرواتب المستحق" value={sar(totals.payable)} tone="warning" />
          </div>

          {!approved && (
            <Card className="flex items-center gap-2 bg-amber-50 text-sm text-amber-700">
              <Hourglass size={16} /> المسير محتسب وبانتظار الاعتماد — لا يُرحَّل قبل اعتماده.
            </Card>
          )}

          <EntryCard
            title={`قيد استحقاق الرواتب — ${period}`}
            lines={accrual.lines}
            date={accrual.entry_date}
            done={!!run.posted_at}
            action={
              approved && !run.posted_at && canPost ? (
                <Button
                  loading={post.isPending}
                  onClick={() => post.mutate({ period, runId: run.id })}
                >
                  <BookOpenText size={16} /> ترحيل القيد
                </Button>
              ) : null
            }
            note="الإجازات والغياب تخفض المصروف · السلف تُسترد إلى 1160 · الجزاءات لصالح العمال (2170) لا إيراداً · الصافي المستحق (2130) = ما يُحوَّل للموظفين."
          />

          {run.posted_at && payment && (
            <EntryCard
              title="قيد صرف الرواتب (حماية الأجور)"
              lines={payment.lines}
              date={run.paid_at ?? paidOn}
              done={run.status === 'paid'}
              action={
                run.status !== 'paid' && canPay ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Select
                      label="من حساب"
                      value={bank}
                      onChange={(e) => setBank(e.target.value)}
                      options={BANKS}
                    />
                    <Input
                      label="تاريخ التحويل"
                      type="date"
                      value={paidOn}
                      onChange={(e) => setPaidOn(e.target.value)}
                    />
                    <Button
                      loading={pay.isPending}
                      onClick={() => pay.mutate({ period, runId: run.id, paidOn, bankCode: bank })}
                    >
                      <Landmark size={16} /> تسجيل الصرف
                    </Button>
                  </div>
                ) : null
              }
              note="يُطفئ الرواتب المستحقة (2130) من البنك بعد رفع ملف حماية الأجور."
            />
          )}
        </>
      )}
    </div>
  );
}

function EntryCard({
  title,
  lines,
  date,
  done,
  action,
  note,
}: {
  title: string;
  lines: { account_code: string; debit: number; credit: number }[];
  date: string;
  done: boolean;
  action: React.ReactNode;
  note: string;
}) {
  const totalD = lines.reduce((s, l) => s + l.debit, 0);
  const totalC = lines.reduce((s, l) => s + l.credit, 0);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Wallet size={16} /> {title}
          {done && (
            <Badge tone="success">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={12} /> مُرحَّل
              </span>
            </Badge>
          )}
        </h2>
        {action}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy-100 text-xs text-purple">
            <th className="py-2 text-right">الحساب</th>
            <th className="w-36 py-2 text-center">مدين</th>
            <th className="w-36 py-2 text-center">دائن</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-navy-50">
              <td className="py-2">
                <span className="num text-navy-300 text-xs">{l.account_code}</span>{' '}
                {accountName(l.account_code)}
              </td>
              <td className="num py-2 text-left text-green-600">
                {l.debit > 0 ? sar(l.debit) : '—'}
              </td>
              <td className="num py-2 text-left text-red-600">
                {l.credit > 0 ? sar(l.credit) : '—'}
              </td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="py-2">الإجمالي</td>
            <td className="py-2 text-center">
              <span className="num">{sar(totalD)}</span>
            </td>
            <td className="py-2 text-center">
              <span className="num">{sar(totalC)}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs leading-relaxed text-purple">
        {note} التاريخ: <span className="num">{dateAr(date)}</span>.
      </p>
    </Card>
  );
}
