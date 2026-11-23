import { useState } from 'react';
import { History, PackageCheck, RotateCcw, Scale, TriangleAlert, Truck, Undo2 } from 'lucide-react';
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
} from '@/shared/ui';
import { dateAr, dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useEmployees } from '@/features/hr/hooks/useHr';
import { useDrivers } from '@/features/orders/hooks/useOrders';
import {
  useLookups,
  useOpsEvents,
  useRefunds,
  useRequestReturn,
  useReturns,
  useReturnStep,
  useSettlements,
} from '@/features/contracts/hooks/useContractOps';
import {
  OPS_ACTION_LABEL,
  RETURN_STATUS_LABEL,
  returnRequestSchema,
  type ContractLookup,
  type ReturnStatus,
  type WorkerReturn,
} from '@/features/contracts/api/contractOps.api';
import { requiresSettlement } from '@/features/contracts/lib/contractState';
import { SettlementCard, SettlementWizard } from '@/features/contracts/components/SettlementPanel';
import { RefundCard } from '@/features/contracts/components/RefundPanel';
import type { ContractListItem } from '@/features/contracts/types';
import type { ReactNode } from 'react';

const RETURN_TONE: Record<ReturnStatus, BadgeTone> = {
  requested: 'gold',
  scheduled: 'navy',
  received: 'teal',
  ready: 'success',
  cancelled: 'neutral',
};
const ENTITY_LABEL = {
  settlement: 'التسوية',
  return: 'الإرجاع',
  refund: 'الاسترداد',
  replacement: 'الاستبدال',
  trial: 'التجربة',
} as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
const nameOf = (list: ContractLookup[], code: string | null) =>
  list.find((l) => l.code === code)?.name_ar ?? code ?? '—';

/** A contract action button that explains WHY it is unavailable instead of hiding it. */
function ActionButton({
  icon,
  label,
  blocked,
  onClick,
  variant = 'outline',
}: {
  icon: ReactNode;
  label: string;
  blocked: string | null;
  onClick: () => void;
  variant?: 'outline' | 'danger' | 'primary';
}) {
  return (
    <div className="min-w-0 flex-1">
      <Button className="w-full" variant={variant} disabled={Boolean(blocked)} onClick={onClick}>
        {icon} {label}
      </Button>
      {blocked && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-purple">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {blocked}
        </p>
      )}
    </div>
  );
}

function ReturnRequestModal({
  contract,
  onClose,
}: {
  contract: ContractListItem;
  onClose: () => void;
}) {
  const { data: reasons = [] } = useLookups('return_reason');
  const { data: employees = [] } = useEmployees();
  const { data: drivers = [] } = useDrivers();
  const request = useRequestReturn();
  const [form, setForm] = useState({
    requestedDate: today(),
    reasonCode: '',
    reasonNote: '',
    responsibleEmployeeId: '',
    driverId: '',
    notes: '',
  });
  const parsed = returnRequestSchema.safeParse({ ...form, contractId: contract.id });
  const err = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  return (
    <Modal open onClose={onClose} title="إرجاع العاملة">
      <div className="space-y-3">
        <div className="rounded-xl bg-navy-50 p-3 text-sm">
          <p>
            <span className="text-purple">العقد: </span>
            <span className="num">{contract.contract_no}</span> · {contract.customer_name}
          </p>
          <p>
            <span className="text-purple">العاملة: </span>
            {contract.worker_name ?? '—'} · <span className="text-purple">بداية العقد: </span>
            <span className="num">{dateAr(contract.start_date)}</span>
          </p>
        </div>
        <Input
          label="تاريخ الإرجاع المطلوب"
          type="date"
          value={form.requestedDate}
          onChange={(e) => setForm({ ...form, requestedDate: e.target.value })}
        />
        <Select
          label="سبب الإرجاع"
          placeholder="اختر السبب"
          value={form.reasonCode}
          onChange={(e) => setForm({ ...form, reasonCode: e.target.value })}
          options={reasons
            .filter((r) => r.is_active)
            .map((r) => ({ value: r.code, label: r.name_ar }))}
        />
        <Input
          label="تفاصيل السبب"
          value={form.reasonNote}
          onChange={(e) => setForm({ ...form, reasonNote: e.target.value })}
        />
        <Select
          label="الموظف المسؤول"
          placeholder="—"
          value={form.responsibleEmployeeId}
          onChange={(e) => setForm({ ...form, responsibleEmployeeId: e.target.value })}
          options={employees.map((e) => ({
            value: e.id,
            label: `${e.full_name} · ${e.job_title}`,
          }))}
        />
        <Select
          label="السائق المكلّف بالاستلام (إن وجد)"
          placeholder="بدون سائق — يسلّمها العميل في مقر الشركة"
          value={form.driverId}
          onChange={(e) => setForm({ ...form, driverId: e.target.value })}
          options={drivers
            .filter((d) => d.is_active)
            .map((d) => ({ value: d.id, label: d.full_name }))}
        />
        <Input
          label="ملاحظات"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        {err && <p className="text-[11px] text-gold-600">{err}</p>}
        <Button
          className="w-full"
          disabled={Boolean(err)}
          loading={request.isPending}
          onClick={() =>
            request.mutate(
              {
                contractId: contract.id,
                ...form,
                responsibleEmployeeId: form.responsibleEmployeeId || null,
                driverId: form.driverId || null,
              },
              { onSuccess: onClose },
            )
          }
        >
          تسجيل طلب الإرجاع
        </Button>
      </div>
    </Modal>
  );
}

function ReturnCard({
  r,
  contract,
  canSettle,
  onSettle,
}: {
  r: WorkerReturn;
  contract: ContractListItem;
  canSettle: boolean;
  onSettle: (r: WorkerReturn) => void;
}) {
  const { can } = usePermissions();
  const step = useReturnStep();
  const { data: reasons = [] } = useLookups('return_reason');
  const { data: conditions = [] } = useLookups('worker_condition');
  const { data: drivers = [] } = useDrivers();
  const [mode, setMode] = useState<'schedule' | 'receive' | null>(null);
  const [date, setDate] = useState(today());
  const [condition, setCondition] = useState('');
  const [note, setNote] = useState('');
  const [driver, setDriver] = useState(r.driver_id ?? '');
  const editable = can('contracts', 'edit');
  const open = ['requested', 'scheduled'].includes(r.status);
  const contractLive = ['active', 'signed', 'musaned_signed'].includes(contract.status);

  return (
    <div className="rounded-xl border border-navy-50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-navy">
          <Undo2 size={15} /> إرجاع <span className="num">{r.return_no}</span>
        </p>
        <Badge tone={RETURN_TONE[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Badge>
      </div>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-purple">السبب: </dt>
          <dd className="inline">
            {nameOf(reasons, r.reason_code)}
            {r.reason_note ? ` — ${r.reason_note}` : ''}
          </dd>
        </div>
        <div>
          <dt className="inline text-purple">المطلوب: </dt>
          <dd className="num inline">{dateAr(r.requested_date)}</dd>
        </div>
        <div>
          <dt className="inline text-purple">الفعلي: </dt>
          <dd className="num inline">{r.actual_date ? dateAr(r.actual_date) : '—'}</dd>
        </div>
        <div>
          <dt className="inline text-purple">السائق: </dt>
          <dd className="inline">
            {drivers.find((d) => d.id === r.driver_id)?.full_name ?? 'بدون'}
          </dd>
        </div>
        {r.condition_code && (
          <div className="sm:col-span-2">
            <dt className="inline text-purple">حالة العاملة عند الاستلام: </dt>
            <dd className="inline">
              {nameOf(conditions, r.condition_code)}
              {r.condition_note ? ` — ${r.condition_note}` : ''}
            </dd>
          </div>
        )}
      </dl>

      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          {open && (
            <>
              <Button size="sm" variant="outline" onClick={() => setMode('schedule')}>
                <Truck size={14} /> جدولة الاستلام
              </Button>
              <Button size="sm" onClick={() => setMode('receive')}>
                <PackageCheck size={14} /> تأكيد الاستلام الفعلي
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={step.isPending}
                onClick={() => step.mutate({ r, action: 'cancel' })}
              >
                إلغاء الطلب
              </Button>
            </>
          )}
          {r.status === 'received' && contractLive && canSettle && (
            <Button size="sm" variant="primary" onClick={() => onSettle(r)}>
              <Scale size={14} /> إنشاء تسوية العقد
            </Button>
          )}
          {r.status === 'received' && (
            <Button
              size="sm"
              variant="success"
              disabled={step.isPending || (contractLive && !r.replacement_id)}
              onClick={() => step.mutate({ r, action: 'ready' })}
            >
              تأكيد الجاهزية وإتاحتها
            </Button>
          )}
        </div>
      )}
      {r.status === 'received' && contractLive && !r.replacement_id && (
        <p className="mt-1 text-[11px] text-purple">
          لا تُتاح العاملة لعقد جديد قبل تسوية هذا العقد وتأكيد جاهزيتها.
        </p>
      )}

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'schedule' ? 'جدولة الاستلام' : 'تأكيد الاستلام الفعلي'}
      >
        <div className="space-y-3">
          <Input
            label={mode === 'schedule' ? 'موعد الاستلام' : 'تاريخ الإرجاع الفعلي'}
            type="date"
            max={mode === 'receive' ? today() : undefined}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {mode === 'schedule' ? (
            <Select
              label="السائق المكلّف"
              placeholder="بدون سائق"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              options={drivers
                .filter((d) => d.is_active)
                .map((d) => ({ value: d.id, label: d.full_name }))}
            />
          ) : (
            <>
              <Select
                label="حالة العاملة عند الاستلام"
                placeholder="اختر الحالة"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                options={conditions
                  .filter((c) => c.is_active)
                  .map((c) => ({ value: c.code, label: c.name_ar }))}
              />
              <Input
                label="ملاحظات الاستلام"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </>
          )}
          <Button
            className="w-full"
            loading={step.isPending}
            disabled={!date || (mode === 'receive' && !condition)}
            onClick={() =>
              step.mutate(
                {
                  r,
                  action: mode === 'schedule' ? 'schedule' : 'receive',
                  input: { date, condition, note, driverId: driver || null },
                },
                { onSuccess: () => setMode(null) },
              )
            }
          >
            حفظ
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * «عمليات العقد» داخل صفحة التفاصيل: إلغاء وتسوية · إرجاع · (استبدال) ·
 * طلبات الاسترداد · سجل العمليات والموافقات. كل زر يعمل فعلياً أو يشرح سبب تعطيله.
 */
export function ContractOpsPanel({
  contract,
  extraActions,
}: {
  contract: ContractListItem;
  extraActions?: ReactNode;
}) {
  const { can } = usePermissions();
  const settlementsQ = useSettlements(contract.id);
  const returnsQ = useReturns(contract.id);
  const refundsQ = useRefunds(contract.id);
  const eventsQ = useOpsEvents(contract.id);
  const { data: cancelReasons = [] } = useLookups('cancel_reason');
  const [wizard, setWizard] = useState<{
    returnId: string | null;
    date: string | undefined;
  } | null>(null);
  const [returning, setReturning] = useState(false);

  const settlements = settlementsQ.data ?? [];
  const returns = returnsQ.data ?? [];
  const refunds = refundsQ.data ?? [];
  const events = eventsQ.data ?? [];
  const liveSettlement =
    settlements.find((s) => !['rejected', 'cancelled'].includes(s.status)) ?? null;
  const liveReturn =
    returns.find((r) => ['requested', 'scheduled', 'received'].includes(r.status)) ?? null;
  const finished = contract.status === 'cancelled' || contract.status === 'completed';

  const cancelBlocked = !can('contracts', 'edit')
    ? 'يتطلب صلاحية تعديل العقود'
    : contract.status === 'draft'
      ? 'المسودة تُلغى من الإجراءات مباشرة — لا مبالغ عليها'
      : finished
        ? 'العقد منتهٍ أو ملغى'
        : liveSettlement
          ? `توجد تسوية قائمة (${liveSettlement.settlement_no})`
          : !requiresSettlement(contract)
            ? 'لا مبالغ محصّلة ولم يُوقَّع بعد — يُلغى من الإجراءات مباشرة'
            : null;
  const delivered = contract.status === 'active' || finished;
  const returnBlocked = !can('contracts', 'edit')
    ? 'يتطلب صلاحية تعديل العقود'
    : !contract.worker_profile_id && !contract.worker_name
      ? 'لا توجد عاملة مرتبطة بهذا العقد'
      : !delivered
        ? 'لم تُسلَّم العاملة للعميل بعد'
        : liveReturn
          ? `يوجد طلب إرجاع قائم (${liveReturn.return_no})`
          : returns.some((r) => r.status === 'ready' && !r.replacement_id)
            ? 'استُلمت العاملة وأُتيحت مسبقاً'
            : null;

  const loading = settlementsQ.isLoading || returnsQ.isLoading || refundsQ.isLoading;
  const error = settlementsQ.isError || returnsQ.isError || refundsQ.isError;

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <RotateCcw size={16} /> عمليات العقد
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        <ActionButton
          variant="danger"
          icon={<Scale size={15} />}
          label="إلغاء العقد وتسويته"
          blocked={cancelBlocked}
          onClick={() => setWizard({ returnId: null, date: undefined })}
        />
        <ActionButton
          icon={<Undo2 size={15} />}
          label="إرجاع العاملة"
          blocked={returnBlocked}
          onClick={() => setReturning(true)}
        />
        {extraActions}
      </div>

      {loading ? (
        <Skeleton className="mt-4 h-32 w-full" />
      ) : error ? (
        <div className="mt-4">
          <ErrorState
            onRetry={() => {
              void settlementsQ.refetch();
              void returnsQ.refetch();
              void refundsQ.refetch();
            }}
          />
        </div>
      ) : settlements.length + returns.length + refunds.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={History}
            title="لا عمليات على هذا العقد"
            description="الإلغاء والإرجاع والاسترداد تظهر هنا مع سجل موافقاتها."
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {returns.map((r) => (
            <ReturnCard
              key={r.id}
              r={r}
              contract={contract}
              canSettle={!liveSettlement && can('contracts', 'edit')}
              onSettle={(x) => setWizard({ returnId: x.id, date: x.actual_date ?? undefined })}
            />
          ))}
          {settlements.map((s) => (
            <SettlementCard
              key={s.id}
              contract={contract}
              s={s}
              refund={
                refunds.find((r) => r.settlement_id === s.id && r.status !== 'rejected') ?? null
              }
              events={events}
              reasonLabel={nameOf(cancelReasons, s.reason_code)}
            />
          ))}
          {refunds.map((r) => (
            <RefundCard key={r.id} r={r} />
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
            <History size={14} /> سجل العمليات والموافقات
          </h3>
          <ol className="space-y-1.5 border-s-2 border-navy-50 ps-3 text-xs">
            {events.map((e) => (
              <li key={e.id}>
                <span className="font-semibold text-navy">
                  {ENTITY_LABEL[e.entity]} · {OPS_ACTION_LABEL[e.action] ?? e.action}
                </span>
                {e.actor_name ? <span className="text-purple"> — {e.actor_name}</span> : null}
                <span className="num text-purple"> · {dateTimeAr(e.created_at)}</span>
                {e.note && <p className="text-purple">{e.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {wizard && (
        <SettlementWizard
          contract={contract}
          open
          onClose={() => setWizard(null)}
          returnId={wizard.returnId}
          defaultDate={wizard.date}
        />
      )}
      {returning && <ReturnRequestModal contract={contract} onClose={() => setReturning(false)} />}
    </Card>
  );
}
