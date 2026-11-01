import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Eye,
  FilePlus2,
  FileSignature,
  MessageCircle,
  Pencil,
  Phone,
  Printer,
  Send,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
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
  StatTile,
} from '@/shared/ui';
import { dateAr, dateTimeAr, sar } from '@/shared/lib/format';
import { effectiveStatus, quoteNeedsApproval, type QuoteRecord } from '@/shared/lib/quotesLedger';
import { usePermissions } from '@/hooks/usePermissions';
import {
  buildQuoteHtml,
  durationLabel,
  quoteShareText,
  toWaNumber,
} from '@/features/pricing/lib/quoteHtml';
import { logPdf, logWhatsappOpened } from '@/features/pricing/api/quotes.api';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import {
  useActivities,
  useAddActivity,
  useConvertLead,
  useConvertQuote,
  useLead,
  useLeadQuotes,
  useQuoteApprovalPolicy,
  useSetLeadQuoteStatus,
  useSetLeadStage,
  useToggleActivity,
} from '@/features/crm/hooks/useCrm';
import { useCrmMeta } from '@/features/crm/hooks/useCrmMeta';
import { QuoteBuilder } from '@/features/crm/components/QuoteBuilder';
import {
  ACTIVITY_LABEL,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  SERVICE_LABEL,
  type ActivityKind,
  type Lead,
  type LeadStageCode,
} from '@/features/crm/types';

const KIND_OPTS = (Object.entries(ACTIVITY_LABEL) as [ActivityKind, string][]).map(
  ([value, label]) => ({ value, label }),
);

/**
 * ملف العميل المحتمل الكامل: بياناته ومتابعاته وعروض أسعاره وعقوده في صفحة
 * واحدة، ومنها مباشرة: إنشاء عرض سعر ← إرسال/اعتماد ← قبول ← تحويل إلى عقد.
 */
export default function LeadProfile() {
  const { id } = useParams<{ id: string }>();
  const { data: lead, isLoading, isError, refetch } = useLead(id);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!lead)
    return (
      <EmptyState
        title="العميل المحتمل غير موجود أو خارج نطاق فرعك"
        action={
          <Link to="/leads" className="text-sm font-medium text-navy underline">
            العودة إلى العملاء المحتملين
          </Link>
        }
      />
    );
  return <LeadProfileBody lead={lead} />;
}

function LeadProfileBody({ lead }: { lead: Lead }) {
  const { can } = usePermissions();
  const { stageLabel, stageTone, sourceLabel, activeStages } = useCrmMeta();
  const {
    data: quotes = [],
    isLoading: quotesLoading,
    isError: quotesError,
    refetch,
  } = useLeadQuotes(lead.id);
  const convertLead = useConvertLead();
  const setStage = useSetLeadStage();
  const [builder, setBuilder] = useState<{ open: boolean; parent: QuoteRecord | null }>({
    open: false,
    parent: null,
  });

  const accepted = quotes.filter((q) => q.status === 'accepted');
  const contracts = quotes.filter((q) => q.contract_id);
  const openBuilder = (parent: QuoteRecord | null = null) => setBuilder({ open: true, parent });

  return (
    <div className="space-y-5">
      <Link
        to="/leads"
        className="inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
      >
        <ArrowRight size={16} /> العملاء المحتملون
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-navy">{lead.full_name}</h1>
              <Badge tone={stageTone(lead.stage_code)}>{stageLabel(lead.stage_code)}</Badge>
              {lead.customer_id && <Badge tone="success">عميل مسجّل</Badge>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <Info label="الجوال" value={<span className="num">{lead.phone ?? '—'}</span>} />
              <Info
                label="الخدمة المطلوبة"
                value={lead.service_code ? SERVICE_LABEL[lead.service_code] : '—'}
              />
              <Info label="المصدر" value={sourceLabel(lead.source_code) || '—'} />
              <Info label="الفرع" value={lead.branch ?? '—'} />
              <Info
                label="القيمة المتوقعة"
                value={<span className="num">{sar(lead.est_value)} ر.س</span>}
              />
              <Info label="تاريخ التسجيل" value={dateAr(lead.created_at)} />
            </dl>
            {lead.notes && <p className="mt-3 text-sm text-navy/80">{lead.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {can('leads', 'create') && (
              <Button onClick={() => openBuilder()}>
                <FilePlus2 size={16} /> إنشاء عرض سعر
              </Button>
            )}
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                className="inline-flex items-center gap-1 rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy"
              >
                <Phone size={16} /> اتصال
              </a>
            )}
            {can('leads', 'edit') && !lead.customer_id && (
              <Button
                variant="outline"
                loading={convertLead.isPending}
                onClick={() => convertLead.mutate(lead.id)}
              >
                <UserCheck size={16} /> تحويل إلى عميل
              </Button>
            )}
            {can('leads', 'edit') && (
              <Select
                aria-label="مرحلة العميل المحتمل"
                options={activeStages.map((s) => ({ value: s.code, label: s.name_ar }))}
                value={lead.stage_code}
                onChange={(e) =>
                  setStage.mutate({ id: lead.id, stage: e.target.value as LeadStageCode })
                }
              />
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="عروض الأسعار" value={String(quotes.length)} />
        <StatTile
          label="قيمة العروض المقبولة"
          value={`${sar(accepted.reduce((s, q) => s + q.total_amount, 0))} ر.س`}
        />
        <StatTile label="العقود" value={String(contracts.length)} />
      </div>

      <section>
        <h2 className="mb-3 text-base font-bold text-navy">عروض الأسعار</h2>
        {quotesLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : quotesError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : quotes.length === 0 ? (
          <EmptyState
            title="لا توجد عروض أسعار بعد"
            description="أنشئ أول عرض سعر لهذا العميل من الزر أعلاه."
          />
        ) : (
          <div className="space-y-3">
            {quotes.map((q) => (
              <QuoteCard key={q.id} q={q} onNewVersion={() => openBuilder(q)} />
            ))}
          </div>
        )}
      </section>

      <Activities leadId={lead.id} />

      <QuoteBuilder
        lead={lead}
        open={builder.open}
        parent={builder.parent}
        onClose={() => setBuilder({ open: false, parent: null })}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-purple">{label}</dt>
      <dd className="font-medium text-navy">{value}</dd>
    </div>
  );
}

function QuoteCard({ q, onNewVersion }: { q: QuoteRecord; onNewVersion: () => void }) {
  const { can, fullName } = usePermissions();
  const policy = useQuoteApprovalPolicy();
  const setStatus = useSetLeadQuoteStatus();
  const convert = useConvertQuote();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(false);
  const status = effectiveStatus(q);
  const needsApproval = quoteNeedsApproval(q, policy.thresholdPct);
  const canEdit = can('leads', 'edit');
  const busy = setStatus.isPending || convert.isPending;
  const move = (to: QuoteRecord['status']) =>
    setStatus.mutate({ id: q.id, status: to, actor: fullName, policy });

  function whatsapp() {
    const text = encodeURIComponent(quoteShareText(q));
    const url = q.customer_phone
      ? `https://wa.me/${toWaNumber(q.customer_phone)}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, '_blank', 'noopener');
    logWhatsappOpened(q.id, fullName);
  }
  function print() {
    openContractPrint(buildQuoteHtml(q, { autoPrint: true }));
    logPdf(q.id, fullName);
  }

  const duration = durationLabel(q.duration_unit, q.duration_count);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num font-bold text-navy">QT-{q.quote_no}</span>
            <Badge tone={QUOTE_STATUS_TONE[status]}>{QUOTE_STATUS_LABEL[status]}</Badge>
            {q.parent_id && <Badge tone="neutral">نسخة معدّلة</Badge>}
            {q.approved_at && (
              <Badge tone="teal">
                <ShieldCheck size={12} className="me-1" /> معتمد
              </Badge>
            )}
          </div>
          <div className="text-sm text-navy/80">
            {SERVICE_LABEL[q.service_code as keyof typeof SERVICE_LABEL] ?? q.service_code}
            {q.nationality && ` · ${q.nationality}`}
            {q.profession && ` · ${q.profession}`}
            {q.worker_name && ` · ${q.worker_name}`}
            {duration && ` · ${duration}`}
          </div>
          <div className="text-xs text-purple">
            أُنشئ {dateTimeAr(q.created_at)}
            {q.valid_until && ` · صالح حتى ${dateAr(q.valid_until)}`}
          </div>
        </div>
        <div className="text-end">
          <div className="num text-lg font-bold text-navy">{sar(q.total_amount)} ر.س</div>
          {(q.discount_amount ?? 0) > 0 && (
            <div className="num text-xs text-red-600">
              خصم {sar(q.discount_amount ?? 0)}
              {q.coupon_code && ` (${q.coupon_code})`}
            </div>
          )}
          <div className="text-xs text-purple">شامل الضريبة</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-navy-50 pt-3">
        <Button size="sm" variant="ghost" onClick={() => setPreview(true)}>
          <Eye size={14} /> معاينة
        </Button>
        <Button size="sm" variant="ghost" onClick={print}>
          <Printer size={14} /> طباعة / PDF
        </Button>
        {(status === 'draft' || status === 'sent') && (
          <Button size="sm" variant="ghost" onClick={whatsapp}>
            <MessageCircle size={14} /> واتساب
          </Button>
        )}

        {canEdit && status === 'draft' && needsApproval && (
          <Button size="sm" loading={busy} onClick={() => move('pending_approval')}>
            <Send size={14} /> إرسال لاعتماد المدير
          </Button>
        )}
        {canEdit && status === 'draft' && !needsApproval && (
          <Button size="sm" loading={busy} onClick={() => move('sent')}>
            <Send size={14} /> تأكيد الإرسال للعميل
          </Button>
        )}
        {status === 'pending_approval' &&
          (policy.canApprove ? (
            <>
              <Button size="sm" variant="success" loading={busy} onClick={() => move('sent')}>
                <BadgeCheck size={14} /> اعتماد وإرسال
              </Button>
              <Button size="sm" variant="danger" loading={busy} onClick={() => move('rejected')}>
                <XCircle size={14} /> رفض الاعتماد
              </Button>
            </>
          ) : (
            <span className="self-center text-xs text-teal">بانتظار اعتماد مدير الفرع</span>
          ))}
        {canEdit && status === 'sent' && (
          <>
            <Button size="sm" variant="success" loading={busy} onClick={() => move('accepted')}>
              <CheckCircle2 size={14} /> قبول العميل
            </Button>
            <Button size="sm" variant="danger" loading={busy} onClick={() => move('rejected')}>
              <XCircle size={14} /> رفض العميل
            </Button>
          </>
        )}
        {status === 'accepted' && !q.contract_id && can('contracts', 'create') && (
          <Button
            size="sm"
            variant="accent"
            loading={convert.isPending}
            onClick={() =>
              convert.mutate(
                { quote: q, actor: fullName },
                { onSuccess: (r) => navigate(`/contracts/${r.contract_id}`) },
              )
            }
          >
            <FileSignature size={14} /> تحويل إلى عقد
          </Button>
        )}
        {q.contract_id && (
          <Link
            to={`/contracts/${q.contract_id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-green-100 px-3 py-1.5 text-xs font-medium text-green-700"
          >
            <FileSignature size={14} /> فتح العقد
          </Link>
        )}
        {can('leads', 'create') && !q.contract_id && status !== 'accepted' && (
          <Button size="sm" variant="outline" onClick={onNewVersion}>
            <Pencil size={14} />{' '}
            {status === 'expired' || status === 'rejected' ? 'عرض جديد' : 'تعديل (نسخة جديدة)'}
          </Button>
        )}
      </div>

      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        size="lg"
        title={`عرض سعر QT-${q.quote_no}`}
      >
        <iframe
          title={`معاينة عرض السعر QT-${q.quote_no}`}
          srcDoc={buildQuoteHtml(q)}
          className="h-[70vh] w-full rounded-xl border border-navy-100 bg-white"
        />
      </Modal>
    </Card>
  );
}

function Activities({ leadId }: { leadId: string }) {
  const { can } = usePermissions();
  const { data: activities = [], isLoading } = useActivities(leadId);
  const add = useAddActivity();
  const toggle = useToggleActivity();
  const [kind, setKind] = useState<ActivityKind>('call');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');

  return (
    <section>
      <h2 className="mb-3 text-base font-bold text-navy">المتابعات</h2>
      {can('leads', 'create') && (
        <Card className="mb-3 grid gap-3 p-4 sm:grid-cols-4">
          <Select
            label="النوع"
            options={KIND_OPTS}
            value={kind}
            onChange={(e) => setKind(e.target.value as ActivityKind)}
          />
          <Input label="الملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
          <Input
            label="موعد المتابعة"
            type="datetime-local"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
          />
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={!note.trim() && !followUp}
              loading={add.isPending}
              onClick={() =>
                add.mutate(
                  {
                    lead_id: leadId,
                    kind,
                    note: note.trim() || null,
                    follow_up_at: followUp ? new Date(followUp).toISOString() : null,
                  },
                  {
                    onSuccess: () => {
                      setNote('');
                      setFollowUp('');
                    },
                  },
                )
              }
            >
              تسجيل
            </Button>
          </div>
        </Card>
      )}
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : activities.length === 0 ? (
        <EmptyState title="لا توجد متابعات مسجّلة" />
      ) : (
        <ul className="space-y-2">
          {activities.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-xl bg-white p-3 shadow-card"
            >
              <div>
                <div className="text-sm font-medium text-navy">
                  {ACTIVITY_LABEL[a.kind]}{' '}
                  {a.note && <span className="font-normal text-navy/80">— {a.note}</span>}
                </div>
                <div className="text-xs text-purple">
                  {dateTimeAr(a.created_at)}
                  {a.follow_up_at && ` · متابعة ${dateTimeAr(a.follow_up_at)}`}
                </div>
              </div>
              {a.follow_up_at && (
                <label className="flex items-center gap-1 text-xs text-purple">
                  <input
                    type="checkbox"
                    checked={a.done}
                    disabled={!can('leads', 'edit')}
                    onChange={(e) => toggle.mutate({ id: a.id, done: e.target.checked })}
                  />
                  تمت
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
