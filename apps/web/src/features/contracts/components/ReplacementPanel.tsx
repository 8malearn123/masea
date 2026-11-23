import { useState } from 'react';
import { ArrowLeftRight, CheckCircle2, FileDown, XCircle } from 'lucide-react';
import { Badge, Button, Input, Modal, Select, type BadgeTone } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { useDrivers } from '@/features/orders/hooks/useOrders';
import { useContracts } from '@/features/contracts/hooks/useContracts';
import {
  useCompleteReplacement,
  useLookups,
  useReplacementQuota,
  useReplacementStep,
  useRequestReplacement,
  useScheduleReplacement,
} from '@/features/contracts/hooks/useContractOps';
import {
  EXCEPTION_BASIS_LABEL,
  REPLACEMENT_STATUS_LABEL,
  replacementRequestSchema,
  type ExceptionBasis,
  type Replacement,
  type ReplacementStatus,
} from '@/features/contracts/api/contractOps.api';
import { workerConflict } from '@/features/contracts/lib/workerAllocation';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import type { ContractListItem } from '@/features/contracts/types';

const TONE: Record<ReplacementStatus, BadgeTone> = {
  requested: 'gold',
  pending_exception: 'gold',
  eligible: 'navy',
  scheduled: 'navy',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};
const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function esc(s: string | null | undefined): string {
  return String(s ?? '—').replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch,
  );
}

/** «محضر استبدال عاملة» — يُطبع عند التسليم والاستلام ولا يعدّل نص العقد. */
function replacementRecordHtml(c: ContractListItem, r: Replacement, reason: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${esc(r.replacement_no)}</title>
<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet" />
<style>body{font-family:'Alexandria',sans-serif;color:#120E45;padding:40px}.num{font-family:'JetBrains Mono',monospace;direction:ltr;unicode-bidi:embed}
header{display:flex;justify-content:space-between;border-bottom:3px solid #1B1564;padding-bottom:12px}.brand{font-size:20px;font-weight:700;color:#1B1564}
h1{font-size:17px;color:#1B1564}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px;border-bottom:1px solid #E3E1ED}td.k{color:#564E85;width:38%}
.sign{display:flex;justify-content:space-between;margin-top:56px}.sign div{width:30%;text-align:center;border-top:1px solid #120E45;padding-top:8px;font-size:12px}</style></head>
<body><header><div class="brand">ماسية الشرق للاستقدام</div><div class="num">${esc(r.replacement_no)}</div></header>
<h1>محضر استبدال عاملة — العقد <span class="num">${esc(c.contract_no)}</span></h1>
<table>
<tr><td class="k">العميل</td><td>${esc(c.customer_name)}</td></tr>
<tr><td class="k">العاملة السابقة</td><td>${esc(r.old_worker_name ?? null)}</td></tr>
<tr><td class="k">العاملة البديلة</td><td>${esc(r.new_worker_name ?? c.worker_name)}</td></tr>
<tr><td class="k">سبب الاستبدال</td><td>${esc(reason)}${r.reason_note ? ` — ${esc(r.reason_note)}` : ''}</td></tr>
<tr><td class="k">رقم الاستبدال على العقد</td><td class="num">${r.seq}</td></tr>
<tr><td class="k">تاريخ الطلب</td><td class="num">${esc(r.requested_at)}</td></tr>
<tr><td class="k">استلام العاملة السابقة</td><td class="num">${esc(r.old_received_at ?? r.old_pickup_date)}</td></tr>
<tr><td class="k">تسليم البديلة</td><td class="num">${esc(r.new_delivered_at ?? r.new_delivery_date)}</td></tr>
${r.is_exception ? `<tr><td class="k">استثناء</td><td>${esc(r.exception_basis ? EXCEPTION_BASIS_LABEL[r.exception_basis] : '')} — ${esc(r.exception_note)}</td></tr>` : ''}
</table>
<p style="font-size:12px;color:#564E85">يبقى العقد الأصلي ببنوده دون تعديل؛ هذا المحضر يوثّق تغيير العاملة المخصّصة فقط.</p>
<div class="sign"><div>العميل</div><div>المندوب / السائق</div><div>المسؤول</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`;
}

export function ReplacementRequestModal({
  contract,
  onClose,
}: {
  contract: ContractListItem;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const { data: reasons = [] } = useLookups('replacement_reason');
  const { data: quota } = useReplacementQuota(contract.id);
  const request = useRequestReplacement();
  const [reasonCode, setReason] = useState('');
  const [reasonNote, setNote] = useState('');
  const [requestedAt, setAt] = useState(today());
  const [exception, setException] = useState<ExceptionBasis | ''>('');
  const [exceptionNote, setExceptionNote] = useState('');
  const contractual = reasons.find((r) => r.code === reasonCode)?.flag ?? false;
  const exhausted = Boolean(quota?.active && (quota.remaining ?? 0) <= 0 && !contractual);
  const parsed = replacementRequestSchema.safeParse({
    contractId: contract.id,
    reasonCode,
    reasonNote,
    requestedAt,
    exceptionBasis: exception || null,
    exceptionNote,
  });
  const err = parsed.success
    ? exhausted && !exception
      ? `استُنفد حد الاستبدالات الاعتيادية (${quota?.max}) — يلزم استثناء معتمد`
      : null
    : (parsed.error.issues[0]?.message ?? null);

  return (
    <Modal open onClose={onClose} title="استبدال العاملة">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-navy-50 p-2">
            <p className="text-purple">المنفّذة</p>
            <p className="num text-base font-bold text-navy">{quota?.total_done ?? 0}</p>
          </div>
          <div className="rounded-xl bg-navy-50 p-2">
            <p className="text-purple">المحتسبة من الحد</p>
            <p className="num text-base font-bold text-navy">{quota?.used ?? 0}</p>
          </div>
          <div className="rounded-xl bg-navy-50 p-2">
            <p className="text-purple">المتبقية</p>
            <p className="num text-base font-bold text-navy">
              {quota?.active ? quota.remaining : 'بلا حد'}
            </p>
          </div>
        </div>
        {!quota?.active && (
          <p className="text-[11px] text-purple">
            لا حد لعدد الاستبدالات على هذا العقد (السياسة غير مطبّقة وقت توقيعه).
          </p>
        )}
        <Select
          label="سبب الاستبدال"
          placeholder="اختر السبب"
          value={reasonCode}
          onChange={(e) => setReason(e.target.value)}
          options={reasons
            .filter((r) => r.is_active)
            .map((r) => ({ value: r.code, label: r.name_ar }))}
        />
        {contractual && (
          <p className="rounded-lg bg-teal-100 p-2 text-[11px] text-teal">
            التزام تعاقدي (البند الثاني/4) — لا يُحتسب من حد الاستبدالات.
          </p>
        )}
        <Input label="تفاصيل" value={reasonNote} onChange={(e) => setNote(e.target.value)} />
        <Input
          label="تاريخ الطلب"
          type="date"
          value={requestedAt}
          onChange={(e) => setAt(e.target.value)}
        />
        {!contractual && (
          <div className="rounded-xl border border-navy-50 p-3">
            <Select
              label="استثناء (إن وُجد أساس نظامي أو تعاقدي أو قرار إداري)"
              placeholder="بدون استثناء"
              value={exception}
              onChange={(e) => setException(e.target.value as ExceptionBasis | '')}
              options={(Object.keys(EXCEPTION_BASIS_LABEL) as ExceptionBasis[]).map((b) => ({
                value: b,
                label: EXCEPTION_BASIS_LABEL[b],
              }))}
            />
            {exception && (
              <Input
                className="mt-2"
                label="أساس الاستثناء"
                value={exceptionNote}
                onChange={(e) => setExceptionNote(e.target.value)}
              />
            )}
            {exception && (
              <p className="mt-1 text-[11px] text-purple">
                يعتمده مستخدم آخر يملك اعتماد العقود
                {can('contracts', 'approve') ? '' : ' (ليست لديك هذه الصلاحية)'}.
              </p>
            )}
          </div>
        )}
        {err && <p className="text-[11px] text-gold-600">{err}</p>}
        <Button
          className="w-full"
          disabled={Boolean(err)}
          loading={request.isPending}
          onClick={() =>
            request.mutate(
              {
                contractId: contract.id,
                reasonCode,
                reasonNote,
                requestedAt,
                exceptionBasis: exception || null,
                exceptionNote,
              },
              { onSuccess: onClose },
            )
          }
        >
          تسجيل طلب الاستبدال
        </Button>
      </div>
    </Modal>
  );
}

export function ReplacementCard({ r, contract }: { r: Replacement; contract: ContractListItem }) {
  const { can } = usePermissions();
  const step = useReplacementStep();
  const schedule = useScheduleReplacement();
  const complete = useCompleteReplacement();
  const { data: reasons = [] } = useLookups('replacement_reason');
  const { data: conditions = [] } = useLookups('worker_condition');
  const { data: workers = [] } = useWorkerProfiles();
  const { data: drivers = [] } = useDrivers();
  const { data: contracts = [] } = useContracts(ALL);
  const [mode, setMode] = useState<'schedule' | 'complete' | 'reject' | null>(null);
  const [newWorker, setNewWorker] = useState(r.new_worker_profile_id ?? '');
  const [pickup, setPickup] = useState(today());
  const [delivery, setDelivery] = useState(today());
  const [pickupDriver, setPickupDriver] = useState('');
  const [deliveryDriver, setDeliveryDriver] = useState('');
  const [oldReceived, setOldReceived] = useState(today());
  const [newDelivered, setNewDelivered] = useState(today());
  const [condition, setCondition] = useState('');
  const [note, setNote] = useState('');
  const reason = reasons.find((x) => x.code === r.reason_code)?.name_ar ?? r.reason_code;
  const busy = step.isPending || schedule.isPending || complete.isPending;

  // المتاحات فقط، ومن غير المحجوزات على عقد حيّ في الفترة المتبقية (0089)
  const choices = workers.filter(
    (w) =>
      w.id !== r.old_worker_profile_id &&
      w.status === 'available' &&
      !workerConflict(contracts, w.id, delivery, contract.end_date, contract.id),
  );
  const editable = can('contracts', 'edit');

  return (
    <div className="rounded-xl border border-navy-50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-navy">
          <ArrowLeftRight size={15} /> استبدال <span className="num">{r.replacement_no}</span> · رقم{' '}
          <span className="num">{r.seq}</span>
        </p>
        <Badge tone={TONE[r.status]}>{REPLACEMENT_STATUS_LABEL[r.status]}</Badge>
      </div>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-purple">السبب: </dt>
          <dd className="inline">
            {reason}
            {r.reason_note ? ` — ${r.reason_note}` : ''}
          </dd>
        </div>
        <div>
          <dt className="inline text-purple">تاريخ الطلب: </dt>
          <dd className="num inline">{dateAr(r.requested_at)}</dd>
        </div>
        <div>
          <dt className="inline text-purple">يُحتسب من الحد: </dt>
          <dd className="inline">{r.counts_toward_limit ? 'نعم' : 'لا'}</dd>
        </div>
        {r.is_exception && (
          <div>
            <dt className="inline text-purple">الاستثناء: </dt>
            <dd className="inline">
              {r.exception_basis ? EXCEPTION_BASIS_LABEL[r.exception_basis] : ''} —{' '}
              {r.exception_note}
            </dd>
          </div>
        )}
        {r.new_worker_profile_id && (
          <div className="sm:col-span-2">
            <dt className="inline text-purple">البديلة: </dt>
            <dd className="inline">
              {r.new_worker_name ??
                workers.find((w) => w.id === r.new_worker_profile_id)?.full_name ??
                '—'}{' '}
              · استلام <span className="num">{dateAr(r.old_received_at ?? r.old_pickup_date)}</span>{' '}
              · تسليم{' '}
              <span className="num">{dateAr(r.new_delivered_at ?? r.new_delivery_date)}</span>
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === 'pending_exception' && can('contracts', 'approve') && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => step.mutate({ r, action: 'approve_exception' })}
          >
            <CheckCircle2 size={14} /> اعتماد الاستثناء
          </Button>
        )}
        {['eligible', 'scheduled'].includes(r.status) && editable && (
          <Button size="sm" onClick={() => setMode('schedule')}>
            {r.status === 'scheduled' ? 'تعديل البديلة والمواعيد' : 'اختيار البديلة وجدولة'}
          </Button>
        )}
        {r.status === 'scheduled' && editable && (
          <Button size="sm" variant="success" onClick={() => setMode('complete')}>
            تنفيذ الاستبدال
          </Button>
        )}
        {['requested', 'pending_exception', 'eligible'].includes(r.status) &&
          can('contracts', 'approve') && (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setMode('reject')}>
              <XCircle size={14} /> رفض
            </Button>
          )}
        {['requested', 'pending_exception', 'eligible', 'scheduled'].includes(r.status) &&
          editable && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => step.mutate({ r, action: 'cancel' })}
            >
              إلغاء الطلب
            </Button>
          )}
        {r.status === 'completed' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openContractPrint(replacementRecordHtml(contract, r, reason))}
          >
            <FileDown size={14} /> محضر الاستبدال
          </Button>
        )}
      </div>

      <Modal
        open={mode === 'schedule'}
        onClose={() => setMode(null)}
        title="اختيار البديلة وجدولة الاستبدال"
      >
        <div className="space-y-3">
          <Input
            label="تسليم البديلة في"
            type="date"
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
          />
          <Select
            label="العاملة البديلة (المتاحات فقط)"
            placeholder={choices.length ? 'اختر' : 'لا توجد عاملة متاحة في هذه الفترة'}
            value={newWorker}
            onChange={(e) => setNewWorker(e.target.value)}
            options={choices.map((w) => ({
              value: w.id,
              label: `${w.full_name} · ${w.nationality} · ${w.profession}`,
            }))}
          />
          <Input
            label="استلام العاملة الحالية في"
            type="date"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="سائق الاستلام"
              placeholder="بدون"
              value={pickupDriver}
              onChange={(e) => setPickupDriver(e.target.value)}
              options={drivers
                .filter((d) => d.is_active)
                .map((d) => ({ value: d.id, label: d.full_name }))}
            />
            <Select
              label="سائق التسليم"
              placeholder="بدون"
              value={deliveryDriver}
              onChange={(e) => setDeliveryDriver(e.target.value)}
              options={drivers
                .filter((d) => d.is_active)
                .map((d) => ({ value: d.id, label: d.full_name }))}
            />
          </div>
          <Button
            className="w-full"
            disabled={!newWorker || !pickup || !delivery}
            loading={schedule.isPending}
            onClick={() =>
              schedule.mutate(
                {
                  r,
                  input: {
                    newWorkerId: newWorker,
                    newWorkerName: workers.find((w) => w.id === newWorker)?.full_name ?? null,
                    pickupDate: pickup,
                    deliveryDate: delivery,
                    pickupDriverId: pickupDriver || null,
                    deliveryDriverId: deliveryDriver || null,
                  },
                },
                { onSuccess: () => setMode(null) },
              )
            }
          >
            حجز البديلة وجدولة
          </Button>
        </div>
      </Modal>

      <Modal open={mode === 'complete'} onClose={() => setMode(null)} title="تنفيذ الاستبدال">
        <div className="space-y-3">
          <Input
            label="تاريخ استلام العاملة السابقة"
            type="date"
            max={today()}
            value={oldReceived}
            onChange={(e) => setOldReceived(e.target.value)}
          />
          <Select
            label="حالة العاملة السابقة عند الاستلام"
            placeholder="اختر الحالة"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            options={conditions
              .filter((c) => c.is_active)
              .map((c) => ({ value: c.code, label: c.name_ar }))}
          />
          <Input
            label="تاريخ تسليم البديلة"
            type="date"
            max={today()}
            value={newDelivered}
            onChange={(e) => setNewDelivered(e.target.value)}
          />
          <Input label="ملاحظات" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-[11px] text-purple">
            يتغيّر تخصيص العقد للبديلة، وتدخل العاملة السابقة مسار الإرجاع ولا تُتاح قبل تأكيد
            جاهزيتها.
          </p>
          <Button
            className="w-full"
            variant="success"
            disabled={!condition}
            loading={complete.isPending}
            onClick={() =>
              complete.mutate(
                { r, input: { oldReceived, newDelivered, condition, note } },
                { onSuccess: () => setMode(null) },
              )
            }
          >
            تأكيد التنفيذ
          </Button>
        </div>
      </Modal>

      <Modal open={mode === 'reject'} onClose={() => setMode(null)} title="رفض طلب الاستبدال">
        <Input label="سبب الرفض" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          className="mt-3 w-full"
          variant="danger"
          disabled={!note.trim() || busy}
          onClick={() =>
            step.mutate({ r, action: 'reject', note }, { onSuccess: () => setMode(null) })
          }
        >
          تأكيد الرفض
        </Button>
      </Modal>
    </div>
  );
}
