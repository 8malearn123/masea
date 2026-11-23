import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Plus, Undo2, Wallet } from 'lucide-react';
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
  useToast,
} from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { contractKeys } from '@/features/contracts/api/keys';
import {
  buildSchedule,
  collectibleRemaining,
  INSTALLMENT_STATUS_LABEL,
  installmentsSchema,
  listContractPayments,
  listInstallments,
  listReceivingAccounts,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  paymentInputSchema,
  recordContractPayment,
  setInstallments,
  setPaymentStatus,
  type ContractPayment,
  type InstallmentStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@/features/contracts/api/contractPayments.api';
import type { ContractListItem } from '@/features/contracts/types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE: Record<PaymentStatus, 'success' | 'gold' | 'danger'> = {
  received: 'success',
  pending_clearance: 'gold',
  bounced: 'danger',
};
const INST_TONE: Record<InstallmentStatus, 'success' | 'gold' | 'danger' | 'neutral'> = {
  paid: 'success',
  partial: 'gold',
  overdue: 'danger',
  due: 'neutral',
};

function usePayments(contract: ContractListItem) {
  return useQuery({
    queryKey: [...contractKeys.detail(contract.id), 'payments', contract.amount_paid],
    queryFn: () => listContractPayments(contract.id),
  });
}

/** تسجيل دفعة: الطريقة، الحساب المستلم (إلزامي للتحويل)، رقم العملية، الحالة. */
export function RecordPaymentModal({
  contract,
  onClose,
}: {
  contract: ContractListItem;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const payQ = usePayments(contract);
  const accQ = useQuery({
    queryKey: ['contracts', 'receiving-accounts'],
    queryFn: listReceivingAccounts,
  });
  const remaining = collectibleRemaining(
    contract.total_amount,
    contract.amount_paid,
    payQ.data ?? [],
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [account, setAccount] = useState('');
  const [txn, setTxn] = useState('');
  const [ref, setRef] = useState('');
  const [status, setStatus] = useState<'received' | 'pending_clearance'>('received');
  const [paidOn, setPaidOn] = useState(today());
  const value = amount ?? remaining;
  const bankAccounts = (accQ.data ?? []).filter((a) => !a.is_cash);
  const input = {
    amount: value,
    method,
    reference_no: ref,
    paid_on: paidOn,
    bank_account_id: account || null,
    transaction_no: txn,
    status,
  };
  const parsed = paymentInputSchema.safeParse(input);
  const err = !parsed.success
    ? (parsed.error.issues[0]?.message ?? null)
    : value > remaining
      ? `المبلغ يتجاوز المتبقي (${sar(remaining)})`
      : null;
  const save = useMutation({
    mutationFn: () => recordContractPayment(contract.id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success(
        status === 'received'
          ? 'سُجّلت الدفعة — حُدّث المدفوع والقيد المحاسبي'
          : 'سُجّلت الدفعة بانتظار التحصيل — تُحتسب بعد تأكيدها',
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="تسجيل دفعة">
      {payQ.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-purple">
            المتبقي القابل للتحصيل:{' '}
            <span className="num font-bold text-navy">{sar(remaining)}</span> ر.س
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="المبلغ"
              type="number"
              min={0}
              max={remaining}
              suffix="ر.س"
              value={value}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            <Select
              label="طريقة الدفع"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              options={(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => ({
                value: m,
                label: PAYMENT_METHOD_LABEL[m],
              }))}
            />
            <Select
              label={method === 'transfer' ? 'الحساب البنكي المستلم' : 'الحساب المستلم (اختياري)'}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              disabled={accQ.isLoading}
              options={[
                {
                  value: '',
                  label: accQ.isError
                    ? 'تعذّر تحميل الحسابات'
                    : method === 'transfer'
                      ? 'اختر الحساب…'
                      : 'الحساب الافتراضي للطريقة',
                },
                ...bankAccounts.map((a) => ({
                  value: a.id,
                  label: `${a.name}${a.iban_masked ? ` · ${a.iban_masked}` : ''}`,
                })),
              ]}
            />
            <Input
              label={method === 'transfer' ? 'رقم عملية التحويل' : 'رقم العملية (اختياري)'}
              value={txn}
              onChange={(e) => setTxn(e.target.value)}
            />
            <Input
              label="مرجع / ملاحظة (اختياري)"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
            <Input
              label="تاريخ الدفعة"
              type="date"
              max={today()}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
            <Select
              label="حالة الدفعة"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'received' | 'pending_clearance')}
              options={[
                { value: 'received', label: 'مستلمة' },
                { value: 'pending_clearance', label: 'بانتظار التحصيل (شيك / تحويل لم يصل)' },
              ]}
            />
          </div>
          {err && <p className="text-[11px] text-gold-600">{err}</p>}
          <Button
            className="w-full"
            disabled={Boolean(err)}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            تسجيل الدفعة
          </Button>
        </div>
      )}
    </Modal>
  );
}

function BounceModal({ payment, onClose }: { payment: ContractPayment; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => setPaymentStatus(payment, 'bounced', note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success('سُجّل ارتداد الدفعة — قيد عكسي وخُصمت من المدفوع');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="ارتداد دفعة">
      <div className="space-y-3">
        <p className="text-sm text-purple">
          دفعة بمبلغ <span className="num font-bold text-navy">{sar(payment.amount)}</span> ر.س —
          يُسجَّل قيد عكسي ولا تُحذف الدفعة. الارتداد نهائي.
        </p>
        <Input label="سبب الارتداد" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          variant="danger"
          className="w-full"
          disabled={note.trim().length < 3}
          loading={m.isPending}
          onClick={() => m.mutate()}
        >
          تأكيد الارتداد
        </Button>
      </div>
    </Modal>
  );
}

export function PaymentsCard({
  contract,
  onRecord,
}: {
  contract: ContractListItem;
  onRecord: (() => void) | null;
}) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const payQ = usePayments(contract);
  const [bouncing, setBouncing] = useState<ContractPayment | null>(null);
  const canEdit = can('payments', 'edit');
  const clear = useMutation({
    mutationFn: (p: ContractPayment) => setPaymentStatus(p, 'received'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success('أُكّد التحصيل — حُدّث المدفوع والقيد');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Wallet size={16} /> الدفعات
        </h3>
        {onRecord && (
          <Button size="sm" onClick={onRecord}>
            <Plus size={14} /> تسجيل دفعة
          </Button>
        )}
      </div>
      {payQ.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : payQ.isError ? (
        <ErrorState onRetry={() => void payQ.refetch()} />
      ) : (payQ.data ?? []).length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="لا دفعات مسجّلة"
          {...(contract.amount_paid > 0
            ? { description: 'المدفوع مسجّل من مصدر سابق (لا تفاصيل دفعات).' }
            : {})}
        />
      ) : (
        <ul className="divide-y divide-navy-50 text-sm">
          {(payQ.data ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="num font-bold text-navy">{sar(p.amount)} ر.س</span>
                  <Badge tone={STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                </p>
                <p className="text-[11px] text-purple">
                  <span className="num">{dateAr(p.paid_at)}</span> ·{' '}
                  {p.method ? PAYMENT_METHOD_LABEL[p.method] : 'غير متوفر'}
                  {p.bank_account_name ? ` · ${p.bank_account_name}` : ''}
                  {p.transaction_no ? (
                    <>
                      {' '}
                      · عملية <span className="num">{p.transaction_no}</span>
                    </>
                  ) : null}
                  {p.reference_no ? ` · ${p.reference_no}` : ''}
                </p>
              </div>
              {canEdit && p.status !== 'bounced' && (
                <div className="flex gap-1">
                  {p.status === 'pending_clearance' && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={clear.isPending && clear.variables?.id === p.id}
                      onClick={() => clear.mutate(p)}
                    >
                      <CheckCircle2 size={13} /> تأكيد التحصيل
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setBouncing(p)}>
                    <Undo2 size={13} /> ارتداد
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {bouncing && <BounceModal payment={bouncing} onClose={() => setBouncing(null)} />}
    </Card>
  );
}

/* ------------------------------ الاستحقاقات ------------------------------ */

function ScheduleModal({
  contract,
  current,
  onClose,
}: {
  contract: ContractListItem;
  current: { due_date: string; amount: number }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const start = contract.start_date ?? today();
  const [rows, setRows] = useState(
    current.length ? current : buildSchedule(contract.total_amount, start, 1),
  );
  const [count, setCount] = useState(Math.max(current.length, 1));
  const sum = r2(rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0));
  const parsed = installmentsSchema.safeParse(rows);
  const err = !parsed.success
    ? (parsed.error.issues[0]?.message ?? null)
    : Math.abs(sum - contract.total_amount) > 0.01
      ? `المجموع ${sar(sum)} لا يساوي إجمالي العقد ${sar(contract.total_amount)}`
      : null;
  const save = useMutation({
    mutationFn: () => setInstallments(contract.id, rows),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success('حُفظ جدول الاستحقاقات');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="جدول الاستحقاقات">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="عدد الأقساط"
            type="number"
            min={1}
            max={60}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <Button
            variant="outline"
            onClick={() => setRows(buildSchedule(contract.total_amount, start, count))}
            disabled={!(count >= 1 && count <= 60)}
          >
            توزيع شهري متساوٍ
          </Button>
        </div>
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr_1fr] items-end gap-2">
              <span className="num pb-3 text-xs text-purple">{i + 1}</span>
              <Input
                label="تاريخ الاستحقاق"
                type="date"
                value={r.due_date}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))
                }
              />
              <Input
                label="المبلغ"
                type="number"
                min={0}
                suffix="ر.س"
                value={r.amount}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)),
                  )
                }
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-purple">
          المجموع <span className="num font-bold text-navy">{sar(sum)}</span> من{' '}
          <span className="num">{sar(contract.total_amount)}</span> ر.س — يُغطّى المدفوع الأقدم
          فالأحدث تلقائياً.
        </p>
        {err && <p className="text-[11px] text-gold-600">{err}</p>}
        <Button
          className="w-full"
          disabled={Boolean(err)}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          حفظ الجدول
        </Button>
      </div>
    </Modal>
  );
}

export function InstallmentsCard({ contract }: { contract: ContractListItem }) {
  const { can } = usePermissions();
  const q = useQuery({
    queryKey: [...contractKeys.detail(contract.id), 'installments', contract.amount_paid],
    queryFn: () => listInstallments(contract.id),
  });
  const [editing, setEditing] = useState(false);
  const canEdit =
    (can('contracts', 'edit') || can('contracts', 'create')) &&
    !['cancelled', 'completed'].includes(contract.status);
  const overdue = useMemo(
    () => (q.data ?? []).filter((i) => i.status === 'overdue').reduce((s, i) => s + i.remaining, 0),
    [q.data],
  );
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
          <CalendarClock size={16} /> جدول الاستحقاقات
          {overdue > 0 && (
            <Badge tone="danger">
              متأخر <span className="num">{sar(overdue)}</span>
            </Badge>
          )}
        </h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {(q.data ?? []).length ? 'تعديل الجدول' : 'إعداد الجدول'}
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="لا جدول استحقاقات"
          description="المبلغ كاملاً مستحق دفعة واحدة — أعدّ جدولاً لتقسيطه."
        />
      ) : (
        <ul className="divide-y divide-navy-50 text-sm">
          {(q.data ?? []).map((i) => (
            <li key={i.seq} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="num text-xs text-purple">
                {i.seq} · {dateAr(i.due_date)}
              </span>
              <span className="num">{sar(i.amount)}</span>
              <span className="num text-xs text-purple">مدفوع {sar(i.paid_amount)}</span>
              <Badge tone={INST_TONE[i.status]}>{INSTALLMENT_STATUS_LABEL[i.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ScheduleModal
          contract={contract}
          current={(q.data ?? []).map((i) => ({ due_date: i.due_date, amount: i.amount }))}
          onClose={() => setEditing(false)}
        />
      )}
    </Card>
  );
}
