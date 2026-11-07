import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BellRing,
  ArchiveRestore,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Upload,
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
import { exportCsv } from '@/shared/lib/exportTable';
import { usePermissions } from '@/hooks/usePermissions';
import { useUpdateConfig } from '@/features/settings/hooks/useSettings';
import { currentEmployees } from '@/features/hr/api/hr.api';
import { useEmployees, useHouseWorkers } from '@/features/hr/hooks/useHr';
import {
  useDocAlertDays,
  useHrDocuments,
  useOpenDocFile,
  useRenewHrDocument,
  useSaveHrDocument,
  useSetDocumentActive,
} from '@/features/hr/hooks/useHrDocuments';
import {
  DOC_ALERT_DAYS_KEY,
  daysLeft,
  docStatus,
  documentSchema,
  fileSizeLabel,
  firstIssue,
  iqamaRegister,
  isCurrent,
  renewSchema,
  todayIso,
  validateDocFile,
  type IqamaRow,
} from '@/features/hr/lib/documentsEngine';
import {
  DOC_OWNER_LABEL,
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  DOC_TYPE_LABEL,
  type DocFile,
  type DocOwnerKind,
  type DocStatus,
  type DocumentDraft,
  type HrDocument,
} from '@/features/hr/types';

const TYPE_OPTIONS = Object.entries(DOC_TYPE_LABEL).map(([value, label]) => ({ value, label }));
const typeLabel = (t: string) => DOC_TYPE_LABEL[t] ?? t;

/* --------------------------------- bits ----------------------------------- */
function DaysLeft({ expiry }: { expiry: string | null }) {
  const d = daysLeft(expiry);
  if (d === null) return <span className="text-xs text-purple">دائمة</span>;
  if (d < 0)
    return (
      <span className="text-xs text-red-600">
        منتهية منذ <span className="num">{-d}</span> يوم
      </span>
    );
  return (
    <span className="text-xs text-purple">
      متبقٍ <span className="num">{d}</span> يوم
    </span>
  );
}

function StatusBadge({ doc, alertDays }: { doc: HrDocument; alertDays: number }) {
  if (!doc.is_active) return <Badge tone="neutral">معطّلة</Badge>;
  if (doc.superseded_by) return <Badge tone="neutral">نسخة مؤرشفة</Badge>;
  const st = docStatus(doc.expiry_date, alertDays);
  return <Badge tone={DOC_STATUS_TONE[st]}>{DOC_STATUS_LABEL[st]}</Badge>;
}

/** PDF / image picker with the same limits as the storage bucket. */
function FilePick({
  file,
  current,
  onPick,
}: {
  file: DocFile | null;
  current: string | null;
  onPick: (f: DocFile | null, error: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-navy-900">الملف (PDF أو صورة · حتى 10 م.ب)</p>
      <div className="relative">
        <input
          ref={ref}
          type="file"
          aria-label="ملف الوثيقة"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return onPick(null, null);
            const picked: DocFile = { name: f.name, type: f.type, size: f.size, blob: f };
            const err = validateDocFile(picked);
            if (err && ref.current) ref.current.value = '';
            onPick(err ? null : picked, err);
          }}
        />
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-navy-100 px-3 py-2.5 text-sm text-purple">
          <Upload size={15} />
          {file ? (
            <span className="truncate text-navy">
              {file.name}{' '}
              <span className="num text-xs text-purple">({fileSizeLabel(file.size)})</span>
            </span>
          ) : current ? (
            <span className="truncate">الحالي: {current} — اختر ملفًا لاستبداله</span>
          ) : (
            'اختر ملفًا لإرفاقه'
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- add / edit form ----------------------------- */
export function DocumentFormModal({
  doc,
  owner,
  defaultType,
  onClose,
}: {
  doc?: HrDocument;
  /** fixed owner (profile / worker file) — hides the person picker */
  owner?: { kind: DocOwnerKind; id: string; name: string };
  defaultType?: string;
  onClose: () => void;
}) {
  const save = useSaveHrDocument();
  const { data: employees = [] } = useEmployees();
  const { data: workers = [] } = useHouseWorkers();
  const [draft, setDraft] = useState<DocumentDraft>(() => ({
    owner_kind: doc?.owner_kind ?? owner?.kind ?? 'employee',
    owner_id: doc?.owner_id ?? owner?.id ?? '',
    type: doc?.type ?? defaultType ?? 'iqama',
    number: doc?.number ?? '',
    issue_date: doc?.issue_date ?? todayIso(),
    expiry_date: doc?.expiry_date ?? '',
    renewal_cost: doc?.renewal_cost ?? 0,
    notes: doc?.notes ?? '',
  }));
  const [file, setFile] = useState<DocFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DocumentDraft>(k: K, v: DocumentDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const people =
    draft.owner_kind === 'employee'
      ? currentEmployees(employees).map((e) => ({
          value: e.id,
          label: `${e.full_name} — ${e.branch}`,
        }))
      : workers.map((w) => ({ value: w.id, label: `${w.full_name} — ${w.branch || 'بلا فرع'}` }));
  const fixedOwner = !!doc || !!owner;
  const ownerName = doc?.owner_name ?? owner?.name ?? '';

  function submit() {
    const err = firstIssue(documentSchema.safeParse(draft));
    if (err) return setError(err);
    setError(null);
    save.mutate({ id: doc?.id ?? null, draft, file }, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title={doc ? 'تعديل وثيقة' : 'إضافة وثيقة'}>
      <div className="space-y-3">
        {fixedOwner ? (
          <p className="rounded-xl bg-navy-50 px-3 py-2 text-sm text-navy">
            {DOC_OWNER_LABEL[draft.owner_kind]}: <span className="font-semibold">{ownerName}</span>
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="صاحب الوثيقة"
              value={draft.owner_kind}
              onChange={(e) => {
                set('owner_kind', e.target.value as DocOwnerKind);
                set('owner_id', '');
              }}
              options={[
                { value: 'employee', label: 'موظف' },
                { value: 'worker', label: 'عاملة / عامل' },
              ]}
            />
            <Select
              label="الاسم"
              value={draft.owner_id}
              onChange={(e) => set('owner_id', e.target.value)}
              options={[{ value: '', label: 'اختر…' }, ...people]}
            />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="نوع الوثيقة"
            value={draft.type}
            onChange={(e) => set('type', e.target.value)}
            options={TYPE_OPTIONS}
          />
          <Input
            label="رقم الوثيقة"
            value={draft.number}
            onChange={(e) => set('number', e.target.value)}
          />
          <Input
            label="تاريخ الإصدار"
            type="date"
            value={draft.issue_date}
            onChange={(e) => set('issue_date', e.target.value)}
          />
          <Input
            label="تاريخ الانتهاء"
            type="date"
            value={draft.expiry_date}
            hint="اتركه فارغًا للوثائق الدائمة"
            onChange={(e) => set('expiry_date', e.target.value)}
          />
          <Input
            label="تكلفة الإصدار/التجديد"
            type="number"
            min={0}
            suffix="ر.س"
            value={draft.renewal_cost}
            disabled={doc?.cost_posted}
            {...(doc?.cost_posted ? { hint: 'مُرحَّلة محاسبيًا — لا تُعدَّل' } : {})}
            onChange={(e) => set('renewal_cost', Number(e.target.value))}
          />
          <Input
            label="ملاحظات"
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
        <FilePick
          file={file}
          current={doc?.file_name ?? null}
          onPick={(f, err) => {
            setFile(f);
            setError(err);
          }}
        />
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button className="w-full" loading={save.isPending} onClick={submit}>
          <FileCheck2 size={16} /> حفظ الوثيقة
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------------- renew ---------------------------------- */
export function RenewDocumentModal({ doc, onClose }: { doc: HrDocument; onClose: () => void }) {
  const renew = useRenewHrDocument();
  const nextYear = (() => {
    const base = doc.expiry_date && doc.expiry_date > todayIso() ? doc.expiry_date : todayIso();
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const [form, setForm] = useState({
    number: doc.number,
    issue_date: todayIso(),
    expiry_date: nextYear,
    renewal_cost: 0,
    notes: '',
  });
  const [file, setFile] = useState<DocFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const err = firstIssue(renewSchema.safeParse(form));
    if (err) return setError(err);
    if (doc.expiry_date && form.expiry_date <= doc.expiry_date)
      return setError(`تاريخ الانتهاء الجديد يجب أن يكون بعد الحالي (${dateAr(doc.expiry_date)})`);
    setError(null);
    renew.mutate({ id: doc.id, input: form, file }, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title={`تجديد ${typeLabel(doc.type)} — ${doc.owner_name}`}>
      <div className="space-y-3">
        <p className="rounded-xl bg-navy-50 px-3 py-2 text-xs text-navy">
          تُحفظ النسخة الحالية في الأرشيف وتُنشأ نسخة جديدة؛ وتُسجَّل تكلفة التجديد لترحيلها في
          المحاسبة (رسوم حكومية).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="رقم الوثيقة"
            value={form.number}
            hint="يبقى كما هو إن لم يتغير"
            onChange={(e) => setForm({ ...form, number: e.target.value })}
          />
          <Input
            label="تكلفة التجديد"
            type="number"
            min={0}
            suffix="ر.س"
            value={form.renewal_cost}
            onChange={(e) => setForm({ ...form, renewal_cost: Number(e.target.value) })}
          />
          <Input
            label="تاريخ التجديد"
            type="date"
            value={form.issue_date}
            onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
          />
          <Input
            label="تاريخ الانتهاء الجديد"
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
          />
        </div>
        <Input
          label="ملاحظات"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <FilePick
          file={file}
          current={null}
          onPick={(f, err) => {
            setFile(f);
            setError(err);
          }}
        />
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button className="w-full" loading={renew.isPending} onClick={submit}>
          <RefreshCw size={16} /> تأكيد التجديد
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------ row actions -------------------------------- */
type Dialog = { kind: 'edit'; doc: HrDocument } | { kind: 'renew'; doc: HrDocument } | null;

function DocActions({
  doc,
  canManage,
  onDialog,
}: {
  doc: HrDocument;
  canManage: boolean;
  onDialog: (d: Dialog) => void;
}) {
  const open = useOpenDocFile();
  const setActive = useSetDocumentActive();
  return (
    <div className="flex flex-wrap items-center gap-1">
      {doc.file_path && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="عرض الملف"
          title={`عرض الملف ${doc.file_name ?? ''}`}
          loading={open.isPending}
          onClick={() => open.mutate(doc.file_path!)}
        >
          <Eye size={15} />
        </Button>
      )}
      {canManage && doc.is_active && !doc.superseded_by && (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-label="تعديل"
            title="تعديل"
            onClick={() => onDialog({ kind: 'edit', doc })}
          >
            <Pencil size={15} />
          </Button>
          {doc.expiry_date && (
            <Button size="sm" variant="outline" onClick={() => onDialog({ kind: 'renew', doc })}>
              <RefreshCw size={14} /> تجديد
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label="تعطيل"
            title="تعطيل (لا حذف نهائي)"
            loading={setActive.isPending}
            onClick={() => setActive.mutate({ id: doc.id, active: false })}
          >
            <Archive size={15} />
          </Button>
        </>
      )}
      {canManage && !doc.is_active && (
        <Button
          size="sm"
          variant="ghost"
          loading={setActive.isPending}
          onClick={() => setActive.mutate({ id: doc.id, active: true })}
        >
          <ArchiveRestore size={15} /> تفعيل
        </Button>
      )}
    </div>
  );
}

function Dialogs({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  if (!dialog) return null;
  return dialog.kind === 'edit' ? (
    <DocumentFormModal doc={dialog.doc} onClose={onClose} />
  ) : (
    <RenewDocumentModal doc={dialog.doc} onClose={onClose} />
  );
}

/* ------------------------------- register ---------------------------------- */
type StatusFilter = 'all' | DocStatus | 'archived';

/** «المستندات» — staff + worker documents with filters, renewal, files and export. */
export function DocumentsRegister() {
  const { can } = usePermissions();
  const canManage = can('hr', 'manage');
  const { data: docs = [], isLoading, isError, refetch } = useHrDocuments();
  const alertDays = useDocAlertDays();
  const [kind, setKind] = useState<'all' | DocOwnerKind>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  const current = docs.filter(isCurrent);
  const count = (s: DocStatus) =>
    current.filter((d) => docStatus(d.expiry_date, alertDays) === s).length;
  const archived = docs.length - current.length;

  const rows = useMemo(() => {
    const term = q.trim();
    return docs.filter((d) => {
      if (status === 'archived' ? isCurrent(d) : !isCurrent(d)) return false;
      if (
        status !== 'all' &&
        status !== 'archived' &&
        docStatus(d.expiry_date, alertDays) !== status
      )
        return false;
      if (kind !== 'all' && d.owner_kind !== kind) return false;
      if (type !== 'all' && d.type !== type) return false;
      if (term && !`${d.owner_name} ${d.number}`.includes(term)) return false;
      return true;
    });
  }, [docs, status, kind, type, q, alertDays]);

  const columns: Column<HrDocument>[] = [
    {
      key: 'owner',
      header: 'صاحب الوثيقة',
      sortValue: (d) => d.owner_name,
      cell: (d) => (
        <div>
          <p className="font-semibold text-navy">{d.owner_name}</p>
          <p className="text-[11px] text-purple">
            {DOC_OWNER_LABEL[d.owner_kind]}
            {d.branch ? ` · ${d.branch}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'الوثيقة',
      sortValue: (d) => typeLabel(d.type),
      cell: (d) => typeLabel(d.type),
    },
    {
      key: 'number',
      header: 'الرقم',
      cell: (d) => <span className="num text-xs">{d.number}</span>,
    },
    {
      key: 'expiry',
      header: 'الانتهاء',
      sortValue: (d) => d.expiry_date ?? '9999',
      cell: (d) => (
        <div>
          <span className="num text-xs">{d.expiry_date ? dateAr(d.expiry_date) : 'دائمة'}</span>
          {d.expiry_date && (
            <div>
              <DaysLeft expiry={d.expiry_date} />
            </div>
          )}
        </div>
      ),
    },
    { key: 'status', header: 'الحالة', cell: (d) => <StatusBadge doc={d} alertDays={alertDays} /> },
    {
      key: 'cost',
      header: 'التكلفة',
      cell: (d) =>
        d.renewal_cost > 0 ? (
          <div>
            <span className="num text-xs">{sar(d.renewal_cost)}</span>
            <div className="text-[11px] text-purple">
              {d.cost_posted ? 'مُرحَّلة' : 'بانتظار المحاسبة'}
            </div>
          </div>
        ) : (
          <span className="text-xs text-purple">—</span>
        ),
    },
    {
      key: 'file',
      header: 'الملف',
      cell: (d) =>
        d.file_path ? (
          <span className="inline-flex items-center gap-1 text-xs text-navy">
            <FileText size={13} /> مرفق
          </span>
        ) : (
          <span className="text-xs text-purple">بلا ملف</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      cell: (d) => <DocActions doc={d} canManage={canManage} onDialog={setDialog} />,
    },
  ];

  function exportRows() {
    exportCsv({
      title: 'سجل الوثائق',
      subtitle: `نافذة التنبيه ${alertDays} يوم — ${dateAr(todayIso())}`,
      headers: [
        'صاحب الوثيقة',
        'النوع',
        'الفرع',
        'الوثيقة',
        'الرقم',
        'الإصدار',
        'الانتهاء',
        'الأيام المتبقية',
        'الحالة',
        'التكلفة',
      ],
      rows: rows.map((d) => [
        d.owner_name,
        DOC_OWNER_LABEL[d.owner_kind],
        d.branch,
        typeLabel(d.type),
        d.number,
        d.issue_date ?? '',
        d.expiry_date ?? 'دائمة',
        daysLeft(d.expiry_date) ?? '',
        isCurrent(d) ? DOC_STATUS_LABEL[docStatus(d.expiry_date, alertDays)] : 'مؤرشفة/معطّلة',
        d.renewal_cost,
      ]),
    });
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="سارية"
          value={count('valid')}
          tone="success"
          icon={FileCheck2}
          active={status === 'valid'}
          onClick={() => setStatus(status === 'valid' ? 'all' : 'valid')}
        />
        <StatTile
          label="قاربت الانتهاء"
          value={count('expiring')}
          tone="warning"
          icon={AlertTriangle}
          active={status === 'expiring'}
          onClick={() => setStatus(status === 'expiring' ? 'all' : 'expiring')}
        />
        <StatTile
          label="منتهية"
          value={count('expired')}
          tone="danger"
          icon={AlertTriangle}
          active={status === 'expired'}
          onClick={() => setStatus(status === 'expired' ? 'all' : 'expired')}
        />
        <StatTile
          label="الأرشيف والمعطّلة"
          value={archived}
          tone="neutral"
          icon={Archive}
          active={status === 'archived'}
          onClick={() => setStatus(status === 'archived' ? 'all' : 'archived')}
        />
      </div>
      {count('expiring') + count('expired') > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertTriangle size={16} /> يوجد{' '}
          <span className="num">{count('expiring') + count('expired')}</span> وثيقة تحتاج تجديدًا
          (نافذة التنبيه <span className="num">{alertDays}</span> يوم).
        </div>
      )}
      <Card className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          aria-label="بحث"
          placeholder="بحث بالاسم أو الرقم"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          aria-label="صاحب الوثيقة"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'all' | DocOwnerKind)}
          options={[
            { value: 'all', label: 'الموظفون والعمالة' },
            { value: 'employee', label: 'الموظفون' },
            { value: 'worker', label: 'العمالة' },
          ]}
        />
        <Select
          aria-label="نوع الوثيقة"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[{ value: 'all', label: 'كل الأنواع' }, ...TYPE_OPTIONS]}
        />
        <Select
          aria-label="الحالة"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          options={[
            { value: 'all', label: 'كل الوثائق الحالية' },
            ...(Object.keys(DOC_STATUS_LABEL) as DocStatus[]).map((s) => ({
              value: s,
              label: DOC_STATUS_LABEL[s],
            })),
            { value: 'archived', label: 'الأرشيف والمعطّلة' },
          ]}
        />
        <div className="flex gap-2">
          {canManage && (
            <Button className="flex-1" onClick={() => setAdding(true)}>
              <Plus size={16} /> وثيقة
            </Button>
          )}
          <Button
            variant="outline"
            aria-label="تصدير"
            onClick={exportRows}
            disabled={rows.length === 0}
          >
            <Download size={16} />
          </Button>
        </div>
      </Card>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد وثائق مطابقة"
      />
      {adding && <DocumentFormModal onClose={() => setAdding(false)} />}
      <Dialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/* ---------------------------- iqamas & visas -------------------------------- */
/** «التأشيرات والإقامات» — iqama register (staff + workers) and current visas. */
export function IqamasVisasBoard() {
  const { can } = usePermissions();
  const canManage = can('hr', 'manage');
  const { data: docs = [], isLoading, isError, refetch } = useHrDocuments();
  const alertDays = useDocAlertDays();
  const [kind, setKind] = useState<'all' | DocOwnerKind>('all');
  const [adding, setAdding] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const register = iqamaRegister(docs, alertDays).filter(
    (r) => kind === 'all' || r.doc.owner_kind === kind,
  );
  const visas = docs
    .filter((d) => isCurrent(d) && d.type === 'visa')
    .filter((d) => kind === 'all' || d.owner_kind === kind);
  const due = register.filter((r) => r.status !== 'valid').length;
  const noPermit = register.filter((r) => !r.work_permit).length;

  const iqamaCols: Column<IqamaRow>[] = [
    {
      key: 'name',
      header: 'الاسم',
      sortValue: (r) => r.doc.owner_name,
      cell: (r) => (
        <div>
          <p className="font-semibold text-navy">{r.doc.owner_name}</p>
          <p className="text-[11px] text-purple">
            {DOC_OWNER_LABEL[r.doc.owner_kind]}
            {r.doc.branch ? ` · ${r.doc.branch}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'no',
      header: 'رقم الإقامة',
      cell: (r) => <span className="num text-xs">{r.doc.number}</span>,
    },
    { key: 'profession', header: 'المهنة', cell: (r) => r.doc.profession || '—' },
    {
      key: 'expiry',
      header: 'الانتهاء',
      sortValue: (r) => r.doc.expiry_date ?? '9999',
      cell: (r) => (
        <div>
          <span className="num text-xs">{r.doc.expiry_date ? dateAr(r.doc.expiry_date) : '—'}</span>
          <div>
            <DaysLeft expiry={r.doc.expiry_date} />
          </div>
        </div>
      ),
    },
    {
      key: 'permit',
      header: 'رخصة العمل',
      cell: (r) => (
        <Badge tone={r.work_permit ? 'success' : 'danger'}>
          {r.work_permit ? 'سارية' : 'غير سارية/غير مسجّلة'}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => <Badge tone={DOC_STATUS_TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => <DocActions doc={r.doc} canManage={canManage} onDialog={setDialog} />,
    },
  ];

  const visaCols: Column<HrDocument>[] = [
    {
      key: 'name',
      header: 'الاسم',
      cell: (d) => <span className="font-semibold text-navy">{d.owner_name}</span>,
    },
    {
      key: 'no',
      header: 'رقم التأشيرة',
      cell: (d) => <span className="num text-xs">{d.number}</span>,
    },
    {
      key: 'expiry',
      header: 'الانتهاء',
      cell: (d) => (
        <div>
          <span className="num text-xs">{d.expiry_date ? dateAr(d.expiry_date) : '—'}</span>
          <div>
            <DaysLeft expiry={d.expiry_date} />
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'الحالة', cell: (d) => <StatusBadge doc={d} alertDays={alertDays} /> },
    {
      key: 'actions',
      header: '',
      cell: (d) => <DocActions doc={d} canManage={canManage} onDialog={setDialog} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="الإقامات المسجّلة" value={register.length} icon={FileText} />
        <StatTile label="تحتاج تجديدًا" value={due} tone="warning" icon={AlertTriangle} />
        <StatTile label="بلا رخصة عمل سارية" value={noPermit} tone="danger" icon={AlertTriangle} />
        <StatTile label="تأشيرات حالية" value={visas.length} icon={FileCheck2} />
      </div>
      {due > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertTriangle size={16} /> <span className="num">{due}</span> إقامة تنتهي خلال{' '}
          <span className="num">{alertDays}</span> يوم أو انتهت — تابع التجديد عبر مقيم/أبشر أعمال.
        </div>
      )}
      <Card className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="الفئة"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'all' | DocOwnerKind)}
          options={[
            { value: 'all', label: 'الموظفون والعمالة' },
            { value: 'employee', label: 'الموظفون' },
            { value: 'worker', label: 'العمالة' },
          ]}
        />
        {canManage && (
          <>
            <Button onClick={() => setAdding('iqama')}>
              <Plus size={16} /> إقامة
            </Button>
            <Button variant="outline" onClick={() => setAdding('work_permit')}>
              <Plus size={16} /> رخصة عمل
            </Button>
            <Button variant="outline" onClick={() => setAdding('visa')}>
              <Plus size={16} /> تأشيرة
            </Button>
          </>
        )}
      </Card>
      <Table
        columns={iqamaCols}
        rows={register}
        rowKey={(r) => r.doc.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد إقامات"
      />
      <h3 className="pt-2 text-sm font-bold text-navy">التأشيرات</h3>
      <Table
        columns={visaCols}
        rows={visas}
        rowKey={(d) => d.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد تأشيرات حالية"
      />
      {adding && <DocumentFormModal defaultType={adding} onClose={() => setAdding(null)} />}
      <Dialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/* ------------------------- one person's documents --------------------------- */
/** Documents tab of an employee profile / worker file. */
export function OwnerDocuments({
  kind,
  ownerId,
  ownerName,
  editable,
}: {
  kind: DocOwnerKind;
  ownerId: string;
  ownerName: string;
  editable: boolean;
}) {
  const { data: docs = [], isLoading, isError, refetch } = useHrDocuments();
  const alertDays = useDocAlertDays();
  const [showArchive, setShowArchive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const mine = docs.filter((d) => d.owner_kind === kind && d.owner_id === ownerId);
  const current = mine.filter(isCurrent);
  const old = mine.filter((d) => !isCurrent(d));
  const list = showArchive ? old : current;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={showArchive ? 'ghost' : 'primary'}
            onClick={() => setShowArchive(false)}
          >
            الحالية{' '}
            <span className="num rounded-full bg-navy-50 px-1.5 text-[11px] text-navy">
              {current.length}
            </span>
          </Button>
          <Button
            size="sm"
            variant={showArchive ? 'primary' : 'ghost'}
            onClick={() => setShowArchive(true)}
          >
            الأرشيف{' '}
            <span className="num rounded-full bg-navy-50 px-1.5 text-[11px] text-navy">
              {old.length}
            </span>
          </Button>
        </div>
        {editable && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={15} /> إضافة وثيقة
          </Button>
        )}
      </div>
      {isLoading ? (
        <Card className="py-6 text-center text-sm text-purple">جارٍ التحميل…</Card>
      ) : isError ? (
        <Card className="flex items-center justify-between py-4 text-sm text-red-700">
          تعذّر تحميل الوثائق
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : list.length === 0 ? (
        <Card className="py-6 text-center text-sm text-purple">
          {showArchive ? 'لا توجد نسخ مؤرشفة.' : `لا توجد وثائق لـ${ownerName} بعد.`}
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-50 px-3 py-2"
            >
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                  {typeLabel(d.type)} <StatusBadge doc={d} alertDays={alertDays} />
                </p>
                <p className="text-[11px] text-purple">
                  <span className="num">{d.number}</span> · انتهاء:{' '}
                  <span className="num">{d.expiry_date ? dateAr(d.expiry_date) : 'دائمة'}</span>
                  {d.renewal_cost > 0 && (
                    <>
                      {' · '}تكلفة <span className="num">{sar(d.renewal_cost)}</span>
                    </>
                  )}
                </p>
              </div>
              <DocActions doc={d} canManage={editable} onDialog={setDialog} />
            </div>
          ))}
        </div>
      )}
      {adding && (
        <DocumentFormModal
          owner={{ kind, id: ownerId, name: ownerName }}
          onClose={() => setAdding(false)}
        />
      )}
      <Dialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/* ------------------------------- settings ---------------------------------- */
/** «تنبيهات الوثائق» — the managed alert window (app_config.doc_expiry_alert_days). */
export function DocAlertSettings({ editable }: { editable: boolean }) {
  const current = useDocAlertDays();
  const update = useUpdateConfig();
  const [value, setValue] = useState<string | null>(null);
  const shown = value ?? String(current);
  const n = Number(shown);
  const invalid = !Number.isInteger(n) || n < 1 || n > 365;

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <BellRing size={18} className="text-gold-600" />
        <h3 className="text-sm font-bold text-navy">تنبيهات انتهاء الوثائق والإقامات</h3>
      </div>
      <p className="text-xs text-purple">
        تظهر الوثيقة «قاربت الانتهاء» في لوحة الموارد البشرية ولوحة الشركة وسجل الوثائق قبل انتهائها
        بهذه المدة — للموظفين والعمالة.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input
            label="التنبيه قبل"
            type="number"
            min={1}
            max={365}
            suffix="يوم"
            value={shown}
            disabled={!editable}
            {...(invalid ? { error: 'من 1 إلى 365 يومًا' } : {})}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {editable && (
          <Button
            loading={update.isPending}
            disabled={invalid || n === current}
            onClick={() =>
              update.mutate(
                { key: DOC_ALERT_DAYS_KEY, value: n },
                { onSuccess: () => setValue(null) },
              )
            }
          >
            <Save size={16} /> حفظ
          </Button>
        )}
      </div>
    </Card>
  );
}
