import { useMemo, useState } from 'react';
import { BookMarked, CheckCircle2, Coins, Scale, TrendingUp, XCircle } from 'lucide-react';
import { Modal, Table, type Column } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { previousWindow } from '@/features/accounting/data/analytics';
import { dayBefore } from '@/features/accounting/data/ledger';
import {
  ACCOUNTING_POLICIES,
  balanceSheetPro,
  cashFlowPro,
  entriesForAccounts,
  incomeStatementPro,
  type StatementLine,
  type StatementSection,
} from '@/features/accounting/data/statements';
import { useChart, useJournal } from '@/features/accounting/hooks/useAccounting';
import { useCostCenters } from '@/features/accounting/hooks/useAccountingPro';
import type { JournalEntry } from '@/features/accounting/types';
import type { Cell } from '@/shared/lib/exportTable';
import {
  DataState,
  ExportButtons,
  FilterBar,
  Money,
  SectionCard,
  TabBar,
  defaultRange,
  rangeLabel,
  toLedger,
  type RangeFilter,
} from '@/features/accounting/components/kit';
import { EntryDetailModal } from '@/features/accounting/components/LedgerScreens';

type Tab = 'income' | 'balance' | 'cashflow' | 'policies';

interface Row {
  key: string;
  label: string;
  cur: number;
  prev?: number;
  codes?: string[];
  kind: 'line' | 'subtotal' | 'total' | 'head';
}

/** Income statement / financial position / cash flows with comparison + drill-down. */
export function StatementsScreen({ onOpenAccount }: { onOpenAccount: (code: string) => void }) {
  const journal = useJournal();
  const { data: chart = [] } = useChart();
  const { data: centers = [] } = useCostCenters();
  const [tab, setTab] = useState<Tab>('income');
  const [f, setF] = useState<RangeFilter>(defaultRange);
  const [compare, setCompare] = useState(true);
  const [drill, setDrill] = useState<{ label: string; codes: string[] } | null>(null);
  const entries = journal.data ?? [];
  const lf = useMemo(() => toLedger(f), [f]);
  const pw = useMemo(() => previousWindow(f.from, f.to), [f.from, f.to]);
  const lfPrev = useMemo(() => ({ ...lf, ...pw }), [lf, pw]);

  const rows = useMemo<Row[]>(() => {
    const L = (s: StatementSection, prevS?: StatementSection): Row[] => [
      { key: `h-${s.key}`, label: s.label, cur: 0, kind: 'head' },
      ...s.lines.map((l: StatementLine) => ({
        key: `${s.key}-${l.code}`,
        label: `${l.code} ${l.name}`,
        cur: l.amount,
        ...(prevS ? { prev: prevS.lines.find((p) => p.code === l.code)?.amount ?? 0 } : {}),
        codes: [l.code],
        kind: 'line' as const,
      })),
      {
        key: `t-${s.key}`,
        label: `إجمالي ${s.label}`,
        cur: s.total,
        ...(prevS ? { prev: prevS.total } : {}),
        codes: s.lines.map((l) => l.code),
        kind: 'subtotal',
      },
    ];
    if (tab === 'income') {
      const a = incomeStatementPro(entries, chart, lf);
      const b = compare ? incomeStatementPro(entries, chart, lfPrev) : undefined;
      return [
        ...L(a.revenue, b?.revenue),
        ...L(a.costOfSales, b?.costOfSales),
        {
          key: 'gp',
          label: 'مجمل الربح',
          cur: a.grossProfit,
          ...(b ? { prev: b.grossProfit } : {}),
          kind: 'total',
        },
        ...L(a.operatingExpenses, b?.operatingExpenses),
        {
          key: 'op',
          label: 'الربح التشغيلي',
          cur: a.operatingProfit,
          ...(b ? { prev: b.operatingProfit } : {}),
          kind: 'total',
        },
        ...L(a.otherIncome, b?.otherIncome),
        ...L(a.otherExpenses, b?.otherExpenses),
        {
          key: 'np',
          label: 'صافي الربح',
          cur: a.netProfit,
          ...(b ? { prev: b.netProfit } : {}),
          kind: 'total',
        },
      ];
    }
    if (tab === 'balance') {
      const a = balanceSheetPro(entries, chart, {
        to: f.to,
        branch: lf.branch,
        costCenter: lf.costCenter,
      });
      const b = compare
        ? balanceSheetPro(entries, chart, {
            to: dayBefore(f.from),
            branch: lf.branch,
            costCenter: lf.costCenter,
          })
        : undefined;
      return [
        ...L(a.currentAssets, b?.currentAssets),
        ...L(a.nonCurrentAssets, b?.nonCurrentAssets),
        {
          key: 'ta',
          label: 'إجمالي الأصول',
          cur: a.totalAssets,
          ...(b ? { prev: b.totalAssets } : {}),
          kind: 'total',
        },
        ...L(a.currentLiabilities, b?.currentLiabilities),
        ...L(a.nonCurrentLiabilities, b?.nonCurrentLiabilities),
        {
          key: 'tl',
          label: 'إجمالي الالتزامات',
          cur: a.totalLiabilities,
          ...(b ? { prev: b.totalLiabilities } : {}),
          kind: 'total',
        },
        ...L(a.equity, b?.equity),
        {
          key: 'up',
          label: 'أرباح الفترة غير المقفلة',
          cur: a.unclosedProfit,
          ...(b ? { prev: b.unclosedProfit } : {}),
          kind: 'line',
        },
        {
          key: 'te',
          label: 'إجمالي حقوق الملكية',
          cur: a.totalEquity,
          ...(b ? { prev: b.totalEquity } : {}),
          kind: 'total',
        },
        {
          key: 'le',
          label: 'الالتزامات + حقوق الملكية',
          cur: a.totalLiabilities + a.totalEquity,
          ...(b ? { prev: b.totalLiabilities + b.totalEquity } : {}),
          kind: 'total',
        },
      ];
    }
    const a = cashFlowPro(entries, chart, lf);
    const b = compare ? cashFlowPro(entries, chart, lfPrev) : undefined;
    const sec = (k: 'operating' | 'investing' | 'financing'): Row[] => [
      { key: `h-${k}`, label: a[k].label, cur: 0, kind: 'head' },
      ...a[k].lines.map((l) => ({
        key: `${k}-${l.code}`,
        label: `${l.code} ${l.name}`,
        cur: l.amount,
        ...(b ? { prev: b[k].lines.find((p) => p.code === l.code)?.amount ?? 0 } : {}),
        codes: [l.code],
        kind: 'line' as const,
      })),
      {
        key: `t-${k}`,
        label: `صافي ${a[k].label}`,
        cur: a[k].net,
        ...(b ? { prev: b[k].net } : {}),
        kind: 'subtotal',
      },
    ];
    return [
      ...sec('operating'),
      ...sec('investing'),
      ...sec('financing'),
      {
        key: 'nc',
        label: 'صافي التغير في النقد',
        cur: a.netChange,
        ...(b ? { prev: b.netChange } : {}),
        kind: 'total',
      },
      {
        key: 'oc',
        label: 'النقد أول الفترة',
        cur: a.openingCash,
        ...(b ? { prev: b.openingCash } : {}),
        kind: 'line',
      },
      {
        key: 'cc',
        label: 'النقد آخر الفترة',
        cur: a.closingCash,
        ...(b ? { prev: b.closingCash } : {}),
        kind: 'total',
      },
    ];
  }, [tab, entries, chart, compare, f.from, f.to, lf, lfPrev]);

  const check = useMemo(() => {
    if (tab === 'balance') {
      const bs = balanceSheetPro(entries, chart, {
        to: f.to,
        branch: lf.branch,
        costCenter: lf.costCenter,
      });
      return {
        ok: bs.balanced,
        text: bs.balanced
          ? 'الأصول = الالتزامات + حقوق الملكية'
          : `فرق ${sar(bs.difference)} — الأصول ≠ الالتزامات + حقوق الملكية`,
      };
    }
    if (tab === 'cashflow') {
      const cf = cashFlowPro(entries, chart, lf);
      return {
        ok: cf.reconciles,
        text: cf.reconciles
          ? 'النقد أول الفترة + صافي التغير = النقد آخر الفترة'
          : 'التدفقات لا تطابق أرصدة النقد',
      };
    }
    return null;
  }, [tab, entries, chart, f.to, lf]);

  const title =
    tab === 'income'
      ? 'قائمة الدخل'
      : tab === 'balance'
        ? 'قائمة المركز المالي'
        : 'قائمة التدفقات النقدية (الطريقة المباشرة)';
  const prevLabel = tab === 'balance' ? `حتى ${dayBefore(f.from)}` : `${pw.from} → ${pw.to}`;
  const curLabel = tab === 'balance' ? `حتى ${f.to}` : `${f.from} → ${f.to}`;

  const columns: Column<Row>[] = [
    {
      key: 'label',
      header: 'البند',
      cell: (r) =>
        r.kind === 'head' ? (
          <span className="font-bold text-navy">{r.label}</span>
        ) : r.codes && r.kind === 'line' ? (
          <button
            type="button"
            className="pr-4 text-navy-900 hover:underline"
            onClick={() => setDrill({ label: r.label, codes: r.codes ?? [] })}
          >
            {r.label}
          </button>
        ) : (
          <span
            className={r.kind === 'total' ? 'font-bold text-navy' : 'font-semibold text-navy-900'}
          >
            {r.label}
          </span>
        ),
    },
    {
      key: 'cur',
      header: curLabel,
      cell: (r) =>
        r.kind === 'head' ? (
          ''
        ) : (
          <Money v={r.cur} className={r.kind !== 'line' ? 'font-bold' : ''} />
        ),
    },
    ...(compare
      ? [
          {
            key: 'prev',
            header: prevLabel,
            cell: (r: Row) =>
              r.kind === 'head' ? '' : <Money v={r.prev ?? 0} className="text-purple" />,
          },
          {
            key: 'chg',
            header: 'التغير',
            cell: (r: Row) => (r.kind === 'head' ? '' : <Money v={r.cur - (r.prev ?? 0)} />),
          },
        ]
      : []),
  ];

  const build = () => ({
    title,
    subtitle: rangeLabel(f),
    headers: ['البند', curLabel, ...(compare ? [prevLabel, 'التغير'] : [])],
    rows: rows
      .filter((r) => r.kind !== 'head')
      .map((r): Cell[] => [
        r.label,
        r.cur,
        ...(compare ? [r.prev ?? 0, r.cur - (r.prev ?? 0)] : []),
      ]),
  });

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { key: 'income', label: 'قائمة الدخل', icon: TrendingUp },
          { key: 'balance', label: 'المركز المالي', icon: Scale },
          { key: 'cashflow', label: 'التدفقات النقدية', icon: Coins },
          { key: 'policies', label: 'السياسات المحاسبية', icon: BookMarked },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'policies' ? (
        <SectionCard title="السياسات المحاسبية المطبّقة" icon={BookMarked}>
          <ol className="list-inside list-decimal space-y-2 text-sm leading-relaxed text-navy-900">
            {ACCOUNTING_POLICIES.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </SectionCard>
      ) : (
        <>
          <FilterBar
            value={f}
            onChange={setF}
            costCenters={centers}
            extra={
              <label className="mb-2 flex items-center gap-1.5 text-xs text-navy">
                <input
                  type="checkbox"
                  checked={compare}
                  onChange={(e) => setCompare(e.target.checked)}
                />{' '}
                مقارنة بالفترة السابقة
              </label>
            }
          />
          <DataState
            isLoading={journal.isLoading}
            isError={journal.isError}
            onRetry={() => void journal.refetch()}
          >
            <SectionCard
              title={title}
              actions={
                <>
                  {check && (
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold ${check.ok ? 'text-green-700' : 'text-red-600'}`}
                    >
                      {check.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {check.text}
                    </span>
                  )}
                  <ExportButtons build={build} />
                </>
              }
            >
              <Table columns={columns} rows={rows} rowKey={(r) => r.key} emptyTitle="لا بيانات" />
              <p className="mt-2 text-xs text-purple">
                اضغط أي بند لعرض الحسابات والقيود المكوّنة له. صافي الربح محسوب من الحسابات
                المصنّفة، وقيود الإقفال مستبعدة من قائمة الدخل.
              </p>
            </SectionCard>
          </DataState>
        </>
      )}
      {drill && (
        <DrillModal
          label={drill.label}
          entries={entriesForAccounts(
            entries,
            drill.codes,
            tab === 'balance' ? { to: f.to, branch: lf.branch } : lf,
            { excludeClosing: tab === 'income' },
          )}
          codes={drill.codes}
          onOpenAccount={(c) => {
            setDrill(null);
            onOpenAccount(c);
          }}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

function DrillModal({
  label,
  entries,
  codes,
  onOpenAccount,
  onClose,
}: {
  label: string;
  entries: JournalEntry[];
  codes: string[];
  onOpenAccount: (c: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} size="lg" title={`مكوّنات البند: ${label}`}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto text-sm">
        <div className="flex flex-wrap gap-2">
          {codes.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onOpenAccount(c)}
              className="rounded-lg bg-navy-50 px-2.5 py-1 text-xs font-medium text-navy hover:bg-navy-100"
            >
              فتح الأستاذ العام للحساب {c}
            </button>
          ))}
        </div>
        <ul className="divide-y divide-navy-50">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setOpen(e.id)}
                className="flex w-full items-center justify-between py-2 text-right hover:bg-navy-50/50"
              >
                <span>
                  <span className="num text-navy-300 text-xs">#{e.entry_no}</span> {e.description}
                </span>
                <span className="num text-xs text-purple">{e.entry_date}</span>
              </button>
            </li>
          ))}
          {!entries.length && <li className="py-4 text-center text-purple">لا قيود في النطاق</li>}
        </ul>
      </div>
      {open && <EntryDetailModal entryId={open} onClose={() => setOpen(null)} />}
    </Modal>
  );
}
