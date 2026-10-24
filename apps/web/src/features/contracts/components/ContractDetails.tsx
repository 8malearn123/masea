import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  ExternalLink,
  FileDown,
  FileText,
  FileX,
  History,
  Pencil,
  RefreshCw,
  ScrollText,
  Signature,
  TriangleAlert,
} from 'lucide-react';
import { Card, Skeleton, EmptyState, ErrorState, Button, Input, Modal, Select } from '@/shared/ui';
import { sar, dateAr, dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useContract,
  useContractClauses,
  useContractHistory,
  useContractSignatures,
  useRenewContract,
  useTransitionContract,
  useUpdateDraft,
  useUpdateMusanedNo,
} from '@/features/contracts/hooks/useContracts';
import { BRANCHES_AR } from '@/lib/funnel';
import { updateDraftInputSchema } from '@/features/contracts/schemas/contract.schema';
import { contractInsight } from '@/features/contracts/lib/contractInsights';
import { useServiceOrigins } from '@/features/contracts/hooks/useServiceOrigins';
import { isMusaned } from '@/features/contracts/lib/contractOrigin';
import { StatusBadge } from '@/features/contracts/components/StatusBadge';
import { SignContractModal } from '@/features/contracts/components/SignContractModal';
import { RecruitmentJourney } from '@/features/contracts/components/RecruitmentJourney';
import {
  CONTRACT_STATUS_LABEL,
  isEditable,
  isRenewable,
  needsConfirmation,
  nextStatuses,
  transitionBlocker,
} from '@/features/contracts/lib/contractState';
import { buildContractHtml, openContractPrint } from '@/features/contracts/lib/contractHtml';
import {
  branchLabel,
  SERVICE_LABEL,
  type ContractListItem,
  type ContractStatus,
} from '@/features/contracts/types';

const ACTION_LABEL: Record<ContractStatus, string> = {
  draft: 'إرجاع لمسودة',
  musaned_created: 'تسجيل الإنشاء على مساند',
  musaned_signed: 'تأكيد توقيع العميل على مساند',
  pending_approval: 'إرسال للاعتماد',
  approved: 'اعتماد',
  awaiting_signature: 'إرسال للتوقيع',
  signed: 'تأكيد التوقيع',
  active: 'تفعيل العقد',
  completed: 'إنهاء العقد',
  cancelled: 'إلغاء',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-navy-50 py-2 last:border-0">
      <span className="text-sm text-purple">{label}</span>
      <span className="text-sm font-medium text-navy-900">{children}</span>
    </div>
  );
}

export default function ContractDetails() {
  const { id = '' } = useParams();
  const { can } = usePermissions();
  const { data: contract, isLoading, isError, refetch } = useContract(id);
  const { data: clauses = [] } = useContractClauses(id);
  const { data: history = [] } = useContractHistory(id);
  const { data: signatures = [] } = useContractSignatures(id);
  const { data: origins } = useServiceOrigins();
  const transition = useTransitionContract(id);
  const renew = useRenewContract(id);
  const navigate = useNavigate();
  const [showSign, setShowSign] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmTo, setConfirmTo] = useState<ContractStatus | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Card>
          <Skeleton className="h-40 w-full" />
        </Card>
      </div>
    );
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!contract) return <EmptyState icon={FileX} title="العقد غير موجود" />;

  const musaned = isMusaned(origins, contract.service_code);

  function canDo(to: ContractStatus): boolean {
    if (to === 'approved') return can('contracts', 'approve');
    return can('contracts', 'edit');
  }
  const origin = musaned ? 'musaned' : 'internal';
  const actions = nextStatuses(contract.status, origin).filter(canDo);
  const canEditDraft = isEditable(contract.status) && can('contracts', 'edit');
  const canRenew = isRenewable(contract.status) && can('contracts', 'create');
  const remaining = contractInsight(contract, new Date()).remaining;

  function runTransition(to: ContractStatus) {
    if (needsConfirmation(to)) setConfirmTo(to);
    else transition.mutate(to);
  }
  function doRenew() {
    renew.mutate(undefined, { onSuccess: (created) => navigate(`/contracts/${created.id}`) });
  }

  return (
    <div>
      <Link
        to="/contracts"
        className="mb-4 inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
      >
        <ArrowRight size={16} /> العودة للعقود
      </Link>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <FileText size={20} />
          </span>
          <div>
            <h1 className="num text-xl font-bold text-navy">{contract.contract_no ?? '—'}</h1>
            <p className="text-sm text-purple">
              {contract.customer_name ?? '—'} ·{' '}
              {contract.service_code ? SERVICE_LABEL[contract.service_code] : '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={contract.status} />
          {!musaned && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openContractPrint(
                  buildContractHtml(
                    contract,
                    clauses.map((c) => c.body),
                  ),
                )
              }
            >
              <FileDown size={16} /> تنزيل PDF
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Details */}
          <Card>
            <h2 className="mb-2 text-sm font-bold text-navy">بيانات العقد</h2>
            <Row label="العميل">{contract.customer_name ?? '—'}</Row>
            {contract.worker_name && <Row label="العاملة">{contract.worker_name}</Row>}
            <Row label="مصدر العقد">
              {musaned ? (
                <span className="inline-flex items-center gap-1 text-navy">
                  <ExternalLink size={13} /> منصة مساند
                </span>
              ) : (
                'داخلي (النظام)'
              )}
            </Row>
            <Row label="الفرع">{branchLabel(contract)}</Row>
            <Row label="تاريخ البداية">{dateAr(contract.start_date)}</Row>
            <Row label="تاريخ النهاية">{contract.end_date ? dateAr(contract.end_date) : '—'}</Row>
            {contract.version > 1 && (
              <Row label="النسخة">
                <span className="num">
                  {contract.version}
                  {contract.parent_contract_id && (
                    <Link
                      to={`/contracts/${contract.parent_contract_id}`}
                      className="mr-2 text-xs text-navy underline"
                    >
                      العقد الأصلي
                    </Link>
                  )}
                </span>
              </Row>
            )}
            {contract.discount_amount > 0 && (
              <>
                <Row label="السعر قبل الخصم">
                  <span className="num">
                    {sar(contract.gross_amount ?? contract.base_amount + contract.discount_amount)}{' '}
                    ر.س
                  </span>
                </Row>
                <Row label="الخصم المعتمد">
                  <span className="num text-green-700">− {sar(contract.discount_amount)} ر.س</span>
                </Row>
              </>
            )}
            <Row label={contract.discount_amount > 0 ? 'الصافي الخاضع للضريبة' : 'المبلغ الأساسي'}>
              <span className="num">{sar(contract.base_amount)} ر.س</span>
            </Row>
            <Row label="ضريبة القيمة المضافة (١٥٪)">
              <span className="num">{sar(contract.vat_amount)} ر.س</span>
            </Row>
            <Row label="الإجمالي">
              <span className="num font-bold text-gold-600">{sar(contract.total_amount)} ر.س</span>
            </Row>
            {contract.signed_at && <Row label="تاريخ التوقيع">{dateAr(contract.signed_at)}</Row>}
          </Card>

          {/* Musaned panel (استقدام / نقل كفالة) OR in-system clauses (تأجير) */}
          {musaned ? (
            <MusanedPanel contract={contract} />
          ) : (
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
                <ScrollText size={16} /> بنود العقد
              </h2>
              {clauses.length === 0 ? (
                <p className="text-sm text-purple">لا توجد بنود مُجمّدة لهذا العقد.</p>
              ) : (
                <ol className="space-y-2">
                  {clauses.map((cl, i) => (
                    <li key={cl.id} className="flex gap-3 text-sm leading-relaxed text-navy-900">
                      <span className="num font-bold text-gold-600">{i + 1}.</span>
                      {cl.body}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}

          {/* External-office recruitment workflow (recruitment contracts only) */}
          {contract.service_code === 'recruitment' && <RecruitmentJourney contract={contract} />}
        </div>

        <div className="space-y-4">
          {/* Actions */}
          <Card>
            <h2 className="mb-3 text-sm font-bold text-navy">الإجراءات</h2>
            {actions.length === 0 && !canEditDraft && !canRenew ? (
              <p className="text-sm text-purple">لا توجد إجراءات متاحة لحالتك ودورك.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {canEditDraft && (
                  <Button variant="outline" onClick={() => setShowEdit(true)}>
                    <Pencil size={15} /> تعديل المسودة
                  </Button>
                )}
                {actions.map((to) => {
                  const blocked = transitionBlocker(contract, to, origin);
                  return to === 'signed' ? (
                    <Button key={to} variant="primary" onClick={() => setShowSign(true)}>
                      {ACTION_LABEL[to]}
                    </Button>
                  ) : (
                    <div key={to}>
                      <Button
                        className="w-full"
                        variant={to === 'cancelled' ? 'danger' : 'primary'}
                        loading={transition.isPending && transition.variables === to}
                        disabled={transition.isPending || Boolean(blocked)}
                        onClick={() => runTransition(to)}
                      >
                        {ACTION_LABEL[to]}
                      </Button>
                      {blocked && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-gold-600">
                          <TriangleAlert size={12} /> {blocked}
                        </p>
                      )}
                    </div>
                  );
                })}
                {canRenew && (
                  <Button variant="outline" loading={renew.isPending} onClick={doRenew}>
                    <RefreshCw size={15} /> تجديد العقد (نسخة جديدة)
                  </Button>
                )}
              </div>
            )}
          </Card>

          {/* Status history */}
          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
              <History size={16} /> سجل الحالات
            </h2>
            {history.length === 0 ? (
              <p className="text-sm text-purple">لا يوجد سجل.</p>
            ) : (
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-navy" />
                    <div>
                      <p className="text-sm font-medium text-navy-900">
                        {CONTRACT_STATUS_LABEL[h.to_status as ContractStatus] ?? h.to_status}
                      </p>
                      <p className="num text-[11px] text-purple">{dateAr(h.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {/* Signatures log — in-system signing only (musaned signs on مساند) */}
          {!musaned && (
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
                <Signature size={16} /> سجل التوقيعات
              </h2>
              {signatures.length === 0 ? (
                <p className="text-sm text-purple">لم يُوقّع العقد بعد.</p>
              ) : (
                <ol className="space-y-3">
                  {signatures.map((s) => (
                    <li key={s.id} className="rounded-xl border border-navy-50 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-navy-900">
                          {s.signer_name ?? '—'}
                        </span>
                        <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[11px] text-navy">
                          {s.signer_type === 'customer'
                            ? 'العميل (الطرف الثاني)'
                            : 'ماسية الشرق (الطرف الأول)'}
                        </span>
                      </div>
                      {s.national_id && (
                        <p className="text-[11px] text-purple">
                          رقم الهوية: <span className="num">{s.national_id}</span>
                        </p>
                      )}
                      <p className="num text-[11px] text-purple">
                        {s.ip_address ? `IP: ${s.ip_address} · ` : ''}
                        {dateTimeAr(s.signed_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
        </div>
      </div>

      {!musaned && (
        <SignContractModal
          contractId={contract.id}
          open={showSign}
          onClose={() => setShowSign(false)}
        />
      )}

      {showEdit && <EditDraftModal contract={contract} onClose={() => setShowEdit(false)} />}

      <Modal
        open={confirmTo !== null}
        onClose={() => setConfirmTo(null)}
        title={confirmTo === 'cancelled' ? 'تأكيد إلغاء العقد' : 'تأكيد إنهاء العقد'}
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-navy-900">
            {confirmTo === 'cancelled'
              ? 'سيُلغى العقد نهائياً ولا يمكن إعادة تفعيله — يمكن إنشاء عقد جديد عند الحاجة.'
              : 'سيُغلق العقد كمنتهٍ. يمكن تجديده لاحقاً كنسخة جديدة.'}
          </p>
          {remaining > 0 && (
            <p className="flex items-center gap-1.5 rounded-xl bg-gold-100 p-3 text-xs text-gold-600">
              <TriangleAlert size={14} /> متبقٍّ على العميل{' '}
              <span className="num font-bold">{sar(remaining)}</span> ر.س غير محصّل.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={confirmTo === 'cancelled' ? 'danger' : 'primary'}
              loading={transition.isPending}
              onClick={() =>
                confirmTo && transition.mutate(confirmTo, { onSuccess: () => setConfirmTo(null) })
              }
            >
              تأكيد
            </Button>
            <Button className="flex-1" variant="outline" onClick={() => setConfirmTo(null)}>
              تراجع
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Edit a DRAFT's dates and branch (validated with Zod, saved via update_contract_draft). */
function EditDraftModal({
  contract,
  onClose,
}: {
  contract: ContractListItem;
  onClose: () => void;
}) {
  const update = useUpdateDraft(contract.id);
  const [form, setForm] = useState({
    start_date: contract.start_date ?? '',
    end_date: contract.end_date ?? '',
    branch: contract.branch_name ?? contract.branch_id ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const branchOptions: { value: string; label: string }[] = BRANCHES_AR.map((b) => ({
    value: b,
    label: b,
  }));
  if (form.branch && !BRANCHES_AR.some((b) => b === form.branch)) {
    branchOptions.unshift({ value: form.branch, label: form.branch });
  }

  function submit() {
    const parsed = updateDraftInputSchema.safeParse({
      ...form,
      end_date: form.end_date || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'بيانات غير صحيحة');
      return;
    }
    setError(null);
    update.mutate(parsed.data, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title="تعديل مسودة العقد">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="تاريخ البداية"
            type="date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
          <Input
            label="تاريخ النهاية"
            type="date"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
          />
          <Select
            label="الفرع"
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
            options={branchOptions}
            placeholder="اختر الفرع"
          />
        </div>
        <p className="text-[11px] text-purple">
          الخدمة والسعر والخصم تُحدَّد عند الإنشاء — لتغييرها ألغِ المسودة وأنشئ عقداً جديداً.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button className="w-full" loading={update.isPending} onClick={submit}>
          حفظ التعديلات
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Musaned contracts (استقدام / نقل كفالة) are created & signed on منصة مساند.
 * Our system tracks the process and the reference number only — editable inline
 * (with contracts.edit) so it can be filled once the contract is issued on مساند.
 */
function MusanedPanel({ contract }: { contract: ContractListItem }) {
  const { can } = usePermissions();
  const update = useUpdateMusanedNo(contract.id);
  const editable = can('contracts', 'edit');
  const [value, setValue] = useState(contract.musaned_contract_no ?? '');
  const [syncedFrom, setSyncedFrom] = useState(contract.musaned_contract_no);
  if (syncedFrom !== contract.musaned_contract_no) {
    // the saved number changed (save / refetch) → reflect it in the field
    setSyncedFrom(contract.musaned_contract_no);
    setValue(contract.musaned_contract_no ?? '');
  }
  const dirty = value.trim() !== (contract.musaned_contract_no ?? '');

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <ExternalLink size={16} /> منصة مساند
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-navy-900">
        يُنشأ عقد {contract.service_code ? SERVICE_LABEL[contract.service_code] : ''} ويُوقّعه
        العميل على منصة مساند. النظام يتتبّع حالة العقد ورقمه فقط — راجع تفاصيل العقد وتوقيعه على
        منصة مساند.
      </p>
      <label className="mb-1.5 block text-xs font-medium text-purple">رقم عقد مساند</label>
      {editable ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="أدخل رقم العقد من منصة مساند"
            />
          </div>
          <Button
            size="sm"
            disabled={!dirty}
            loading={update.isPending}
            onClick={() => update.mutate(value)}
          >
            حفظ
          </Button>
        </div>
      ) : (
        <p className="num text-sm font-semibold text-navy-900">
          {contract.musaned_contract_no ?? 'لم يُسجَّل بعد'}
        </p>
      )}
    </Card>
  );
}
