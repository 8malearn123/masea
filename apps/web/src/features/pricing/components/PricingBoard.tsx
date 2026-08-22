import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Calculator,
  FileText,
  ListOrdered,
  Pencil,
  Search,
  Send,
  Tag,
  Settings2,
  ScrollText,
  Save,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Table,
  useToast,
  type Column,
} from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { NATIONALITIES, TASK_TYPES } from '@/lib/orderTypes';
import type { ServiceCode } from '@/lib/funnel';
import { calcPriceDetail, DEFAULT_PRICING_CONFIG, type PricingConfig } from '@/shared/lib/pricing';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import { recordPricingLog } from '@/features/pricing/api/pricing.api';
import {
  usePricingConfig,
  usePricingLog,
  usePricingRules,
  useUpdatePricingConfig,
  useUpdatePricingRule,
} from '@/features/pricing/hooks/usePricingRules';
import { useCreateQuote, useMarkQuoteSent, useQuotes } from '@/features/pricing/hooks/useQuotes';
import {
  PRICING_SERVICE_LABEL,
  QUOTE_STATUS_LABEL,
  UNIT_LABEL,
  type PricingLogEntry,
  type PricingQuote,
  type PricingRule,
  type QuoteStatus,
} from '@/features/pricing/types';

const SERVICE_OPTIONS = Object.entries(PRICING_SERVICE_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/* ----------------------------- calculator ------------------------------- */
function Calc({ cfg }: { cfg: PricingConfig }) {
  const [service, setService] = useState<ServiceCode>('recruitment');
  const [nationality, setNationality] = useState('الفلبين');
  const [task, setTask] = useState('تنظيف');
  const [quantity, setQuantity] = useState(1);
  const [discountPct, setDiscountPct] = useState(0);
  const [lateDays, setLateDays] = useState(0);
  const [absenceDays, setAbsenceDays] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);

  const detail = calcPriceDetail(
    service,
    {
      nationality,
      profession: service === 'daily_rental' ? task : undefined,
      quantity: Math.max(quantity, 1),
    },
    { discountPct, lateDays, absenceDays, cancelled },
    cfg,
  );

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Calculator size={16} /> حاسبة التسعير
        </h2>
        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal">
          تحديث فوري
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="الخدمة"
          value={service}
          onChange={(e) => setService(e.target.value as ServiceCode)}
          options={SERVICE_OPTIONS}
        />
        {service === 'daily_rental' ? (
          <Select
            label="نوع المهمة"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            options={TASK_TYPES.map((t) => ({ value: t, label: t }))}
          />
        ) : (
          <Select
            label="الجنسية"
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
            options={NATIONALITIES.map((n) => ({ value: n, label: n }))}
          />
        )}
        <Input
          label="الكمية / المدة"
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
        />
        <Input
          label="خصم (٪)"
          type="number"
          min={0}
          max={100}
          value={discountPct}
          onChange={(e) => setDiscountPct(Number(e.target.value))}
        />
        <Input
          label="أيام تأخر السداد"
          type="number"
          min={0}
          value={lateDays}
          onChange={(e) => setLateDays(Number(e.target.value))}
        />
        <Input
          label="أيام غياب العاملة"
          type="number"
          min={0}
          value={absenceDays}
          onChange={(e) => setAbsenceDays(Number(e.target.value))}
        />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-navy">
        <input
          type="checkbox"
          checked={cancelled}
          onChange={(e) => setCancelled(e.target.checked)}
          className="h-4 w-4 rounded border-navy-100"
        />
        إلغاء بعد المباشرة (رسوم {cfg.cancellation_pct}٪)
      </label>

      <div className="mt-4">
        <PriceBreakdown detail={detail} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="primary" size="sm" onClick={() => setQuoteOpen(true)}>
          <span className="flex items-center justify-center gap-1.5">
            <FileText size={14} /> إنشاء عرض سعر
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            recordPricingLog(
              service,
              {
                nationality,
                profession: task,
                quantity,
                discountPct,
                lateDays,
                absenceDays,
                cancelled,
              },
              detail,
            )
          }
        >
          <span className="flex items-center justify-center gap-1.5">
            <Save size={14} /> تسجيل العملية
          </span>
        </Button>
      </div>

      <CreateQuoteModal
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        serviceCode={service}
        base={detail.net}
        vat={detail.vat}
        total={detail.total}
      />
    </Card>
  );
}

/* ------------------------- calculation-order card ------------------------ */
function CalcOrderCard({ cfg }: { cfg: PricingConfig }) {
  const steps = [
    'السعر الأساسي × الكمية / المدة',
    '− الخصم المعتمد على العميل',
    `+ غرامة التأخر (بحد ${cfg.late_max_pct}٪) − تعويض غياب العاملة`,
    `+ رسوم الإلغاء بعد المباشرة (${cfg.cancellation_pct}٪) إن وُجدت`,
    `+ ضريبة القيمة المضافة (${Math.round(cfg.vat_rate * 100)}٪)`,
  ];
  return (
    <div className="mt-4 rounded-2xl bg-navy p-5 text-white shadow-card">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <ListOrdered size={16} /> ترتيب الحساب المعتمد
      </h2>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2.5 text-xs text-white/90">
            <span className="num grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/15 text-[11px] font-bold">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* --------------------------- create-quote modal -------------------------- */
function toWaNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('966')) return digits;
  if (digits.startsWith('0')) return `966${digits.slice(1)}`;
  return digits;
}

function CreateQuoteModal({
  open,
  onClose,
  serviceCode,
  base,
  vat,
  total,
}: {
  open: boolean;
  onClose: () => void;
  serviceCode: string;
  base: number;
  vat: number;
  total: number;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [validDays, setValidDays] = useState(7);
  const create = useCreateQuote();

  function submit() {
    const validUntil = new Date(Date.now() + validDays * 86_400_000).toISOString().slice(0, 10);
    create.mutate(
      {
        service_code: serviceCode,
        customer_name: name.trim() || null,
        customer_phone: phone.trim() || null,
        base_amount: base,
        vat_amount: vat,
        total_amount: total,
        valid_until: validUntil,
        notes: null,
      },
      {
        onSuccess: () => {
          setName('');
          setPhone('');
          onClose();
        },
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="إنشاء عرض سعر">
      <div className="space-y-4">
        <div className="rounded-xl bg-navy-50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-purple">{PRICING_SERVICE_LABEL[serviceCode] ?? serviceCode}</span>
            <span className="num font-bold text-gold-600">{sar(total)} ر.س</span>
          </div>
          <p className="num mt-1 text-[11px] text-purple">
            الأساسي {sar(base)} + ضريبة {sar(vat)}
          </p>
        </div>
        <Input label="اسم العميل" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="جوال العميل"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="05xxxxxxxx"
            className="num"
          />
          <Input
            label="صلاحية العرض (أيام)"
            type="number"
            min={1}
            value={validDays}
            onChange={(e) => setValidDays(Number(e.target.value))}
          />
        </div>
        <Button onClick={submit} loading={create.isPending} className="w-full">
          حفظ عرض السعر
        </Button>
      </div>
    </Modal>
  );
}

/* -------------------------------- quotes tab ----------------------------- */
const QUOTE_TONE: Record<QuoteStatus, 'neutral' | 'gold' | 'success' | 'danger'> = {
  draft: 'neutral',
  sent: 'gold',
  accepted: 'success',
  rejected: 'danger',
  expired: 'neutral',
};

function QuotesTab() {
  const { data: quotes = [], isLoading, isError, refetch } = useQuotes();
  const markSent = useMarkQuoteSent();
  const toast = useToast();

  function share(q: PricingQuote) {
    const lines = [
      'عرض سعر — ماسية الشرق للاستقدام',
      `الخدمة: ${PRICING_SERVICE_LABEL[q.service_code] ?? q.service_code}`,
      `الإجمالي شامل الضريبة: ${sar(q.total_amount)} ر.س`,
      q.valid_until ? `صالح حتى: ${dateAr(q.valid_until)}` : '',
    ].filter(Boolean);
    const text = encodeURIComponent(lines.join('\n'));
    const wa = q.customer_phone
      ? `https://wa.me/${toWaNumber(q.customer_phone)}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(wa, '_blank', 'noopener');
    if (q.status === 'draft') markSent.mutate(q.id);
    toast.success('تم فتح واتساب لإرسال العرض');
  }

  const columns: Column<PricingQuote>[] = [
    {
      key: 'customer',
      header: 'العميل',
      cell: (q) => (
        <div>
          <span className="block text-sm font-medium text-navy-900">{q.customer_name ?? '—'}</span>
          <span className="num block text-[11px] text-purple">{q.customer_phone ?? ''}</span>
        </div>
      ),
    },
    {
      key: 'service_code',
      header: 'الخدمة',
      cell: (q) => PRICING_SERVICE_LABEL[q.service_code] ?? q.service_code,
    },
    {
      key: 'total_amount',
      header: 'الإجمالي',
      cell: (q) => <span className="num font-semibold text-navy">{sar(q.total_amount)} ر.س</span>,
    },
    {
      key: 'valid_until',
      header: 'صالح حتى',
      cell: (q) => <span className="num text-xs text-purple">{dateAr(q.valid_until)}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (q) => <Badge tone={QUOTE_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge>,
    },
    {
      key: 'send',
      header: 'إرسال',
      cell: (q) => (
        <button
          type="button"
          onClick={() => share(q)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy/90"
        >
          <Send size={13} /> واتساب
        </button>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={quotes}
      rowKey={(q) => q.id}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      emptyTitle="لا توجد عروض سعر"
    />
  );
}

/* -------------------------- config editor -------------------------------- */
function ConfigForm({ cfg, editable }: { cfg: PricingConfig; editable: boolean }) {
  const update = useUpdatePricingConfig();
  const [form, setForm] = useState<PricingConfig>(cfg);
  const num = (k: keyof PricingConfig) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: Number(e.target.value) }));

  return (
    <Card className="max-w-2xl">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
        <Settings2 size={16} /> إعدادات التسعير (قابلة للتعديل من الإدارة)
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="ضريبة القيمة المضافة (نسبة، مثال 0.15)"
          type="number"
          step="0.01"
          min={0}
          value={form.vat_rate}
          onChange={num('vat_rate')}
          disabled={!editable}
        />
        <Input
          label="مهلة سماح تأخر السداد (أيام)"
          type="number"
          min={0}
          value={form.late_grace_days}
          onChange={num('late_grace_days')}
          disabled={!editable}
        />
        <Input
          label="غرامة التأخر اليومية (٪)"
          type="number"
          min={0}
          value={form.late_daily_pct}
          onChange={num('late_daily_pct')}
          disabled={!editable}
        />
        <Input
          label="الحد الأقصى لغرامة التأخر (٪)"
          type="number"
          min={0}
          value={form.late_max_pct}
          onChange={num('late_max_pct')}
          disabled={!editable}
        />
        <Input
          label="رسوم الإلغاء بعد المباشرة (٪)"
          type="number"
          min={0}
          value={form.cancellation_pct}
          onChange={num('cancellation_pct')}
          disabled={!editable}
        />
        <Input
          label="تعويض غياب العاملة (ر.س/يوم)"
          type="number"
          min={0}
          value={form.absence_per_day}
          onChange={num('absence_per_day')}
          disabled={!editable}
        />
        <Input
          label="أقصى أيام تعويض الغياب"
          type="number"
          min={0}
          value={form.absence_max_days}
          onChange={num('absence_max_days')}
          disabled={!editable}
        />
      </div>
      {editable && (
        <Button className="mt-4" loading={update.isPending} onClick={() => update.mutate(form)}>
          <span className="flex items-center gap-1.5">
            <Save size={15} /> حفظ الإعدادات
          </span>
        </Button>
      )}
    </Card>
  );
}

/* ------------------------------- board ----------------------------------- */
type Tab = 'calc' | 'config' | 'quotes' | 'log';

export default function PricingBoard() {
  const { can } = usePermissions();
  const editable = can('pricing', 'edit');
  const manageable = can('pricing', 'manage');
  const { data: rules = [], isLoading, isError, refetch } = usePricingRules();
  const { data: cfg = DEFAULT_PRICING_CONFIG } = usePricingConfig();
  const {
    data: log = [],
    isLoading: logLoading,
    isError: logError,
    refetch: refetchLog,
  } = usePricingLog();
  const { data: quotes = [] } = useQuotes();
  const update = useUpdatePricingRule();

  const [tab, setTab] = useState<Tab>('calc');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PricingRule | null>(null);
  const [base, setBase] = useState(0);
  const [min, setMin] = useState(0);

  const rows = useMemo(() => {
    const q = search.trim();
    return rules.filter((r) => {
      if (filter !== 'all' && r.service_code !== filter) return false;
      if (!q) return true;
      const hay = `${PRICING_SERVICE_LABEL[r.service_code] ?? ''} ${r.nationality ?? ''} ${r.profession ?? ''}`;
      return hay.includes(q);
    });
  }, [rules, filter, search]);

  function openEdit(r: PricingRule) {
    setEditing(r);
    setBase(r.base_price);
    setMin(r.min_price ?? 0);
  }
  function saveEdit() {
    if (!editing) return;
    update.mutate(
      { id: editing.id, base_price: base, min_price: min },
      { onSuccess: () => setEditing(null) },
    );
  }

  const columns: Column<PricingRule>[] = [
    {
      key: 'service_code',
      header: 'الخدمة',
      cell: (r) => (
        <span className="font-medium text-navy-900">
          {PRICING_SERVICE_LABEL[r.service_code] ?? r.service_code}
        </span>
      ),
    },
    {
      key: 'nationality',
      header: 'الجنسية / المهنة',
      cell: (r) => r.nationality ?? r.profession ?? '—',
    },
    {
      key: 'duration_unit',
      header: 'الوحدة',
      cell: (r) => (
        <Badge tone="navy">{UNIT_LABEL[r.duration_unit ?? 'fixed'] ?? r.duration_unit}</Badge>
      ),
    },
    {
      key: 'base_price',
      header: 'السعر الأساسي',
      cell: (r) => <span className="num font-semibold text-navy">{sar(r.base_price)} ر.س</span>,
    },
    {
      key: 'min_price',
      header: 'الحد الأدنى',
      cell: (r) => (
        <span className="num text-sm text-purple">
          {r.min_price != null ? `${sar(r.min_price)} ر.س` : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'تعديل',
      cell: (r) =>
        editable ? (
          <button
            type="button"
            onClick={() => openEdit(r)}
            className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
          >
            <Pencil size={13} /> تعديل
          </button>
        ) : null,
    },
  ];

  const logColumns: Column<PricingLogEntry>[] = [
    {
      key: 'service_code',
      header: 'الخدمة',
      cell: (l) => PRICING_SERVICE_LABEL[l.service_code] ?? l.service_code,
    },
    {
      key: 'base',
      header: 'الأساسي',
      cell: (l) => <span className="num text-xs">{sar(l.result.base)}</span>,
    },
    {
      key: 'discounts',
      header: 'الخصومات',
      cell: (l) => <span className="num text-xs text-green-600">{sar(l.result.discounts)}</span>,
    },
    {
      key: 'penalties',
      header: 'الغرامات',
      cell: (l) => <span className="num text-xs text-red-600">{sar(l.result.penalties)}</span>,
    },
    {
      key: 'total',
      header: 'الإجمالي',
      cell: (l) => (
        <span className="num text-xs font-bold text-gold-600">{sar(l.result.total)} ر.س</span>
      ),
    },
    {
      key: 'created_at',
      header: 'الوقت',
      cell: (l) => <span className="num text-xs">{dateAr(l.created_at)}</span>,
    },
  ];

  const TABS: { value: Tab; label: string; icon: typeof Calculator; count?: number }[] = [
    { value: 'calc', label: 'الحاسبة والقواعد', icon: Calculator },
    { value: 'config', label: 'الإعدادات', icon: Settings2 },
    { value: 'quotes', label: 'عروض السعر', icon: FileText, count: quotes.length },
    { value: 'log', label: 'سجل التسعير', icon: ScrollText },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <Tag size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">التسعير وعروض السعر</h1>
            <p className="text-sm text-purple">
              مصدر واحد للأسعار — الأساسي − الخصم + الرسوم + الضريبة، ثم عرض سعر يُرسل للعميل.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-navy-50 px-3 py-1 text-xs font-medium text-navy">
          المصدر الموحّد للأسعار
        </span>
      </div>

      <div className="mb-4 inline-flex flex-wrap rounded-xl bg-navy-50 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === t.value ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
            >
              <Icon size={15} /> {t.label}
              {t.count != null && t.count > 0 && (
                <span className="num rounded-full bg-navy-100 px-1.5 text-[11px] text-navy">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'calc' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Calc cfg={cfg} />
            <CalcOrderCard cfg={cfg} />
          </div>
          <div className="lg:col-span-2">
            <Card className="mb-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
                  قائمة الأسعار الأساسية
                  <span className="num rounded-full bg-navy-50 px-2 py-0.5 text-[11px] text-navy">
                    {rows.length} قاعدة
                  </span>
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="relative">
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
                    <Search size={16} />
                  </span>
                  <Input
                    placeholder="بحث بالخدمة أو الجنسية"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pr-9"
                  />
                </div>
                <Select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  options={[{ value: 'all', label: 'كل الخدمات' }, ...SERVICE_OPTIONS]}
                />
              </div>
            </Card>
            <Table
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              isLoading={isLoading}
              isError={isError}
              onRetry={() => void refetch()}
              emptyTitle="لا توجد قواعد تسعير مطابقة"
            />
          </div>
        </div>
      )}

      {tab === 'config' && <ConfigForm cfg={cfg} editable={manageable} />}

      {tab === 'quotes' && <QuotesTab />}

      {tab === 'log' && (
        <Table
          columns={logColumns}
          rows={log}
          rowKey={(l) => l.id}
          isLoading={logLoading}
          isError={logError}
          onRetry={() => void refetchLog()}
          emptyTitle="لا توجد عمليات تسعير مسجّلة"
        />
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="تعديل قاعدة السعر">
        {editing && (
          <div className="space-y-4">
            <p className="text-sm text-purple">
              {PRICING_SERVICE_LABEL[editing.service_code]} ·{' '}
              {editing.nationality ?? editing.profession ?? '—'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="السعر الأساسي (ر.س)"
                type="number"
                min={0}
                value={base}
                onChange={(e) => setBase(Number(e.target.value))}
              />
              <Input
                label="الحد الأدنى (ر.س)"
                type="number"
                min={0}
                value={min}
                onChange={(e) => setMin(Number(e.target.value))}
                error={min > base ? 'الحد الأدنى أعلى من السعر الأساسي' : undefined}
              />
            </div>
            <Button
              onClick={saveEdit}
              loading={update.isPending}
              disabled={min > base}
              className="w-full"
            >
              حفظ
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
