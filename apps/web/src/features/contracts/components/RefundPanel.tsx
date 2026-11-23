import { useState } from 'react';
import { Banknote, CheckCircle2, Send, XCircle } from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Skeleton, type BadgeTone } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  usePayouts,
  useRecordPayout,
  useRefundStep,
  useUpdateRefundDetails,
} from '@/features/contracts/hooks/useContractOps';
import {
  REFUND_METHOD_LABEL,
  REFUND_STATUS_LABEL,
  refundDetailsSchema,
  payoutSchema,
  type Refund,
  type RefundAction,
  type RefundMethod,
  type RefundStatus,
} from '@/features/contracts/api/contractOps.api';

export const REFUND_TONE: Record<RefundStatus, BadgeTone> = {
  draft: 'neutral',
  pending_review: 'gold',
  pending_finance: 'gold',
  approved: 'navy',
  pending_payout: 'navy',
  partially_refunded: 'teal',
  refunded: 'success',
  rejected: 'danger',
};

/** حسابات الصرف من دليل الحسابات (الصندوق/البنك) — نفس رموز صرف نهاية الخدمة. */
const PAYOUT_ACCOUNTS = [
  { value: '1112', label: 'البنك (1112)' },
  { value: '1111', label: 'الصندوق (1111)' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function DetailsForm({ r, onDone }: { r: Refund; onDone: () => void }) {
  const save = useUpdateRefundDetails();
  const [method, setMethod] = useState<RefundMethod>(r.method ?? 'transfer');
  const [beneficiary, setBeneficiary] = useState(r.beneficiary_name ?? '');
  const [iban, setIban] = useState(r.customer_iban ?? '');
  const [bank, setBank] = useState(r.bank_name ?? '');
  const parsed = refundDetailsSchema.safeParse({ method, beneficiary, iban, bank });
  const err = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  return (
    <div className="space-y-3">
      <Select
        label="وسيلة الاسترداد"
        value={method}
        onChange={(e) => setMethod(e.target.value as RefundMethod)}
        options={(Object.keys(REFUND_METHOD_LABEL) as RefundMethod[]).map((m) => ({
          value: m,
          label: REFUND_METHOD_LABEL[m],
        }))}
      />
      <Input
        label="اسم المستفيد"
        value={beneficiary}
        onChange={(e) => setBeneficiary(e.target.value)}
      />
      {method === 'transfer' && (
        <>
          <Input
            label="الآيبان"
            dir="ltr"
            className="num"
            placeholder="SA0000000000000000000000"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
          />
          <Input label="البنك" value={bank} onChange={(e) => setBank(e.target.value)} />
        </>
      )}
      {err && <p className="text-[11px] text-gold-600">{err}</p>}
      <Button
        className="w-full"
        disabled={Boolean(err)}
        loading={save.isPending}
        onClick={() =>
          save.mutate({ r, input: { method, beneficiary, iban, bank } }, { onSuccess: onDone })
        }
      >
        حفظ بيانات الاسترداد
      </Button>
    </div>
  );
}

function PayoutForm({ r, onDone }: { r: Refund; onDone: () => void }) {
  const pay = useRecordPayout();
  const left = Math.round((r.amount - r.paid_total) * 100) / 100;
  const [amount, setAmount] = useState(left);
  const [ref, setRef] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [bankCode, setBankCode] = useState(r.method === 'cash' ? '1111' : '1112');
  const parsed = payoutSchema.safeParse({ amount, transferRef: ref, paidOn, bankCode });
  const err = !parsed.success
    ? (parsed.error.issues[0]?.message ?? null)
    : amount > left
      ? `المبلغ يتجاوز المتبقي (${sar(left)})`
      : null;
  return (
    <div className="space-y-3">
      <p className="text-sm text-purple">
        المتبقي للصرف: <span className="num font-bold text-navy">{sar(left)}</span> ر.س — يمكن الصرف
        على دفعات.
      </p>
      <Input
        label="المبلغ"
        type="number"
        min={0}
        max={left}
        suffix="ر.س"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
      />
      <Input label="رقم مرجع التحويل" value={ref} onChange={(e) => setRef(e.target.value)} />
      <Input
        label="تاريخ الصرف"
        type="date"
        max={today()}
        value={paidOn}
        onChange={(e) => setPaidOn(e.target.value)}
      />
      <Select
        label="حساب الصرف"
        value={bankCode}
        onChange={(e) => setBankCode(e.target.value)}
        options={PAYOUT_ACCOUNTS}
      />
      {err && <p className="text-[11px] text-gold-600">{err}</p>}
      <Button
        className="w-full"
        variant="success"
        disabled={Boolean(err)}
        loading={pay.isPending}
        onClick={() =>
          pay.mutate(
            { r, input: { amount, transferRef: ref, paidOn, bankCode } },
            { onSuccess: onDone },
          )
        }
      >
        تسجيل الصرف وقيده
      </Button>
    </div>
  );
}

export function RefundCard({ r }: { r: Refund }) {
  const { can } = usePermissions();
  const step = useRefundStep();
  const { data: payouts = [], isLoading } = usePayouts(r);
  const [modal, setModal] = useState<'details' | 'payout' | 'reject' | null>(null);
  const [why, setWhy] = useState('');
  const busy = step.isPending;

  const next: { action: RefundAction; label: string; allowed: boolean }[] = [
    {
      action: 'submit',
      label: 'إرسال للمراجعة',
      allowed: r.status === 'draft' && can('contracts', 'edit'),
    },
    {
      action: 'review',
      label: 'مراجعة',
      allowed: r.status === 'pending_review' && can('contracts', 'approve'),
    },
    {
      action: 'approve',
      label: 'اعتماد مالي',
      allowed: r.status === 'pending_finance' && can('payments', 'approve'),
    },
    {
      action: 'queue',
      label: 'إرسال للصرف',
      allowed: r.status === 'approved' && can('payments', 'create'),
    },
  ];
  const canReject =
    ['pending_review', 'pending_finance', 'approved'].includes(r.status) &&
    (can('contracts', 'approve') || can('payments', 'approve'));
  const canPay =
    ['pending_payout', 'partially_refunded'].includes(r.status) && can('payments', 'create');

  return (
    <div className="rounded-xl border border-navy-50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-navy">
          <Banknote size={15} /> استرداد <span className="num">{r.refund_no}</span>
        </p>
        <Badge tone={REFUND_TONE[r.status]}>{REFUND_STATUS_LABEL[r.status]}</Badge>
      </div>
      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-purple">المبلغ القابل للاسترداد</dt>
          <dd className="num font-bold">{sar(r.amount)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-purple">المسترد حتى الآن</dt>
          <dd className="num">{sar(r.paid_total)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-purple">الوسيلة</dt>
          <dd>{r.method ? REFUND_METHOD_LABEL[r.method] : 'لم تُحدَّد'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-purple">آخر موعد</dt>
          <dd className="num">{r.due_by ? dateAr(r.due_by) : '—'}</dd>
        </div>
        {r.customer_iban && (
          <div className="flex justify-between gap-2 sm:col-span-2">
            <dt className="text-purple">الآيبان</dt>
            <dd className="num">{r.customer_iban}</dd>
          </div>
        )}
      </dl>

      {isLoading ? (
        <Skeleton className="mt-2 h-8 w-full" />
      ) : (
        payouts.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-lg bg-navy-50 p-2 text-xs">
            {payouts.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  مرجع <span className="num">{p.transfer_ref}</span> ·{' '}
                  <span className="num">{dateAr(p.paid_on)}</span>
                </span>
                <span className="num">{sar(p.amount)}</span>
              </li>
            ))}
          </ul>
        )
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === 'draft' && can('contracts', 'edit') && (
          <Button size="sm" variant="outline" onClick={() => setModal('details')}>
            بيانات الاسترداد
          </Button>
        )}
        {next
          .filter((n) => n.allowed)
          .map((n) => (
            <Button
              key={n.action}
              size="sm"
              disabled={busy || (n.action === 'submit' && !r.method)}
              onClick={() => step.mutate({ r, action: n.action })}
            >
              <CheckCircle2 size={14} /> {n.label}
            </Button>
          ))}
        {canPay && (
          <Button size="sm" variant="success" onClick={() => setModal('payout')}>
            <Send size={14} /> تسجيل صرف
          </Button>
        )}
        {canReject && (
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setModal('reject')}>
            <XCircle size={14} /> رفض
          </Button>
        )}
      </div>
      {r.status === 'draft' && !r.method && (
        <p className="mt-1 text-[11px] text-gold-600">حدّد وسيلة الاسترداد قبل الإرسال.</p>
      )}

      <Modal open={modal === 'details'} onClose={() => setModal(null)} title="بيانات الاسترداد">
        <DetailsForm r={r} onDone={() => setModal(null)} />
      </Modal>
      <Modal open={modal === 'payout'} onClose={() => setModal(null)} title="تسجيل صرف الاسترداد">
        <PayoutForm r={r} onDone={() => setModal(null)} />
      </Modal>
      <Modal open={modal === 'reject'} onClose={() => setModal(null)} title="رفض الاسترداد">
        <Input label="سبب الرفض" value={why} onChange={(e) => setWhy(e.target.value)} />
        <Button
          className="mt-3 w-full"
          variant="danger"
          disabled={!why.trim() || busy}
          onClick={() =>
            step.mutate({ r, action: 'reject', note: why }, { onSuccess: () => setModal(null) })
          }
        >
          تأكيد الرفض
        </Button>
      </Modal>
    </div>
  );
}
