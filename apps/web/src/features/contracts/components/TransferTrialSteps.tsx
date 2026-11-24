import { useMemo } from 'react';
import { CircleAlert, FileText, Printer } from 'lucide-react';
import { Button, Input, Select } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { priceFromBase, type PricingConfig } from '@/shared/lib/pricing';
import type { CustomerLite } from '@/features/contracts/api/customers.api';
import type { TrialFieldsInput } from '@/features/contracts/api/trials.api';
import { buildTrialContractHtml } from '@/features/contracts/lib/trialContract/render';
import {
  trialPeriodLabel,
  type TrialContractData,
  type TrialTemplateDoc,
} from '@/features/contracts/lib/trialContract/template';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import { TrialDocFrame } from '@/features/contracts/components/TrialDocFrame';

/**
 * «نقل كفالة» من «عقد جديد»: بيانات عقد التجربة الرسمي (contract_final_black.pdf).
 * تُحفظ مع مسودة المعالج فلا تضيع عند الرجوع بين الخطوات؛ العقد يظهر في المعاينة فقط.
 */
export interface TrialDraft {
  workerKind: '' | 'العاملة' | 'السائق';
  days: number;
  sponsorName: string;
  city: string;
  customerNationality: string;
  idKind: '' | 'بطاقة' | 'إقامة';
  idNumber: string;
  idIssueDate: string;
  idIssuePlace: string;
  address: string;
  job: string;
  mobile: string;
  customerNo: string;
  /** السعر المتفق عليه قبل الضريبة */
  price: string;
  paid: string;
  dailyWage: string;
}

export const EMPTY_TRIAL: TrialDraft = {
  workerKind: '',
  days: 0,
  sponsorName: '',
  city: '',
  customerNationality: '',
  idKind: '',
  idNumber: '',
  idIssueDate: '',
  idIssuePlace: '',
  address: '',
  job: '',
  mobile: '',
  customerNo: '',
  price: '',
  paid: '',
  dailyWage: '',
};

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const DRIVER_RE = /سائق/;

/** نهاية التجربة = تاريخ الاستلام + الأيام − 1 (مرآة create_trial_agreement). */
export function trialEndDate(receipt: string, days: number): string | null {
  if (!receipt || !(days > 0)) return null;
  const t = new Date(`${receipt}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days - 1);
  return t.toISOString().slice(0, 10);
}

/** يكمّل حقول العميل الفارغة من ملفه (لا يستبدل ما أدخله الموظف). */
export function prefillFromCustomer(t: TrialDraft, c: CustomerLite): Partial<TrialDraft> {
  return {
    ...(!t.idNumber && c.national_id ? { idNumber: c.national_id } : {}),
    ...(!t.mobile && c.phone ? { mobile: c.phone } : {}),
    ...(!t.address && c.address ? { address: c.address } : {}),
  };
}

/** نوع العامل من مهنته (يُعدَّل يدوياً). */
export const workerKindFor = (profession: string | null | undefined): TrialDraft['workerKind'] =>
  DRIVER_RE.test(profession ?? '') ? 'السائق' : 'العاملة';

export function trialTotals(t: TrialDraft, cfg: PricingConfig | undefined) {
  const base = num(t.price);
  if (!(base > 0)) return null;
  const detail = priceFromBase('transfer_trial', base, {}, cfg);
  const paid = num(t.paid);
  return {
    base: detail.net,
    vat: detail.vat,
    total: detail.total,
    paid: paid >= 0 ? paid : 0,
    remaining: Math.round((detail.total - (paid >= 0 ? paid : 0)) * 100) / 100,
  };
}

/** أخطاء كل خطوة — لا انتقال قبل اكتمالها. */
export function trialStepError(
  step: 'details' | 'customer' | 'pricing',
  t: TrialDraft,
  ctx: {
    hasWorker: boolean;
    receipt: string;
    branch: string;
    maxDays: number;
    totals: ReturnType<typeof trialTotals>;
  },
): string | null {
  if (step === 'details') {
    if (!ctx.hasWorker) return 'اختر العاملة أو السائق';
    if (!t.workerKind) return 'حدّد: العاملة أو السائق';
    if (!ctx.receipt) return 'حدّد تاريخ الاستلام';
    if (!(t.days > 0) || !Number.isInteger(t.days)) return 'حدّد مدة التجربة بالأيام';
    if (t.days > ctx.maxDays)
      return `مدة التجربة بين يوم و${ctx.maxDays} يوماً (لائحة العمالة المنزلية — المادة التاسعة)`;
    if (t.sponsorName.trim().length < 3) return 'اكتب اسم الكفيل الحالي';
    if (t.city.trim().length < 2) return 'حدّد مدينة العمل لدى العميل';
    if (!ctx.branch) return 'اختر الفرع';
    return null;
  }
  if (step === 'customer') {
    if (!t.customerNationality.trim()) return 'حدّد جنسية العميل';
    if (!t.idKind) return 'حدّد نوع الهوية: بطاقة أو إقامة';
    if (!/^[12]\d{9}$/.test(t.idNumber.trim())) return 'رقم الهوية/الإقامة 10 أرقام يبدأ بـ 1 أو 2';
    if (!t.idIssueDate.trim()) return 'حدّد تاريخ إصدار الهوية';
    if (!t.idIssuePlace.trim()) return 'حدّد جهة إصدار الهوية';
    if (!/^05\d{8}$/.test(t.mobile.trim())) return 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام';
    if (t.address.trim().length < 3) return 'اكتب عنوان العميل';
    if (t.job.trim().length < 2) return 'اكتب عمل العميل';
    return null;
  }
  if (!ctx.totals) return 'حدّد سعر التجربة المتفق عليه';
  const paid = num(t.paid);
  if (t.paid.trim() !== '' && !(paid >= 0)) return 'المبلغ المدفوع غير صالح';
  if (paid > ctx.totals.total) return 'المبلغ المدفوع أكبر من المبلغ الإجمالي';
  if (!(num(t.dailyWage) > 0)) return 'حدّد أجر اليوم أثناء التجربة';
  return null;
}

export function trialFieldsOf(t: TrialDraft): TrialFieldsInput {
  return {
    customer_nationality: t.customerNationality.trim(),
    id_kind: t.idKind as 'بطاقة' | 'إقامة',
    id_number: t.idNumber.trim(),
    id_issue_date: t.idIssueDate.trim(),
    id_issue_place: t.idIssuePlace.trim(),
    worker_kind: t.workerKind as 'العاملة' | 'السائق',
    sponsor_name: t.sponsorName.trim(),
    city: t.city.trim(),
    daily_wage: num(t.dailyWage),
    paid_amount: num(t.paid) >= 0 ? num(t.paid) : 0,
    address: t.address.trim(),
    job: t.job.trim(),
    mobile: t.mobile.trim(),
    customer_no: t.customerNo.trim() || null,
  };
}

/** بيانات المعاينة قبل الحفظ (رقم العقد يُولَّد عند الحفظ). */
export function trialPreviewData(
  t: TrialDraft,
  ctx: {
    customerName: string;
    workerName: string;
    workerNationality: string;
    totals: ReturnType<typeof trialTotals>;
  },
): TrialContractData {
  return {
    contract_no: '',
    customer_no: t.customerNo.trim(),
    issued_on: new Date().toISOString(),
    customer_name: ctx.customerName,
    customer_nationality: t.customerNationality.trim(),
    id_kind: t.idKind,
    id_number: t.idNumber.trim(),
    id_issue_date: t.idIssueDate.trim(),
    id_issue_place: t.idIssuePlace.trim(),
    worker_kind: t.workerKind,
    sponsor_name: t.sponsorName.trim(),
    worker_name: ctx.workerName,
    worker_nationality: ctx.workerNationality,
    total: ctx.totals?.total ?? null,
    paid: ctx.totals?.paid ?? null,
    remaining: ctx.totals?.remaining ?? null,
    city: t.city.trim(),
    trial_period: trialPeriodLabel(t.days),
    daily_wage: num(t.dailyWage) > 0 ? num(t.dailyWage) : null,
    address: t.address.trim(),
    job: t.job.trim(),
    mobile: t.mobile.trim(),
  };
}

type Set = (p: Partial<TrialDraft>) => void;

/** الخطوة 2: العاملة/السائق، مدة التجربة، الاستلام والنهاية، الكفيل الحالي، المدينة. */
export function TrialDetailsFields({
  t,
  set,
  receipt,
  onReceipt,
  workerNationality,
  maxDays,
}: {
  t: TrialDraft;
  set: Set;
  receipt: string;
  onReceipt: (v: string) => void;
  workerNationality: string | null;
  maxDays: number;
}) {
  const end = trialEndDate(receipt, t.days);
  return (
    <>
      <Select
        label="العاملة أو السائق"
        value={t.workerKind}
        onChange={(e) => set({ workerKind: e.target.value as TrialDraft['workerKind'] })}
        options={[
          { value: 'العاملة', label: 'العاملة' },
          { value: 'السائق', label: 'السائق' },
        ]}
        placeholder="اختر"
      />
      <Input
        label="الجنسية"
        value={workerNationality ?? ''}
        disabled
        placeholder="تُعبّأ من ملف العاملة المختارة"
      />
      <Input
        label={`مدة التجربة (يوم — حتى ${maxDays})`}
        type="number"
        min={1}
        max={maxDays}
        step={1}
        value={t.days > 0 ? t.days : ''}
        onChange={(e) => set({ days: Number(e.target.value) })}
      />
      <Input
        label="تاريخ الاستلام"
        type="date"
        value={receipt}
        onChange={(e) => onReceipt(e.target.value)}
      />
      <Input label="تاريخ نهاية التجربة" value={end ? dateAr(end) : ''} disabled />
      <Input
        label="اسم الكفيل الحالي"
        value={t.sponsorName}
        onChange={(e) => set({ sponsorName: e.target.value })}
        placeholder="العاملة تحت كفالة السيد…"
      />
      <Input
        label="مدينة العمل لدى العميل"
        value={t.city}
        onChange={(e) => set({ city: e.target.value })}
      />
    </>
  );
}

/** الخطوة 3: بيانات العميل في القالب (الهوية والجوال من ملفه إن وُجدا). */
export function TrialCustomerFields({
  t,
  set,
  customer,
}: {
  t: TrialDraft;
  set: Set;
  customer: CustomerLite;
}) {
  const idLocked = Boolean(customer.national_id);
  const phoneLocked = Boolean(customer.phone);
  return (
    <div className="mt-5 border-t border-navy-50 pt-4">
      <p className="mb-3 text-sm font-bold text-navy">بيانات العميل في عقد التجربة</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="الجنسية"
          value={t.customerNationality}
          onChange={(e) => set({ customerNationality: e.target.value })}
        />
        <Select
          label="بموجب"
          value={t.idKind}
          onChange={(e) => set({ idKind: e.target.value as TrialDraft['idKind'] })}
          options={[
            { value: 'بطاقة', label: 'بطاقة' },
            { value: 'إقامة', label: 'إقامة' },
          ]}
          placeholder="بطاقة / إقامة"
        />
        <Input
          label="رقم الهوية / الإقامة"
          value={t.idNumber}
          inputMode="numeric"
          className="num"
          disabled={idLocked}
          onChange={(e) => set({ idNumber: e.target.value.replace(/\D/g, '') })}
        />
        <Input
          label="تاريخ الإصدار"
          value={t.idIssueDate}
          placeholder="كما في الهوية — مثال: 1440/05/12"
          className="num"
          onChange={(e) => set({ idIssueDate: e.target.value })}
        />
        <Input
          label="صادرة من"
          value={t.idIssuePlace}
          onChange={(e) => set({ idIssuePlace: e.target.value })}
        />
        <Input
          label="الجوال"
          value={t.mobile}
          inputMode="tel"
          className="num"
          disabled={phoneLocked}
          onChange={(e) => set({ mobile: e.target.value.replace(/\D/g, '') })}
        />
        <Input
          label="العنوان"
          value={t.address}
          onChange={(e) => set({ address: e.target.value })}
        />
        <Input label="العمل" value={t.job} onChange={(e) => set({ job: e.target.value })} />
        <Input
          label="رقم العميل (اختياري)"
          value={t.customerNo}
          className="num"
          onChange={(e) => set({ customerNo: e.target.value })}
        />
      </div>
      {(idLocked || phoneLocked) && (
        <p className="mt-2 text-[11px] text-purple">
          الهوية والجوال من ملف العميل — يُتحقق بهما عند القبول الإلكتروني، ويُصحَّحان من ملفه.
        </p>
      )}
    </div>
  );
}

/** الخطوة 4: الإجمالي، المدفوع، المتبقي، أجر اليوم أثناء التجربة. */
export function TrialPricing({
  t,
  set,
  totals,
}: {
  t: TrialDraft;
  set: Set;
  totals: ReturnType<typeof trialTotals>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid content-start gap-3">
        <Input
          label="سعر التجربة المتفق عليه (قبل الضريبة)"
          inputMode="decimal"
          className="num"
          value={t.price}
          onChange={(e) => set({ price: e.target.value })}
        />
        <Input
          label="المبلغ المدفوع"
          inputMode="decimal"
          className="num"
          value={t.paid}
          onChange={(e) => set({ paid: e.target.value })}
          placeholder="0"
        />
        <Input
          label="أجر اليوم أثناء التجربة (ريال)"
          inputMode="decimal"
          className="num"
          value={t.dailyWage}
          onChange={(e) => set({ dailyWage: e.target.value })}
        />
        <p className="text-[11px] text-purple">
          أجر اليوم يُطبَّق في حال عدم الصلاحية (البند ٧). المدفوع يظهر في العقد؛ تُسجَّل الدفعة
          نفسها من صفحة العقد ← «تسجيل دفعة».
        </p>
      </div>
      {totals ? (
        <dl className="grid content-start gap-2 text-sm sm:grid-cols-3">
          {[
            ['المبلغ الإجمالي', totals.total, `يشمل الضريبة ${sar(totals.vat)}`],
            ['المبلغ المدفوع', totals.paid, null],
            ['المبلغ المتبقي', totals.remaining, null],
          ].map(([k, v, note]) => (
            <div key={String(k)} className="rounded-xl bg-navy-50 p-3">
              <dt className="text-xs text-purple">{k}</dt>
              <dd className="num font-bold text-navy">{sar(Number(v))}</dd>
              {note && <dd className="text-[10px] text-purple">{note}</dd>}
            </div>
          ))}
        </dl>
      ) : (
        <div className="rounded-xl border border-navy-100 p-4 text-sm text-purple">
          أدخل سعر التجربة المتفق عليه لاحتساب الإجمالي والمتبقي.
        </div>
      )}
    </div>
  );
}

/** الخطوة 5: عقد التجربة الأصلي مكتمل البيانات — للمراجعة قبل الحفظ. */
export function TrialReview({
  template,
  data,
}: {
  template: TrialTemplateDoc | null;
  data: TrialContractData;
}) {
  const html = useMemo(
    () =>
      template
        ? buildTrialContractHtml(template, data, { watermark: 'معاينة — قبل الحفظ والقبول' })
        : '',
    [template, data],
  );
  if (!template)
    return (
      <p className="flex items-start gap-2 rounded-xl bg-gold-100/60 p-3 text-sm text-navy-900">
        <CircleAlert size={16} className="mt-0.5 shrink-0 text-gold-600" />
        قالب «عقد تجربة» المعتمد غير متاح — لا يُنشأ عقد تجربة دونه.
      </p>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <FileText size={16} /> {template.title} — القالب المعتمد (النسخة{' '}
          <span className="num">{template.version}</span>)
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            openContractPrint(
              buildTrialContractHtml(template, data, {
                watermark: 'معاينة — قبل الحفظ والقبول',
                autoPrint: true,
              }),
            )
          }
        >
          <Printer size={14} /> طباعة المعاينة
        </Button>
      </div>
      <TrialDocFrame html={html} title="معاينة عقد التجربة" testId="trial-preview" />
      <p className="text-[11px] text-purple">
        راجع البيانات في أماكنها — للتعديل ارجع للخطوة المطلوبة بزر «السابق» دون فقد البيانات. قبول
        العميل لعقد التجربة لا يُعد نقلاً للخدمات ولا يغني عن إجراءات منصة مساند.
      </p>
    </div>
  );
}
