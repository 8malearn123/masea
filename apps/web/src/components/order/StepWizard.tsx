import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, FlaskConical, PackageSearch } from 'lucide-react';
import { sar } from '@/lib/format';
import type { ServiceCode } from '@/lib/funnel';
import { BRANCHES_AR } from '@/lib/funnel';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { usePrice } from '@/hooks/usePricing';
import { newClientToken, useCreateRequest, type CreateResult } from '@/hooks/useCreateRequest';
import { useRequestBackend } from '@/features/requests/hooks/useRequestFiles';
import {
  customerContactSchema,
  firstIssue,
  placeStepIssue,
} from '@/features/requests/schemas/request.schema';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import { SERVICE_FLOWS } from '@/lib/wizardConfig';
import { BeneficiaryStep } from '@/features/requests/components/BeneficiaryStep';
import { PlaceStep } from '@/features/requests/components/PlaceStep';
import { PeriodFields } from '@/features/requests/components/PeriodFields';
import { MatchedWorkerPicker } from '@/features/catalog/components/MatchedWorkerPicker';
import type { RequestNeed } from '@/features/catalog/lib/matching';
import type { PlaceDetails } from '@/features/requests/types';
import { periodLabel } from '@/features/requests/lib/period';
import {
  NATIONALITIES,
  PROFESSIONS,
  TASK_TYPES,
  PAYMENT_METHODS,
  TRACKING_STAGES,
  draftPeriod,
  priceParams,
  type OrderDraft,
} from '@/lib/orderTypes';

/* ----------------------------- field helpers ----------------------------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-brand-dark">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-xl border border-brand-100 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}

function SelectInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder: string;
}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function RadioCards({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string; icon?: string }[];
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={
            'flex items-center gap-3 rounded-xl border p-3.5 text-right transition ' +
            (value === o.key ? 'border-brand bg-brand-50' : 'border-brand-100 hover:border-brand')
          }
        >
          {o.icon ? <span className="text-xl">{o.icon}</span> : null}
          <span className="text-sm font-medium text-brand-dark">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={strong ? 'font-bold text-brand' : 'text-sm text-brand-dark/70'}>
        {label}
      </span>
      <span
        className={(strong ? 'text-lg font-bold text-brand' : 'text-sm text-brand-dark') + ' num'}
      >
        {sar(value)} <span className="text-xs font-normal">ر.س</span>
      </span>
    </div>
  );
}

/* ------------------------------- the engine ------------------------------- */
interface Props {
  service: ServiceCode;
  serviceName: string;
  initialDraft: OrderDraft;
  onReset: () => void;
}

export default function StepWizard({ service, serviceName, initialDraft, onReset }: Props) {
  const flow = SERVICE_FLOWS[service];
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<OrderDraft>(initialDraft);
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // معرّف إرسال ثابت لهذه الجلسة: الضغط المزدوج أو إعادة المحاولة = نفس الطلب.
  const clientToken = useRef(newClientToken());
  // حارس متزامن: «paying» لا يتحدّث قبل إعادة الرسم.
  const submitting = useRef(false);
  const { supportsRequestFile } = useRequestBackend();

  const { data: workers = [], isLoading: workersLoading } = useWorkerProfiles();
  const params = useMemo(() => priceParams(draft), [draft]);
  const { data: price } = usePrice(service, params, true);
  const createRequest = useCreateRequest();

  const step = flow[stepIndex];
  const update = (patch: Partial<OrderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const updatePlace = (patch: Partial<PlaceDetails>) =>
    setDraft((d) => ({ ...d, place: { ...d.place, ...patch } }));

  const period = useMemo(() => draftPeriod(draft), [draft]);
  const selectedWorker = workers.find((w) => w.id === draft.workerProfileId) ?? null;

  /** احتياج الطلب كما يُغذّي محرّك الترشيح. */
  const need: RequestNeed = useMemo(
    () => ({
      place: draft.place,
      period,
      nationality: draft.nationality || undefined,
      profession: draft.profession || undefined,
    }),
    [draft.place, draft.nationality, draft.profession, period],
  );

  const filteredWorkers = useMemo(() => {
    if (service === 'recruitment') {
      return workers.filter(
        (w) =>
          (!draft.nationality || w.nationality === draft.nationality) &&
          (!draft.profession || w.profession === draft.profession),
      );
    }
    return workers;
  }, [workers, service, draft.nationality, draft.profession]);

  if (!step) return null; // stepIndex is always in range; guards the type

  /* --------------------------- per-step validation -------------------------- */
  function stepError(key: string): string | null {
    switch (key) {
      case 'nationality_profession':
        return draft.nationality && draft.profession ? null : 'اختر الجنسية والمهنة.';
      case 'beneficiary':
        return placeStepIssue(draft.place, 'beneficiary');
      case 'place':
        return (
          placeStepIssue(draft.place, 'place') ??
          (draft.place.careNeeds.length > 0
            ? null
            : 'اختر احتياج رعاية واحدًا على الأقل ليُرشَّح لك الأنسب.')
        );
      case 'package':
        return draft.monthlySalary > 0 && draft.contractMonths > 0 && draft.startDate
          ? null
          : 'حدّد الراتب ومدة العقد وتاريخ المباشرة المتوقّع.';
      case 'select_worker':
        if (service === 'daily_rental') return null; // يجوز ترك الاختيار للشركة
        return draft.workerProfileId ? null : 'اختر العاملة المطلوبة.';
      case 'duration':
        return draft.startDate && draft.months >= 1 ? null : 'حدّد تاريخ البداية وعدد الأشهر.';
      case 'dates':
        return draft.startDate && draft.days >= 1 ? null : 'حدّد تاريخ البداية وعدد الأيام.';
      case 'task':
        return draft.taskType ? null : 'اختر نوع المهمة.';
      case 'employer':
      case 'customer': {
        if (!draft.customerName || !draft.phone || !draft.branch)
          return 'أدخل الاسم والجوال والفرع.';
        const contact = customerContactSchema.safeParse(draft);
        return contact.success ? null : firstIssue(contact.error);
      }
      case 'worker':
        return draft.currentIqama && draft.currentNationality && draft.currentProfession
          ? null
          : 'أدخل بيانات العاملة الحالية.';
      case 'sponsors':
        return draft.currentSponsor && draft.newSponsor ? null : 'أدخل بيانات الكفيلين.';
      case 'documents':
        return draft.documents.length > 0 ? null : 'أرفق مستندًا واحدًا على الأقل.';
      case 'contract':
        return draft.agreeTerms ? null : 'يجب الموافقة على بنود العقد.';
      default:
        return null;
    }
  }

  const err = stepError(step.key);
  const isLast = stepIndex === flow.length - 1;
  const isPayment = step.key === 'payment';

  function next() {
    if (err) return;
    if (!isLast) setStepIndex((i) => i + 1);
  }
  function back() {
    if (stepIndex === 0) onReset();
    else setStepIndex((i) => i - 1);
  }

  async function pay() {
    if (!price || submitting.current) return;
    submitting.current = true;
    setPaying(true);
    setSubmitError(null);
    try {
      // الدفع محاكاة في العرض التجريبي (Moyasar/Tamara لاحقًا)
      await new Promise((r) => setTimeout(r, 1200));
      const res = await createRequest.mutateAsync({
        clientToken: clientToken.current,
        draft,
        price,
        serviceName,
        worker: selectedWorker,
      });
      setResult(res);
      setStepIndex(flow.length - 1); // jump to confirm
    } catch (e) {
      setSubmitError(
        e instanceof Error && e.message ? e.message : 'تعذّر إرسال الطلب، حاول مرة أخرى.',
      );
    } finally {
      submitting.current = false;
      setPaying(false);
    }
  }

  /* ------------------------------ step bodies ------------------------------ */
  function body(key: string) {
    switch (key) {
      case 'nationality_profession':
        return (
          <div className="space-y-4">
            <Field label="الجنسية">
              <SelectInput
                value={draft.nationality}
                onChange={(v) => update({ nationality: v })}
                options={NATIONALITIES}
                placeholder="اختر الجنسية"
              />
            </Field>
            <Field label="المهنة">
              <SelectInput
                value={draft.profession}
                onChange={(v) => update({ profession: v })}
                options={PROFESSIONS}
                placeholder="اختر المهنة"
              />
            </Field>
          </div>
        );
      case 'beneficiary':
        return <BeneficiaryStep place={draft.place} onChange={updatePlace} />;
      case 'place':
        return <PlaceStep place={draft.place} onChange={updatePlace} />;
      case 'package':
        return (
          <div className="space-y-4">
            <Field label="الراتب الشهري للعاملة (ر.س)">
              <TextInput
                type="number"
                min={800}
                value={draft.monthlySalary}
                onChange={(e) => update({ monthlySalary: Number(e.target.value) })}
              />
            </Field>
            <Field label="مدة العقد">
              <SelectInput
                value={String(draft.contractMonths)}
                onChange={(v) => update({ contractMonths: Number(v) })}
                options={['12', '24']}
                placeholder="اختر المدة بالأشهر"
              />
            </Field>
            <PeriodFields
              startDate={draft.startDate}
              unit="month"
              count={draft.contractMonths}
              maxCount={36}
              onChange={(patch) =>
                update({
                  ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
                  ...(patch.count !== undefined ? { contractMonths: patch.count } : {}),
                })
              }
            />
          </div>
        );
      case 'cv':
        return (
          <div>
            <p className="mb-3 text-sm text-brand-dark/60">
              رتّبنا السير المتاحة حسب مطابقتها لاحتياج طلبك، أو اتركوا الاختيار لنا.
            </p>
            <MatchedWorkerPicker
              workers={filteredWorkers}
              need={need}
              isLoading={workersLoading}
              selectedId={draft.workerProfileId}
              allowNone
              onSelect={(w, m) =>
                update({ workerProfileId: w?.id ?? null, matchScore: m?.score ?? null })
              }
            />
          </div>
        );
      case 'select_worker':
        return (
          <MatchedWorkerPicker
            workers={workers}
            need={need}
            isLoading={workersLoading}
            selectedId={draft.workerProfileId}
            allowNone={service === 'daily_rental'}
            onSelect={(w, m) =>
              update({
                workerProfileId: w?.id ?? null,
                matchScore: m?.score ?? null,
                nationality: w?.nationality ?? '',
                profession: w?.profession ?? '',
              })
            }
          />
        );
      case 'duration':
        return (
          <PeriodFields
            startDate={draft.startDate}
            unit="month"
            count={draft.months}
            workerId={draft.workerProfileId}
            workerName={selectedWorker?.full_name ?? null}
            onChange={(patch) =>
              update({
                ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
                ...(patch.count !== undefined ? { months: patch.count } : {}),
              })
            }
          />
        );
      case 'dates':
        return (
          <PeriodFields
            startDate={draft.startDate}
            unit="day"
            count={draft.days}
            workerId={draft.workerProfileId}
            workerName={selectedWorker?.full_name ?? null}
            onChange={(patch) =>
              update({
                ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
                ...(patch.count !== undefined ? { days: patch.count } : {}),
              })
            }
          />
        );
      case 'task':
        return (
          <RadioCards
            value={draft.taskType}
            onChange={(v) => update({ taskType: v })}
            options={TASK_TYPES.map((t) => ({ key: t, label: t }))}
          />
        );
      case 'employer':
      case 'customer':
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم الكامل">
              <TextInput
                value={draft.customerName}
                onChange={(e) => update({ customerName: e.target.value })}
              />
            </Field>
            <Field label="رقم الجوال">
              <TextInput
                type="tel"
                inputMode="numeric"
                placeholder="05xxxxxxxx"
                value={draft.phone}
                onChange={(e) => update({ phone: e.target.value })}
              />
            </Field>
            <Field label="رقم الهوية الوطنية">
              <TextInput
                inputMode="numeric"
                value={draft.nationalId}
                onChange={(e) => update({ nationalId: e.target.value })}
              />
            </Field>
            <Field label="المدينة">
              <TextInput value={draft.city} onChange={(e) => update({ city: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="العنوان">
                <TextInput
                  value={draft.address}
                  onChange={(e) => update({ address: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="الفرع">
                <SelectInput
                  value={draft.branch}
                  onChange={(v) => update({ branch: v })}
                  options={BRANCHES_AR}
                  placeholder="اختر الفرع"
                />
              </Field>
            </div>
          </div>
        );
      case 'worker':
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="رقم إقامة العاملة">
              <TextInput
                inputMode="numeric"
                value={draft.currentIqama}
                onChange={(e) => update({ currentIqama: e.target.value })}
              />
            </Field>
            <Field label="جنسية العاملة">
              <SelectInput
                value={draft.currentNationality}
                onChange={(v) => update({ currentNationality: v })}
                options={NATIONALITIES}
                placeholder="اختر الجنسية"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="مهنة العاملة">
                <SelectInput
                  value={draft.currentProfession}
                  onChange={(v) => update({ currentProfession: v })}
                  options={PROFESSIONS}
                  placeholder="اختر المهنة"
                />
              </Field>
            </div>
          </div>
        );
      case 'sponsors':
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم/هوية الكفيل الحالي">
              <TextInput
                value={draft.currentSponsor}
                onChange={(e) => update({ currentSponsor: e.target.value })}
              />
            </Field>
            <Field label="اسم/هوية الكفيل الجديد">
              <TextInput
                value={draft.newSponsor}
                onChange={(e) => update({ newSponsor: e.target.value })}
              />
            </Field>
          </div>
        );
      case 'documents':
        return (
          <div>
            <Field label="إرفاق المستندات (الإقامة، الموافقات)">
              <input
                type="file"
                multiple
                className={
                  inputCls +
                  ' file:ml-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-white'
                }
                onChange={(e) =>
                  update({ documents: Array.from(e.target.files ?? []).map((f) => f.name) })
                }
              />
            </Field>
            {draft.documents.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-brand-dark/70">
                {draft.documents.map((d) => (
                  <li key={d}>📎 {d}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-brand-dark/50">
              سيتم رفع الملفات إلى التخزين الآمن عند تأكيد الطلب.
            </p>
          </div>
        );
      case 'pricing':
        return (
          <div>
            <PriceBreakdown
              detail={{
                base: price?.base ?? 0,
                discounts: 0,
                penalties: 0,
                net: price?.base ?? 0,
                vat: price?.vat ?? 0,
                total: price?.total ?? 0,
              }}
            />
            {service === 'recruitment' && (
              <div className="mt-4 rounded-xl bg-brand-50 p-4 text-sm text-brand-dark/70">
                <p className="font-semibold text-brand">الجدول الزمني المتوقع للوصول</p>
                <p className="num mt-1">
                  إصدار التأشيرة ٢–٤ أسابيع · الإجراءات والسفر ٤–٨ أسابيع تقريبًا.
                </p>
              </div>
            )}
          </div>
        );
      case 'contract':
        return (
          <div>
            <div className="rounded-xl border border-brand-100 p-4 text-sm leading-relaxed text-brand-dark/80">
              <p className="mb-2 font-bold text-brand">ملخص بنود العقد</p>
              <ul className="list-inside list-disc space-y-1">
                {contractTerms(service, draft, serviceName, price?.total ?? 0).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.agreeTerms}
                onChange={(e) => update({ agreeTerms: e.target.checked })}
                className="h-4 w-4 accent-[#0E5A4F]"
              />
              أوافق على بنود وشروط العقد.
            </label>
          </div>
        );
      case 'payment':
        return (
          <div className="space-y-5">
            <RadioCards
              value={draft.paymentMethod}
              onChange={(v) => update({ paymentMethod: v })}
              options={PAYMENT_METHODS}
            />
            <div className="rounded-xl border border-brand-100 p-4">
              <Money label="المبلغ المطلوب" value={price?.total ?? 0} strong />
            </div>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              بيئة تجريبية: الدفع محاكاة فقط (سيُربط Moyasar لاحقًا). لن يتم خصم أي مبلغ.
            </p>
          </div>
        );
      case 'confirm':
        return (
          <div className="text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand text-3xl text-white">
              ✓
            </div>
            <h2 className="mt-4 text-xl font-bold text-brand">تم استلام طلبك بنجاح</h2>
            <p className="mt-1 text-sm text-brand-dark/60">رقم الطلب</p>
            <p className="num mt-1 text-lg font-bold text-brand-accent">
              {result?.requestNo ?? '—'}
            </p>
            {result?.backend === 'mock' && (
              <p className="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                <FlaskConical size={13} /> طلب تجريبي — عرض للنظام، لا يُرسل لجهة حقيقية
              </p>
            )}
            {result && (
              <Link
                to={`/order/track?no=${result.requestNo}`}
                className="me-2 mt-4 inline-flex items-center gap-2 rounded-xl border border-brand px-5 py-2.5 text-sm font-bold text-brand transition hover:bg-brand-50"
              >
                <PackageSearch size={16} /> تتبّع الطلب
              </Link>
            )}
            {result && supportsRequestFile && (
              <Link
                to={`/order/request/${result.requestNo}`}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
              >
                <FileText size={16} /> عرض ملف الطلب
              </Link>
            )}
            <div className="mt-6">
              <p className="mb-3 text-sm font-semibold text-brand-dark">مراحل تتبّع الطلب</p>
              <ol className="flex flex-wrap items-center justify-center gap-2">
                {TRACKING_STAGES[service].map((s, i) => (
                  <li key={s} className="flex items-center gap-2">
                    <span
                      className={
                        'rounded-full px-3 py-1.5 text-xs font-medium ' +
                        (i === 0 ? 'bg-brand text-white' : 'bg-brand-50 text-brand')
                      }
                    >
                      <span className="num">{i + 1}</span> {s}
                    </span>
                    {i < TRACKING_STAGES[service].length - 1 && (
                      <span className="text-brand-100">←</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  /* -------------------------------- progress -------------------------------- */
  return (
    <div className="rounded-2xl bg-white p-6 shadow-card">
      {/* progress */}
      <div className="mb-5 overflow-x-auto">
        <ol className="flex items-center gap-2">
          {flow.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className={
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ' +
                  (i < stepIndex
                    ? 'bg-brand-50 text-brand'
                    : i === stepIndex
                      ? 'bg-brand text-white'
                      : 'bg-gray-100 text-gray-400')
                }
              >
                <span className="num">{i + 1}</span> {s.title}
              </span>
              {i < flow.length - 1 && <span className="text-gray-300">←</span>}
            </li>
          ))}
        </ol>
      </div>

      <div className="mb-1 text-xs text-brand-dark/50">{serviceName}</div>
      <h1 className="mb-5 text-lg font-bold text-brand">{step.title}</h1>

      {body(step.key)}

      {/* nav */}
      {step.key !== 'confirm' && (
        <div className="mt-8 flex items-center justify-between gap-3">
          <button type="button" onClick={back} className="btn-outline-brand">
            السابق
          </button>
          {(err ?? (isPayment ? submitError : null)) && (
            <span role="alert" className="flex-1 text-center text-xs text-red-600">
              {err ?? submitError}
            </span>
          )}
          {isPayment ? (
            <button type="button" onClick={pay} disabled={paying} className="btn-accent px-6">
              {paying ? 'جارٍ معالجة الدفع…' : `ادفع ${price ? sar(price.total) : ''} ر.س`}
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              disabled={!!err}
              className="btn-brand px-6 disabled:opacity-50"
            >
              التالي
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- text helpers ------------------------------ */
function contractTerms(
  service: ServiceCode,
  d: OrderDraft,
  serviceName: string,
  total: number,
): string[] {
  const period = draftPeriod(d);
  const base = [
    `نوع الخدمة: ${serviceName}.`,
    ...(period
      ? [`مدة الطلب: من ${period.startDate} إلى ${period.endDate} (${periodLabel(period)}).`]
      : []),
    `الفرع: ${d.branch || '—'}.`,
    `إجمالي القيمة شاملة الضريبة: ${sar(total)} ر.س.`,
    'العقد موثّق ومتوافق مع أنظمة وزارة الموارد البشرية ومنصة مساند.',
  ];
  if (service === 'recruitment')
    base.splice(
      1,
      0,
      `الجنسية والمهنة: ${d.nationality} — ${d.profession}.`,
      `مدة العقد: ${d.contractMonths} شهرًا.`,
    );
  if (service === 'monthly_rental')
    base.splice(1, 0, `مدة الإيجار: ${d.months} شهرًا، تجدد تلقائيًا.`);
  if (service === 'daily_rental') base.splice(1, 0, `المهمة: ${d.taskType} لمدة ${d.days} يوم.`);
  if (service === 'sponsorship_transfer') base.splice(1, 0, 'يشمل إجراءات النقل عبر مساند وأبشر.');
  return base;
}
