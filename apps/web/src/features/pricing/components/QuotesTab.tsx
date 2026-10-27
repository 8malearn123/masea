import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Copy,
  Eye,
  FileDown,
  FileSignature,
  FileText,
  MessageCircle,
  Send,
  XCircle,
  CircleDashed,
  Clock,
  Ban,
  Files,
} from 'lucide-react';
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Pagination,
  Skeleton,
  StatTile,
  paginate,
} from '@/shared/ui';
import { dateAr, dateTimeAr } from '@/shared/lib/format';
import { exportExcel } from '@/shared/lib/exportTable';
import { usePermissions } from '@/hooks/usePermissions';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import { effectiveStatus, canMoveTo } from '@/shared/lib/quotesLedger';
import type { PricingConfig } from '@/shared/lib/pricing';
import {
  logPdf,
  logWhatsappOpened,
  type PricingQuote,
  type QuoteEvent,
} from '@/features/pricing/api/quotes.api';
import {
  useCreateQuote,
  useQuoteEvents,
  useQuotes,
  useSetQuoteStatus,
} from '@/features/pricing/hooks/useQuotes';
import { usePromotions } from '@/features/pricing/hooks/usePromotions';
import {
  buildQuoteHtml,
  isSnapshot,
  quoteShareText,
  toWaNumber,
} from '@/features/pricing/lib/quoteHtml';
import {
  PRICING_SERVICE_LABEL,
  QUOTE_STATUS_LABEL,
  type PricingRule,
  type QuoteStatus,
} from '@/features/pricing/types';
import {
  FilterSelect,
  Money,
  QuoteBadge,
  SearchBox,
  SectionTitle,
  Toolbar,
  today,
  useUrlState,
} from '@/features/pricing/components/shared';
import { useQueryClient } from '@tanstack/react-query';

const PAGE = 10;
const STATUSES: QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
const EVENT_LABEL: Record<QuoteEvent['type'], string> = {
  created: 'أُنشئ العرض',
  whatsapp_opened: 'فُتح رابط واتساب (لا يعني الاستلام)',
  marked_sent: 'تأكيد الإرسال للعميل',
  pdf_generated: 'تحميل/طباعة PDF',
  accepted: 'قبول العرض',
  rejected: 'رفض العرض',
  expired: 'انتهاء الصلاحية',
  version_created: 'إنشاء نسخة جديدة',
  converted: 'تحويل إلى عقد',
};
const RANGES = [
  { value: 'all', label: 'كل الفترات' },
  { value: '7', label: 'آخر 7 أيام' },
  { value: '30', label: 'آخر 30 يومًا' },
  { value: '90', label: 'آخر 90 يومًا' },
];

export function QuotesTab({ cfg, rules }: { cfg: PricingConfig; rules: PricingRule[] }) {
  const { can } = usePermissions();
  const { data: raw = [], isLoading, isError, refetch } = useQuotes();
  const [q, setQ] = useUrlState('qq', '');
  const [status, setStatus] = useUrlState('qs', 'all');
  const [service, setService] = useUrlState('qsv', 'all');
  const [owner, setOwner] = useUrlState('qo', 'all');
  const [range, setRange] = useUrlState('qr', 'all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const quotes = useMemo(() => raw.map((x) => ({ ...x, status: effectiveStatus(x) })), [raw]);
  const owners = useMemo(
    () => [...new Set(quotes.map((x) => x.assigned_to).filter((v): v is string => !!v))],
    [quotes],
  );
  const count = (s: QuoteStatus) => quotes.filter((x) => x.status === s).length;
  const rows = useMemo(() => {
    const s = q.trim().replace(/^QT-/i, '');
    const since =
      range === 'all' ? null : new Date(Date.now() - Number(range) * 86400000).toISOString();
    return quotes.filter(
      (x) =>
        (status === 'all' ||
          x.status === status ||
          (status === 'pending' && (x.status === 'draft' || x.status === 'sent'))) &&
        (service === 'all' || x.service_code === service) &&
        (owner === 'all' || x.assigned_to === owner) &&
        (!since || x.created_at >= since) &&
        (!s ||
          String(x.quote_no).includes(s) ||
          (x.customer_name ?? '').includes(s) ||
          (x.customer_phone ?? '').includes(s)),
    );
  }, [quotes, q, status, service, owner, range]);
  const open = quotes.find((x) => x.id === openId) ?? null;
  const pick = (s: string) => {
    setStatus(status === s ? 'all' : s);
    setPage(1);
  };

  return (
    <div>
      <SectionTitle
        title="عروض الأسعار"
        desc="دورة حياة العرض من المسودة حتى القبول والتحويل إلى عقد — نفس السجلات المستخدمة في مسار المبيعات."
        actions={
          can('pricing', 'export') && (
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() =>
                exportExcel({
                  title: 'عروض الأسعار',
                  subtitle: `تاريخ التصدير ${today()}`,
                  headers: [
                    'رقم العرض',
                    'العميل',
                    'الخدمة',
                    'الجنسية/المهنة',
                    'الإجمالي',
                    'تاريخ الإنشاء',
                    'صالح حتى',
                    'الحالة',
                    'المسؤول',
                  ],
                  rows: rows.map((x) => [
                    `QT-${x.quote_no}`,
                    x.customer_name ?? '',
                    PRICING_SERVICE_LABEL[x.service_code] ?? x.service_code,
                    x.nationality ?? x.profession ?? '',
                    x.total_amount,
                    x.created_at.slice(0, 10),
                    x.valid_until ?? '',
                    QUOTE_STATUS_LABEL[x.status],
                    x.assigned_to ?? '',
                  ]),
                })
              }
            >
              تصدير Excel
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="إجمالي العروض"
          value={quotes.length}
          icon={FileText}
          active={status === 'all'}
          onClick={() => pick('all')}
        />
        <StatTile
          label="المسودة"
          value={count('draft')}
          icon={CircleDashed}
          tone="neutral"
          active={status === 'draft'}
          onClick={() => pick('draft')}
        />
        <StatTile
          label="المرسلة"
          value={count('sent')}
          icon={Send}
          active={status === 'sent'}
          onClick={() => pick('sent')}
        />
        <StatTile
          label="المقبولة"
          value={count('accepted')}
          icon={CheckCircle2}
          tone="success"
          active={status === 'accepted'}
          onClick={() => pick('accepted')}
        />
        <StatTile
          label="المرفوضة"
          value={count('rejected')}
          icon={Ban}
          tone="danger"
          active={status === 'rejected'}
          onClick={() => pick('rejected')}
        />
        <StatTile
          label="المنتهية"
          value={count('expired')}
          icon={Clock}
          tone="warning"
          active={status === 'expired'}
          onClick={() => pick('expired')}
        />
      </div>
      <Card>
        <Toolbar>
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="بحث برقم العرض أو العميل"
          />
          <FilterSelect
            label="الحالة"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'كل الحالات' },
              { value: 'pending', label: 'قيد الانتظار (مسودة/مرسلة)' },
              ...STATUSES.map((s) => ({ value: s, label: QUOTE_STATUS_LABEL[s] })),
            ]}
          />
          <FilterSelect
            label="الخدمة"
            value={service}
            onChange={(v) => {
              setService(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'كل الخدمات' },
              ...Object.entries(PRICING_SERVICE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FilterSelect
            label="الموظف"
            value={owner}
            onChange={(v) => {
              setOwner(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'كل الموظفين' },
              ...owners.map((o) => ({ value: o, label: o })),
            ]}
          />
          <FilterSelect
            label="الفترة"
            value={range}
            onChange={(v) => {
              setRange(v);
              setPage(1);
            }}
            options={RANGES}
          />
        </Toolbar>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 5 }).map((_, n) => (
              <Skeleton key={n} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={FileText}
            title={quotes.length ? 'لا عروض مطابقة للفلاتر' : 'لا توجد عروض أسعار بعد'}
            description={
              quotes.length ? 'غيّر الفلاتر لعرض نتائج أخرى.' : 'أنشئ أول عرض من «حاسبة التسعير».'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-xs text-purple">
                  {['رقم العرض', 'العميل', 'الخدمة', 'الجنسية / المهنة'].map((h) => (
                    <th key={h} className="px-3 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-left font-semibold">الإجمالي</th>
                  {['تاريخ الإنشاء', 'صالح حتى', 'الحالة', 'المسؤول'].map((h) => (
                    <th key={h} className="px-3 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                  <th className="px-3 py-3">
                    <span className="sr-only">الإجراءات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginate(rows, page, PAGE).map((x) => (
                  <tr
                    key={x.id}
                    className="cursor-pointer border-b border-navy-50 hover:bg-navy-50/40"
                    onClick={() => setOpenId(x.id)}
                  >
                    <td className="num px-3 py-3 font-semibold text-navy">QT-{x.quote_no}</td>
                    <td className="px-3 py-3">
                      <span className="block font-medium text-navy-900">
                        {x.customer_name ?? '—'}
                      </span>
                      <span className="num block text-[11px] text-purple">
                        {x.customer_phone ?? ''}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {PRICING_SERVICE_LABEL[x.service_code] ?? x.service_code}
                    </td>
                    <td className="px-3 py-3">{x.nationality ?? x.profession ?? '—'}</td>
                    <td className="px-3 py-3 text-left">
                      <Money v={x.total_amount} strong className="text-navy" />
                    </td>
                    <td className="px-3 py-3 text-xs">{dateAr(x.created_at)}</td>
                    <td
                      className={`px-3 py-3 text-xs ${x.status === 'expired' ? 'text-amber-700' : ''}`}
                    >
                      {dateAr(x.valid_until)}
                    </td>
                    <td className="px-3 py-3">
                      <QuoteBadge status={x.status} />
                    </td>
                    <td className="px-3 py-3 text-xs">{x.assigned_to ?? '—'}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        aria-label={`فتح العرض QT-${x.quote_no}`}
                        className="rounded-lg p-1.5 text-navy hover:bg-navy-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(x.id);
                        }}
                      >
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} size={PAGE} total={rows.length} onChange={setPage} />
          </div>
        )}
      </Card>
      {open && (
        <QuoteDrawer
          quote={open}
          cfg={cfg}
          rules={rules}
          onClose={() => setOpenId(null)}
          onOpenOther={setOpenId}
        />
      )}
    </div>
  );
}

function QuoteDrawer({
  quote: x,
  cfg,
  rules,
  onClose,
  onOpenOther,
}: {
  quote: PricingQuote;
  cfg: PricingConfig;
  rules: PricingRule[];
  onClose: () => void;
  onOpenOther: (id: string) => void;
}) {
  const { can, fullName } = usePermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: events = [], isLoading: evLoading } = useQuoteEvents(x.id);
  const { data: promotions = [] } = usePromotions();
  const setStatus = useSetQuoteStatus();
  const create = useCreateQuote();
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState<QuoteStatus | null>(null);
  const [note, setNote] = useState('');
  const snap = isSnapshot(x.snapshot) ? x.snapshot : null;
  const canEdit = can('pricing', 'edit') || can('leads', 'edit');
  const refreshEvents = () =>
    void qc.invalidateQueries({ queryKey: ['pricing', 'quote-events', x.id] });

  function openWhatsapp() {
    const text = encodeURIComponent(quoteShareText(x));
    const url = x.customer_phone
      ? `https://wa.me/${toWaNumber(x.customer_phone)}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, '_blank', 'noopener');
    logWhatsappOpened(x.id, fullName);
    refreshEvents();
  }
  function pdf() {
    openContractPrint(buildQuoteHtml(x, { autoPrint: true }));
    logPdf(x.id, fullName);
    refreshEvents();
  }
  function newVersion() {
    if (!snap) return;
    const promotion = snap.inputs.promotion_id
      ? (promotions.find((p) => p.id === snap.inputs.promotion_id) ?? null)
      : null;
    const { promotion_id: _pid, ...inputs } = snap.inputs;
    void _pid;
    create.mutate(
      {
        input: {
          calc: { ...inputs, promotion },
          customer_name: x.customer_name ?? '',
          customer_phone: x.customer_phone,
          valid_days: 7,
          notes: x.notes,
          parent_id: x.id,
        },
        rules,
        cfg,
        actor: fullName,
      },
      { onSuccess: (n) => onOpenOther(n.id) },
    );
  }
  function toContract() {
    const p = new URLSearchParams({ service: x.service_code, quote: x.id });
    if (x.nationality) p.set('nationality', x.nationality);
    if (x.profession) p.set('task', x.profession);
    if (x.quantity > 1) p.set('quantity', String(x.quantity));
    if (snap?.inputs.couponCode) p.set('coupon', snap.inputs.couponCode);
    navigate(`/contracts/new?${p.toString()}`);
  }

  const days = x.valid_until
    ? Math.ceil((new Date(`${x.valid_until}T23:59:59`).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <Drawer
      open
      width="lg"
      onClose={onClose}
      title={`عرض سعر QT-${x.quote_no}`}
      subtitle={
        <span className="flex items-center gap-2">
          <QuoteBadge status={x.status} /> {x.parent_id && <span>نسخة من عرض سابق</span>}
        </span>
      }
      footer={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setPreview(true)}>
            <Eye size={14} /> معاينة
          </Button>
          <Button size="sm" variant="outline" onClick={pdf}>
            <FileDown size={14} /> PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={openWhatsapp}
            disabled={x.status === 'expired' || x.status === 'rejected'}
          >
            <MessageCircle size={14} /> واتساب
          </Button>
          {canEdit && x.status === 'draft' && (
            <Button size="sm" variant="outline" onClick={() => setConfirm('sent')}>
              <Send size={14} /> تأكيد الإرسال
            </Button>
          )}
          {canEdit && canMoveTo(x.status, 'accepted') && (
            <Button size="sm" variant="success" onClick={() => setConfirm('accepted')}>
              <CheckCircle2 size={14} /> قبول
            </Button>
          )}
          {canEdit && canMoveTo(x.status, 'rejected') && (
            <Button size="sm" variant="danger" onClick={() => setConfirm('rejected')}>
              <XCircle size={14} /> رفض
            </Button>
          )}
          {(can('pricing', 'create') || can('leads', 'create')) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={newVersion}
              disabled={!snap || create.isPending}
              title={
                snap
                  ? 'يُعاد الحساب بالأسعار الحالية والعرض الأصلي يبقى كما هو'
                  : 'عرض قديم بلا نسخة حساب محفوظة'
              }
            >
              <Files size={14} /> نسخة جديدة
            </Button>
          )}
          {x.status === 'accepted' && !x.contract_id && can('contracts', 'create') && (
            <Button size="sm" onClick={toContract}>
              <FileSignature size={14} /> تحويل إلى عقد
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <Section n={1} title="معلومات العميل">
          <Row k="الاسم" v={x.customer_name ?? '—'} />
          <Row
            k="الجوال"
            v={
              <span className="num" dir="ltr">
                {x.customer_phone ?? '—'}
              </span>
            }
          />
          {x.lead_id && <Row k="مرتبط بعميل محتمل" v="نعم — يظهر في مسار المبيعات" />}
        </Section>
        <Section n={2} title="تفاصيل الخدمة">
          <Row k="الخدمة" v={PRICING_SERVICE_LABEL[x.service_code] ?? x.service_code} />
          <Row k="الجنسية / المهنة" v={x.nationality ?? x.profession ?? '—'} />
          <Row k="الكمية / المدة" v={<span className="num">{x.quantity}</span>} />
        </Section>
        <Section n={3} title="تفصيل السعر">
          {snap ? (
            snap.lines.map((l) => (
              <Row
                key={l.key}
                k={
                  <>
                    {l.label}
                    {l.hint && <span className="block text-[11px] text-purple">{l.hint}</span>}
                  </>
                }
                v={<Money v={l.amount} />}
              />
            ))
          ) : (
            <p className="text-xs text-purple">
              عرض أُنشئ قبل حفظ تفصيل الحساب — المتاح: المبلغ قبل الضريبة والضريبة والإجمالي.
            </p>
          )}
        </Section>
        <Section n={4} title="الخصومات المطبقة">
          {snap?.promotion ? (
            <Row
              k={snap.promotion.isCoupon ? 'كوبون' : 'خصم معتمد'}
              v={
                <>
                  {snap.promotion.name} — <Money v={snap.promotion.amount} />
                </>
              }
            />
          ) : (
            <p className="text-xs text-purple">{snap ? 'لا خصم' : 'غير مسجل لهذا العرض'}</p>
          )}
        </Section>
        <Section n={5} title="الضرائب والرسوم">
          <Row k="المبلغ الخاضع للضريبة" v={<Money v={x.base_amount} />} />
          <Row
            k={`ضريبة القيمة المضافة${snap ? ` (${Math.round(snap.config.vat_rate * 100)}٪)` : ''}`}
            v={<Money v={x.vat_amount} />}
          />
          <Row
            k={<span className="font-bold text-navy">الإجمالي</span>}
            v={<Money v={x.total_amount} strong className="text-lg text-navy" />}
          />
        </Section>
        <Section n={6} title="صلاحية العرض">
          <Row
            k="صالح حتى"
            v={
              <>
                {dateAr(x.valid_until)}{' '}
                {days != null && x.status !== 'expired' && days >= 0 && (
                  <span className="text-xs text-purple">(متبقٍ {days} يوم)</span>
                )}
              </>
            }
          />
          {snap && <Row k="الأسعار مثبتة بتاريخ" v={dateTimeAr(snap.computed_at)} />}
        </Section>
        <Section n={7} title="حالة العرض">
          <Row k="الحالة" v={<QuoteBadge status={x.status} />} />
          <Row k="المسؤول" v={x.assigned_to ?? '—'} />
          {x.contract_id && <Row k="العقد" v={<span className="num">{x.contract_id}</span>} />}
        </Section>
        <Section n={8} title="سجل التغييرات والإرسال">
          {evLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <ol className="space-y-2 border-r-2 border-navy-100 pr-3">
              {events.map((e) => (
                <li key={e.id} className="text-xs">
                  <span className="font-medium text-navy-900">{EVENT_LABEL[e.type]}</span>
                  <span className="block text-purple">
                    {dateTimeAr(e.at)} — {e.actor}
                    {e.note ? ` · ${e.note}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 flex items-center gap-1 text-[11px] text-purple">
            <Copy size={11} /> روابط العرض الآمنة للعميل غير مدعومة حاليًا؛ الإرسال عبر واتساب أو
            PDF.
          </p>
        </Section>
      </div>

      {preview && (
        <Modal
          open
          size="xl"
          onClose={() => setPreview(false)}
          title={`معاينة عرض السعر QT-${x.quote_no}`}
        >
          <iframe
            title="معاينة العرض"
            srcDoc={buildQuoteHtml(x)}
            className="h-[70vh] w-full rounded-xl border border-navy-100 bg-white"
          />
        </Modal>
      )}
      {confirm && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title={
            confirm === 'sent'
              ? 'تأكيد إرسال العرض'
              : confirm === 'accepted'
                ? 'قبول العرض'
                : 'رفض العرض'
          }
        >
          <div className="space-y-3 text-sm">
            <p className="text-purple">
              {confirm === 'sent'
                ? 'أكّد فقط إذا تأكدت أن العرض وصل للعميل (فتح رابط واتساب وحده لا يكفي).'
                : confirm === 'accepted'
                  ? 'سيُعتمد العرض كمقبول ويصبح متاحًا للتحويل إلى عقد. لا يمكن التراجع عن القرار.'
                  : 'سيُسجل العرض كمرفوض. لا يمكن التراجع عن القرار.'}
            </p>
            <Input
              label="ملاحظة (اختياري)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant={confirm === 'rejected' ? 'danger' : 'primary'}
                loading={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate(
                    {
                      id: x.id,
                      to: confirm,
                      actor: fullName,
                      ...(note.trim() ? { note: note.trim() } : {}),
                    },
                    {
                      onSuccess: () => {
                        setConfirm(null);
                        setNote('');
                        refreshEvents();
                      },
                    },
                  )
                }
              >
                تأكيد
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                إلغاء
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Drawer>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-navy">
        <span className="num grid h-5 w-5 place-items-center rounded-full bg-navy-50 text-[10px]">
          {n}
        </span>{' '}
        {title}
      </h3>
      <dl className="space-y-1.5 rounded-xl border border-navy-100 p-3">{children}</dl>
    </section>
  );
}
function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-purple">{k}</dt>
      <dd className="text-left text-navy-900">{v}</dd>
    </div>
  );
}
