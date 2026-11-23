import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Plus, Search, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type BadgeTone } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { BRANCHES_AR } from '@/lib/funnel';
import { useCustomerSearch } from '@/features/contracts/hooks/useCustomers';
import { useCreateTrial, useTrials, useTrialTerms } from '@/features/contracts/hooks/useTrials';
import {
  createTrialSchema,
  TRIAL_STATUS_LABEL,
  type Trial,
  type TrialStatus,
} from '@/features/contracts/api/trials.api';
import type { CustomerLite } from '@/features/contracts/api/customers.api';

export const TRIAL_TONE: Record<TrialStatus, BadgeTone> = {
  draft: 'neutral',
  awaiting_acceptance: 'gold',
  accepted: 'navy',
  awaiting_handover: 'gold',
  in_trial: 'teal',
  completed: 'navy',
  wants_transfer: 'success',
  declined: 'danger',
  cancelled: 'neutral',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewTrialModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const { data: customers = [] } = useCustomerSearch(q);
  const { data: workers = [] } = useWorkerProfiles();
  const create = useCreateTrial();
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [workerId, setWorkerId] = useState('');
  const [branch, setBranch] = useState<string>(BRANCHES_AR[0]);
  const [price, setPrice] = useState(0);
  const [days, setDays] = useState(7);
  const [receipt, setReceipt] = useState(today());
  const worker = workers.find((w) => w.id === workerId);
  const input = {
    customerId: customer?.id ?? '',
    customerName: customer?.full_name ?? null,
    customerNationalId: customer?.national_id ?? null,
    customerPhone: customer?.phone ?? null,
    workerId,
    workerName: worker?.full_name ?? null,
    branch,
    price,
    days,
    receiptDate: receipt,
  };
  const parsed = createTrialSchema.safeParse(input);
  const err = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  const idMissing = customer && (!customer.national_id || !customer.phone);

  return (
    <Modal open onClose={onClose} title="تجربة عاملة بغرض نقل الخدمات" size="lg">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {customer ? (
            <div className="flex items-center justify-between rounded-xl bg-navy-50 p-3 text-sm">
              <span>
                {customer.full_name} · <span className="num">{customer.phone ?? '—'}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                تغيير
              </Button>
            </div>
          ) : (
            <>
              <Input
                label="العميل"
                placeholder="ابحث بالاسم"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-navy-50">
                {customers.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-right text-sm hover:bg-navy-50"
                      onClick={() => setCustomer(c)}
                    >
                      {c.full_name} <span className="num text-purple">{c.phone ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {idMissing && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-gold-600">
              <TriangleAlert size={12} /> سجّل رقم الهوية والجوال في ملف العميل — يُستخدمان للتحقق
              عند القبول.
            </p>
          )}
        </div>
        <Select
          label="العاملة (المتاحات)"
          placeholder="اختر"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          options={workers
            .filter((w) => w.status === 'available')
            .map((w) => ({
              value: w.id,
              label: `${w.full_name} · ${w.nationality} · ${w.profession}`,
            }))}
        />
        <Select
          label="الفرع"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          options={BRANCHES_AR.map((b) => ({ value: b, label: b }))}
        />
        <Input
          label="سعر التجربة المتفق عليه (قبل الضريبة)"
          type="number"
          min={0}
          suffix="ر.س"
          value={price || ''}
          onChange={(e) => setPrice(Number(e.target.value))}
        />
        <Input
          label="عدد أيام التجربة"
          type="number"
          min={1}
          suffix="يوم"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <Input
          label="تاريخ استلام العاملة"
          type="date"
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
        />
      </div>
      <p className="mt-3 text-[11px] text-purple">
        التجربة لا تُعد نقل خدمات؛ النقل الفعلي عبر منصة مساند بعد انتهائها وبرغبة العميل.
      </p>
      {err && <p className="mt-2 text-[11px] text-gold-600">{err}</p>}
      <Button
        className="mt-3 w-full"
        disabled={Boolean(err)}
        loading={create.isPending}
        onClick={() => create.mutate(input, { onSuccess: onClose })}
      >
        إنشاء التجربة
      </Button>
    </Modal>
  );
}

/** «تجارب نقل الخدمات» — قائمة التجارب وإنشاء تجربة جديدة. */
export default function TrialsBoard() {
  const { can } = usePermissions();
  const { data: trials = [], isLoading, isError, refetch } = useTrials();
  const { data: terms = [] } = useTrialTerms();
  const [status, setStatus] = useState<TrialStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const approved = terms.some((t) => t.status === 'approved');
  const rows = trials.filter(
    (t) =>
      (status === 'all' || t.status === status) &&
      (!search.trim() ||
        [t.trial_no, t.customer_name, t.worker_name].some((v) => v?.includes(search.trim()))),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <FlaskConical size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">تجارب نقل الخدمات</h1>
            <p className="text-sm text-purple">
              تجربة العاملة لدى العميل بقبول إلكتروني قبل إجراءات مساند.
            </p>
          </div>
        </div>
        {can('contracts', 'create') && (
          <Button disabled={!approved} onClick={() => setCreating(true)}>
            <Plus size={16} /> تجربة جديدة
          </Button>
        )}
      </div>
      {!approved && (
        <Card>
          <p className="flex items-center gap-2 text-sm text-gold-600">
            <TriangleAlert size={16} /> لا توجد شروط تجربة معتمدة. تكتبها الشركة وتعتمدها من{' '}
            <Link to="/settings" className="font-semibold underline">
              الإعدادات ← عمليات العقود
            </Link>
            .
          </p>
        </Card>
      )}

      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search size={15} className="absolute right-3 top-3 text-purple" />
            <Input
              className="pr-9"
              placeholder="رقم التجربة أو العميل أو العاملة"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as TrialStatus | 'all')}
            options={[
              { value: 'all', label: 'كل الحالات' },
              ...(Object.keys(TRIAL_STATUS_LABEL) as TrialStatus[]).map((s) => ({
                value: s,
                label: TRIAL_STATUS_LABEL[s],
              })),
            ]}
          />
        </div>
        <Table<Trial>
          rows={rows}
          rowKey={(t) => t.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          emptyTitle="لا تجارب — أنشئ تجربة بعد اعتماد شروطها"
          columns={[
            {
              key: 'no',
              header: 'الرقم',
              sortValue: (t) => t.trial_no,
              cell: (t) => (
                <Link
                  to={`/contracts/${t.contract_id}`}
                  className="num font-semibold text-navy hover:underline"
                >
                  {t.trial_no}
                </Link>
              ),
            },
            { key: 'customer', header: 'العميل', cell: (t) => t.customer_name ?? '—' },
            { key: 'worker', header: 'العاملة', cell: (t) => t.worker_name ?? '—' },
            {
              key: 'total',
              header: 'السعر',
              sortValue: (t) => t.total_amount,
              cell: (t) => <span className="num">{sar(t.total_amount)}</span>,
            },
            {
              key: 'days',
              header: 'الأيام',
              cell: (t) => <span className="num">{t.trial_days}</span>,
            },
            {
              key: 'period',
              header: 'الاستلام ← النهاية',
              sortValue: (t) => t.end_date,
              cell: (t) => (
                <span className="num">
                  {dateAr(t.receipt_date)} ← {dateAr(t.end_date)}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'الحالة',
              cell: (t) => (
                <Badge tone={TRIAL_TONE[t.status]}>{TRIAL_STATUS_LABEL[t.status]}</Badge>
              ),
            },
          ]}
        />
      </Card>
      {creating && <NewTrialModal onClose={() => setCreating(false)} />}
    </div>
  );
}
