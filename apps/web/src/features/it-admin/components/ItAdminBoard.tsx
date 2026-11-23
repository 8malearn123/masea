import { useState } from 'react';
import {
  AtSign,
  CheckCircle2,
  KeyRound,
  Mail,
  Plus,
  ShieldCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Modal,
  Select,
  Skeleton,
  StatTile,
  Table,
  type BadgeTone,
} from '@/shared/ui';
import { dateAr, dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useAccountRequests,
  useCancelRequest,
  useDecideRequest,
  useExecuteRequest,
  useMailAccounts,
  useOwnership,
  useSubmitRequest,
  useUpdateOwnership,
} from '@/features/it-admin/hooks/useItAdmin';
import {
  ACCOUNT_STATUS_LABEL,
  DOMAIN_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  REQUEST_TYPE_LABEL,
  requestSchema,
  type AccountRequest,
  type AccountStatus,
  type DomainStatus,
  type MailAccount,
  type MailOwnership,
  type RequestStatus,
  type RequestType,
} from '@/features/it-admin/api/itAdmin.api';

const ACCOUNT_TONE: Record<AccountStatus, BadgeTone> = {
  requested: 'gold',
  active: 'success',
  suspended: 'navy',
  disabled: 'neutral',
  deleted: 'danger',
};
const REQUEST_TONE: Record<RequestStatus, BadgeTone> = {
  pending: 'gold',
  approved: 'navy',
  rejected: 'danger',
  done: 'success',
  cancelled: 'neutral',
};
type Tab = 'accounts' | 'requests' | 'ownership';

function RequestModal({
  account,
  type,
  onClose,
}: {
  account: MailAccount | null;
  type: RequestType;
  onClose: () => void;
}) {
  const submit = useSubmitRequest();
  const [employeeName, setName] = useState(account?.display_name ?? '');
  const [address, setAddress] = useState('');
  const [displayName, setDisplay] = useState(account?.display_name ?? '');
  const [groups, setGroups] = useState((account?.groups ?? []).join('، '));
  const [reason, setReason] = useState('');
  const input = {
    type,
    accountId: account?.id ?? null,
    employeeName,
    address: type === 'create' ? address : undefined,
    displayName: type === 'create' || type === 'modify' ? displayName : undefined,
    groups:
      type === 'group_change'
        ? groups
            .split(/[،,]/)
            .map((g) => g.trim())
            .filter(Boolean)
        : undefined,
    reason,
  };
  const parsed = requestSchema.safeParse(input);
  const err = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  return (
    <Modal open onClose={onClose} title={REQUEST_TYPE_LABEL[type]}>
      <div className="space-y-3">
        {account && (
          <p className="num rounded-lg bg-navy-50 p-2 text-sm" dir="ltr">
            {account.address}
          </p>
        )}
        <Input label="اسم الموظف" value={employeeName} onChange={(e) => setName(e.target.value)} />
        {type === 'create' && (
          <Input
            label="البريد المطلوب"
            dir="ltr"
            className="num"
            placeholder="name@masiatalsharq.com"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        )}
        {(type === 'create' || type === 'modify') && (
          <Input
            label="الاسم الظاهر"
            value={displayName}
            onChange={(e) => setDisplay(e.target.value)}
          />
        )}
        {type === 'group_change' && (
          <Input
            label="المجموعات (افصل بفاصلة)"
            value={groups}
            onChange={(e) => setGroups(e.target.value)}
          />
        )}
        <Input label="سبب الطلب" value={reason} onChange={(e) => setReason(e.target.value)} />
        {type === 'reset_password' && (
          <p className="text-[11px] text-purple">
            تُعاد كلمة المرور من لوحة المزوّد وتُسلَّم للموظف مباشرة — لا تُكتب هنا.
          </p>
        )}
        {err && <p className="text-[11px] text-gold-600">{err}</p>}
        <Button
          className="w-full"
          disabled={Boolean(err)}
          loading={submit.isPending}
          onClick={() => submit.mutate(input, { onSuccess: onClose })}
        >
          تسجيل الطلب
        </Button>
      </div>
    </Modal>
  );
}

function AccountsTab() {
  const { can } = usePermissions();
  const { data = [], isLoading, isError, refetch } = useMailAccounts();
  const [modal, setModal] = useState<{ account: MailAccount | null; type: RequestType } | null>(
    null,
  );
  const counts = (s: AccountStatus) => data.filter((a) => a.status === s).length;
  const canAsk = can('it_admin', 'create');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="إجمالي الحسابات" value={data.length} icon={Mail} />
        <StatTile
          label="مطلوبة — لم تُنشأ"
          value={counts('requested')}
          icon={AtSign}
          tone="warning"
        />
        <StatTile label="نشطة" value={counts('active')} icon={CheckCircle2} tone="success" />
        <StatTile
          label="معطّلة/موقوفة"
          value={counts('disabled') + counts('suspended')}
          icon={UserX}
          tone="neutral"
        />
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy">الحسابات على دومين الشركة</h2>
          {canAsk && (
            <Button size="sm" onClick={() => setModal({ account: null, type: 'create' })}>
              <Plus size={14} /> طلب حساب جديد
            </Button>
          )}
        </div>
        <Table<MailAccount>
          rows={data}
          rowKey={(a) => a.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          emptyTitle="لا حسابات"
          columns={[
            {
              key: 'address',
              header: 'البريد',
              sortValue: (a) => a.address,
              cell: (a) => (
                <span className="num" dir="ltr">
                  {a.address}
                </span>
              ),
            },
            { key: 'name', header: 'الموظف', cell: (a) => a.display_name },
            {
              key: 'mfa',
              header: 'MFA',
              cell: (a) =>
                a.mfa_enabled ? (
                  <Badge tone="success">مفعّل</Badge>
                ) : (
                  <Badge tone="neutral">—</Badge>
                ),
            },
            {
              key: 'groups',
              header: 'المجموعات',
              cell: (a) => (a.groups.length ? a.groups.join('، ') : '—'),
            },
            {
              key: 'status',
              header: 'الحالة',
              cell: (a) => (
                <div>
                  <Badge tone={ACCOUNT_TONE[a.status]}>{ACCOUNT_STATUS_LABEL[a.status]}</Badge>
                  {a.note && <p className="mt-1 text-[11px] text-gold-600">{a.note}</p>}
                </div>
              ),
            },
            {
              key: 'act',
              header: 'طلب',
              cell: (a) =>
                canAsk && a.status !== 'deleted' && a.status !== 'requested' ? (
                  <Select
                    aria-label="نوع الطلب"
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      setModal({ account: a, type: e.target.value as RequestType })
                    }
                    options={[
                      { value: '', label: 'اختر…' },
                      ...(a.status === 'active'
                        ? ([
                            'reset_password',
                            'modify',
                            'group_change',
                            'suspend',
                            'disable',
                          ] as RequestType[])
                        : (['reactivate', 'delete'] as RequestType[])
                      ).map((t) => ({ value: t, label: REQUEST_TYPE_LABEL[t] })),
                    ]}
                  />
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>
      {modal && (
        <RequestModal account={modal.account} type={modal.type} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function RequestsTab() {
  const { can } = usePermissions();
  const { data = [], isLoading, isError, refetch } = useAccountRequests();
  const decide = useDecideRequest();
  const execute = useExecuteRequest();
  const cancel = useCancelRequest();
  const [status, setStatus] = useState<RequestStatus | 'all'>('pending');
  const [action, setAction] = useState<{ r: AccountRequest; kind: 'reject' | 'execute' } | null>(
    null,
  );
  const [note, setNote] = useState('');
  const rows = data.filter((r) => status === 'all' || r.status === status);
  const busy = decide.isPending || execute.isPending || cancel.isPending;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-navy">سجل طلبات الحسابات</h2>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as RequestStatus | 'all')}
          options={[
            { value: 'all', label: 'كل الحالات' },
            ...(Object.keys(REQUEST_STATUS_LABEL) as RequestStatus[]).map((s) => ({
              value: s,
              label: REQUEST_STATUS_LABEL[s],
            })),
          ]}
        />
      </div>
      <Table<AccountRequest>
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا طلبات بهذه الحالة"
        columns={[
          {
            key: 'no',
            header: 'الرقم',
            sortValue: (r) => r.request_no,
            cell: (r) => <span className="num">{r.request_no}</span>,
          },
          { key: 'emp', header: 'الموظف', cell: (r) => r.employee_name },
          {
            key: 'type',
            header: 'الطلب',
            cell: (r) => (
              <div>
                {REQUEST_TYPE_LABEL[r.request_type]}
                {r.details.address && (
                  <p className="num text-[11px] text-purple" dir="ltr">
                    {r.details.address}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: 'by',
            header: 'الطالب',
            cell: (r) => r.requested_by_name ?? (r.requested_by ? '—' : 'قائمة الشركة'),
          },
          { key: 'ap', header: 'المعتمد', cell: (r) => r.approved_by_name ?? '—' },
          { key: 'ex', header: 'المنفّذ', cell: (r) => r.executed_by_name ?? '—' },
          {
            key: 'date',
            header: 'التاريخ',
            sortValue: (r) => r.requested_at,
            cell: (r) => (
              <div className="num text-[11px]">
                <p>{dateAr(r.requested_at)}</p>
                {r.executed_at && <p className="text-teal">{dateTimeAr(r.executed_at)}</p>}
              </div>
            ),
          },
          {
            key: 'st',
            header: 'الحالة',
            cell: (r) => (
              <Badge tone={REQUEST_TONE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
            ),
          },
          {
            key: 'act',
            header: '',
            cell: (r) => (
              <div className="flex flex-wrap gap-1">
                {r.status === 'pending' && can('it_admin', 'approve') && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => decide.mutate({ r, approve: true })}
                    >
                      اعتماد
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => setAction({ r, kind: 'reject' })}
                    >
                      <XCircle size={13} />
                    </Button>
                  </>
                )}
                {r.status === 'approved' && can('it_admin', 'edit') && (
                  <Button
                    size="sm"
                    variant="success"
                    disabled={busy}
                    onClick={() => setAction({ r, kind: 'execute' })}
                  >
                    تسجيل التنفيذ
                  </Button>
                )}
                {['pending', 'approved'].includes(r.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => cancel.mutate(r)}
                  >
                    إلغاء
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <Modal
        open={action !== null}
        onClose={() => setAction(null)}
        title={action?.kind === 'reject' ? 'رفض الطلب' : 'تسجيل التنفيذ في لوحة المزوّد'}
      >
        {action?.kind === 'execute' && (
          <p className="mb-2 text-[11px] text-purple">
            نفّذ الإجراء في لوحة إدارة البريد أولاً ثم سجّله هنا. لا تكتب كلمات مرور.
          </p>
        )}
        <Input
          label={action?.kind === 'reject' ? 'سبب الرفض' : 'ملاحظة التنفيذ'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          className="mt-3 w-full"
          variant={action?.kind === 'reject' ? 'danger' : 'success'}
          disabled={busy || (action?.kind === 'reject' && !note.trim())}
          onClick={() => {
            if (!action) return;
            const done = {
              onSuccess: () => {
                setAction(null);
                setNote('');
              },
            };
            if (action.kind === 'reject')
              decide.mutate({ r: action.r, approve: false, note }, done);
            else execute.mutate({ r: action.r, note }, done);
          }}
        >
          تأكيد
        </Button>
      </Modal>
    </Card>
  );
}

function OwnershipTab() {
  const { can } = usePermissions();
  const { data, isLoading, isError, refetch } = useOwnership();
  if (isLoading)
    return (
      <Card>
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;
  return (
    <OwnershipForm key={data.updated_at} initial={data} editable={can('it_admin', 'manage')} />
  );
}

function OwnershipForm({ initial, editable }: { initial: MailOwnership; editable: boolean }) {
  const save = useUpdateOwnership();
  const [f, setF] = useState(initial);
  const set = (p: Partial<MailOwnership>) => setF((x) => ({ ...x, ...p }));
  const text = (k: keyof MailOwnership, label: string, ltr = false) => (
    <Input
      label={label}
      dir={ltr ? 'ltr' : undefined}
      disabled={!editable}
      value={(f[k] as string | null) ?? ''}
      onChange={(e) => set({ [k]: e.target.value || null } as Partial<MailOwnership>)}
    />
  );
  const flag = (
    k: 'mfa_enforced' | 'dns_mx' | 'dns_spf' | 'dns_dkim' | 'dns_dmarc',
    label: string,
  ) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        disabled={!editable}
        checked={f[k]}
        onChange={(e) => set({ [k]: e.target.checked })}
      />
      {label}
    </label>
  );
  const ownershipIssues = [
    !f.registrant_name && 'اسم المسجّل (يجب أن يكون الشركة)',
    !f.super_admin_email && 'حساب Super Admin مملوك للشركة',
    !f.backup_admin_email && 'حساب إدارة احتياطي',
    !f.mfa_enforced && 'إلزام المصادقة متعددة العوامل',
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <ShieldCheck size={16} /> ملكية الدومين والبريد (باسم الشركة حصراً)
        </h2>
        {ownershipIssues.length > 0 && (
          <p className="mb-3 rounded-lg bg-gold-100 p-2 text-xs text-navy">
            ناقص لضمان ملكية الشركة: {ownershipIssues.join('، ')}.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {text('domain', 'الدومين', true)}
          <Select
            label="حالة الدومين"
            disabled={!editable}
            value={f.domain_status}
            onChange={(e) => set({ domain_status: e.target.value as DomainStatus })}
            options={(Object.keys(DOMAIN_STATUS_LABEL) as DomainStatus[]).map((s) => ({
              value: s,
              label: DOMAIN_STATUS_LABEL[s],
            }))}
          />
          {text('registrar', 'المسجّل المعتمد')}
          {text('registrant_name', 'اسم المسجّل (الشركة)')}
          {text('registrar_account', 'حساب المسجّل (بريد الشركة الإداري)', true)}
          {text('provider', 'مزوّد البريد')}
          {text('billing_owner', 'الفوترة باسم')}
          {text('super_admin_email', 'Super Admin (للشركة)', true)}
          {text('backup_admin_email', 'حساب الإدارة الاحتياطي (للشركة)', true)}
          <Input
            label="تاريخ التجديد"
            type="date"
            disabled={!editable}
            value={f.renewal_date ?? ''}
            onChange={(e) => set({ renewal_date: e.target.value || null })}
          />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {flag('mfa_enforced', 'MFA مفروض على كل الحسابات')}
          {flag('dns_mx', 'سجل MX')}
          {flag('dns_spf', 'سجل SPF')}
          {flag('dns_dkim', 'سجل DKIM')}
          {flag('dns_dmarc', 'سجل DMARC')}
        </div>
        <div className="mt-3">{text('notes', 'ملاحظات')}</div>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-purple">
          <KeyRound size={12} /> لا تُحفظ كلمات المرور هنا — تُسلَّم للشركة عبر قناة آمنة (مدير
          كلمات مرور).
        </p>
        {editable && (
          <Button className="mt-3" loading={save.isPending} onClick={() => save.mutate(f)}>
            حفظ
          </Button>
        )}
      </Card>
    </div>
  );
}

/** «البريد المؤسسي» — سجل الحسابات وطلباتها وملكية الدومين (0093). */
export default function ItAdminBoard() {
  const [tab, setTab] = useState<Tab>('accounts');
  const TABS: { key: Tab; label: string }[] = [
    { key: 'accounts', label: 'الحسابات' },
    { key: 'requests', label: 'سجل الطلبات' },
    { key: 'ownership', label: 'الملكية والدومين' },
  ];
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <AtSign size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">البريد المؤسسي</h1>
          <p className="text-sm text-purple">
            طلبات الإنشاء والتعديل والتعطيل بأربع أعين — الملكية والتحكم النهائي للشركة.
          </p>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2 border-b border-navy-100">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-3 py-2.5 text-sm font-medium ${tab === t.key ? 'border-navy text-navy' : 'border-transparent text-purple hover:text-navy'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'accounts' ? (
        <AccountsTab />
      ) : tab === 'requests' ? (
        <RequestsTab />
      ) : (
        <OwnershipTab />
      )}
    </div>
  );
}
