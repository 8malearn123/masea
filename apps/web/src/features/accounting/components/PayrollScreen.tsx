import { useMemo, useState } from 'react';
import { BookOpenText, CheckCircle2, Link2, Wallet } from 'lucide-react';
import { Badge, Button, Card, Select, Table, type Column } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useAdjustments, useEmployees } from '@/features/hr/hooks/useHr';
import { runPayroll } from '@/features/hr/api/hr.api';
import type { Payslip } from '@/features/hr/types';
import { accountName } from '@/features/accounting/data/chart';
import { buildPayrollEntry, employerGosi, payrollTotals } from '@/features/accounting/data/payroll';
import { usePostedPayroll, usePostPayroll } from '@/features/accounting/hooks/useAccounting';

const PERIODS = ['2026-04', '2026-05', '2026-06'] as const;

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

export function PayrollScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: employees = [], isLoading } = useEmployees();
  const { data: adjustments = [] } = useAdjustments();
  const { data: postedRefs = [] } = usePostedPayroll();
  const post = usePostPayroll();
  const [period, setPeriod] = useState('2026-06');

  const slips: Payslip[] = useMemo(
    () => runPayroll(employees, period, adjustments),
    [employees, period, adjustments],
  );
  const totals = useMemo(() => payrollTotals(slips), [slips]);
  const entry = useMemo(() => buildPayrollEntry(slips, period, null), [slips, period]);
  const isPosted = postedRefs.includes(`PAYROLL-${period}`);

  const columns: Column<Payslip>[] = [
    {
      key: 'employee_name',
      header: 'الموظف',
      cell: (p) => <span className="font-semibold text-navy">{p.employee_name}</span>,
    },
    {
      key: 'nationality',
      header: 'الجنسية',
      cell: (p) => (
        <Badge tone={p.nationality === 'السعودية' ? 'teal' : 'navy'}>{p.nationality}</Badge>
      ),
    },
    { key: 'gross', header: 'الإجمالي', cell: (p) => <span className="num">{sar(p.gross)}</span> },
    {
      key: 'ded',
      header: 'الاستقطاعات',
      cell: (p) => <span className="num text-red-600">{sar(p.total_deductions)}</span>,
    },
    {
      key: 'gosi_employee',
      header: 'تأمينات الموظف',
      cell: (p) => <span className="num text-purple">{sar(p.gosi_employee)}</span>,
    },
    {
      key: 'gosi_company',
      header: 'تأمينات الشركة',
      cell: (p) => <span className="num text-purple">{sar(employerGosi(p))}</span>,
    },
    {
      key: 'net',
      header: 'الصافي',
      cell: (p) => <span className="num font-bold text-navy">{sar(p.net)} ر.س</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 border-teal/30 bg-teal-50/40 text-sm">
        <Link2 size={16} className="text-teal" />
        <span className="font-semibold text-navy">مصدر البيانات: وحدة الموارد البشرية (٠٥)</span>
        <span className="text-purple">
          — الحضور والبدلات والتعديلات المعتمدة تأتي من مسير رواتب فريق الموارد البشرية، ويُرحَّل
          قيد الرواتب هنا.
        </span>
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Select
          label="فترة المسير"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          options={PERIODS.map((p) => ({ value: p, label: p }))}
        />
        {editable &&
          (isPosted ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">
              <CheckCircle2 size={14} /> مُرحَّل إلى دفتر اليومية
            </span>
          ) : (
            <Button onClick={() => post.mutate(entry)} disabled={slips.length === 0}>
              <BookOpenText size={16} /> ترحيل قيد الرواتب
            </Button>
          ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="عدد الموظفين" value={String(totals.count)} />
        <Stat label="مصروف الرواتب" value={sar(totals.earnings)} tone="text-red-600" />
        <Stat label="تأمينات الموظفين" value={sar(totals.employeeGosi)} tone="text-purple" />
        <Stat label="تأمينات الشركة" value={sar(totals.employerGosi)} tone="text-purple" />
        <Stat label="صافي الرواتب المستحق" value={sar(totals.payable)} tone="text-gold-600" />
      </div>

      <Table
        columns={columns}
        rows={slips}
        rowKey={(p) => p.employee_id}
        isLoading={isLoading}
        emptyTitle="لا يوجد مسير رواتب"
      />

      {/* the resulting accrual journal entry */}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <Wallet size={16} /> قيد الرواتب — {period}{' '}
          {isPosted && <Badge tone="success">مُرحَّل</Badge>}
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-xs text-purple">
              <th className="py-2 text-right">الحساب</th>
              <th className="py-2 text-left">مدين</th>
              <th className="py-2 text-left">دائن</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => (
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
          </tbody>
        </table>
        <p className="mt-3 text-xs leading-relaxed text-purple">
          مدين مصروف الرواتب (٥١٠٠) وحصة الشركة من التأمينات (٥٢٠٠) / دائن التأمينات المستحقة (٢١٤٠)
          والرواتب المستحقة (٢١٣٠). التاريخ: {dateAr(entry.entry_date)}.
        </p>
      </Card>
    </div>
  );
}
