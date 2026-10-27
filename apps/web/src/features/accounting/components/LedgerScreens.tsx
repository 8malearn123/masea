import { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, ExternalLink, Paperclip, Scale, XCircle } from 'lucide-react';
import { Badge, Modal, Select, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { accountName } from '@/features/accounting/data/chart';
import {
  compareBalances,
  generalLedger,
  trialBalancePro,
  type GlRow,
  type TbProRow,
} from '@/features/accounting/data/ledger';
import { previousWindow } from '@/features/accounting/data/analytics';
import { useChart, useJournal } from '@/features/accounting/hooks/useAccounting';
import { useWorkflow } from '@/features/accounting/hooks/useAccountingPro';
import {
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPE_TONE,
  ENTRY_KIND_LABEL,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  SOURCE_LABEL,
  type JournalEntry,
} from '@/features/accounting/types';
import {
  DataState,
  ExportButtons,
  FilterBar,
  Money,
  SearchInput,
  SectionCard,
  defaultRange,
  rangeLabel,
  toLedger,
  type RangeFilter,
} from '@/features/accounting/components/kit';

/* ----------------------------- entry detail ------------------------------ */
/** Opens the original entry (from GL rows, statements drill-down, alerts…). */
export function EntryDetailModal({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { data: journal = [] } = useJournal();
  const { data: wf = [] } = useWorkflow();
  const entry: JournalEntry | undefined =
    wf.find((e) => e.id === entryId) ?? journal.find((e) => e.id === entryId);
  if (!entry) return null;
  const debit = entry.lines.reduce((s, l) => s + l.debit, 0);
  const credit = entry.lines.reduce((s, l) => s + l.credit, 0);
  return (
    <Modal open onClose={onClose} size="lg" title={`قيد #${entry.entry_no} — ${entry.description}`}>
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pl-1 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone={ENTRY_STATUS_TONE[entry.status]}>{ENTRY_STATUS_LABEL[entry.status]}</Badge>
          <Badge tone="teal">{SOURCE_LABEL[entry.source_type]}</Badge>
          {entry.kind && <Badge tone="navy">{ENTRY_KIND_LABEL[entry.kind]}</Badge>}
          {entry.reversal_of && <Badge tone="gold">يعكس قيدًا سابقًا</Badge>}
          {entry.reversed_by && <Badge tone="danger">معكوس</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <Meta k="التاريخ" v={dateAr(entry.entry_date)} />
          <Meta k="المرجع" v={entry.reference ?? '—'} />
          <Meta k="مركز التكلفة" v={entry.branch ?? 'المركز الرئيسي'} />
          {entry.cost_center && <Meta k="المشروع/القسم" v={entry.cost_center} />}
          {entry.created_by && <Meta k="أنشأه" v={entry.created_by} />}
          {entry.approved_by && <Meta k="اعتمده" v={entry.approved_by} />}
        </dl>
        <table className="w-full">
          <thead>
            <tr className="border-b border-navy-100 text-xs text-purple">
              <th className="py-2 text-right">الحساب</th>
              <th className="py-2 text-right">البيان</th>
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
                  {l.branch !== undefined && (
                    <span className="mr-1 text-[10px] text-purple">({l.branch ?? 'المركز'})</span>
                  )}
                </td>
                <td className="py-2 text-xs text-purple">{l.description ?? ''}</td>
                <td className="num py-2 text-left text-green-700">
                  {l.debit > 0 ? sar(l.debit) : '—'}
                </td>
                <td className="num py-2 text-left text-red-600">
                  {l.credit > 0 ? sar(l.credit) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold text-navy">
              <td className="py-2" colSpan={2}>
                الإجمالي
              </td>
              <td className="num py-2 text-left">{sar(debit)}</td>
              <td className="num py-2 text-left">{sar(credit)}</td>
            </tr>
          </tfoot>
        </table>
        {!!entry.attachments?.length && (
          <div>
            <p className="mb-1 text-xs font-semibold text-navy">المرفقات</p>
            <ul className="space-y-1 text-xs">
              {entry.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-1 text-purple">
                  <Paperclip size={12} /> {a.name}{' '}
                  <span className="num">({Math.ceil(a.size / 1024)} KB)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {entry.status === 'posted' && (
          <p className="rounded-xl bg-navy-50 px-3 py-2 text-xs text-purple">
            القيد المرحّل محمي من التعديل والحذف؛ التصحيح بقيد عكسي أو تسوية معتمدة من شاشة القيود.
          </p>
        )}
      </div>
    </Modal>
  );
}
const Meta = ({ k, v }: { k: string; v: string }) => (
  <div>
    <dt className="text-purple">{k}</dt>
    <dd className="font-medium text-navy">{v}</dd>
  </div>
);

/* ------------------------------ general ledger --------------------------- */
export function GeneralLedgerScreen({ initialAccount }: { initialAccount?: string | undefined }) {
  const journal = useJournal();
  const { data: chart = [] } = useChart();
  const postable = chart.filter((a) => a.is_postable);
  const [code, setCode] = useState(initialAccount ?? '1112');
  const [f, setF] = useState<RangeFilter>(defaultRange);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const gl = useMemo(
    () => generalLedger(journal.data ?? [], code, chart, toLedger(f), q),
    [journal.data, code, chart, f, q],
  );

  const columns: Column<GlRow>[] = [
    {
      key: 'date',
      header: 'التاريخ',
      cell: (r) => <span className="num text-xs">{dateAr(r.date)}</span>,
      sortValue: (r) => r.date,
    },
    {
      key: 'entry_no',
      header: 'رقم القيد',
      cell: (r) => <span className="num">#{r.entry_no}</span>,
      sortValue: (r) => r.entry_no,
    },
    {
      key: 'reference',
      header: 'المرجع',
      cell: (r) => <span className="num text-xs">{r.reference ?? '—'}</span>,
    },
    {
      key: 'description',
      header: 'الوصف',
      cell: (r) => <span className="text-navy-900">{r.description}</span>,
    },
    { key: 'branch', header: 'الفرع', cell: (r) => r.branch ?? 'المركز' },
    {
      key: 'debit',
      header: 'مدين',
      cell: (r) => (r.debit ? <Money v={r.debit} className="text-green-700" /> : '—'),
      sortValue: (r) => r.debit,
    },
    {
      key: 'credit',
      header: 'دائن',
      cell: (r) => (r.credit ? <Money v={r.credit} className="text-red-600" /> : '—'),
      sortValue: (r) => r.credit,
    },
    {
      key: 'balance',
      header: 'الرصيد التراكمي',
      cell: (r) => <Money v={r.balance} className="font-bold text-navy" />,
    },
    {
      key: 'open',
      header: '',
      cell: (r) => (
        <button
          type="button"
          onClick={() => setOpen(r.entry_id)}
          className="text-navy hover:text-navy-700"
          title="فتح القيد الأصلي"
          aria-label="فتح القيد الأصلي"
        >
          <ExternalLink size={14} />
        </button>
      ),
    },
  ];

  const build = () => ({
    title: `الأستاذ العام — ${code} ${gl.account?.name_ar ?? ''}`,
    subtitle: `${rangeLabel(f)} · رصيد افتتاحي ${sar(gl.opening)}`,
    headers: ['التاريخ', 'رقم القيد', 'المرجع', 'الوصف', 'مدين', 'دائن', 'الرصيد'],
    rows: gl.rows.map((r) => [
      r.date,
      r.entry_no,
      r.reference ?? '',
      r.description,
      r.debit,
      r.credit,
      r.balance,
    ]),
    footer: ['الإجمالي', '', '', '', gl.totalDebit, gl.totalCredit, gl.closing],
  });

  return (
    <div className="space-y-4">
      <FilterBar
        value={f}
        onChange={setF}
        extra={
          <div className="w-64">
            <Select
              label="الحساب"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              options={postable.map((a) => ({ value: a.code, label: `${a.code} — ${a.name_ar}` }))}
            />
          </div>
        }
      />
      <SectionCard
        title={`الأستاذ العام — ${code} ${gl.account?.name_ar ?? ''}`}
        icon={BookOpen}
        actions={
          <>
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="بحث بالوصف أو المرجع أو رقم القيد"
            />
            <ExportButtons build={build} />
          </>
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Fig label="الرصيد الافتتاحي" v={gl.opening} />
          <Fig label="إجمالي المدين" v={gl.totalDebit} />
          <Fig label="إجمالي الدائن" v={gl.totalCredit} />
          <Fig label="الرصيد الختامي" v={gl.closing} strong />
        </div>
        <Table
          columns={columns}
          rows={gl.rows}
          rowKey={(r) => r.key}
          isLoading={journal.isLoading}
          isError={journal.isError}
          onRetry={() => void journal.refetch()}
          emptyTitle="لا حركات على الحساب في النطاق"
        />
      </SectionCard>
      {open && <EntryDetailModal entryId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Fig({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-navy-50 px-3 py-2">
      <p className="text-purple">{label}</p>
      <Money
        v={v}
        className={`text-sm ${strong ? 'font-bold text-navy' : 'font-semibold text-navy-900'}`}
      />
    </div>
  );
}

/* ------------------------------ trial balance ---------------------------- */
export function TrialBalanceProScreen({
  onOpenAccount,
}: {
  onOpenAccount: (code: string) => void;
}) {
  const journal = useJournal();
  const { data: chart = [] } = useChart();
  const [f, setF] = useState<RangeFilter>(defaultRange);
  const [level, setLevel] = useState<'all' | 'postable' | 'main'>('all');
  const [compare, setCompare] = useState(false);

  const tb = useMemo(
    () => trialBalancePro(journal.data ?? [], chart, toLedger(f)),
    [journal.data, chart, f],
  );
  const prev = previousWindow(f.from, f.to);
  const cmp = useMemo(
    () =>
      compare
        ? compareBalances(
            journal.data ?? [],
            chart,
            { ...toLedger(f), from: undefined },
            { ...toLedger(f), from: undefined, to: prev.to },
          )
        : [],
    [compare, journal.data, chart, f, prev.to],
  );
  const rows = tb.rows.filter((r) =>
    level === 'postable' ? r.is_postable : level === 'main' ? !r.is_postable : true,
  );
  const cmpBy = new Map(cmp.map((c) => [c.code, c]));

  const columns: Column<TbProRow>[] = [
    {
      key: 'code',
      header: 'الحساب',
      sortValue: (r) => r.code,
      cell: (r) => (
        <span
          className={r.is_postable ? '' : 'font-bold text-navy'}
          style={{ paddingRight: r.level * 14 }}
        >
          <span className="num text-navy-300 text-xs">{r.code}</span>{' '}
          {r.is_postable ? (
            <button type="button" className="hover:underline" onClick={() => onOpenAccount(r.code)}>
              {r.name}
            </button>
          ) : (
            r.name
          )}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'النوع',
      cell: (r) => <Badge tone={ACCOUNT_TYPE_TONE[r.type]}>{ACCOUNT_TYPE_LABEL[r.type]}</Badge>,
    },
    { key: 'od', header: 'افتتاحي مدين', cell: (r) => <Money v={r.openingDebit} /> },
    { key: 'oc', header: 'افتتاحي دائن', cell: (r) => <Money v={r.openingCredit} /> },
    {
      key: 'pd',
      header: 'حركة مدين',
      cell: (r) => <Money v={r.periodDebit} className="text-green-700" />,
      sortValue: (r) => r.periodDebit,
    },
    {
      key: 'pc',
      header: 'حركة دائن',
      cell: (r) => <Money v={r.periodCredit} className="text-red-600" />,
      sortValue: (r) => r.periodCredit,
    },
    {
      key: 'cd',
      header: 'ختامي مدين',
      cell: (r) => <Money v={r.closingDebit} className="font-semibold" />,
    },
    {
      key: 'cc',
      header: 'ختامي دائن',
      cell: (r) => <Money v={r.closingCredit} className="font-semibold" />,
    },
    ...(compare
      ? [
          {
            key: 'prev',
            header: `الرصيد حتى ${prev.to}`,
            cell: (r: TbProRow) => (
              <Money v={cmpBy.get(r.code)?.previous ?? 0} className="text-purple" />
            ),
          },
          {
            key: 'diff',
            header: 'التغير',
            cell: (r: TbProRow) => <Money v={cmpBy.get(r.code)?.diff ?? 0} />,
          },
        ]
      : []),
  ];

  const t = tb.totals;
  const build = () => ({
    title: 'ميزان المراجعة',
    subtitle: rangeLabel(f),
    headers: [
      'الرمز',
      'الحساب',
      'افتتاحي مدين',
      'افتتاحي دائن',
      'حركة مدين',
      'حركة دائن',
      'ختامي مدين',
      'ختامي دائن',
    ],
    rows: rows.map((r) => [
      r.code,
      r.name,
      r.openingDebit,
      r.openingCredit,
      r.periodDebit,
      r.periodCredit,
      r.closingDebit,
      r.closingCredit,
    ]),
    footer: [
      '',
      'الإجمالي (الحسابات الفرعية)',
      t.openingDebit,
      t.openingCredit,
      t.periodDebit,
      t.periodCredit,
      t.closingDebit,
      t.closingCredit,
    ],
  });

  return (
    <div className="space-y-4">
      <FilterBar
        value={f}
        onChange={setF}
        extra={
          <>
            <div className="w-44">
              <Select
                label="العرض"
                value={level}
                onChange={(e) => setLevel(e.target.value as typeof level)}
                options={[
                  { value: 'all', label: 'رئيسية وفرعية' },
                  { value: 'postable', label: 'الفرعية فقط' },
                  { value: 'main', label: 'الرئيسية فقط' },
                ]}
              />
            </div>
            <label className="mb-2 flex items-center gap-1.5 text-xs text-navy">
              <input
                type="checkbox"
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
              />{' '}
              مقارنة بالفترة السابقة
            </label>
          </>
        }
      />
      <DataState
        isLoading={journal.isLoading}
        isError={journal.isError}
        onRetry={() => void journal.refetch()}
      >
        <SectionCard
          title="ميزان المراجعة"
          icon={Scale}
          actions={
            <>
              {t.balanced ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                  <CheckCircle2 size={14} /> متوازن في الأرصدة الافتتاحية والحركات والختامية
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                  <XCircle size={14} /> غير متوازن
                  {f.branch !== 'all' ? ' (عرض فرع واحد قد لا يتوازن بسبب التوزيعات)' : ''}
                </span>
              )}
              <ExportButtons build={build} />
            </>
          }
        >
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.code}
            emptyTitle="لا حركات في النطاق"
          />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
            <Fig label="افتتاحي مدين" v={t.openingDebit} />
            <Fig label="افتتاحي دائن" v={t.openingCredit} />
            <Fig label="حركة مدين" v={t.periodDebit} />
            <Fig label="حركة دائن" v={t.periodCredit} />
            <Fig label="ختامي مدين" v={t.closingDebit} strong />
            <Fig label="ختامي دائن" v={t.closingCredit} strong />
          </div>
        </SectionCard>
      </DataState>
    </div>
  );
}
