import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Badge, Button, Input, Modal, useToast } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { usePermissions } from '@/hooks/usePermissions';
import { useContractLineage, useRenewContract } from '@/features/contracts/hooks/useContracts';
import { useExpiryWindow } from '@/features/contracts/hooks/useExpiryWindow';
import { contractTermLabel } from '@/features/contracts/lib/contractTerm';
import {
  defaultRenewalStart,
  nextVersion,
  renewalBlocker,
  renewalTerm,
} from '@/features/contracts/lib/contractRenewal';
import { SERVICE_LABEL, type ContractListItem } from '@/features/contracts/types';

/**
 * زر «تجديد العقد» — يظهر فقط لمن يملك صلاحية إنشاء العقود، وللعقد الذي تنطبق
 * عليه قواعد التجديد (ساري، له مدة وتاريخ نهاية، داخل مهلة التنبيه أو منتهٍ، ولا
 * تجديد قائم له). يفتح شاشة مراجعة قبل إنشاء النسخة.
 */
export function RenewContractButton({
  contract,
  existingRenewals,
  size = 'sm',
}: {
  contract: ContractListItem;
  existingRenewals: ContractListItem[];
  size?: 'sm' | 'md';
}) {
  const { can } = usePermissions();
  const alertWindow = useExpiryWindow();
  const [open, setOpen] = useState(false);

  if (!can('contracts', 'create')) return null;
  if (renewalBlocker(contract, existingRenewals, alertWindow.days) !== null) return null;

  return (
    <>
      <Button size={size} variant="primary" onClick={() => setOpen(true)}>
        <RefreshCw size={size === 'sm' ? 13 : 16} /> تجديد العقد
      </Button>
      {open && <RenewContractModal contract={contract} onClose={() => setOpen(false)} />}
    </>
  );
}

function RenewContractModal({
  contract,
  onClose,
}: {
  contract: ContractListItem;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const renew = useRenewContract(contract.id);
  const { data: lineage } = useContractLineage(contract.id);
  const [start, setStart] = useState(() => defaultRenewalStart(contract));
  // حارس متزامن: isPending لا يتحدّث قبل إعادة الرسم، فالضغط المزدوج السريع كان
  // يرسل طلبين. (الخادم يرفض الثاني على أي حال — قفل الأصل + تجديد قائم.)
  const submitting = useRef(false);

  const plan = renewalTerm(contract, start);
  const version = lineage
    ? nextVersion(
        contract,
        lineage.filter((c) => c.parent_contract_id === contract.id),
      )
    : null;

  function confirm() {
    if (plan.error !== null || submitting.current) return;
    submitting.current = true;
    renew.mutate(plan.term, {
      onSettled: () => {
        submitting.current = false;
      },
      onSuccess: (created) => {
        toast.success(`تم إنشاء النسخة ${created.contract_no ?? ''} — مسودة بانتظار الاعتماد`);
        onClose();
        navigate(`/contracts/${created.id}`);
      },
    });
  }

  return (
    <Modal open onClose={renew.isPending ? () => undefined : onClose} title="تجديد العقد">
      <div className="space-y-4 text-sm">
        {isDemoMode() && (
          <Badge tone="neutral">بيانات تجريبية — لا تُحفظ النسخة في قاعدة البيانات</Badge>
        )}

        <section className="rounded-xl bg-navy-50 p-3">
          <p className="mb-2 text-xs font-bold text-navy">العقد الأصلي</p>
          <Line label="رقم العقد">
            <span className="num">{contract.contract_no ?? '—'}</span> · الإصدار{' '}
            <span className="num">{contract.version}</span>
          </Line>
          <Line label="العميل">{contract.customer_name ?? '—'}</Line>
          <Line label="الخدمة">
            {contract.service_code ? SERVICE_LABEL[contract.service_code] : '—'}
          </Line>
          <Line label="المدة">
            {dateAr(contract.start_date)} ← {dateAr(contract.end_date)} (
            {contractTermLabel(contract) ?? '—'})
          </Line>
          <Line label="الإجمالي">
            <span className="num">{sar(contract.total_amount)} ر.س</span>
          </Line>
        </section>

        <section className="rounded-xl border border-gold-100 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
            <ArrowLeft size={13} /> النسخة الجديدة المقترحة
          </p>
          <Input
            label="تاريخ البداية"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <div className="mt-2">
            <Line label="المدة">{plan.term?.label ?? '—'} (مطابقة للعقد الأصلي)</Line>
            <Line label="تاريخ النهاية">{plan.term ? dateAr(plan.term.end_date) : '—'}</Line>
            <Line label="الإصدار">
              <span className="num">{version ?? '…'}</span>
            </Line>
            <Line label="الحالة">مسودة — تمرّ بالاعتماد والتوقيع من جديد</Line>
            <Line label="الإجمالي">
              <span className="num">{sar(contract.total_amount)} ر.س</span>
            </Line>
          </div>
          {plan.error !== null && <p className="mt-2 text-xs text-red-600">{plan.error}</p>}
        </section>

        <p className="text-[11px] leading-relaxed text-purple">
          تُنشأ نسخة جديدة برقم عقد جديد مرتبطة بهذا العقد. العقد الأصلي يبقى كما هو بحالته وبنوده
          وتوقيعاته وسجلّه. المدة مطابقة للأصل لأن السعر مرتبط بها.
        </p>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={renew.isPending}>
            إلغاء
          </Button>
          <Button
            onClick={confirm}
            loading={renew.isPending}
            disabled={plan.error !== null || renew.isPending}
          >
            <RefreshCw size={15} /> تأكيد إنشاء النسخة
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-purple">{label}</span>
      <span className="text-end text-xs font-medium text-navy-900">{children}</span>
    </div>
  );
}
