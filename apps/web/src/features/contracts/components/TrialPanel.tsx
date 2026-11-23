import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FlaskConical,
  Link2,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Modal, Skeleton, useToast } from '@/shared/ui';
import { sar, dateAr, dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useLookups } from '@/features/contracts/hooks/useContractOps';
import {
  useIssueTrialLink,
  useSetTrialRequirement,
  useTrialAcceptance,
  useTrialByContract,
  useTrialStep,
} from '@/features/contracts/hooks/useTrials';
import {
  TRIAL_STATUS_LABEL,
  trialLinkUrl,
  type TrialAction,
} from '@/features/contracts/api/trials.api';
import { TRIAL_TONE } from '@/features/contracts/components/TrialsBoard';
import type { ContractListItem } from '@/features/contracts/types';

const PRE_HANDOVER = ['draft', 'awaiting_acceptance', 'accepted', 'awaiting_handover'];

/** «تجربة نقل الخدمات» داخل تفاصيل عقدها: البيانات، رابط القبول، المتطلبات، القرار. */
export function TrialPanel({ contract }: { contract: ContractListItem }) {
  const { can } = usePermissions();
  const toast = useToast();
  const { data: t, isLoading, isError, refetch } = useTrialByContract(contract.id);
  const { data: acceptance } = useTrialAcceptance(t?.id);
  const { data: reqs = [] } = useLookups('trial_requirement');
  const issue = useIssueTrialLink();
  const setReq = useSetTrialRequirement();
  const step = useTrialStep();
  const [link, setLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [decision, setDecision] = useState<'transfer' | 'decline' | 'cancel' | null>(null);
  const [note, setNote] = useState('');

  if (isLoading)
    return (
      <Card>
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  if (isError)
    return (
      <Card>
        <ErrorState onRetry={() => void refetch()} />
      </Card>
    );
  if (!t) return null;

  const editable = can('contracts', 'edit');
  const active = reqs.filter((r) => r.is_active);
  const missing = active.filter((r) => r.flag && !t.regulatory_checklist[r.code]?.done);
  const run = (action: TrialAction, n?: string) =>
    step.mutate({ t, action, note: n }, { onSuccess: () => setDecision(null) });

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <FlaskConical size={16} /> تجربة بغرض نقل الخدمات ·{' '}
          <span className="num">{t.trial_no}</span>
        </h2>
        <Badge tone={TRIAL_TONE[t.status]}>{TRIAL_STATUS_LABEL[t.status]}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {[
          [
            'السعر شامل الضريبة',
            <span key="p" className="num">
              {sar(t.total_amount)}
            </span>,
          ],
          [
            'أيام التجربة',
            <span key="d" className="num">
              {t.trial_days}
            </span>,
          ],
          [
            'استلام العاملة',
            <span key="r" className="num">
              {dateAr(t.receipt_date)}
            </span>,
          ],
          [
            'نهاية التجربة',
            <span key="e" className="num">
              {dateAr(t.end_date)}
            </span>,
          ],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl bg-navy-50 p-2">
            <p className="text-[11px] text-purple">{label}</p>
            <p className="text-sm font-bold text-navy">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-purple">
        الشروط: {t.terms_snapshot.title} — النسخة{' '}
        <span className="num">{t.terms_snapshot.version}</span>. القبول هنا لا يُعد عقد نقل خدمات
        ولا يغني عن إجراءات منصة مساند.
      </p>

      {/* القبول الإلكتروني */}
      <div className="mt-4 rounded-xl border border-navy-50 p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
          <ShieldCheck size={14} /> القبول الإلكتروني
        </h3>
        {acceptance ? (
          <dl className="grid gap-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="inline text-purple">وقت القبول: </dt>
              <dd className="num inline">{dateTimeAr(acceptance.accepted_at)}</dd>
            </div>
            <div>
              <dt className="inline text-purple">التحقق: </dt>
              <dd className="inline">
                آخر 4 من الهوية <span className="num">{acceptance.national_id_last4}</span> + الجوال{' '}
                <span className="num">{acceptance.phone_masked}</span>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="inline text-purple">بصمة المستند المقبول: </dt>
              <dd className="num inline break-all">{acceptance.document_sha256}</dd>
            </div>
          </dl>
        ) : ['draft', 'awaiting_acceptance'].includes(t.status) ? (
          <>
            <p className="mb-2 text-xs text-purple">
              أرسل للعميل رابطاً آمناً: يراجع بيانات العاملة والسعر والمدة والشروط ثم يضغط «أوافق».
              فتح الرابط وحده ليس قبولاً.
            </p>
            {editable && (
              <Button
                size="sm"
                loading={issue.isPending}
                onClick={() =>
                  issue.mutate(t, {
                    onSuccess: (r) =>
                      setLink({ url: trialLinkUrl(r.token), expires_at: r.expires_at }),
                  })
                }
              >
                <Link2 size={14} />{' '}
                {t.status === 'draft' ? 'إنشاء رابط القبول' : 'إصدار رابط جديد (يُلغي السابق)'}
              </Button>
            )}
            {link && (
              <div className="mt-2 rounded-lg bg-navy-50 p-2 text-xs">
                <p className="num break-all" dir="ltr">
                  {link.url}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-purple">
                    صالح حتى <span className="num">{dateTimeAr(link.expires_at)}</span> — يظهر مرة
                    واحدة فقط
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard?.writeText(link.url);
                      toast.success('نُسخ الرابط');
                    }}
                  >
                    <Copy size={13} /> نسخ
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-purple">لا يوجد سجل قبول.</p>
        )}
      </div>

      {/* المتطلبات النظامية قبل التسليم */}
      <div className="mt-3 rounded-xl border border-navy-50 p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
          <ClipboardCheck size={14} /> متطلبات التسليم (تحقّق عبر القنوات الرسمية)
        </h3>
        <ul className="space-y-1.5">
          {active.map((r) => {
            const item = t.regulatory_checklist[r.code];
            return (
              <li
                key={r.code}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(item?.done)}
                    disabled={!editable || !PRE_HANDOVER.includes(t.status) || setReq.isPending}
                    onChange={(e) => setReq.mutate({ t, code: r.code, done: e.target.checked })}
                  />
                  {r.name_ar}
                  {r.flag && <span className="text-[10px] text-gold-600">إلزامي</span>}
                </label>
                {item?.at && (
                  <span className="num text-[11px] text-purple">{dateTimeAr(item.at)}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* الإجراءات */}
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          {['accepted', 'awaiting_handover'].includes(t.status) && (
            <div>
              <Button
                size="sm"
                disabled={missing.length > 0 || step.isPending}
                onClick={() => run('start')}
              >
                <CheckCircle2 size={14} /> تسليم العاملة وبدء التجربة
              </Button>
              {missing.length > 0 && (
                <p className="mt-1 text-[11px] text-purple">
                  ناقص: {missing.map((m) => m.name_ar).join('، ')}
                </p>
              )}
            </div>
          )}
          {t.status === 'in_trial' && (
            <Button
              size="sm"
              variant="outline"
              disabled={step.isPending}
              onClick={() => run('complete')}
            >
              إنهاء فترة التجربة
            </Button>
          )}
          {['in_trial', 'completed'].includes(t.status) && (
            <>
              <Button size="sm" variant="success" onClick={() => setDecision('transfer')}>
                العميل يرغب في نقل الخدمات
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDecision('decline')}>
                العميل لا يرغب في الاستمرار
              </Button>
            </>
          )}
          {PRE_HANDOVER.includes(t.status) && (
            <Button size="sm" variant="ghost" onClick={() => setDecision('cancel')}>
              <XCircle size={14} /> إلغاء التجربة
            </Button>
          )}
        </div>
      )}
      {t.status === 'wants_transfer' && t.transfer_contract_id && (
        <Link
          to={`/contracts/${t.transfer_contract_id}`}
          className="mt-3 block text-sm font-semibold text-navy underline"
        >
          متابعة مسودة عقد نقل الكفالة (مسار مساند)
        </Link>
      )}
      {t.status === 'declined' && (
        <p className="mt-3 text-xs text-purple">
          أكمل «إرجاع العاملة» ثم «إلغاء العقد وتسويته» من عمليات العقد — وفق الشروط المعتمدة فقط.
        </p>
      )}

      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={
          decision === 'transfer'
            ? 'رغبة العميل في نقل الخدمات'
            : decision === 'decline'
              ? 'عدم رغبة العميل في الاستمرار'
              : 'إلغاء التجربة'
        }
      >
        {decision === 'transfer' && (
          <p className="mb-2 text-xs text-purple">
            تُنشأ مسودة عقد نقل كفالة على مسار مساند وتنتهي التجربة اليوم. لا يُنفَّذ أي نقل فعلي في
            النظام — الإجراء عبر مساند وأبشر.
          </p>
        )}
        <Input label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          className="mt-3 w-full"
          loading={step.isPending}
          onClick={() => decision && run(decision, note)}
        >
          تأكيد
        </Button>
      </Modal>
    </Card>
  );
}
