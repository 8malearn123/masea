import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, History, Plus, Truck, UserRound } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Select,
  Skeleton,
  type BadgeTone,
  useToast,
} from '@/shared/ui';
import { dateAr, dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { contractKeys } from '@/features/contracts/api/keys';
import { opsKeys } from '@/features/contracts/hooks/useContractOps';
import {
  createDriverTask,
  driverAvailability,
  driverTaskSchema,
  driverTaskStep,
  listDriverTasks,
  listWorkerCandidates,
  TASK_KIND_LABEL,
  TASK_STATUS_LABEL,
  workerDoc,
  workerHistory,
  WORKER_STATUS_LABEL,
  type DriverTask,
  type DriverTaskAction,
  type DriverTaskKind,
  type DriverTaskStatus,
} from '@/features/contracts/api/workersDrivers.api';
import { CONTRACT_STATUS_LABEL } from '@/features/contracts/lib/contractState';
import type { ContractListItem, ContractStatus } from '@/features/contracts/types';

const NA = 'غير متوفر';
const TASK_TONE: Record<DriverTaskStatus, BadgeTone> = {
  pending: 'gold',
  assigned: 'navy',
  on_the_way: 'teal',
  done: 'success',
  cancelled: 'neutral',
};
const HISTORY_KIND = { contract: 'عقد', replacement: 'استبدال', return: 'إرجاع' } as const;

/* ------------------------------ بيانات العاملة ------------------------------ */

export function WorkerTab({ contract }: { contract: ContractListItem }) {
  const wid = contract.worker_profile_id;
  const cand = useQuery({
    queryKey: ['contracts', 'worker-card', wid, contract.start_date],
    queryFn: () =>
      listWorkerCandidates(
        contract.service_code ?? '',
        contract.start_date ?? '',
        contract.end_date,
        contract.id,
      ),
    enabled: Boolean(wid && contract.start_date),
  });
  const doc = useQuery({
    queryKey: ['contracts', 'worker-doc', wid],
    queryFn: () => workerDoc(wid ?? ''),
    enabled: Boolean(wid),
  });
  const hist = useQuery({
    queryKey: ['contracts', 'worker-history', wid],
    queryFn: () => workerHistory(wid ?? ''),
    enabled: Boolean(wid),
  });
  if (!wid) {
    return (
      <Card>
        <EmptyState
          icon={UserRound}
          title={
            contract.worker_name ? `العاملة: ${contract.worker_name}` : 'لا عاملة مرتبطة بهذا العقد'
          }
          description="العقد غير مربوط بملف عاملة في النظام — بياناتها التفصيلية غير متوفرة."
        />
      </Card>
    );
  }
  const w = cand.data?.find((x) => x.id === wid) ?? null;
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 border-b border-navy-50 py-2 text-sm last:border-0">
      <dt className="text-purple">{k}</dt>
      <dd className={v ? 'text-navy-900' : 'text-purple/70'}>{v || NA}</dd>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
          <UserRound size={16} /> بيانات العاملة
        </h3>
        {cand.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <dl>
            {row('الاسم', w?.full_name ?? contract.worker_name)}
            {row('الرقم الداخلي', w?.internal_no && <span className="num">{w.internal_no}</span>)}
            {row('الجنسية', w?.nationality)}
            {row('المهنة', w?.profession)}
            {row(
              'الإقامة / الجواز',
              (doc.data?.iqama_no ?? doc.data?.passport_no ?? w?.id_no) && (
                <span className="num">
                  {doc.data?.iqama_no ?? doc.data?.passport_no ?? w?.id_no}
                </span>
              ),
            )}
            {row('الجوال', doc.data?.phone && <span className="num">{doc.data.phone}</span>)}
            {row('الفرع', w?.branch_name)}
            {row('الحالة', w && (WORKER_STATUS_LABEL[w.status] ?? w.status))}
            {row(
              'تاريخ التوفر',
              w?.next_free_date && <span className="num">{dateAr(w.next_free_date)}</span>,
            )}
          </dl>
        )}
      </Card>
      <Card>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
          <History size={16} /> سجل العاملة
        </h3>
        {hist.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : hist.isError ? (
          <ErrorState onRetry={() => void hist.refetch()} />
        ) : (hist.data ?? []).length === 0 ? (
          <p className="text-sm text-purple">لا سجل.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {(hist.data ?? []).map((h) => (
              <li key={`${h.kind}-${h.ref_id}`} className="rounded-lg border border-navy-50 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-navy">
                    {HISTORY_KIND[h.kind]}{' '}
                    {h.contract_no && h.contract_id !== contract.id ? (
                      <Link to={`/contracts/${h.contract_id}`} className="num hover:underline">
                        {h.contract_no}
                      </Link>
                    ) : (
                      <span className="num">{h.contract_no ?? ''}</span>
                    )}
                    {h.contract_id === contract.id && (
                      <span className="text-[11px] text-purple"> (هذا العقد)</span>
                    )}
                  </span>
                  <span className="text-[11px] text-purple">
                    {h.kind === 'contract'
                      ? (CONTRACT_STATUS_LABEL[h.status as ContractStatus] ?? h.status)
                      : h.status}
                  </span>
                </div>
                <p className="num text-[11px] text-purple">
                  {dateAr(h.start_date)} ← {h.end_date ? dateAr(h.end_date) : '—'}
                  {h.customer_name ? ` · ${h.customer_name}` : ''}
                  {h.note ? ` · ${h.note}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------- التوصيل والاستلام ----------------------------- */

function toLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DriverSelect({
  start,
  end,
  value,
  onChange,
}: {
  start: string;
  end: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const ok = Boolean(start && end && end > start);
  const q = useQuery({
    queryKey: ['contracts', 'driver-availability', start, end],
    queryFn: () => driverAvailability(new Date(start).toISOString(), new Date(end).toISOString()),
    enabled: ok,
  });
  return (
    <Select
      label="السائق"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={ok ? 'بدون سائق الآن' : 'حدّد الوقت أولاً'}
      options={(q.data ?? []).map((d) => ({
        value: d.busy ? `busy:${d.id}` : d.id,
        label: `${d.full_name}${d.branch_name ? ` · ${d.branch_name}` : ''} — ${d.busy ? `مشغول (${d.busy_task_no})` : `متاح · مهام اليوم ${d.tasks_today}`}`,
      }))}
    />
  );
}

function NewTaskModal({ contract, onClose }: { contract: ContractListItem; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const base = contract.start_date ? `${contract.start_date}T09:00` : '';
  const [kind, setKind] = useState<DriverTaskKind>(
    contract.status === 'active' ? 'pickup' : 'delivery',
  );
  const [start, setStart] = useState(base);
  const [end, setEnd] = useState(contract.start_date ? `${contract.start_date}T10:00` : '');
  const [driver, setDriver] = useState('');
  const [address, setAddress] = useState('');
  const input = {
    contractId: contract.id,
    kind,
    startsAt: start,
    endsAt: end,
    driverId: driver && !driver.startsWith('busy:') ? driver : null,
    address,
    workerId: contract.worker_profile_id,
  };
  const parsed = driverTaskSchema.safeParse(input);
  const err = driver.startsWith('busy:')
    ? 'السائق مشغول في هذا الوقت — اختر غيره'
    : parsed.success
      ? null
      : (parsed.error.issues[0]?.message ?? null);
  const save = useMutation({
    mutationFn: () => createDriverTask(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      void qc.invalidateQueries({ queryKey: opsKeys.all });
      toast.success('أُنشئت المهمة');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="مهمة توصيل / استلام">
      <div className="space-y-3">
        <Select
          label="نوع المهمة"
          value={kind}
          onChange={(e) => setKind(e.target.value as DriverTaskKind)}
          options={(Object.keys(TASK_KIND_LABEL) as DriverTaskKind[]).map((k) => ({
            value: k,
            label: TASK_KIND_LABEL[k],
          }))}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            label="من"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Input
            label="إلى"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <DriverSelect start={start} end={end} value={driver} onChange={setDriver} />
        <Input label="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} />
        {err && <p className="text-[11px] text-gold-600">{err}</p>}
        <Button
          className="w-full"
          disabled={Boolean(err)}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          حفظ المهمة
        </Button>
      </div>
    </Modal>
  );
}

function AssignModal({ task, onClose }: { task: DriverTask; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [driver, setDriver] = useState(task.driver_id ?? '');
  const step = useMutation({
    mutationFn: () => driverTaskStep(task, 'assign', driver),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      toast.success('أُسند السائق');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title={`إسناد سائق — ${task.task_no}`}>
      <p className="mb-2 text-xs text-purple">
        <span className="num">{dateTimeAr(task.starts_at)}</span> ←{' '}
        <span className="num">{dateTimeAr(task.ends_at)}</span>
      </p>
      <DriverSelect
        start={toLocal(task.starts_at)}
        end={toLocal(task.ends_at)}
        value={driver}
        onChange={setDriver}
      />
      <Button
        className="mt-3 w-full"
        disabled={!driver || driver.startsWith('busy:')}
        loading={step.isPending}
        onClick={() => step.mutate()}
      >
        إسناد
      </Button>
    </Modal>
  );
}

export function DeliveryTab({ contract }: { contract: ContractListItem }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: [...contractKeys.detail(contract.id), 'driver-tasks'],
    queryFn: () => listDriverTasks(contract.id),
  });
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<DriverTask | null>(null);
  const step = useMutation({
    mutationFn: ({ t, a }: { t: DriverTask; a: DriverTaskAction }) => driverTaskStep(t, a),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      void qc.invalidateQueries({ queryKey: opsKeys.all });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const editable = can('contracts', 'edit') || can('orders', 'edit');
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Truck size={16} /> التوصيل والاستلام
        </h3>
        {editable && !['cancelled', 'completed'].includes(contract.status) && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> مهمة جديدة
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="لا مهام توصيل أو استلام"
          description="تُنشأ مهمة التوصيل تلقائياً من «عقد جديد»، أو أضفها من هنا."
        />
      ) : (
        <ul className="space-y-2">
          {(q.data ?? []).map((t) => (
            <li key={t.id} className="rounded-xl border border-navy-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-navy">
                  {TASK_KIND_LABEL[t.kind]} · <span className="num">{t.task_no}</span>
                </p>
                <Badge tone={TASK_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
              </div>
              <p className="text-xs text-purple">
                <span className="num">{dateTimeAr(t.starts_at)}</span> ←{' '}
                <span className="num">{dateTimeAr(t.ends_at)}</span>
                {' · '}السائق: {t.driver_name ?? (t.driver_id ? '—' : 'لم يُسند')}
                {t.address ? ` · ${t.address}` : ''}
              </p>
              {t.done_at && (
                <p className="num text-[11px] text-teal">نُفّذت {dateTimeAr(t.done_at)}</p>
              )}
              {editable && !['done', 'cancelled'].includes(t.status) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {['pending', 'assigned'].includes(t.status) && (
                    <Button size="sm" variant="outline" onClick={() => setAssigning(t)}>
                      {t.driver_id ? 'تغيير السائق' : 'إسناد سائق'}
                    </Button>
                  )}
                  {t.status === 'assigned' && (
                    <Button
                      size="sm"
                      disabled={step.isPending}
                      onClick={() => step.mutate({ t, a: 'start' })}
                    >
                      في الطريق
                    </Button>
                  )}
                  {['assigned', 'on_the_way'].includes(t.status) && (
                    <Button
                      size="sm"
                      variant="success"
                      disabled={step.isPending}
                      onClick={() => step.mutate({ t, a: 'done' })}
                    >
                      تم التنفيذ
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={step.isPending}
                    onClick={() => step.mutate({ t, a: 'cancel' })}
                  >
                    إلغاء
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating && <NewTaskModal contract={contract} onClose={() => setCreating(false)} />}
      {assigning && <AssignModal task={assigning} onClose={() => setAssigning(null)} />}
    </Card>
  );
}
