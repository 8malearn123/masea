import { useMemo, useState } from 'react';
import { CheckCircle2, FileDown, Plus, Scale, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Skeleton, type BadgeTone } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useLookups,
  usePrepareSettlement,
  useSettlementManualDue,
  useSettlementPreview,
  useSettlementStep,
  useSettleSettlement,
} from '@/features/contracts/hooks/useContractOps';
import {
  SETTLEMENT_STATUS_LABEL,
  type OpsEvent,
  type Refund,
  type Settlement,
  type SettlementStatus,
} from '@/features/contracts/api/contractOps.api';
import {
  creditNoteAmount,
  DUE_BASIS_LABEL,
  feeError,
  SETTLEMENT_KIND_LABEL,
  type SettlementFee,
  type SettlementPreview,
} from '@/features/contracts/lib/settlement';
import { buildSettlementHtml } from '@/features/contracts/lib/settlementHtml';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import type { ContractListItem } from '@/features/contracts/types';

export const SETTLEMENT_TONE: Record<SettlementStatus, BadgeTone> = {
  draft: 'neutral',
  pending_review: 'gold',
  pending_finance: 'gold',
  approved: 'navy',
  settled: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** «قبل وبعد» — the money table shown in the wizard and on the settlement card. */
export function SettlementFigures({ p }: { p: SettlementPreview }) {
  const refund = p.balance >= 0;
  const cn = creditNoteAmount(p);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['مدة العقد', p.days_total],
          ['المستهلكة', p.days_used],
          ['المتبقية', p.days_remaining],
        ].map(([label, v]) => (
          <div key={label} className="rounded-xl bg-navy-50 p-2">
            <p className="text-[11px] text-purple">{label}</p>
            <p className="num text-sm font-bold text-navy">{v ?? '—'}</p>
            <p className="text-[10px] text-purple">يوم</p>
          </div>
        ))}
      </div>
      <dl className="divide-y divide-navy-50 rounded-xl border border-navy-50 text-sm">
        <div className="flex justify-between px-3 py-2">
          <dt className="text-purple">قيمة العقد (شاملة الضريبة)</dt>
          <dd className="num">{sar(p.contract_value)}</dd>
        </div>
        <div className="flex justify-between px-3 py-2">
          <dt className="text-purple">المبالغ المحصّلة</dt>
          <dd className="num">{sar(p.amount_paid)}</dd>
        </div>
        <div className="flex justify-between gap-3 px-3 py-2">
          <dt className="text-purple">
            قيمة الخدمة المستحقة
            <span className="block text-[11px]">
              {DUE_BASIS_LABEL[p.due_basis]}
              {p.due_basis_ref ? ` — ${p.due_basis_ref}` : ''}
            </span>
          </dt>
          <dd className="num">{sar(p.service_due)}</dd>
        </div>
        <div className="flex justify-between px-3 py-2">
          <dt className="text-purple">الرسوم والتعويضات</dt>
          <dd className="num">{sar(p.fees_total)}</dd>
        </div>
        <div
          className={`flex justify-between px-3 py-2 font-bold ${refund ? 'text-teal' : 'text-red-700'}`}
        >
          <dt>{refund ? 'يُسترد للعميل' : 'متبقٍ على العميل'}</dt>
          <dd className="num">{sar(Math.abs(p.balance))}</dd>
        </div>
      </dl>
      {cn !== 0 && (
        <p className="text-[11px] text-purple">
          {cn > 0
            ? `عند التنفيذ يصدر إشعار دائن بـ ${sar(cn)} ر.س يعكس الإيراد غير المستحق وضريبته.`
            : `عند التنفيذ يُقيَّد ${sar(-cn)} ر.س رسوماً إضافية على العميل.`}
          {p.refund_within_days
            ? ` الاسترداد خلال ${p.refund_within_days} أيام (${p.refund_within_ref}).`
            : ''}
        </p>
      )}
    </div>
  );
}

/* ------------------------------- the wizard ------------------------------- */

export function SettlementWizard({
  contract,
  open,
  onClose,
  returnId = null,
  defaultDate,
}: {
  contract: ContractListItem;
  open: boolean;
  onClose: () => void;
  returnId?: string | null;
  defaultDate?: string | undefined;
}) {
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(defaultDate ?? today());
  const [fees, setFees] = useState<SettlementFee[]>([]);
  const [fee, setFee] = useState<SettlementFee>({ label: '', amount: 0, clause_ref: '' });
  const { data: reasons = [] } = useLookups('cancel_reason');
  const preview = useSettlementPreview(contract.id, date, fees, open && step >= 1);
  const prepare = usePrepareSettlement();
  const submitStep = useSettlementStep();
  const [submitting, setSubmitting] = useState(false);

  const feeProblem = fee.label || fee.amount || fee.clause_ref ? feeError(fee) : null;
  const STEPS = ['السبب والتاريخ', 'المبالغ والرسوم', 'التأكيد'];

  async function finish(send: boolean) {
    setSubmitting(true);
    try {
      const s = await prepare.mutateAsync({
        contractId: contract.id,
        effectiveDate: date,
        reasonCode: reason,
        reasonNote: note,
        fees,
        returnId,
      });
      if (send) await submitStep.mutateAsync({ s, action: 'submit' });
      onClose();
    } catch {
      /* toast shown by the mutation */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="إلغاء العقد وتسويته" size="lg">
      <ol className="mb-4 flex gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`flex-1 rounded-lg px-2 py-1.5 text-center ${i === step ? 'bg-navy text-white' : i < step ? 'bg-teal-100 text-teal' : 'bg-navy-50 text-purple'}`}
          >
            <span className="num">{i + 1}</span> · {s}
          </li>
        ))}
      </ol>

      <div className="mb-4 grid gap-2 rounded-xl bg-navy-50 p-3 text-sm sm:grid-cols-3">
        <p>
          <span className="text-purple">العقد: </span>
          <span className="num">{contract.contract_no}</span>
        </p>
        <p>
          <span className="text-purple">العميل: </span>
          {contract.customer_name ?? '—'}
        </p>
        <p>
          <span className="text-purple">العاملة: </span>
          {contract.worker_name ?? '—'}
        </p>
      </div>

      {step === 0 && (
        <div className="space-y-3">
          <Select
            label="سبب الإلغاء"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="اختر السبب"
            options={reasons
              .filter((r) => r.is_active)
              .map((r) => ({ value: r.code, label: r.name_ar }))}
          />
          <Input
            label="تاريخ الإلغاء الفعلي"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input label="ملاحظات (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="w-full" disabled={!reason || !date} onClick={() => setStep(1)}>
            التالي: احتساب المبالغ
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {preview.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : preview.isError ? (
            <p className="flex items-center gap-1 text-sm text-red-700">
              <TriangleAlert size={14} /> {preview.error.message}
            </p>
          ) : preview.data ? (
            <>
              <p className="text-xs text-purple">{SETTLEMENT_KIND_LABEL[preview.data.kind]}</p>
              <SettlementFigures p={preview.data} />
            </>
          ) : null}

          <div className="rounded-xl border border-navy-50 p-3">
            <p className="mb-2 text-sm font-semibold text-navy">
              رسوم أو تعويضات (من بنود العقد المعتمد فقط)
            </p>
            {fees.length > 0 && (
              <ul className="mb-2 space-y-1 text-sm">
                {fees.map((f, i) => (
                  <li
                    key={`${f.label}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-navy-50 px-2 py-1"
                  >
                    <span>
                      {f.label} <span className="text-[11px] text-purple">({f.clause_ref})</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="num">{sar(f.amount)}</span>
                      <button
                        type="button"
                        aria-label="حذف الرسم"
                        className="text-red-700"
                        onClick={() => setFees(fees.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                label="البيان"
                value={fee.label}
                onChange={(e) => setFee({ ...fee, label: e.target.value })}
              />
              <Input
                label="المبلغ"
                type="number"
                min={0}
                suffix="ر.س"
                value={fee.amount || ''}
                onChange={(e) => setFee({ ...fee, amount: Number(e.target.value) })}
              />
              <Input
                label="البند"
                placeholder="مثال: البند الثالث/11"
                value={fee.clause_ref}
                onChange={(e) => setFee({ ...fee, clause_ref: e.target.value })}
              />
            </div>
            {feeProblem && <p className="mt-1 text-[11px] text-gold-600">{feeProblem}</p>}
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={Boolean(feeProblem) || !fee.label}
              onClick={() => {
                setFees([
                  ...fees,
                  { ...fee, label: fee.label.trim(), clause_ref: fee.clause_ref.trim() },
                ]);
                setFee({ label: '', amount: 0, clause_ref: '' });
              }}
            >
              <Plus size={14} /> إضافة الرسم
            </Button>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStep(0)}>
              السابق
            </Button>
            <Button className="flex-1" disabled={!preview.data} onClick={() => setStep(2)}>
              التالي: التأكيد
            </Button>
          </div>
        </div>
      )}

      {step === 2 && preview.data && (
        <div className="space-y-4">
          <SettlementFigures p={preview.data} />
          <p className="rounded-xl bg-gold-100 p-3 text-xs text-navy">
            لا يُلغى العقد الآن: تُراجع التسوية ثم تُعتمد مالياً من مستخدم آخر، وبعد التنفيذ يُلغى
            العقد ويصدر الإشعار الدائن وطلب الاسترداد. العقد الأصلي ونصوصه لا تُحذف ولا تُعدَّل.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
              السابق
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              loading={submitting}
              onClick={() => void finish(false)}
            >
              حفظ كمسودة
            </Button>
            <Button className="flex-1" loading={submitting} onClick={() => void finish(true)}>
              إرسال للمراجعة
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------- one settlement card -------------------------- */

export function SettlementCard({
  contract,
  s,
  refund,
  events,
  reasonLabel,
}: {
  contract: ContractListItem;
  s: Settlement;
  refund: Refund | null;
  events: OpsEvent[];
  reasonLabel: string;
}) {
  const { can } = usePermissions();
  const step = useSettlementStep();
  const settle = useSettleSettlement();
  const manual = useSettlementManualDue();
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState('');
  const [due, setDue] = useState<number>(s.service_due);
  const [ref, setRef] = useState('');
  const busy = step.isPending || settle.isPending || manual.isPending;

  const actions = useMemo(() => {
    const a: {
      key: string;
      label: string;
      run: () => void;
      variant?: 'primary' | 'success' | 'outline';
    }[] = [];
    if (s.status === 'draft' && can('contracts', 'edit')) {
      a.push({
        key: 'submit',
        label: 'إرسال للمراجعة',
        run: () => step.mutate({ s, action: 'submit' }),
      });
      a.push({
        key: 'withdraw',
        label: 'سحب التسوية',
        variant: 'outline',
        run: () => step.mutate({ s, action: 'withdraw' }),
      });
    }
    if (s.status === 'pending_review' && can('contracts', 'approve')) {
      a.push({
        key: 'review',
        label: 'مراجعة واعتماد تشغيلي',
        run: () => step.mutate({ s, action: 'review' }),
      });
    }
    if (s.status === 'pending_finance' && can('payments', 'approve')) {
      a.push({
        key: 'approve',
        label: 'اعتماد مالي',
        variant: 'success',
        run: () => step.mutate({ s, action: 'approve' }),
      });
    }
    if (s.status === 'approved' && can('payments', 'approve')) {
      a.push({
        key: 'settle',
        label: 'تنفيذ التسوية وإلغاء العقد',
        variant: 'success',
        run: () => settle.mutate(s),
      });
    }
    return a;
  }, [s, can, step, settle]);
  const canReject =
    (s.status === 'pending_review' && can('contracts', 'approve')) ||
    (s.status === 'pending_finance' && can('payments', 'approve'));

  return (
    <div className="rounded-xl border border-navy-50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-navy">
          <Scale size={15} /> <span className="num">{s.settlement_no}</span> ·{' '}
          {SETTLEMENT_KIND_LABEL[s.kind]}
        </p>
        <Badge tone={SETTLEMENT_TONE[s.status]}>{SETTLEMENT_STATUS_LABEL[s.status]}</Badge>
      </div>
      <p className="mb-2 text-xs text-purple">
        السبب: {reasonLabel}
        {s.reason_note ? ` — ${s.reason_note}` : ''} · تاريخ الإلغاء الفعلي{' '}
        <span className="num">{dateAr(s.effective_date)}</span>
      </p>
      <SettlementFigures p={s} />
      {s.fees.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {s.fees.map((f, i) => (
            <li key={`${f.label}-${i}`} className="flex justify-between">
              <span>
                {f.label} <span className="text-purple">({f.clause_ref})</span>
              </span>
              <span className="num">{sar(f.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {s.posting_note && <p className="mt-2 text-[11px] text-gold-600">{s.posting_note}</p>}

      {s.status === 'draft' && s.due_basis === 'manual' && can('contracts', 'edit') && (
        <div className="mt-3 grid gap-2 rounded-xl bg-navy-50 p-3 sm:grid-cols-3">
          <Input
            label="القيمة المستحقة"
            type="number"
            min={0}
            value={due}
            onChange={(e) => setDue(Number(e.target.value))}
          />
          <Input label="البند أو السياسة" value={ref} onChange={(e) => setRef(e.target.value)} />
          <Button
            className="self-end"
            disabled={!ref.trim() || busy}
            onClick={() => manual.mutate({ s, due, ref })}
          >
            حفظ المستحق
          </Button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.key}
            size="sm"
            variant={a.variant ?? 'primary'}
            disabled={busy}
            onClick={a.run}
          >
            <CheckCircle2 size={14} /> {a.label}
          </Button>
        ))}
        {canReject && (
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setRejecting(true)}>
            <XCircle size={14} /> رفض
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            openContractPrint(
              buildSettlementHtml(contract, s, { reason: reasonLabel, refund, events }),
            )
          }
        >
          <FileDown size={14} /> مستند التسوية
        </Button>
      </div>
      {(s.status === 'pending_review' || s.status === 'pending_finance') && (
        <p className="mt-2 text-[11px] text-purple">
          المراجعة والاعتماد المالي من مستخدم غير مُعِدّ التسوية (أربع أعين).
        </p>
      )}

      <Modal open={rejecting} onClose={() => setRejecting(false)} title="رفض التسوية">
        <Input label="سبب الرفض" value={why} onChange={(e) => setWhy(e.target.value)} />
        <Button
          className="mt-3 w-full"
          variant="danger"
          disabled={!why.trim() || busy}
          onClick={() =>
            step.mutate(
              { s, action: 'reject', note: why },
              { onSuccess: () => setRejecting(false) },
            )
          }
        >
          تأكيد الرفض
        </Button>
      </Modal>
    </div>
  );
}
