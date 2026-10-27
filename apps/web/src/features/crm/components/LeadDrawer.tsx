import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Check,
  FileSignature,
  FileText,
  MessageCircle,
  Phone,
  Send,
  UserCheck,
} from 'lucide-react';
import { Badge, Button, Input, Modal, Select } from '@/shared/ui';
import { dateTimeAr, sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { NATIONALITIES, TASK_TYPES } from '@/lib/orderTypes';
import { canMoveTo, quoteContractPath } from '@/shared/lib/quotesLedger';
import { calculate, EMPTY_CALC, type CalcInput } from '@/features/pricing/lib/engine';
import { usePricingConfig, usePricingRules } from '@/features/pricing/hooks/usePricingRules';
import {
  useActivities,
  useAddActivity,
  useConvertLead,
  useCreateQuote,
  useQuotes,
  useSetQuoteStatus,
  useToggleActivity,
} from '@/features/crm/hooks/useCrm';
import { useCrmMeta } from '@/features/crm/hooks/useCrmMeta';
import {
  ACTIVITY_LABEL,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  SERVICE_LABEL,
  type ActivityKind,
  type Lead,
  type QuoteStatus,
  type ServiceCode,
} from '@/features/crm/types';

const KIND_OPTS = (Object.entries(ACTIVITY_LABEL) as [ActivityKind, string][]).map(
  ([value, label]) => ({ value, label }),
);
const SERVICE_OPTS = (Object.entries(SERVICE_LABEL) as [ServiceCode, string][]).map(
  ([value, label]) => ({ value, label }),
);
/** Current status + the moves the quote lifecycle allows (no invalid options). */
function quoteStatusOpts(from: QuoteStatus) {
  return (Object.entries(QUOTE_STATUS_LABEL) as [QuoteStatus, string][])
    .filter(([to]) => to === from || canMoveTo(from, to))
    .map(([value, label]) => ({ value, label }));
}
const NAT_OPTS = NATIONALITIES.map((n) => ({ value: n, label: n }));
const TASK_OPTS = TASK_TYPES.map((t) => ({ value: t, label: t }));

/** wa.me link with a Saudi number normalized to international format. */
function waLink(phone: string | null, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0/, '966');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function LeadDrawer({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  return (
    <Modal open={lead !== null} onClose={onClose} title="ملف العميل المحتمل">
      {lead && <LeadDrawerBody lead={lead} />}
    </Modal>
  );
}

function LeadDrawerBody({ lead }: { lead: Lead }) {
  const { stageLabel, stageTone, sourceLabel } = useCrmMeta();
  const { data: activities = [] } = useActivities(lead.id);
  const { data: quotes = [] } = useQuotes(lead.id);
  const addActivity = useAddActivity();
  const toggle = useToggleActivity();
  const convertLead = useConvertLead();
  const createQuote = useCreateQuote();
  const setQuoteStatus = useSetQuoteStatus();
  const navigate = useNavigate();
  const { can, fullName } = usePermissions();
  const canEdit = can('leads', 'edit');
  const canLog = can('leads', 'create');
  const { data: rules = [], isLoading: rulesLoading } = usePricingRules();
  const { data: cfg } = usePricingConfig();

  // follow-up form
  const [kind, setKind] = useState<ActivityKind>('call');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');

  // quick quote form
  const [service, setService] = useState<ServiceCode>(lead.service_code ?? 'recruitment');
  const [nationality, setNationality] = useState(EMPTY_CALC.nationality);
  const [task, setTask] = useState(EMPTY_CALC.profession);
  const [qty, setQty] = useState('1');
  const calc: CalcInput = {
    ...EMPTY_CALC,
    service,
    nationality,
    profession: task,
    quantity: Number(qty),
  };
  // same engine as the calculator: managed price list + managed VAT
  const result = useMemo(
    () => (cfg ? calculate(calc, rules, cfg) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [service, nationality, task, qty, rules, cfg],
  );
  const price = result?.detail;
  const quoteBlocker = !price ? 'جارٍ تحميل قائمة الأسعار…' : (result.blockers[0] ?? null);
  const canLogActivity = Boolean(note.trim() || followUp);

  function logActivity() {
    if (!canLogActivity) return;
    addActivity.mutate(
      {
        lead_id: lead.id,
        kind,
        note: note.trim() ? note.trim() : null,
        follow_up_at: followUp ? new Date(followUp).toISOString() : null,
      },
      {
        onSuccess: () => {
          setNote('');
          setFollowUp('');
        },
      },
    );
  }

  function sendQuote() {
    if (!cfg || quoteBlocker) return;
    createQuote.mutate({
      input: { lead_id: lead.id, calc, valid_days: 7 },
      rules,
      cfg,
      actor: fullName,
    });
  }

  const quoteText = `عرض سعر من ماسية الشرق للاستقدام\nالخدمة: ${SERVICE_LABEL[service]}\nالإجمالي شامل الضريبة: ${sar(price?.total ?? 0)} ر.س\nصالح حتى 7 أيام.`;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-50/60 p-3">
        <div>
          <p className="font-bold text-navy">{lead.full_name}</p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-purple">
            {lead.service_code && <Badge tone="teal">{SERVICE_LABEL[lead.service_code]}</Badge>}
            {lead.source_code && <span>{sourceLabel(lead.source_code)}</span>}
            <Badge tone={stageTone(lead.stage_code)}>{stageLabel(lead.stage_code)}</Badge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lead.phone && (
            <>
              <a
                href={`tel:${lead.phone}`}
                className="inline-flex items-center gap-1 rounded-lg border border-navy-100 px-2.5 py-1.5 text-xs text-navy hover:bg-navy-50"
              >
                <Phone size={13} /> اتصال
              </a>
              <a
                href={waLink(lead.phone, `مرحباً ${lead.full_name}`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-navy-100 px-2.5 py-1.5 text-xs text-green-600 hover:bg-navy-50"
              >
                <MessageCircle size={13} /> واتساب
              </a>
            </>
          )}
          {lead.customer_id ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-green-100 px-2.5 py-1.5 text-xs font-semibold text-green-600">
              <BadgeCheck size={13} /> عميل
            </span>
          ) : (
            canEdit && (
              <Button
                variant="outline"
                size="sm"
                loading={convertLead.isPending}
                onClick={() => convertLead.mutate(lead.id)}
              >
                <UserCheck size={14} /> تحويل لعميل
              </Button>
            )
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* follow-ups */}
        <div className="rounded-xl border border-navy-100 p-3">
          <h3 className="mb-2 text-xs font-bold text-navy">المتابعات والتذكيرات</h3>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as ActivityKind)}
                options={KIND_OPTS}
              />
              <Input
                type="datetime-local"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />
            </div>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ملاحظة المتابعة"
            />
            {canLog && (
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                disabled={!canLogActivity}
                title={canLogActivity ? undefined : 'اكتب ملاحظة أو حدّد موعد تذكير'}
                loading={addActivity.isPending}
                onClick={logActivity}
              >
                تسجيل المتابعة
              </Button>
            )}
          </div>
          <ol className="mt-3 space-y-2">
            {activities.length === 0 && <p className="text-xs text-purple">لا يوجد سجل بعد.</p>}
            {activities.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-[13px]">
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: a.id, done: !a.done })}
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${a.done ? 'border-teal bg-teal text-white' : 'border-navy-200'}`}
                  aria-label="إنجاز"
                >
                  {a.done && <Check size={11} />}
                </button>
                <div>
                  <p className={a.done ? 'text-purple line-through' : 'text-navy-900'}>
                    <Badge tone="teal">{ACTIVITY_LABEL[a.kind]}</Badge> {a.note}
                  </p>
                  {a.follow_up_at && (
                    <p className="num text-[11px] text-gold-600">
                      تذكير: {dateTimeAr(a.follow_up_at)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* quick quote */}
        <div className="rounded-xl border border-navy-100 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
            <FileText size={14} /> عرض سعر سريع
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={service}
              onChange={(e) => setService(e.target.value as ServiceCode)}
              options={SERVICE_OPTS}
              aria-label="الخدمة"
            />
            {service === 'daily_rental' ? (
              <Select
                value={task}
                onChange={(e) => setTask(e.target.value)}
                options={TASK_OPTS}
                aria-label="المهمة"
              />
            ) : (
              <Select
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                options={NAT_OPTS}
                aria-label="الجنسية"
              />
            )}
            <Input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              placeholder={
                service === 'daily_rental'
                  ? 'عدد الأيام'
                  : service === 'monthly_rental'
                    ? 'عدد الأشهر'
                    : 'العدد'
              }
              aria-label="الكمية"
              className="col-span-2"
            />
          </div>
          <div className="mt-2 rounded-lg bg-navy-50 p-2.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-purple">الصافي قبل الضريبة</span>
              <span className="num">{price ? sar(price.net) : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-purple">
                ضريبة القيمة المضافة{' '}
                {cfg && <span className="num">({Math.round(cfg.vat_rate * 10000) / 100}٪)</span>}
              </span>
              <span className="num">{price ? sar(price.vat) : '—'}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-navy-100 pt-1 font-bold text-navy">
              <span>الإجمالي</span>
              <span className="num text-gold-600">{price ? `${sar(price.total)} ر.س` : '—'}</span>
            </div>
            <p className="mt-1 text-[11px] text-purple">
              من قائمة الأسعار المعتمدة في قسم التسعير.
            </p>
          </div>
          {quoteBlocker && !rulesLoading && price && (
            <p role="alert" className="mt-1.5 text-[11px] text-red-600">
              {quoteBlocker}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {canEdit && (
              <Button
                variant="primary"
                size="sm"
                className="flex-1"
                disabled={Boolean(quoteBlocker)}
                loading={createQuote.isPending}
                onClick={sendQuote}
              >
                <Send size={14} /> إنشاء العرض
              </Button>
            )}
            {lead.phone && price && (
              <a
                href={waLink(lead.phone, quoteText)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-xl border border-navy-100 px-3 text-xs font-semibold text-green-600 hover:bg-navy-50"
              >
                <MessageCircle size={14} /> واتساب
              </a>
            )}
          </div>

          {quotes.length > 0 && (
            <ol className="mt-3 space-y-2">
              {quotes.map((q) => (
                <li key={q.id} className="rounded-lg border border-navy-100 p-2 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="num font-semibold text-navy">{sar(q.total_amount)} ر.س</span>
                    <Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Select
                      value={q.status}
                      onChange={(e) =>
                        setQuoteStatus.mutate({
                          id: q.id,
                          status: e.target.value as QuoteStatus,
                          actor: fullName,
                        })
                      }
                      options={quoteStatusOpts(q.status)}
                      disabled={!canEdit || quoteStatusOpts(q.status).length < 2}
                      aria-label="حالة العرض"
                      className="flex-1"
                    />
                    {q.status === 'accepted' && !q.contract_id && can('contracts', 'create') && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(quoteContractPath(q, q.coupon_code))}
                      >
                        <FileSignature size={14} /> تحويل لعقد
                      </Button>
                    )}
                    {q.contract_id && <Badge tone="success">تم التعاقد</Badge>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
