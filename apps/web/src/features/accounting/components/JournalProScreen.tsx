import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  FileCheck2,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  Upload,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { postingErrors } from '@/features/accounting/data/journalWorkflow';
import { sumMoney, toHalala } from '@/features/accounting/data/money';
import type { RecurringTemplate, EntryAction } from '@/features/accounting/data/journalWorkflow';
import * as pro from '@/features/accounting/api/accountingPro.api';
import { useChart, useJournal, usePeriods } from '@/features/accounting/hooks/useAccounting';
import {
  useAccAccess,
  useAccConfig,
  useAccMutation,
  useCostCenters,
  useRecurring,
  useWorkflow,
} from '@/features/accounting/hooks/useAccountingPro';
import {
  ENTRY_KIND_LABEL,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  SOURCE_LABEL,
  type EntryKind,
  type EntryStatus,
  type JournalEntry,
} from '@/features/accounting/types';
import { EntryDetailModal } from '@/features/accounting/components/LedgerScreens';
import {
  ConfirmModal,
  ExportButtons,
  SearchInput,
  SectionCard,
  TabBar,
  branchOptions,
  todayIso,
} from '@/features/accounting/components/kit';

type Tab = 'entries' | 'recurring';
const total = (e: JournalEntry) => sumMoney(e.lines.map((l) => l.debit));

export function JournalProScreen() {
  const [tab, setTab] = useState<Tab>('entries');
  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { key: 'entries', label: 'القيود', icon: FileCheck2 },
          { key: 'recurring', label: 'القيود المتكررة', icon: Repeat },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'entries' ? <EntriesTab /> : <RecurringTab />}
    </div>
  );
}

/* -------------------------------- entries -------------------------------- */
function EntriesTab() {
  const journal = useJournal();
  const wf = useWorkflow();
  const { allowed, actor } = useAccAccess();
  const cfg = useAccConfig();
  const [status, setStatus] = useState<'all' | EntryStatus>('all');
  const [kind, setKind] = useState<'all' | EntryKind | 'system'>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<JournalEntry | 'new' | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    entry: JournalEntry;
    action: EntryAction | 'reverse';
  } | null>(null);

  const act = useAccMutation(
    (v: { id: string; action: EntryAction }) =>
      pro.actOnEntry(v.id, v.action, actor, cfg.requireSod),
    (e) => `تم: ${ENTRY_STATUS_LABEL[e.status]}`,
  );
  const reverse = useAccMutation(
    (v: { id: string; date: string }) => pro.reverseEntry(v.id, v.date, actor),
    'أُنشئ قيد عكسي كمسودة — يمر بالاعتماد ثم الترحيل',
  );
  const attach = useAccMutation(
    (v: { id: string; file: File }) =>
      pro.addAttachment(v.id, { name: v.file.name, size: v.file.size }, actor),
    'أُرفق المستند',
  );

  const all = useMemo(() => {
    const byId = new Map<string, JournalEntry>();
    for (const e of journal.data ?? []) byId.set(e.id, e);
    for (const e of wf.data ?? []) byId.set(e.id, e); // workflow version wins
    return [...byId.values()].sort(
      (a, b) => b.entry_date.localeCompare(a.entry_date) || b.entry_no - a.entry_no,
    );
  }, [journal.data, wf.data]);

  const rows = all.filter((e) => {
    if (status !== 'all' && e.status !== status) return false;
    if (kind === 'system' && e.kind && e.kind !== 'auto') return false;
    if (kind !== 'all' && kind !== 'system' && (e.kind ?? 'auto') !== kind) return false;
    if (q && !`${e.description} ${e.reference ?? ''} #${e.entry_no}`.includes(q)) return false;
    return true;
  });
  const counts = (s: EntryStatus) => all.filter((e) => e.status === s).length;
  const isWorkflow = (e: JournalEntry) => (wf.data ?? []).some((w) => w.id === e.id);

  const columns: Column<JournalEntry>[] = [
    {
      key: 'no',
      header: 'القيد',
      cell: (e) => <span className="num">#{e.entry_no}</span>,
      sortValue: (e) => e.entry_no,
    },
    {
      key: 'date',
      header: 'التاريخ',
      cell: (e) => <span className="num text-xs">{dateAr(e.entry_date)}</span>,
      sortValue: (e) => e.entry_date,
    },
    {
      key: 'desc',
      header: 'البيان',
      cell: (e) => (
        <span className="font-semibold text-navy">
          {e.description}
          {!!e.attachments?.length && <Paperclip size={12} className="mr-1 inline text-purple" />}
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'النوع',
      cell: (e) => (
        <Badge tone="navy">{e.kind ? ENTRY_KIND_LABEL[e.kind] : SOURCE_LABEL[e.source_type]}</Badge>
      ),
    },
    { key: 'branch', header: 'مركز التكلفة', cell: (e) => e.branch ?? 'المركز' },
    {
      key: 'amount',
      header: 'المبلغ',
      cell: (e) => <span className="num font-bold text-navy">{sar(total(e))}</span>,
      sortValue: total,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (e) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={ENTRY_STATUS_TONE[e.status]}>{ENTRY_STATUS_LABEL[e.status]}</Badge>
          {e.reversed_by && <Badge tone="danger">معكوس</Badge>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (e) => (
        <div className="flex flex-wrap items-center gap-1">
          <IconBtn title="عرض" onClick={() => setView(e.id)} icon={Eye} />
          {isWorkflow(e) && e.status === 'draft' && allowed('gl', 'edit') && (
            <IconBtn title="تعديل" onClick={() => setEditing(e)} icon={Pencil} />
          )}
          {e.status === 'draft' && allowed('gl', 'create') && (
            <IconBtn
              title="إرسال للاعتماد"
              onClick={() => act.mutate({ id: e.id, action: 'submit' })}
              icon={Send}
            />
          )}
          {e.status === 'pending' && allowed('gl', 'approve') && (
            <IconBtn
              title="اعتماد"
              onClick={() => act.mutate({ id: e.id, action: 'approve' })}
              icon={CheckCircle2}
            />
          )}
          {(e.status === 'approved' ||
            (!cfg.requireSod && (e.status === 'draft' || e.status === 'pending'))) &&
            allowed('gl', 'post') && (
              <IconBtn
                title="ترحيل"
                onClick={() => setConfirm({ entry: e, action: 'post' })}
                icon={FileCheck2}
              />
            )}
          {(e.status === 'pending' || e.status === 'approved') && allowed('gl', 'approve') && (
            <IconBtn
              title="إعادة للمسودة"
              onClick={() => act.mutate({ id: e.id, action: 'return' })}
              icon={Undo2}
            />
          )}
          {isWorkflow(e) &&
            ['draft', 'pending', 'approved'].includes(e.status) &&
            allowed('gl', 'edit') && (
              <IconBtn
                title="إلغاء"
                danger
                onClick={() => setConfirm({ entry: e, action: 'void' })}
                icon={XCircle}
              />
            )}
          {e.status === 'posted' &&
            !e.reversed_by &&
            e.kind !== 'closing' &&
            allowed('gl', 'create') && (
              <IconBtn
                title="قيد عكسي"
                onClick={() => setConfirm({ entry: e, action: 'reverse' })}
                icon={RotateCcw}
              />
            )}
          {isWorkflow(e) && allowed('gl', 'create') && (
            <label
              className="cursor-pointer rounded-lg bg-navy-50 p-1.5 text-navy hover:bg-navy-100"
              title="إرفاق مستند"
            >
              <Upload size={13} />
              <input
                type="file"
                className="hidden"
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  if (file) attach.mutate({ id: e.id, file });
                  ev.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      ),
    },
  ];

  const build = () => ({
    title: 'القيود اليومية',
    subtitle: `الحالة: ${status === 'all' ? 'الكل' : ENTRY_STATUS_LABEL[status]}`,
    headers: ['القيد', 'التاريخ', 'البيان', 'المرجع', 'الحالة', 'المبلغ'],
    rows: rows.map((e) => [
      e.entry_no,
      e.entry_date,
      e.description,
      e.reference ?? '',
      ENTRY_STATUS_LABEL[e.status],
      total(e),
    ]),
  });

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['draft', 'pending', 'approved', 'posted'] as EntryStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(status === s ? 'all' : s)}
            className={`rounded-2xl bg-white p-3 text-right shadow-card transition ${status === s ? 'ring-2 ring-navy' : ''}`}
          >
            <p className="text-xs text-purple">{ENTRY_STATUS_LABEL[s]}</p>
            <p className="num text-xl font-bold text-navy">{counts(s)}</p>
          </button>
        ))}
      </div>
      <SectionCard
        title="القيود اليومية"
        icon={FileCheck2}
        actions={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="بحث بالبيان أو المرجع أو #رقم" />
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              options={[
                { value: 'all', label: 'كل الأنواع' },
                ...(Object.keys(ENTRY_KIND_LABEL) as EntryKind[]).map((k) => ({
                  value: k,
                  label: ENTRY_KIND_LABEL[k],
                })),
              ]}
            />
            <ExportButtons build={build} />
            {allowed('gl', 'create') && (
              <Button onClick={() => setEditing('new')}>
                <Plus size={15} /> قيد جديد
              </Button>
            )}
          </>
        }
      >
        <Table
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          isLoading={journal.isLoading || wf.isLoading}
          isError={journal.isError || wf.isError}
          onRetry={() => void journal.refetch()}
          emptyTitle="لا قيود مطابقة"
        />
        <p className="mt-3 text-xs leading-relaxed text-purple">
          دورة القيد: مسودة ← بانتظار الاعتماد ← معتمد ← مُرحَّل.{' '}
          {cfg.requireSod
            ? 'فصل المهام مفعّل: لا يعتمد المستخدم قيدًا أنشأه.'
            : 'فصل المهام معطّل من الإعدادات.'}{' '}
          القيد غير المتوازن لا يُرحّل، والقيد المرحّل لا يُعدّل ولا يُحذف — يُصحّح بقيد عكسي.
        </p>
      </SectionCard>

      {editing && (
        <EntryEditor entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {view && <EntryDetailModal entryId={view} onClose={() => setView(null)} />}
      {confirm && (
        <ConfirmModal
          title={
            confirm.action === 'post'
              ? 'تأكيد الترحيل'
              : confirm.action === 'void'
                ? 'تأكيد الإلغاء'
                : 'إنشاء قيد عكسي'
          }
          message={
            confirm.action === 'post'
              ? `سيُرحّل القيد #${confirm.entry.entry_no} بمبلغ ${sar(total(confirm.entry))} ر.س إلى الأستاذ العام ولن يمكن تعديله بعد ذلك.`
              : confirm.action === 'void'
                ? `سيُلغى القيد #${confirm.entry.entry_no} (غير مرحّل). يبقى في السجل بحالة ملغى.`
                : `سيُنشأ قيد عكسي بتاريخ اليوم للقيد #${confirm.entry.entry_no} كمسودة، ثم يمر بالاعتماد والترحيل.`
          }
          confirmLabel={
            confirm.action === 'post'
              ? 'ترحيل'
              : confirm.action === 'void'
                ? 'إلغاء القيد'
                : 'إنشاء القيد العكسي'
          }
          danger={confirm.action === 'void'}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const { entry, action } = confirm;
            if (action === 'reverse')
              reverse.mutate({
                id: entry.id,
                date: todayIso() < entry.entry_date ? entry.entry_date : todayIso(),
              });
            else act.mutate({ id: entry.id, action });
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}

function IconBtn({
  title,
  onClick,
  icon: Icon,
  danger,
}: {
  title: string;
  onClick: () => void;
  icon: typeof Eye;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`rounded-lg p-1.5 ${danger ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-navy-50 text-navy hover:bg-navy-100'}`}
    >
      <Icon size={13} />
    </button>
  );
}

/* ------------------------------- editor ---------------------------------- */
interface DraftLine {
  account_code: string;
  debit: number;
  credit: number;
  description: string;
}

function EntryEditor({ entry, onClose }: { entry: JournalEntry | null; onClose: () => void }) {
  const { data: chart = [] } = useChart();
  const { data: periods = [] } = usePeriods();
  const { data: centers = [] } = useCostCenters();
  const { actor } = useAccAccess();
  const postable = chart.filter((a) => a.is_postable && a.is_active !== false);
  const [date, setDate] = useState(entry?.entry_date ?? todayIso());
  const [branch, setBranch] = useState(entry ? (entry.branch ?? 'head') : 'نجران');
  const [cc, setCc] = useState(entry?.cost_center ?? '');
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? 'manual');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [reference, setReference] = useState(entry?.reference ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    entry?.lines.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? '',
    })) ?? [
      { account_code: '5400', debit: 0, credit: 0, description: '' },
      { account_code: '1112', debit: 0, credit: 0, description: '' },
    ],
  );
  const save = useAccMutation(
    (v: { submit: boolean }) => {
      const saved = pro.saveDraftEntry(
        {
          entry_date: date,
          branch: branch === 'head' ? null : branch,
          cost_center: cc || null,
          description,
          reference: reference.trim() || null,
          kind,
          lines: lines.map((l) => ({
            account_code: l.account_code,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            ...(l.description ? { description: l.description } : {}),
          })),
        },
        actor,
        entry?.id,
      );
      return v.submit ? pro.actOnEntry(saved.id, 'submit', actor, true) : saved;
    },
    (e) => (e.status === 'pending' ? 'حُفظ القيد وأُرسل للاعتماد' : 'حُفظت المسودة'),
  );

  const dr = sumMoney(lines.map((l) => Number(l.debit) || 0));
  const cr = sumMoney(lines.map((l) => Number(l.credit) || 0));
  const balanced = toHalala(dr) === toHalala(cr) && dr > 0;
  const errs = postingErrors(
    {
      entry_date: date,
      description,
      lines: lines
        .filter((l) => l.debit > 0 || l.credit > 0)
        .map((l) => ({
          account_code: l.account_code,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
    },
    { chart, periods },
  );
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={entry ? `تعديل مسودة #${entry.entry_no}` : 'قيد يومية جديد'}
    >
      <div className="max-h-[74vh] space-y-3 overflow-y-auto pl-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="التاريخ"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            label="نوع القيد"
            value={kind}
            onChange={(e) => setKind(e.target.value as EntryKind)}
            options={(['manual', 'opening', 'adjusting'] as EntryKind[]).map((k) => ({
              value: k,
              label: ENTRY_KIND_LABEL[k],
            }))}
          />
          <Input
            label="المرجع المستندي"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <Select
            label="الفرع (مركز التكلفة)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions(false)}
          />
          <Select
            label="المشروع / القسم"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            options={[
              { value: '', label: 'بدون' },
              ...centers
                .filter((c) => c.kind !== 'branch' && c.is_active)
                .map((c) => ({ value: c.code, label: c.name })),
            ]}
          />
          <Input
            label="البيان"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-12 sm:col-span-4">
                <Select
                  {...(i === 0 ? { label: 'الحساب' } : {})}
                  value={l.account_code}
                  onChange={(e) => setLine(i, { account_code: e.target.value })}
                  options={postable.map((a) => ({
                    value: a.code,
                    label: `${a.code} — ${a.name_ar}`,
                  }))}
                />
              </div>
              <div className="col-span-6 sm:col-span-3">
                <Input
                  {...(i === 0 ? { label: 'بيان السطر' } : {})}
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <Input
                  {...(i === 0 ? { label: 'مدين' } : {})}
                  type="number"
                  min={0}
                  step="0.01"
                  value={l.debit}
                  onChange={(e) => setLine(i, { debit: Number(e.target.value), credit: 0 })}
                />
              </div>
              <div className="col-span-2 sm:col-span-2">
                <Input
                  {...(i === 0 ? { label: 'دائن' } : {})}
                  type="number"
                  min={0}
                  step="0.01"
                  value={l.credit}
                  onChange={(e) => setLine(i, { credit: Number(e.target.value), debit: 0 })}
                />
              </div>
              <div className="col-span-1 pb-2">
                {lines.length > 2 && (
                  <button
                    type="button"
                    aria-label="حذف السطر"
                    onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    className="text-purple hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                { account_code: '5400', debit: 0, credit: 0, description: '' },
              ])
            }
            className="inline-flex items-center gap-1 text-xs font-medium text-navy"
          >
            <Plus size={14} /> إضافة سطر
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-50 px-4 py-2.5 text-sm">
          <span className="text-purple">
            مدين <span className="num font-semibold text-navy">{sar(dr)}</span> · دائن{' '}
            <span className="num font-semibold text-navy">{sar(cr)}</span>
          </span>
          {balanced ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
              <CheckCircle2 size={14} /> متوازن
            </span>
          ) : (
            <span className="text-xs font-semibold text-red-600">
              غير متوازن — يُحفظ كمسودة ولا يُرحّل
            </span>
          )}
        </div>
        {errs.length > 0 && (
          <ul className="list-inside list-disc text-xs text-red-600">
            {errs.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => save.mutate({ submit: false }, { onSuccess: onClose })}
            disabled={!description.trim()}
          >
            حفظ كمسودة
          </Button>
          <Button
            className="flex-1"
            onClick={() => save.mutate({ submit: true }, { onSuccess: onClose })}
            disabled={errs.length > 0}
          >
            <Send size={15} /> حفظ وإرسال للاعتماد
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- recurring ------------------------------- */
function RecurringTab() {
  const { data: list = [], isLoading, isError, refetch } = useRecurring();
  const { data: chart = [] } = useChart();
  const { allowed, actor } = useAccAccess();
  const [adding, setAdding] = useState(false);
  const gen = useAccMutation(
    () => pro.generateRecurring(todayIso().slice(0, 7), actor),
    (m) => (m.length ? `أُنشئت ${m.length} مسودة من القوالب` : 'لا قيود مستحقة'),
  );
  const toggle = useAccMutation(
    (t: RecurringTemplate) => pro.saveRecurring({ ...t, is_active: !t.is_active }, actor),
    'تم التحديث',
  );

  const columns: Column<RecurringTemplate>[] = [
    {
      key: 'name',
      header: 'القالب',
      cell: (t) => <span className="font-semibold text-navy">{t.name}</span>,
    },
    {
      key: 'amount',
      header: 'المبلغ الشهري',
      cell: (t) => <span className="num">{sar(sumMoney(t.lines.map((l) => l.debit)))}</span>,
    },
    {
      key: 'lines',
      header: 'الحسابات',
      cell: (t) => (
        <span className="text-xs text-purple">
          {t.lines.map((l) => l.account_code).join(' / ')}
        </span>
      ),
    },
    { key: 'start', header: 'من', cell: (t) => <span className="num">{t.start_period}</span> },
    {
      key: 'last',
      header: 'آخر توليد',
      cell: (t) => <span className="num">{t.last_period ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (t) => (
        <Badge tone={t.is_active ? 'success' : 'neutral'}>{t.is_active ? 'فعّال' : 'معطّل'}</Badge>
      ),
    },
    {
      key: 'a',
      header: '',
      cell: (t) =>
        allowed('gl', 'edit') ? (
          <Button size="sm" variant="ghost" onClick={() => toggle.mutate(t)}>
            {t.is_active ? 'تعطيل' : 'تفعيل'}
          </Button>
        ) : null,
    },
  ];
  return (
    <SectionCard
      title="القيود المتكررة"
      icon={Repeat}
      actions={
        allowed('gl', 'create') && (
          <>
            <Button variant="outline" onClick={() => gen.mutate(undefined)}>
              <Repeat size={15} /> توليد المستحق حتى الشهر الحالي
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus size={15} /> قالب جديد
            </Button>
          </>
        )
      }
    >
      <Table
        columns={columns}
        rows={list}
        rowKey={(t) => t.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا قوالب متكررة"
      />
      <p className="mt-2 text-xs text-purple">
        التوليد يُنشئ مسودات (مرة واحدة لكل فترة) تمر بدورة الاعتماد — لا ترحيل تلقائي.
      </p>
      {adding && (
        <RecurringModal
          chart={chart.filter((a) => a.is_postable && a.is_active !== false)}
          onClose={() => setAdding(false)}
        />
      )}
    </SectionCard>
  );
}

function RecurringModal({
  chart,
  onClose,
}: {
  chart: { code: string; name_ar: string }[];
  onClose: () => void;
}) {
  const { actor } = useAccAccess();
  const [name, setName] = useState('');
  const [dr, setDr] = useState('5700');
  const [cr, setCr] = useState('1112');
  const [amount, setAmount] = useState(0);
  const [start, setStart] = useState(todayIso().slice(0, 7));
  const [branch, setBranch] = useState('head');
  const save = useAccMutation(
    () =>
      pro.saveRecurring(
        {
          id: `rec-${Date.now()}`,
          name: name.trim(),
          description: name.trim(),
          branch: branch === 'head' ? null : branch,
          lines: [
            { account_code: dr, debit: amount, credit: 0 },
            { account_code: cr, debit: 0, credit: amount },
          ],
          start_period: start,
          end_period: null,
          last_period: null,
          is_active: true,
        },
        actor,
      ),
    'أُضيف القالب',
  );
  const opts = chart.map((a) => ({ value: a.code, label: `${a.code} — ${a.name_ar}` }));
  return (
    <Modal open onClose={onClose} title="قالب قيد متكرر">
      <div className="space-y-3">
        <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          label="الحساب المدين"
          value={dr}
          onChange={(e) => setDr(e.target.value)}
          options={opts}
        />
        <Select
          label="الحساب الدائن"
          value={cr}
          onChange={(e) => setCr(e.target.value)}
          options={opts}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="المبلغ الشهري"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <Input
            label="يبدأ من (YYYY-MM)"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <Select
          label="الفرع"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          options={branchOptions(false)}
        />
        <Button
          className="w-full"
          disabled={!name.trim() || amount <= 0 || dr === cr || !/^\d{4}-\d{2}$/.test(start)}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          حفظ القالب
        </Button>
      </div>
    </Modal>
  );
}
