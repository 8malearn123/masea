import { useMemo, useState } from 'react';
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  FileText,
  HandCoins,
  Scale,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import {
  agingOf,
  apOpenItems,
  arOpenItems,
  controlReconciliation,
  partyBalances,
  partyStatement,
  paymentSchedule,
  remindersDue,
  type OpenItem,
  type PartyBalance,
} from '@/features/accounting/data/receivables';
import { AGING_LABEL, type AgingBucketKey } from '@/features/accounting/types';
import {
  useBills,
  useChart,
  useInvoices,
  useJournal,
} from '@/features/accounting/hooks/useAccounting';
import {
  useAccAccess,
  useAccConfig,
  useAccMutation,
  useApSchedule,
  useCreditLimits,
  useReminders,
} from '@/features/accounting/hooks/useAccountingPro';
import * as pro from '@/features/accounting/api/accountingPro.api';
import { listCustomerReceipts } from '@/shared/lib/salesLedger';
import {
  DataState,
  ExportButtons,
  Money,
  SearchInput,
  SectionCard,
  todayIso,
} from '@/features/accounting/components/kit';

const BUCKETS: AgingBucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

/** ذمم العملاء (side='ar') أو ذمم الموردين (side='ap') — same layout, one module. */
export function ReceivablesScreen({ side }: { side: 'ar' | 'ap' }) {
  const invQ = useInvoices();
  const billQ = useBills();
  const journal = useJournal();
  const { data: chart = [] } = useChart();
  const { data: limits = {} } = useCreditLimits();
  const { data: reminders = [] } = useReminders();
  const { data: schedule = {} } = useApSchedule();
  const { allowed, actor } = useAccAccess();
  const cfg = useAccConfig();
  const [asOf, setAsOf] = useState(todayIso());
  const [q, setQ] = useState('');
  const [statementOf, setStatementOf] = useState<string | null>(null);
  const [collect, setCollect] = useState<OpenItem | null>(null);
  const [limitOf, setLimitOf] = useState<PartyBalance | null>(null);
  const [plan, setPlan] = useState<OpenItem | null>(null);

  const invoices = invQ.data ?? [];
  const bills = billQ.data ?? [];
  const items = useMemo(
    () => (side === 'ar' ? arOpenItems(invoices, asOf) : apOpenItems(bills, asOf)),
    [side, invoices, bills, asOf],
  );
  const aging = useMemo(() => agingOf(items, asOf), [items, asOf]);
  const parties = useMemo(
    () => partyBalances(items, side === 'ar' ? limits : {}),
    [items, limits, side],
  );
  const control = useMemo(
    () =>
      controlReconciliation(journal.data ?? [], chart, invoices, bills, asOf).find(
        (c) => c.account === (side === 'ar' ? '1120' : '2110'),
      ),
    [journal.data, chart, invoices, bills, asOf, side],
  );
  const lastReminded = Object.fromEntries(reminders.map((r) => [r.invoice_id, r.at]));
  const due = side === 'ar' ? remindersDue(items, cfg.reminderAfterDays, lastReminded, asOf) : [];
  const weeks = side === 'ap' ? paymentSchedule(items, schedule) : [];
  const remind = useAccMutation(
    (id: string) => pro.queueReminder(id, actor),
    'أُضيف التذكير لقائمة الإرسال',
  );
  const remindAll = useAccMutation(
    (ids: string[]) => ids.forEach((id) => pro.queueReminder(id, actor)),
    'أُضيفت التذكيرات لقائمة الإرسال',
  );
  const visible = items.filter(
    (i) => !q || i.party.includes(q) || String(i.no) === q.replace('#', ''),
  );

  const columns: Column<OpenItem>[] = [
    {
      key: 'no',
      header: side === 'ar' ? 'الفاتورة' : 'فاتورة المورد',
      cell: (i) => <span className="num font-semibold">#{i.no}</span>,
      sortValue: (i) => i.no,
    },
    {
      key: 'party',
      header: side === 'ar' ? 'العميل' : 'المورد',
      sortValue: (i) => i.party,
      cell: (i) => (
        <button
          type="button"
          className="text-navy hover:underline"
          onClick={() => setStatementOf(i.party)}
        >
          {i.party}
        </button>
      ),
    },
    {
      key: 'due',
      header: 'الاستحقاق',
      cell: (i) => <span className="num text-xs">{dateAr(i.due_date)}</span>,
      sortValue: (i) => i.due_date,
    },
    { key: 'total', header: 'الإجمالي', cell: (i) => <Money v={i.total} /> },
    { key: 'paid', header: 'المسدد', cell: (i) => <Money v={i.paid} className="text-green-700" /> },
    {
      key: 'out',
      header: 'المتبقي',
      cell: (i) => <Money v={i.outstanding} className="font-bold text-navy" />,
      sortValue: (i) => i.outstanding,
    },
    {
      key: 'age',
      header: 'العمر',
      sortValue: (i) => i.days_overdue,
      cell: (i) => (
        <Badge tone={i.bucket === 'current' ? 'success' : i.bucket === 'd1_30' ? 'gold' : 'danger'}>
          {i.days_overdue > 0 ? `متأخرة ${i.days_overdue} يوم` : 'لم يحل أجلها'}
        </Badge>
      ),
    },
    ...(side === 'ap'
      ? [
          {
            key: 'plan',
            header: 'موعد الدفع المخطط',
            cell: (i: OpenItem) => <span className="num text-xs">{schedule[i.id] ?? '—'}</span>,
          },
        ]
      : []),
    {
      key: 'a',
      header: '',
      cell: (i) => (
        <div className="flex gap-1">
          {side === 'ar' && allowed('ar', 'create') && (
            <>
              <Button size="sm" variant="outline" onClick={() => setCollect(i)}>
                <HandCoins size={13} /> تحصيل
              </Button>
              {i.days_overdue > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remind.mutate(i.id)}
                  title={lastReminded[i.id] ? `آخر تذكير ${lastReminded[i.id]}` : ''}
                >
                  <BellRing size={13} />
                </Button>
              )}
            </>
          )}
          {side === 'ap' && allowed('ap', 'edit') && (
            <Button size="sm" variant="outline" onClick={() => setPlan(i)}>
              <CalendarClock size={13} /> جدولة
            </Button>
          )}
        </div>
      ),
    },
  ];

  const build = () => ({
    title: side === 'ar' ? 'ذمم العملاء — الفواتير المفتوحة' : 'ذمم الموردين — الفواتير المفتوحة',
    subtitle: `حتى ${asOf}`,
    headers: ['الرقم', 'الطرف', 'الاستحقاق', 'الإجمالي', 'المسدد', 'المتبقي', 'أيام التأخير'],
    rows: visible.map((i) => [
      i.no,
      i.party,
      i.due_date,
      i.total,
      i.paid,
      i.outstanding,
      i.days_overdue,
    ]),
    footer: ['', 'الإجمالي', '', '', '', aging.total, ''],
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input
            label="حتى تاريخ"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        {control && (
          <span
            className={`mb-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${control.matched ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
          >
            {control.matched ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            {control.matched
              ? `مطابق لحساب الرقابة ${control.account} في الأستاذ العام`
              : `فرق ${sar(control.difference)} مع حساب الرقابة ${control.account}`}
          </span>
        )}
      </div>

      <DataState
        isLoading={invQ.isLoading || billQ.isLoading}
        isError={invQ.isError || billQ.isError}
        onRetry={() => void invQ.refetch()}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {BUCKETS.map((b) => (
            <div key={b} className="rounded-2xl bg-white p-3 shadow-card">
              <p className="text-xs text-purple">{AGING_LABEL[b]}</p>
              <Money
                v={aging[b]}
                className={`text-lg font-bold ${b === 'current' ? 'text-navy' : b === 'd1_30' ? 'text-gold-600' : 'text-red-600'}`}
              />
            </div>
          ))}
          <div className="rounded-2xl bg-navy p-3 text-white shadow-card">
            <p className="text-xs opacity-80">الإجمالي</p>
            <span className="num text-lg font-bold">{sar(aging.total)}</span>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <SectionCard
            title={side === 'ar' ? 'أرصدة العملاء وحدود الائتمان' : 'أرصدة الموردين'}
            icon={Users}
            className="xl:col-span-1"
          >
            <ul className="divide-y divide-navy-50 text-sm">
              {parties.map((p) => (
                <li key={p.party} className="flex items-center justify-between gap-2 py-2">
                  <button
                    type="button"
                    onClick={() => setStatementOf(p.party)}
                    className="text-right hover:underline"
                  >
                    <span className="font-semibold text-navy">{p.party}</span>
                    <span className="block text-[11px] text-purple">
                      {p.items} مستند · متأخر <span className="num">{sar(p.overdue)}</span>
                      {side === 'ar' &&
                        (p.creditLimit !== null ? (
                          <>
                            {' '}
                            · الحد <span className="num">{sar(p.creditLimit)}</span>
                          </>
                        ) : (
                          ' · بلا حد ائتماني'
                        ))}
                    </span>
                  </button>
                  <span className="flex items-center gap-1">
                    {p.overLimit && (
                      <Badge tone="danger">
                        <ShieldAlert size={11} className="ml-0.5" /> تجاوز الحد
                      </Badge>
                    )}
                    <Money v={p.outstanding} className="font-bold" />
                    {side === 'ar' && allowed('ar', 'edit') && (
                      <button
                        type="button"
                        className="text-xs text-navy underline"
                        onClick={() => setLimitOf(p)}
                      >
                        الحد
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {!parties.length && <li className="py-4 text-center text-purple">لا أرصدة مفتوحة</li>}
            </ul>
          </SectionCard>

          <SectionCard
            title={
              side === 'ar' ? 'الفواتير المفتوحة ومتابعة المتأخرات' : 'المستحقات وتواريخ الاستحقاق'
            }
            icon={FileText}
            className="xl:col-span-2"
            actions={
              <>
                <SearchInput value={q} onChange={setQ} placeholder="بحث بالاسم أو الرقم" />
                <ExportButtons build={build} />
                {side === 'ar' && due.length > 0 && allowed('ar', 'create') && (
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => remindAll.mutate(due.map((d) => d.id))}
                  >
                    <BellRing size={13} /> تذكير {due.length} متأخر
                  </Button>
                )}
              </>
            }
          >
            <Table
              columns={columns}
              rows={visible}
              rowKey={(i) => i.id}
              emptyTitle="لا مستندات مفتوحة"
            />
            {side === 'ar' && (
              <p className="mt-2 text-xs text-purple">
                التذكير يُضاف لقائمة الإرسال (SMS) ويُرسل فعليًا عند ربط مزوّد الرسائل. التذكير
                الآلي بعد {cfg.reminderAfterDays} يوم تأخر (من الإعدادات).
              </p>
            )}
          </SectionCard>
        </div>

        {side === 'ap' && (
          <SectionCard title="جدولة المدفوعات الأسبوعية" icon={CalendarClock}>
            <Table
              columns={[
                {
                  key: 'w',
                  header: 'الأسبوع (يبدأ الأحد)',
                  cell: (w) => <span className="num">{w.week}</span>,
                },
                {
                  key: 'n',
                  header: 'عدد الفواتير',
                  cell: (w) => <span className="num">{w.bills}</span>,
                },
                {
                  key: 'a',
                  header: 'المبلغ المطلوب',
                  cell: (w) => <Money v={w.amount} className="font-bold" />,
                },
              ]}
              rows={weeks}
              rowKey={(w) => w.week}
              emptyTitle="لا مدفوعات مجدولة"
            />
          </SectionCard>
        )}
      </DataState>

      {statementOf && (
        <StatementModal side={side} party={statementOf} onClose={() => setStatementOf(null)} />
      )}
      {collect && <CollectModal item={collect} onClose={() => setCollect(null)} />}
      {limitOf && <LimitModal party={limitOf} onClose={() => setLimitOf(null)} />}
      {plan && (
        <PlanModal
          item={plan}
          current={schedule[plan.id] ?? plan.due_date}
          onClose={() => setPlan(null)}
        />
      )}
    </div>
  );
}

function StatementModal({
  side,
  party,
  onClose,
}: {
  side: 'ar' | 'ap';
  party: string;
  onClose: () => void;
}) {
  const { data: invoices = [] } = useInvoices();
  const { data: bills = [] } = useBills();
  const rows = useMemo(() => {
    if (side === 'ar') {
      const docs = invoices
        .filter((i) => i.customer_name === party && i.status !== 'void')
        .map((i) => ({
          id: i.id,
          date: i.issue_date,
          ref: `INV-${i.invoice_no}`,
          description: `فاتورة #${i.invoice_no}`,
          amount: i.total,
          paid: i.amount_paid,
        }));
      const pays = listCustomerReceipts()
        .filter((r) => r.customer_name === party)
        .map((r) => ({
          date: r.paid_at,
          ref: r.reference_no,
          amount: r.amount,
          doc_id: r.sale_id,
        }));
      return partyStatement(docs, pays, 'ar');
    }
    const docs = bills
      .filter((b) => b.vendor_name === party && b.status !== 'void')
      .map((b) => ({
        id: b.id,
        date: b.issue_date,
        ref: `BILL-${b.bill_no}`,
        description: `فاتورة مورد #${b.bill_no}`,
        amount: b.total,
        paid: b.amount_paid,
      }));
    return partyStatement(docs, [], 'ap');
  }, [side, party, invoices, bills]);
  const build = () => ({
    title: `كشف حساب ${side === 'ar' ? 'العميل' : 'المورد'}: ${party}`,
    headers: ['التاريخ', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد'],
    rows: rows.map((r) => [r.date, r.ref, r.description, r.debit, r.credit, r.balance]),
  });
  return (
    <Modal open onClose={onClose} size="lg" title={`كشف حساب: ${party}`}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto">
        <div className="flex justify-end">
          <ExportButtons build={build} />
        </div>
        <Table
          columns={[
            {
              key: 'd',
              header: 'التاريخ',
              cell: (r) => <span className="num text-xs">{r.date}</span>,
            },
            {
              key: 'r',
              header: 'المرجع',
              cell: (r) => <span className="num text-xs">{r.ref}</span>,
            },
            { key: 's', header: 'البيان', cell: (r) => r.description },
            { key: 'dr', header: 'مدين', cell: (r) => (r.debit ? <Money v={r.debit} /> : '—') },
            { key: 'cr', header: 'دائن', cell: (r) => (r.credit ? <Money v={r.credit} /> : '—') },
            {
              key: 'b',
              header: 'الرصيد',
              cell: (r) => <Money v={r.balance} className="font-bold" />,
            },
          ]}
          rows={rows}
          rowKey={(r) => `${r.ref}-${r.date}-${r.balance}`}
          emptyTitle="لا حركات"
        />
      </div>
    </Modal>
  );
}

function CollectModal({ item, onClose }: { item: OpenItem; onClose: () => void }) {
  const { actor } = useAccAccess();
  const [amount, setAmount] = useState(item.outstanding);
  const [method, setMethod] = useState('transfer');
  const [date, setDate] = useState(todayIso());
  const save = useAccMutation(
    () => pro.recordCollection(item.id, amount, method, date, actor),
    'سُجّل التحصيل ورُحّل',
  );
  return (
    <Modal open onClose={onClose} title={`تحصيل — فاتورة #${item.no} (${item.party})`}>
      <div className="space-y-3">
        <p className="text-sm text-purple">
          المتبقي: <span className="num font-bold text-navy">{sar(item.outstanding)}</span> ر.س —
          الدفعات الجزئية مسموحة.
        </p>
        <Input
          label="المبلغ"
          type="number"
          min={0}
          max={item.outstanding}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
        <Select
          label="طريقة الدفع"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          options={[
            { value: 'transfer', label: 'تحويل بنكي' },
            { value: 'cash', label: 'نقدًا' },
            { value: 'mada', label: 'مدى' },
            { value: 'apple_pay', label: 'Apple Pay' },
            { value: 'tamara', label: 'تمارا' },
          ]}
        />
        <Input label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button
          className="w-full"
          disabled={amount <= 0 || amount > item.outstanding}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          <HandCoins size={15} /> تسجيل التحصيل (مدين النقدية / دائن ذمم العملاء)
        </Button>
      </div>
    </Modal>
  );
}

function LimitModal({ party, onClose }: { party: PartyBalance; onClose: () => void }) {
  const { actor } = useAccAccess();
  const [limit, setLimit] = useState(party.creditLimit ?? 0);
  const save = useAccMutation(
    (v: number | null) => pro.setCreditLimit(party.party, v, actor),
    'حُدّث حد الائتمان',
  );
  return (
    <Modal open onClose={onClose} title={`حد الائتمان — ${party.party}`}>
      <div className="space-y-3">
        <Input
          label="الحد (ريال)"
          type="number"
          min={0}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        />
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => save.mutate(limit, { onSuccess: onClose })}>
            حفظ
          </Button>
          <Button variant="ghost" onClick={() => save.mutate(null, { onSuccess: onClose })}>
            إزالة الحد
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PlanModal({
  item,
  current,
  onClose,
}: {
  item: OpenItem;
  current: string;
  onClose: () => void;
}) {
  const { actor } = useAccAccess();
  const [date, setDate] = useState(current);
  const save = useAccMutation(
    (d: string | null) => pro.scheduleBillPayment(item.id, d, actor),
    'حُدّثت جدولة الدفع',
  );
  return (
    <Modal open onClose={onClose} title={`جدولة دفع فاتورة #${item.no} — ${item.party}`}>
      <div className="space-y-3">
        <p className="text-sm text-purple">
          الاستحقاق: <span className="num">{item.due_date}</span> · المتبقي{' '}
          <span className="num font-bold">{sar(item.outstanding)}</span>
        </p>
        <Input
          label="موعد الدفع المخطط"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Button className="w-full" onClick={() => save.mutate(date, { onSuccess: onClose })}>
          <Scale size={15} /> حفظ الجدولة
        </Button>
        <p className="text-xs text-purple">الدفع الفعلي يتم عبر «سندات الموردين» ويُرحّل هناك.</p>
      </div>
    </Modal>
  );
}
