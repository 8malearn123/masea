import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Code2,
  FileMinus,
  FileText,
  Plus,
  QrCode,
  Send,
  Settings2,
  ShieldAlert,
} from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import {
  decodeQr,
  EINV_STATUS_LABEL,
  isValidVatNumber,
  PHASE2_CHECKLIST,
  submissionFlow,
  vatReturnForm,
  type EInvoiceRecord,
  type SalesCreditNote,
} from '@/features/accounting/data/zatca';
import { useBills, useCashExpenses, useInvoices } from '@/features/accounting/hooks/useAccounting';
import {
  useAccAccess,
  useAccConfig,
  useAccMutation,
  useCreditNotes,
  useEInvoices,
  useSeller,
} from '@/features/accounting/hooks/useAccountingPro';
import * as pro from '@/features/accounting/api/accountingPro.api';
import type { Invoice } from '@/features/accounting/types';
import {
  DataState,
  ExportButtons,
  Money,
  SectionCard,
  todayIso,
} from '@/features/accounting/components/kit';

/* =========================== VAT return (form) =========================== */
export function VatFormScreen() {
  const invQ = useInvoices();
  const { data: bills = [] } = useBills();
  const { data: cash = [] } = useCashExpenses();
  const { data: notes = [] } = useCreditNotes();
  const cfg = useAccConfig();
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const [corr, setCorr] = useState(0);
  const form = useMemo(
    () => vatReturnForm(period, cfg.vatRate, invQ.data ?? [], notes, bills, cash, corr),
    [period, cfg.vatRate, invQ.data, notes, bills, cash, corr],
  );
  const build = () => ({
    title: `إقرار ضريبة القيمة المضافة — ${period}`,
    subtitle: 'بنود نموذج هيئة الزكاة والضريبة والجمارك (مسودة للمراجعة قبل التقديم عبر البوابة)',
    headers: ['البند', 'الوصف', 'المبلغ (ر.س)', 'التعديلات', 'الضريبة (ر.س)'],
    rows: form.boxes.map((b) => [b.box, b.label, b.amount, b.adjustment ?? 0, b.vat]),
    footer: ['16', 'صافي الضريبة المستحقة', '', '', form.netVat],
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Input
            label="الفترة"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Input
            label="تصحيحات فترات سابقة (البند 14)"
            type="number"
            value={corr}
            onChange={(e) => setCorr(Number(e.target.value))}
          />
        </div>
        <span className="mb-2 text-xs text-purple">
          النسبة من الإعدادات: <span className="num">{Math.round(cfg.vatRate * 100)}٪</span>
        </span>
      </div>
      <DataState
        isLoading={invQ.isLoading}
        isError={invQ.isError}
        onRetry={() => void invQ.refetch()}
      >
        <SectionCard
          title="نموذج الإقرار الضريبي"
          icon={FileText}
          actions={<ExportButtons build={build} />}
        >
          <Table
            columns={[
              {
                key: 'b',
                header: 'البند',
                cell: (b) => <span className="num font-semibold">{b.box}</span>,
              },
              { key: 'l', header: 'الوصف', cell: (b) => b.label },
              { key: 'a', header: 'المبلغ', cell: (b) => <Money v={b.amount} /> },
              { key: 'adj', header: 'التعديلات', cell: (b) => <Money v={b.adjustment ?? 0} /> },
              {
                key: 'v',
                header: 'الضريبة',
                cell: (b) => <Money v={b.vat} className="font-bold" />,
              },
            ]}
            rows={form.boxes}
            rowKey={(b) => String(b.box)}
          />
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <Fig label="إجمالي ضريبة المبيعات المستحقة" v={form.totalSalesVat} />
            <Fig label="إجمالي ضريبة المشتريات القابلة للخصم" v={form.totalPurchasesVat} />
            <Fig
              label={form.netVat >= 0 ? 'صافي المستحق للهيئة' : 'صافي القابل للاسترداد'}
              v={form.netVat}
              strong
            />
          </div>
          {form.notes.map((n) => (
            <p
              key={n}
              className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <ShieldAlert size={14} className="mt-0.5 shrink-0" /> {n}
            </p>
          ))}
          <p className="mt-2 text-xs text-purple">
            مسودة إقرار محسوبة من المستندات؛ التقديم الرسمي يتم عبر بوابة الهيئة، والاعتماد/الدفع
            يُسجّل من شاشة «ضريبة القيمة المضافة».
          </p>
        </SectionCard>
      </DataState>
    </div>
  );
}

const Fig = ({ label, v, strong }: { label: string; v: number; strong?: boolean }) => (
  <div className={`rounded-xl px-3 py-2 ${strong ? 'bg-navy text-white' : 'bg-navy-50'}`}>
    <p className={`text-xs ${strong ? 'opacity-80' : 'text-purple'}`}>{label}</p>
    <span className={`num font-bold ${strong ? '' : 'text-navy'}`}>{sar(v)}</span>
  </div>
);

/* ============================ credit notes =============================== */
export function CreditNotesScreen() {
  const { data: notes = [], isLoading, isError, refetch } = useCreditNotes();
  const { allowed } = useAccAccess();
  const [adding, setAdding] = useState(false);
  const columns: Column<SalesCreditNote>[] = [
    {
      key: 'n',
      header: 'الإشعار',
      cell: (n) => <span className="num font-semibold">CN-{n.note_no}</span>,
    },
    { key: 'c', header: 'العميل', cell: (n) => n.customer_name },
    {
      key: 'd',
      header: 'التاريخ',
      cell: (n) => <span className="num text-xs">{dateAr(n.note_date)}</span>,
    },
    { key: 'r', header: 'السبب', cell: (n) => <span className="text-xs">{n.reason}</span> },
    { key: 's', header: 'قبل الضريبة', cell: (n) => <Money v={n.subtotal} /> },
    { key: 'v', header: 'الضريبة', cell: (n) => <Money v={n.vat_amount} /> },
    { key: 't', header: 'الإجمالي', cell: (n) => <Money v={n.total} className="font-bold" /> },
  ];
  return (
    <SectionCard
      title="الإشعارات الدائنة (مرتجعات وتخفيضات المبيعات)"
      icon={FileMinus}
      actions={
        allowed('ar', 'create') && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={15} /> إشعار دائن
          </Button>
        )
      }
    >
      <Table
        columns={columns}
        rows={notes}
        rowKey={(n) => n.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا إشعارات دائنة"
      />
      <p className="mt-2 text-xs text-purple">
        الفاتورة المُصدرة لا تُعدَّل؛ التصحيح بإشعار دائن مرتبط بها: مدين مردودات المبيعات (4900) +
        ضريبة المخرجات / دائن ذمم العملاء.
      </p>
      {adding && <CreditNoteModal onClose={() => setAdding(false)} />}
    </SectionCard>
  );
}

function CreditNoteModal({ onClose }: { onClose: () => void }) {
  const { data: invoices = [] } = useInvoices();
  const { actor } = useAccAccess();
  const cfg = useAccConfig();
  const open = invoices.filter((i) => i.status !== 'void');
  const [invId, setInvId] = useState(open[0]?.id ?? '');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayIso());
  const inv = open.find((i) => i.id === invId);
  const save = useAccMutation(
    () =>
      pro.createCreditNote(
        { invoice_id: invId, subtotal: amount, reason, date, vat_rate: cfg.vatRate },
        actor,
      ),
    'صدر الإشعار الدائن ورُحّل',
  );
  return (
    <Modal open onClose={onClose} title="إشعار دائن على فاتورة">
      <div className="space-y-3">
        <Select
          label="الفاتورة"
          value={invId}
          onChange={(e) => setInvId(e.target.value)}
          options={open.map((i) => ({
            value: i.id,
            label: `#${i.invoice_no} — ${i.customer_name} — ${sar(i.subtotal)}`,
          }))}
        />
        <Input
          label="المبلغ قبل الضريبة"
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
        <Input label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Input label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {inv && (
          <p className="text-xs text-purple">
            الضريبة:{' '}
            <span className="num">{sar(inv.vat_amount > 0 ? amount * cfg.vatRate : 0)}</span> · لا
            يتجاوز مجموع الإشعارات قيمة الفاتورة.
          </p>
        )}
        <Button
          className="w-full"
          disabled={!invId || amount <= 0 || !reason.trim()}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          إصدار الإشعار
        </Button>
      </div>
    </Modal>
  );
}

/* ============================ e-invoicing ================================ */
export function EInvoiceScreen() {
  const invQ = useInvoices();
  const { data: records = [] } = useEInvoices();
  const { data: seller } = useSeller();
  const { allowed, actor } = useAccAccess();
  const [view, setView] = useState<EInvoiceRecord | null>(null);
  const [settings, setSettings] = useState(false);
  const gen = useAccMutation(
    (id: string) => pro.generateEInvoiceFor(id, actor),
    (r) =>
      r.status === 'error'
        ? 'وُلّدت مع أخطاء — راجع الرسائل'
        : 'وُلّدت بيانات الفاتورة الإلكترونية',
  );
  const queue = useAccMutation(
    (id: string) => pro.queueSubmission(id, actor),
    'أُضيفت لقائمة الإرسال — التكامل غير مفعّل',
  );
  const byInv = new Map(records.map((r) => [r.invoice_id, r]));
  const invoices = (invQ.data ?? []).filter((i) => i.status !== 'void');

  const columns: Column<Invoice>[] = [
    {
      key: 'no',
      header: 'الفاتورة',
      cell: (i) => <span className="num font-semibold">#{i.invoice_no}</span>,
    },
    { key: 'c', header: 'العميل', cell: (i) => i.customer_name },
    {
      key: 'type',
      header: 'المسار',
      cell: (i) => (
        <Badge tone="teal">
          {submissionFlow(i) === 'clearance' ? 'معيارية — إجازة' : 'مبسطة — إبلاغ'}
        </Badge>
      ),
    },
    { key: 't', header: 'الإجمالي', cell: (i) => <Money v={i.total} /> },
    {
      key: 's',
      header: 'حالة الفاتورة الإلكترونية',
      cell: (i) => {
        const r = byInv.get(i.id);
        return (
          <Badge
            tone={
              !r
                ? 'neutral'
                : r.status === 'error' || r.status === 'rejected'
                  ? 'danger'
                  : r.status === 'pending_submission'
                    ? 'gold'
                    : 'navy'
            }
          >
            {EINV_STATUS_LABEL[r?.status ?? 'not_generated']}
          </Badge>
        );
      },
    },
    {
      key: 'icv',
      header: 'ICV',
      cell: (i) => <span className="num text-xs">{byInv.get(i.id)?.icv ?? '—'}</span>,
    },
    {
      key: 'a',
      header: '',
      cell: (i) => {
        const r = byInv.get(i.id);
        return (
          <div className="flex gap-1">
            {!r && allowed('tax', 'create') && (
              <Button size="sm" variant="outline" onClick={() => gen.mutate(i.id)}>
                <QrCode size={13} /> توليد
              </Button>
            )}
            {r && (
              <Button size="sm" variant="ghost" onClick={() => setView(r)}>
                <Code2 size={13} /> عرض
              </Button>
            )}
            {r?.status === 'generated' && allowed('tax', 'edit') && (
              <Button size="sm" variant="ghost" onClick={() => queue.mutate(i.id)}>
                <Send size={13} />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <SectionCard
        title="حالة التوافق مع الفوترة الإلكترونية (فاتورة)"
        icon={ShieldAlert}
        actions={
          allowed('tax', 'edit') && (
            <Button size="sm" variant="outline" onClick={() => setSettings(true)}>
              <Settings2 size={13} /> بيانات المنشأة الضريبية
            </Button>
          )
        }
      >
        <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          النظام <strong>غير معتمد رسميًا</strong> لدى هيئة الزكاة والضريبة والجمارك. المرحلة الأولى
          (الإصدار) مطبّقة؛ المرحلة الثانية (الربط والتكامل) جاهزة على مستوى البيانات فقط وتتطلب
          تسجيل المنشأة في منصة «فاتورة» والحصول على شهادة CSID وتوقيعًا رقميًا واجتياز فحص
          المطابقة. المرجع: zatca.gov.sa (المواصفات الفنية والإجرائية المحدثة).
        </div>
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          {PHASE2_CHECKLIST.map((c) => (
            <li key={c.item} className="flex items-start gap-2">
              {c.done ? (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-700" />
              ) : (
                <CircleDashed size={15} className="mt-0.5 shrink-0 text-amber-600" />
              )}
              <span>
                {c.item}{' '}
                <span className="text-[11px] text-purple">
                  — {c.done ? 'مكتمل' : 'يحتاج اعتمادًا/تكاملًا رسميًا'}: {c.note}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {seller && !isValidVatNumber(seller.vat_number) && (
          <p className="mt-2 text-xs text-red-600">الرقم الضريبي للمنشأة غير صالح.</p>
        )}
      </SectionCard>
      <SectionCard title="الفواتير الإلكترونية" icon={QrCode}>
        <Table
          columns={columns}
          rows={invoices}
          rowKey={(i) => i.id}
          isLoading={invQ.isLoading}
          isError={invQ.isError}
          onRetry={() => void invQ.refetch()}
          emptyTitle="لا فواتير"
        />
      </SectionCard>
      {view && <EInvoiceModal rec={view} onClose={() => setView(null)} />}
      {settings && seller && <SellerModal initial={seller} onClose={() => setSettings(false)} />}
    </div>
  );
}

function EInvoiceModal({ rec, onClose }: { rec: EInvoiceRecord; onClose: () => void }) {
  const fields = decodeQr(rec.qr);
  const names: Record<number, string> = {
    1: 'اسم البائع',
    2: 'الرقم الضريبي',
    3: 'الطابع الزمني',
    4: 'الإجمالي شامل الضريبة',
    5: 'إجمالي الضريبة',
  };
  return (
    <Modal open onClose={onClose} size="xl" title={`الفاتورة الإلكترونية — ICV ${rec.icv}`}>
      <div className="max-h-[74vh] space-y-3 overflow-y-auto text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone="navy">{EINV_STATUS_LABEL[rec.status]}</Badge>
          <span className="num text-xs text-purple">UUID {rec.uuid}</span>
        </div>
        {rec.messages.map((m) => (
          <p key={m} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {m}
          </p>
        ))}
        <div>
          <p className="mb-1 font-semibold text-navy">رمز QR — المرحلة الأولى (TLV Base64)</p>
          <code className="num block break-all rounded-xl bg-navy-50 p-2 text-[11px]" dir="ltr">
            {rec.qr}
          </code>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
            {Object.entries(fields).map(([k, v]) => (
              <div key={k}>
                <dt className="text-purple">{names[Number(k)]}</dt>
                <dd className="num font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-[11px] text-purple">
            رسم الرمز كصورة على الفاتورة المطبوعة يحتاج مكتبة QR (غير مضافة بعد).
          </p>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <p className="text-purple">تجزئة الفاتورة (SHA-256)</p>
            <code className="num break-all">{rec.hash}</code>
          </div>
          <div>
            <p className="text-purple">تجزئة الفاتورة السابقة (PIH)</p>
            <code className="num break-all">{rec.pih}</code>
          </div>
        </div>
        <div>
          <p className="mb-1 font-semibold text-navy">UBL 2.1 XML (غير موقّع)</p>
          <pre
            className="max-h-64 overflow-auto rounded-xl bg-navy-900 p-3 text-[10px] text-white"
            dir="ltr"
          >
            {rec.xml}
          </pre>
        </div>
      </div>
    </Modal>
  );
}

function SellerModal({
  initial,
  onClose,
}: {
  initial: { name: string; vat_number: string; cr_number: string; address: string; city: string };
  onClose: () => void;
}) {
  const { actor } = useAccAccess();
  const [s, setS] = useState(initial);
  const save = useAccMutation(() => pro.updateSeller(s, actor), 'حُفظت بيانات المنشأة');
  return (
    <Modal open onClose={onClose} title="بيانات المنشأة الضريبية">
      <div className="space-y-3">
        <Input
          label="الاسم القانوني"
          value={s.name}
          onChange={(e) => setS({ ...s, name: e.target.value })}
        />
        <Input
          label="الرقم الضريبي (15 رقمًا)"
          value={s.vat_number}
          onChange={(e) => setS({ ...s, vat_number: e.target.value })}
          {...(!isValidVatNumber(s.vat_number) ? { error: 'يبدأ وينتهي بالرقم 3' } : {})}
        />
        <Input
          label="السجل التجاري"
          value={s.cr_number}
          onChange={(e) => setS({ ...s, cr_number: e.target.value })}
        />
        <Input
          label="العنوان"
          value={s.address}
          onChange={(e) => setS({ ...s, address: e.target.value })}
        />
        <Input
          label="المدينة"
          value={s.city}
          onChange={(e) => setS({ ...s, city: e.target.value })}
        />
        <Button
          className="w-full"
          disabled={!isValidVatNumber(s.vat_number)}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          حفظ
        </Button>
      </div>
    </Modal>
  );
}
