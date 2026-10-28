import { useMemo, useState } from 'react';
import {
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Lock,
  LockOpen,
  ScrollText,
} from 'lucide-react';
import { Badge, Button, Input, Select } from '@/shared/ui';
import {
  canClose,
  closeChecklist,
  openingBalances,
  periodsNeedingClose,
} from '@/features/accounting/data/periodClose';
import { trialBalancePro } from '@/features/accounting/data/ledger';
import { bookLines, reconciliationReport } from '@/features/accounting/data/bankrec';
import {
  useChart,
  useFixedAssets,
  useJournal,
  usePeriods,
  usePostedDepreciation,
  useVatReturns,
} from '@/features/accounting/hooks/useAccounting';
import {
  useAccAccess,
  useAccMutation,
  useMatches,
  useStatement,
  useWorkflow,
} from '@/features/accounting/hooks/useAccountingPro';
import * as pro from '@/features/accounting/api/accountingPro.api';
import {
  MONTH_AR,
  PERIOD_STATUS_LABEL,
  PERIOD_STATUS_TONE,
  type Period,
} from '@/features/accounting/types';
import {
  ConfirmModal,
  DataState,
  Money,
  SectionCard,
  todayIso,
} from '@/features/accounting/components/kit';

/** السنوات والفترات المالية: إقفال شهري بقائمة تحقق، إقفال سنوي، إعادة فتح بسبب وصلاحية. */
export function ClosingScreen() {
  const periodsQ = usePeriods();
  const journal = useJournal();
  const { data: chart = [] } = useChart();
  const { data: wf = [] } = useWorkflow();
  const { data: assets = [] } = useFixedAssets();
  const { data: depPosted = [] } = usePostedDepreciation();
  const { data: vat = [] } = useVatReturns();
  const { data: st } = useStatement('1112');
  const { data: matches = [] } = useMatches('1112');
  const { allowed, actor } = useAccAccess();
  const periods = periodsQ.data ?? [];
  const years = [...new Set(periods.map((p) => p.year))].sort();
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const [sel, setSel] = useState<Period | null>(null);
  const [confirm, setConfirm] = useState<'close' | 'reopen' | 'year' | null>(null);
  const [newYear, setNewYear] = useState(year + 1);

  const entries = journal.data ?? [];
  const balanced = useMemo(
    () => trialBalancePro(entries, chart, {}).totals.balanced,
    [entries, chart],
  );
  const bankOk = useMemo(() => {
    if (!st) return false;
    return reconciliationReport(bookLines(entries, '1112'), st.lines, matches, st.closing_balance)
      .complete;
  }, [st, entries, matches]);
  const checklist = sel
    ? closeChecklist({
        period: sel.id,
        pendingEntries: wf.filter((e) => ['draft', 'pending', 'approved'].includes(e.status)),
        depreciationPosted: depPosted.includes(sel.id),
        hasActiveAssets: assets.some((a) => a.status === 'active'),
        vatFiled: vat.some((v) => v.period === sel.id),
        bankReconciled: bankOk,
        ledgerBalanced: balanced,
      })
    : [];
  const opening = useMemo(() => openingBalances(entries, chart, year), [entries, chart, year]);
  const late = periodsNeedingClose(periods, todayIso());

  const close = useAccMutation((id: string) => pro.closePeriodChecked(id, actor), 'أُقفلت الفترة');
  const reopen = useAccMutation(
    (v: { id: string; reason: string }) => pro.reopenPeriod(v.id, v.reason, actor),
    'أُعيد فتح الفترة وسُجّل السبب',
  );
  const closeYear = useAccMutation(
    (y: number) => pro.closeFiscalYear(y, actor),
    (e) => (e ? `رُحّل ${e.description}` : 'أُقفلت السنة (لا أرباح/خسائر مفتوحة)'),
  );
  const addYear = useAccMutation(
    (y: number) => pro.createFiscalYear(y),
    'أُنشئت السنة المالية وفتراتها',
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-36">
          <Select
            label="السنة المالية"
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        </div>
        {allowed('close', 'approve') && (
          <>
            <div className="w-28">
              <Input
                label="سنة جديدة"
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(Number(e.target.value))}
              />
            </div>
            <Button variant="outline" onClick={() => addYear.mutate(newYear)}>
              <CalendarPlus size={15} /> إنشاء السنة المالية
            </Button>
            <Button variant="danger" onClick={() => setConfirm('year')}>
              <Lock size={15} /> إقفال سنة {year}
            </Button>
          </>
        )}
      </div>
      {late.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <CircleAlert size={14} /> {late.length} فترة منتهية ما زالت مفتوحة:{' '}
          {late.map((p) => p.id).join('، ')}
        </p>
      )}

      <DataState
        isLoading={periodsQ.isLoading}
        isError={periodsQ.isError}
        onRetry={() => void periodsQ.refetch()}
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <SectionCard title={`فترات ${year}`} icon={CalendarRange} className="xl:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {periods
                .filter((p) => p.year === year)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSel(p)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-right transition ${sel?.id === p.id ? 'border-navy ring-2 ring-navy-100' : 'border-navy-100 hover:bg-navy-50'}`}
                  >
                    <span className="font-semibold text-navy">{MONTH_AR[p.month - 1]}</span>
                    <Badge tone={PERIOD_STATUS_TONE[p.status]}>
                      {PERIOD_STATUS_LABEL[p.status]}
                    </Badge>
                  </button>
                ))}
            </div>
          </SectionCard>

          <SectionCard
            title={sel ? `إقفال ${MONTH_AR[sel.month - 1]} ${sel.year}` : 'اختر فترة'}
            icon={ScrollText}
          >
            {sel ? (
              <div className="space-y-3 text-sm">
                <ul className="space-y-1.5">
                  {checklist.map((c) => (
                    <li key={c.key} className="flex items-start gap-2">
                      {c.ok ? (
                        <CheckCircle2 size={15} className="mt-0.5 text-green-700" />
                      ) : c.blocking ? (
                        <CircleAlert size={15} className="mt-0.5 text-red-600" />
                      ) : (
                        <CircleDashed size={15} className="mt-0.5 text-amber-600" />
                      )}
                      <span>
                        {c.label}
                        {!c.ok && (
                          <span className="block text-[11px] text-purple">
                            {c.blocking ? 'مانع للإقفال' : 'تنبيه — لا يمنع الإقفال'}
                            {c.detail ? ` · ${c.detail}` : ''}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {sel.status === 'open'
                  ? allowed('close', 'approve') && (
                      <Button
                        className="w-full"
                        disabled={!canClose(checklist)}
                        onClick={() => setConfirm('close')}
                      >
                        <Lock size={15} /> إقفال الفترة
                      </Button>
                    )
                  : allowed('close', 'reopen') && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setConfirm('reopen')}
                      >
                        <LockOpen size={15} /> إعادة فتح (بصلاحية خاصة وسبب)
                      </Button>
                    )}
                <p className="text-xs text-purple">
                  الفترة المقفلة ترفض أي ترحيل (قيود، تحصيلات، إهلاك، توزيع). التصحيح بعد الإقفال
                  بقيد عكسي في فترة مفتوحة.
                </p>
              </div>
            ) : (
              <p className="text-sm text-purple">اختر شهرًا لعرض قائمة التحقق قبل الإقفال.</p>
            )}
          </SectionCard>
        </div>

        <SectionCard
          title={`الأرصدة الافتتاحية لسنة ${year} (= أرصدة نهاية ${year - 1})`}
          icon={ScrollText}
        >
          {opening.length ? (
            <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {opening.map((o) => (
                <li
                  key={o.code}
                  className="flex justify-between rounded-lg px-2 py-1 hover:bg-navy-50"
                >
                  <span>
                    <span className="num text-navy-300 text-xs">{o.code}</span> {o.name}
                  </span>
                  <Money v={o.amount} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-purple">
              لا أرصدة من سنة سابقة — أرصدة {year} الافتتاحية مسجلة بقيود افتتاحية داخل السنة.
            </p>
          )}
          <p className="mt-2 text-xs text-purple">
            الدفتر مستمر: أرصدة الميزانية تُرحّل تلقائيًا، وقيد إقفال السنة ينقل صافي الربح المفتوح
            إلى الأرباح المحتجزة 3200 دون تكرار الأرصدة.
          </p>
        </SectionCard>
      </DataState>

      {confirm === 'close' && sel && (
        <ConfirmModal
          title="تأكيد إقفال الفترة"
          message={`سيُقفل ${MONTH_AR[sel.month - 1]} ${sel.year} ولن يُقبل أي ترحيل فيه.`}
          confirmLabel="إقفال"
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            close.mutate(sel.id);
            setConfirm(null);
            setSel(null);
          }}
        />
      )}
      {confirm === 'reopen' && sel && (
        <ConfirmModal
          title="إعادة فتح فترة مقفلة"
          message="إعادة الفتح إجراء استثنائي يُسجّل في سجل التدقيق مع اسمك والوقت والسبب."
          confirmLabel="إعادة الفتح"
          requireReason
          danger
          onClose={() => setConfirm(null)}
          onConfirm={(reason) => {
            reopen.mutate({ id: sel.id, reason });
            setConfirm(null);
            setSel(null);
          }}
        />
      )}
      {confirm === 'year' && (
        <ConfirmModal
          title={`إقفال السنة المالية ${year}`}
          message="سيُرحّل قيد إقفال (الإيرادات والمصروفات ← الأرباح المحتجزة 3200) وتُقفل كل فترات السنة. يتطلب عدم وجود قيود معلّقة."
          confirmLabel="إقفال السنة"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            closeYear.mutate(year);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
