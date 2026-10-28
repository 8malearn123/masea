import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileUp,
  Link2,
  ListChecks,
  Plus,
  ShieldCheck,
  Sparkles,
  Unlink,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import {
  bookLines,
  parseStatementCsv,
  reconciliationReport,
  ruleFor,
  suggestMatches,
  StatementParseError,
  type BankRule,
  type StatementLine,
} from '@/features/accounting/data/bankrec';
import { useBankAccounts, useChart, useJournal } from '@/features/accounting/hooks/useAccounting';
import {
  useAccAccess,
  useAccConfig,
  useAccMutation,
  useBankRules,
  useMatches,
  useStatement,
} from '@/features/accounting/hooks/useAccountingPro';
import * as pro from '@/features/accounting/api/accountingPro.api';
import {
  DataState,
  ExportButtons,
  Money,
  SectionCard,
  todayIso,
} from '@/features/accounting/components/kit';

/**
 * التسوية البنكية: استيراد الكشف ← اقتراح المطابقات ← تأكيدها ← تقرير التسوية.
 * المطابقة لا تُنشئ قيدًا؛ القاعدة المعتمدة فقط تقترح مسودة قيد تمر بالاعتماد.
 */
export function BankRecScreen() {
  const { data: accounts = [] } = useBankAccounts();
  const banks = accounts.filter((a) => a.is_active && a.account_code !== '1111');
  const [code, setCode] = useState('1112');
  const journal = useJournal();
  const stQ = useStatement(code);
  const { data: matches = [] } = useMatches(code);
  const { data: rules = [] } = useBankRules();
  const { allowed, actor } = useAccAccess();
  const cfg = useAccConfig();
  const [importing, setImporting] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const st = stQ.data;
  const book = useMemo(() => bookLines(journal.data ?? [], code), [journal.data, code]);
  const matchedS = useMemo(() => new Set(matches.map((m) => m.statement_id)), [matches]);
  const matchedB = useMemo(() => new Set(matches.map((m) => m.book_key)), [matches]);
  const suggestions = useMemo(
    () =>
      st
        ? suggestMatches(st.lines, book, { statement: matchedS, book: matchedB }, cfg.bankMatchDays)
        : [],
    [st, book, matchedS, matchedB, cfg.bankMatchDays],
  );
  const report = useMemo(
    () => (st ? reconciliationReport(book, st.lines, matches, st.closing_balance) : null),
    [st, book, matches],
  );

  const confirm = useAccMutation(
    (pairs: { statement_id: string; book_key: string }[]) => pro.confirmMatches(code, pairs, actor),
    'تم تأكيد المطابقة',
  );
  const unmatch = useAccMutation(
    (sid: string) => pro.removeMatch(code, sid, actor),
    'أُلغيت المطابقة',
  );
  const draft = useAccMutation(
    (v: { line: StatementLine; rule: BankRule }) => pro.draftFromRule(code, v.line, v.rule, actor),
    'أُنشئت مسودة قيد — راجعها واعتمدها من شاشة القيود',
  );

  const stCols: Column<StatementLine>[] = [
    {
      key: 'd',
      header: 'التاريخ',
      cell: (l) => <span className="num text-xs">{l.date}</span>,
      sortValue: (l) => l.date,
    },
    { key: 's', header: 'البيان', cell: (l) => l.description },
    {
      key: 'r',
      header: 'المرجع',
      cell: (l) => <span className="num text-xs">{l.reference || '—'}</span>,
    },
    {
      key: 'a',
      header: 'المبلغ',
      cell: (l) => (
        <Money v={l.amount} className={l.amount > 0 ? 'text-green-700' : 'text-red-600'} />
      ),
      sortValue: (l) => l.amount,
    },
    {
      key: 'st',
      header: 'الحالة',
      cell: (l) => {
        if (matchedS.has(l.id)) return <Badge tone="success">مطابق</Badge>;
        const sug = suggestions.find((x) => x.statement_id === l.id);
        if (sug) return <Badge tone="gold">مقترح ({sug.score}٪)</Badge>;
        const rule = ruleFor(l, rules);
        return rule ? (
          <Badge tone="navy">قاعدة: {rule.name}</Badge>
        ) : (
          <Badge tone="danger">غير مطابق</Badge>
        );
      },
    },
    {
      key: 'x',
      header: '',
      cell: (l) => {
        if (matchedS.has(l.id))
          return allowed('bank', 'edit') ? (
            <Button size="sm" variant="ghost" onClick={() => unmatch.mutate(l.id)}>
              <Unlink size={13} />
            </Button>
          ) : null;
        const sug = suggestions.find((x) => x.statement_id === l.id);
        if (sug && allowed('bank', 'edit'))
          return (
            <Button
              size="sm"
              variant="outline"
              onClick={() => confirm.mutate([sug])}
              title={sug.reason}
            >
              <Link2 size={13} /> تأكيد
            </Button>
          );
        const rule = ruleFor(l, rules);
        return rule && allowed('gl', 'create') ? (
          <Button size="sm" variant="outline" onClick={() => draft.mutate({ line: l, rule })}>
            <Plus size={13} /> مسودة قيد
          </Button>
        ) : null;
      },
    },
  ];

  const build = () => ({
    title: `تقرير التسوية البنكية — ${code}`,
    subtitle: `حتى ${todayIso()}`,
    headers: ['البند', 'المبلغ'],
    rows: report
      ? [
          ['رصيد كشف البنك', report.bankBalance],
          [
            '+ إيداعات بالطريق (في الدفاتر لا في الكشف)',
            report.depositsInTransit.reduce((s, b) => s + b.amount, 0),
          ],
          [
            '− مدفوعات معلّقة (في الدفاتر لا في الكشف)',
            report.outstandingPayments.reduce((s, b) => s + b.amount, 0),
          ],
          ['= الرصيد البنكي المعدّل', report.adjustedBank],
          ['رصيد الدفاتر', report.bookBalance],
          [
            '+ إيداعات في الكشف غير مسجلة',
            report.unrecordedCredits.reduce((s, b) => s + b.amount, 0),
          ],
          [
            '− خصومات في الكشف غير مسجلة',
            report.unrecordedDebits.reduce((s, b) => s + b.amount, 0),
          ],
          ['= رصيد الدفاتر المعدّل', report.adjustedBook],
          ['الفرق', report.difference],
        ]
      : [],
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72">
          <Select
            label="الحساب البنكي"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            options={banks.map((b) => ({
              value: b.account_code,
              label: `${b.account_code} — ${b.name}`,
            }))}
          />
        </div>
        {allowed('bank', 'create') && (
          <Button variant="outline" onClick={() => setImporting(true)}>
            <FileUp size={15} /> استيراد كشف حساب
          </Button>
        )}
        <Button variant="ghost" onClick={() => setRulesOpen(true)}>
          <ShieldCheck size={15} /> قواعد الترحيل المعتمدة
        </Button>
        {suggestions.length > 0 && allowed('bank', 'edit') && (
          <Button
            variant="accent"
            onClick={() => confirm.mutate(suggestions.filter((s) => s.score >= 90))}
          >
            <Sparkles size={15} /> تأكيد المطابقات عالية الثقة (
            {suggestions.filter((s) => s.score >= 90).length})
          </Button>
        )}
      </div>

      <DataState
        isLoading={stQ.isLoading || journal.isLoading}
        isError={stQ.isError}
        onRetry={() => void stQ.refetch()}
        empty={!st}
        emptyTitle="لا يوجد كشف مستورد لهذا الحساب"
        emptyHint="استورد كشف الحساب (CSV) من البنك لبدء المطابقة."
      >
        {report && st && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Fig label="الرصيد الدفتري" v={report.bookBalance} />
              <Fig label="رصيد كشف البنك" v={report.bankBalance} />
              <Fig label="رصيد بنكي معدّل" v={report.adjustedBank} />
              <div
                className={`rounded-2xl p-4 shadow-card ${report.reconciled ? 'bg-green-50' : 'bg-red-50'}`}
              >
                <p className="text-xs text-purple">نتيجة التسوية</p>
                <p
                  className={`mt-1 flex items-center gap-1 text-sm font-bold ${report.reconciled ? 'text-green-700' : 'text-red-700'}`}
                >
                  {report.reconciled ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  {report.reconciled ? 'مُسوّاة' : `فرق ${sar(report.difference)}`}
                </p>
              </div>
            </div>
            <SectionCard
              title={`حركات الكشف — مستورد ${st.imported_at.slice(0, 10)}`}
              icon={ListChecks}
              actions={<ExportButtons build={build} />}
            >
              <Table columns={stCols} rows={st.lines} rowKey={(l) => l.id} emptyTitle="لا حركات" />
            </SectionCard>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="في الدفاتر وغير ظاهرة في الكشف">
                <ul className="divide-y divide-navy-50 text-sm">
                  {[...report.depositsInTransit, ...report.outstandingPayments].map((b) => (
                    <li key={b.key} className="flex justify-between py-1.5">
                      <span>
                        <span className="num text-navy-300 text-xs">#{b.entry_no}</span>{' '}
                        {b.description}
                      </span>
                      <Money v={b.amount} />
                    </li>
                  ))}
                  {!report.depositsInTransit.length && !report.outstandingPayments.length && (
                    <li className="py-3 text-center text-purple">لا يوجد</li>
                  )}
                </ul>
              </SectionCard>
              <SectionCard title="في الكشف وغير مسجلة في الدفاتر">
                <ul className="divide-y divide-navy-50 text-sm">
                  {[...report.unrecordedCredits, ...report.unrecordedDebits].map((s) => (
                    <li key={s.id} className="flex justify-between py-1.5">
                      <span>
                        <span className="num text-xs text-purple">{s.date}</span> {s.description}
                      </span>
                      <Money v={s.amount} />
                    </li>
                  ))}
                  {!report.unrecordedCredits.length && !report.unrecordedDebits.length && (
                    <li className="py-3 text-center text-purple">لا يوجد</li>
                  )}
                </ul>
              </SectionCard>
            </div>
          </>
        )}
      </DataState>
      <p className="text-xs text-purple">
        المطابقة مقترحة بالمبلغ والتاريخ (±{cfg.bankMatchDays} أيام من الإعدادات) والمرجع، وتحتاج
        تأكيدك. لا يُنشأ أي قيد آليًا؛ القواعد المعتمدة تُنشئ مسودات فقط.
      </p>
      {importing && <ImportModal code={code} onClose={() => setImporting(false)} />}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

function Fig({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-card">
      <p className="text-xs text-purple">{label}</p>
      <Money v={v} className="text-lg font-bold text-navy" />
    </div>
  );
}

function ImportModal({ code, onClose }: { code: string; onClose: () => void }) {
  const { actor } = useAccAccess();
  const [text, setText] = useState('');
  const [closing, setClosing] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useAccMutation(
    (lines: StatementLine[]) =>
      pro.importStatement(code, lines, closing ? Number(closing) : null, actor),
    'تم استيراد الكشف',
  );
  function submit() {
    try {
      const lines = parseStatementCsv(text);
      save.mutate(lines, { onSuccess: onClose });
    } catch (e) {
      setError(e instanceof StatementParseError ? e.message : 'تعذّر قراءة الملف');
    }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={`استيراد كشف حساب — ${code}`}>
      <div className="space-y-3 text-sm">
        <p className="text-purple">
          ملف CSV بأعمدة: التاريخ (YYYY-MM-DD أو DD/MM/YYYY)، البيان، المرجع، والمبلغ (+ إيداع / −
          سحب) أو عمودا مدين/دائن. الكشف المستورد يستبدل السابق لهذا الحساب.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then(setText);
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          dir="ltr"
          className="num w-full rounded-xl border border-navy-100 p-2 text-xs"
          placeholder={'التاريخ,البيان,المرجع,المبلغ\n05/04/2026,حوالة واردة,PMT-1,11500'}
        />
        <Input
          label="الرصيد الختامي في الكشف (اختياري — وإلا مجموع الحركات)"
          type="number"
          value={closing}
          onChange={(e) => setClosing(e.target.value)}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button className="w-full" disabled={!text.trim()} onClick={submit}>
          استيراد
        </Button>
      </div>
    </Modal>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const { data: rules = [] } = useBankRules();
  const { data: chart = [] } = useChart();
  const { allowed, actor } = useAccAccess();
  const [name, setName] = useState('');
  const [contains, setContains] = useState('');
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [acc, setAcc] = useState('5400');
  const add = useAccMutation(
    () =>
      pro.saveBankRule(
        {
          id: `rule-${Date.now()}`,
          name: name.trim(),
          contains: contains.trim(),
          direction: dir,
          account_code: acc,
          approved: false,
          is_active: true,
        },
        actor,
      ),
    'أُضيفت القاعدة — تحتاج اعتمادًا قبل الاستخدام',
  );
  const approve = useAccMutation((id: string) => pro.approveBankRule(id, actor), 'اعتُمدت القاعدة');
  return (
    <Modal open onClose={onClose} size="lg" title="قواعد الترحيل من الكشف">
      <div className="space-y-3 text-sm">
        <ul className="divide-y divide-navy-50">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span>
                <span className="font-semibold text-navy">{r.name}</span>
                <span className="block text-xs text-purple">
                  البيان يحتوي «{r.contains}» · {r.direction === 'in' ? 'إيداع' : 'سحب'} ← حساب{' '}
                  {r.account_code}
                </span>
              </span>
              {r.approved ? (
                <Badge tone="success">معتمدة</Badge>
              ) : allowed('bank', 'approve') ? (
                <Button size="sm" onClick={() => approve.mutate(r.id)}>
                  اعتماد
                </Button>
              ) : (
                <Badge tone="gold">بانتظار الاعتماد</Badge>
              )}
            </li>
          ))}
        </ul>
        {allowed('bank', 'edit') && (
          <div className="grid gap-2 rounded-xl bg-navy-50 p-3 sm:grid-cols-2">
            <Input label="اسم القاعدة" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              label="البيان يحتوي على"
              value={contains}
              onChange={(e) => setContains(e.target.value)}
            />
            <Select
              label="الاتجاه"
              value={dir}
              onChange={(e) => setDir(e.target.value as 'in' | 'out')}
              options={[
                { value: 'out', label: 'سحب' },
                { value: 'in', label: 'إيداع' },
              ]}
            />
            <Select
              label="الحساب المقابل"
              value={acc}
              onChange={(e) => setAcc(e.target.value)}
              options={chart
                .filter((a) => a.is_postable && a.is_active !== false)
                .map((a) => ({ value: a.code, label: `${a.code} — ${a.name_ar}` }))}
            />
            <Button
              className="sm:col-span-2"
              disabled={!name.trim() || !contains.trim()}
              onClick={() => add.mutate(undefined)}
            >
              إضافة قاعدة
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
