import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getQuoteRecord } from '@/shared/lib/quotesLedger';
import { convertQuoteToContract } from '@/features/crm/api/crm.api';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarRange,
  Check,
  CircleAlert,
  FileText,
  Printer,
  UserPlus,
} from 'lucide-react';
import { Button, Card, Input, Modal, Select, useToast } from '@/shared/ui';
import { RentalTemplatePanel } from '@/features/contracts/components/RentalTemplateReview';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import {
  EMPTY_MARKETING,
  MarketingSection,
  marketingError,
  useCustomerAcquisition,
  type MarketingDraft,
} from '@/features/marketing/components/MarketingSection';
import {
  noteRequired,
  setContractMarketing,
  setCustomerAcquisition,
} from '@/features/marketing/api/attribution.api';
import { useSources } from '@/features/settings/hooks/useSettings';
import { dateAr, sar } from '@/shared/lib/format';
import { packagesFor } from '@/features/pricing/lib/engine';
import { buildSchedule, setInstallments } from '@/features/contracts/api/contractPayments.api';
import { NATIONALITIES, TASK_TYPES } from '@/lib/orderTypes';
import { BRANCHES_AR, type WorkerProfile } from '@/lib/funnel';
import { usePrice } from '@/hooks/usePricing';
import { useContractTemplates, useCreateContract } from '@/features/contracts/hooks/useContracts';
import { usePricingConfig, usePricingRules } from '@/features/pricing/hooks/usePricingRules';
import { PromotionPicker } from '@/features/pricing/components/PromotionPicker';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import {
  evaluatePromotion,
  findByCode,
  priceFromBase,
  ruleFloor,
  type Promotion,
} from '@/shared/lib/pricing';
import { usePromotions } from '@/features/pricing/hooks/usePromotions';
import { usePermissions } from '@/hooks/usePermissions';
import { createContractInputSchema } from '@/features/contracts/schemas/contract.schema';
import { useServiceOrigins } from '@/features/contracts/hooks/useServiceOrigins';
import { isMusaned } from '@/features/contracts/lib/contractOrigin';
import { useCreateCustomer, useCustomerSearch } from '@/features/contracts/hooks/useCustomers';
import { renderClauses } from '@/features/contracts/lib/clauses';
import {
  RECRUITMENT_TERM_MONTHS,
  contractEndDate,
  contractTermLabel,
  validateContractTerm,
} from '@/features/contracts/lib/contractTerm';
import { SERVICE_LABEL, type ContractServiceCode } from '@/features/contracts/types';
import {
  wizardServiceCodeSchema,
  type WizardServiceCode,
} from '@/features/contracts/schemas/contract.schema';
import {
  useCompanyProfile,
  useRentalTemplates,
} from '@/features/contracts/hooks/useRentalContract';
import {
  approvedTemplateFor,
  getWorkerDoc,
  setContractDocFields,
  type DocFields,
} from '@/features/contracts/api/rentalContract.api';
import { legalClausesOf } from '@/features/contracts/lib/rentalContract/template';
import type { RentalContractSource } from '@/features/contracts/lib/rentalContract/fields';
import { rentalContractHtml } from '@/features/contracts/lib/rentalContract/print';
import type { CustomerLite } from '@/features/contracts/api/customers.api';
import { isRentalService } from '@/features/contracts/api/rentalContract.api';
import { bookHourly, getHourlyConfig, listBusySlots } from '@/features/hourly/api/hourly.api';
import { conflictFor, hoursBetween, validateHours } from '@/features/hourly/lib/hourly';
import { useAuth } from '@/store/auth';
import { WorkerPicker } from '@/features/contracts/components/WorkerPicker';
import { configValue, listConfig } from '@/features/settings/api/settings.api';
import {
  createDriverTask,
  type WorkerCandidate,
} from '@/features/contracts/api/workersDrivers.api';

interface Draft {
  service: WizardServiceCode | '';
  worker: WorkerProfile | null;
  nationality: string;
  profession: string;
  task: string;
  contractMonths: number;
  quantity: number; // months or days
  start_date: string;
  branch: string;
  customer: CustomerLite | null;
  templateId: string;
  musanedNo: string;
  promotion: Promotion | null;
  /** Coupon code the discount was applied with (null = picked from the list). */
  promotionCode: string | null;
  /** حقول عقد التأجير (القالب الأصلي) غير المسجّلة في ملف العميل. */
  customerIdNo: string;
  customerAddress: string;
  workLocation: string;
  employeeMobile: string;
  /** التأجير بالساعة: وقت الوصول والانصراف في يوم الحجز (start_date). */
  startTime: string;
  endTime: string;
  /** موعد التسليم المتوقع (مهمة توصيل بانتظار إسناد سائق) */
  deliveryAt: string;
  /** الباقة المختارة (قاعدة تسعير مسمّاة بمدة — 0096)؛ فارغ = حسب العدد */
  packageId?: string | undefined;
  /** خطة السداد: عدد الأقساط الشهرية (1 = دفعة واحدة) */
  installments?: number | undefined;
  /** البيانات التسويقية (0098) — لا تدخل نص العقد */
  mkt?: MarketingDraft | undefined;
}

const EMPTY: Draft = {
  service: '',
  worker: null,
  nationality: '',
  profession: '',
  task: 'تنظيف',
  contractMonths: 24,
  quantity: 3,
  start_date: '',
  branch: '',
  customer: null,
  templateId: '',
  musanedNo: '',
  promotion: null,
  promotionCode: null,
  customerIdNo: '',
  customerAddress: '',
  workLocation: '',
  employeeMobile: '',
  startTime: '09:00',
  endTime: '13:00',
  deliveryAt: '',
};

/** بطاقة المرشّحة ← شكل ملف العاملة المستخدم في المعالج (البيانات الإضافية من ملفها). */
function toProfile(w: WorkerCandidate): WorkerProfile {
  return {
    id: w.id,
    full_name: w.full_name,
    nationality: w.nationality,
    profession: w.profession,
    age: null,
    experience_years: 0,
    languages: [],
    monthly_salary: 0,
    status: w.status,
    photo_url: null,
    bio_ar: null,
  };
}

/** مسودة المعالج تُحفظ محلياً لكل مستخدم حتى لا تضيع البيانات عند التنقل. */
const DRAFT_KEY = (uid: string) => `masea.contractWizard.draft.${uid}`;
function readDraft(uid: string): { d: Draft; step: number } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { d: Draft; step: number };
    return parsed.d && typeof parsed.step === 'number'
      ? { d: { ...EMPTY, ...parsed.d }, step: parsed.step }
      : null;
  } catch {
    return null;
  }
}
function writeDraft(uid: string, d: Draft, step: number): void {
  try {
    window.localStorage.setItem(DRAFT_KEY(uid), JSON.stringify({ d, step }));
  } catch {
    /* storage unavailable — the wizard still works, only without resume */
  }
}
function clearDraft(uid: string): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY(uid));
  } catch {
    /* ignore */
  }
}

const STEP_LABEL: Record<string, string> = {
  service: 'نوع الخدمة',
  details: 'تفاصيل الخدمة',
  customer: 'العميل',
  pricing: 'التسعير',
  review: 'المعاينة',
};

export default function ContractWizard() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateContract();
  const { data: pricingCfg } = usePricingConfig();
  const { data: rules = [] } = usePricingRules();
  const { data: templates = [] } = useContractTemplates();
  const { data: origins } = useServiceOrigins();

  const [d, setD] = useState<Draft>(() => {
    const s = params.get('service');
    if (
      s !== 'recruitment' &&
      s !== 'monthly_rental' &&
      s !== 'daily_rental' &&
      s !== 'sponsorship_transfer'
    )
      return EMPTY;
    // prefill from an accepted quote (التسعير ← تحويل إلى عقد); price is re-computed here
    const qty = Number(params.get('quantity'));
    return {
      ...EMPTY,
      service: s,
      nationality: params.get('nationality') ?? EMPTY.nationality,
      task: params.get('task') ?? EMPTY.task,
      quantity: Number.isInteger(qty) && qty > 0 ? qty : EMPTY.quantity,
    };
  });
  const fromQuote = params.get('quote');
  const qc = useQueryClient();
  const quote = useMemo(() => (fromQuote ? getQuoteRecord(fromQuote) : null), [fromQuote]);
  const { meta, branchLabel } = usePermissions();
  // branch-scoped roles create contracts for their own branch only (RLS contracts_read)
  const ownBranch = !meta?.crossBranch && branchLabel ? branchLabel : null;
  const branchOptions = ownBranch ? [ownBranch] : [...BRANCHES_AR];
  useEffect(() => {
    if (ownBranch && d.branch !== ownBranch) set({ branch: ownBranch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownBranch]);

  // the quote's coupon is applied once the managed discounts are loaded
  const couponParam = params.get('coupon');
  const { data: promotions } = usePromotions();
  const couponDone = useRef(false);
  useEffect(() => {
    if (couponDone.current || !couponParam || !promotions) return;
    couponDone.current = true;
    const found = findByCode(promotions, couponParam);
    if (found) set({ promotion: found, promotionCode: couponParam.toUpperCase() });
    else toast.error(`كوبون العرض ${couponParam} لم يعد صالحًا`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [couponParam, promotions]);

  // what differs from the quote (the contract is re-priced on what it says)
  const quoteWarnings: string[] = [];
  if (quote) {
    if (quote.nationality && d.nationality && d.nationality !== quote.nationality)
      quoteWarnings.push(
        `جنسية العاملة المختارة (${d.nationality}) تختلف عن العرض (${quote.nationality}) — السعر يُحتسب على العاملة المختارة.`,
      );
    if (d.service === 'recruitment' && quote.quantity > 1)
      quoteWarnings.push(
        `العرض لعدد ${quote.quantity} — عقد الاستقدام لعاملة واحدة؛ أنشئ عقدًا لكل عاملة.`,
      );
  }
  const [step, setStep] = useState(0);
  // حفظ المسودة عند التنقل + منع فقدان البيانات (لا يُستأنف تحويل عرض سعر من مسودة قديمة)
  const uid = useAuth((st) => st.profile?.id) ?? 'anon';
  const [resume, setResume] = useState(() => (fromQuote ? null : readDraft(uid)));
  const dirty = !resume && (d.service !== '' || step > 0);
  useEffect(() => {
    if (!fromQuote && dirty) writeDraft(uid, d, step);
  }, [d, step, uid, fromQuote, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const acqQ = useCustomerAcquisition(d.customer?.id);
  const { data: sourceRows = [] } = useSources();
  // مساند: العقد يُنشأ ويُوقّع على منصة مساند — لا بنود ولا توقيع داخلي.
  const musaned = isMusaned(origins, d.service || null);
  // 0094: الشهري واليومي وبالساعة على قالب «عقد تأجير خدمات عمالية» الموحّد
  const isRental = isRentalService(d.service);
  const isHourly = d.service === 'hourly_rental';
  const needsWorker = d.service === 'recruitment' || isRental;
  const hours = isHourly ? hoursBetween(d.startTime, d.endTime) : 0;
  const { data: hourlyCfg } = useQuery({
    queryKey: ['hourly', 'config'],
    queryFn: getHourlyConfig,
    enabled: isHourly,
  });
  const { data: busy = [] } = useQuery({
    queryKey: ['hourly', 'busy', d.start_date],
    queryFn: () => listBusySlots(d.start_date),
    enabled: isHourly && Boolean(d.start_date),
  });
  // الخطوات الخمس: العاملة ضمن «تفاصيل الخدمة»
  const stepKeys = ['service', 'details', 'customer', 'pricing', 'review'];
  const current = stepKeys[step] ?? 'service';

  const service = d.service || 'recruitment';
  // الباقات المسمّاة للخدمة (من قائمة الأسعار نفسها) — التأجير الشهري واليومي
  const packages = useMemo(
    () =>
      d.service === 'monthly_rental' || d.service === 'daily_rental'
        ? packagesFor(rules, d.service, {
            nationality: d.nationality || undefined,
            branch: d.branch || null,
          }).filter(
            (r) => d.service !== 'daily_rental' || r.profession == null || r.profession === d.task,
          )
        : [],
    [rules, d.service, d.nationality, d.branch, d.task],
  );
  const activePkg = packages.find((p) => p.id === d.packageId) ?? null;
  // مدة العقد: أشهر عقد الاستقدام، أو العدد (أشهر/أيام) للتأجير؛ نقل الكفالة بلا مدة.
  const termCount =
    d.service === 'recruitment'
      ? d.contractMonths
      : activePkg
        ? Math.max(activePkg.duration_count ?? 1, 1)
        : d.quantity;
  const endDate = isHourly
    ? d.start_date || null
    : contractEndDate(d.service || null, d.start_date, termCount);
  const termLabel = contractTermLabel({
    service_code: d.service || null,
    start_date: d.start_date,
    end_date: endDate,
  });
  const priceArgs = useMemo(
    () => ({
      nationality: d.nationality || undefined,
      profession: d.service === 'daily_rental' || isHourly ? d.task : d.profession || undefined,
      quantity:
        d.service === 'monthly_rental' || d.service === 'daily_rental'
          ? Math.max(termCount, 1)
          : isHourly
            ? Math.max(hours, 0)
            : 1,
      package_id: activePkg?.id ?? undefined,
    }),
    [d.nationality, d.profession, d.task, termCount, d.service, isHourly, hours, activePkg],
  );
  const { data: listPrice, isLoading: priceLoading } = usePrice(
    service,
    priceArgs,
    d.service !== '',
  );
  // الخصم من الخصومات المعتمدة فقط — يُتحقّق منه هنا للعرض ثم يُعاد التحقق في الـ backend.
  const promotion = d.promotion;
  const promoCheck =
    promotion && listPrice
      ? evaluatePromotion(promotion, service, listPrice.base, new Date(), d.promotionCode)
      : null;
  const floor = ruleFloor(rules, service, priceArgs);
  const detail = listPrice
    ? priceFromBase(
        service,
        listPrice.base,
        {
          promotion: promoCheck?.ok ? promotion : null,
          promotionCode: d.promotionCode,
          floor,
        },
        pricingCfg,
      )
    : null;
  const price = detail ? { base: detail.net, vat: detail.vat, total: detail.total } : undefined;
  const serviceTemplates = useMemo(
    () => templates.filter((t) => t.service_code === d.service),
    [templates, d.service],
  );
  const template = serviceTemplates.find((t) => t.id === d.templateId) ?? serviceTemplates[0];
  const clausePreview = useMemo(() => {
    if (!template) return [];
    return renderClauses(template.clauses, {
      customer_name: d.customer?.full_name ?? '—',
      nationality: d.nationality || d.worker?.nationality || '—',
      profession: d.profession || d.task || '—',
      task: d.task || '—',
      duration: String(d.service === 'recruitment' ? d.contractMonths : d.quantity),
      days: String(d.quantity),
      monthly: listPrice ? sar(Math.round((listPrice.base || 0) / Math.max(d.quantity, 1))) : '—',
      start_date: d.start_date || '—',
      total: price ? sar(price.total) : '—',
    });
  }, [template, d, price]);

  // «عقد تأجير خدمات عمالية»: القالب الأصلي المعتمد للتأجير — بنوده ثابتة لا تتغيّر
  // بالباقة أو المدة أو الجنسية؛ تتغيّر الحقول فقط (العميل، العاملة، المدة، السعر).
  const { data: rentalRows = [] } = useRentalTemplates();
  const { data: company } = useCompanyProfile();
  const rentalTpl = isRental ? approvedTemplateFor(rentalRows, d.service) : null;
  const rentalPending =
    isRental &&
    !rentalTpl &&
    rentalRows.some((r) => r.service_code === d.service && r.status === 'pending_review');
  const rentalDocFields: DocFields | null = useMemo(() => {
    if (!rentalTpl || !company || !d.customer) return null;
    const unit = d.service === 'daily_rental' ? 'يوم' : isHourly ? 'ساعة' : 'شهر';
    return {
      customer: {
        full_name: d.customer.full_name,
        national_id: d.customerIdNo.trim() || d.customer.national_id || null,
        phone: d.customer.phone,
        mobile: d.customer.phone,
        address: d.customerAddress.trim() || d.customer.address || null,
        city: d.customer.city,
      },
      worker: d.worker
        ? { full_name: d.worker.full_name, nationality: d.worker.nationality }
        : null,
      company,
      employee_mobile: d.employeeMobile.trim() || null,
      work_location: d.workLocation.trim() || null,
      service_label: isHourly
        ? `${SERVICE_LABEL[service]} — ${hours} ${unit} (${d.startTime}–${d.endTime}) · ${d.task}`
        : `${SERVICE_LABEL[service]} — ${d.quantity} ${unit}`,
    };
  }, [rentalTpl, company, d, service, isHourly, hours]);
  const rentalSource: RentalContractSource | null =
    rentalDocFields && price
      ? {
          contract: {
            contract_no: '',
            issued_on: new Date().toISOString().slice(0, 10),
            service_code: d.service || null,
            start_date: d.start_date,
            end_date: endDate,
            base_amount: price.base,
            vat_amount: price.vat,
            total_amount: price.total,
            amount_paid: 0,
            notes: null,
            work_location: rentalDocFields.work_location ?? null,
          },
          customer: rentalDocFields.customer,
          worker: rentalDocFields.worker,
          company: rentalDocFields.company,
          employee_mobile: rentalDocFields.employee_mobile ?? null,
          payments: [],
          service_label: rentalDocFields.service_label,
        }
      : null;
  const [rentalHtml, setRentalHtml] = useState('');
  useEffect(() => {
    if (current !== 'review' || !rentalTpl || !rentalSource) return;
    let live = true;
    void rentalContractHtml(rentalTpl.doc, rentalSource, {
      watermark: 'معاينة — قبل الحفظ والتوقيع',
    }).then((h) => live && setRentalHtml(h));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild on the inputs that change the text
  }, [current, rentalTpl, JSON.stringify(rentalSource)]);

  function stepError(): string | null {
    if (current === 'service') {
      if (!d.service) return 'اختر نوع الخدمة';
      if (isRental && !rentalTpl) {
        return 'قالب «عقد تأجير خدمات عمالية» لم يُعتمد بعد — لا يُنشأ عقد تأجير قبل اعتماده';
      }
      return null;
    }
    if (current === 'details') {
      if (needsWorker && !d.worker) return 'اختر العاملة';
      if (isHourly) {
        if (!d.start_date) return 'حدّد تاريخ الحجز';
        const hErr = hourlyCfg ? validateHours(d.startTime, d.endTime, hourlyCfg) : null;
        if (hErr) return hErr;
        if (!d.task) return 'اختر نوع المهمة';
        if (!d.branch) return 'اختر الفرع';
        return null;
      }
      const termError = validateContractTerm(d.service || null, d.start_date, termCount);
      if (termError) return termError;
      if (!d.branch) return 'اختر الفرع';
      if (d.service === 'daily_rental' && !d.task) return 'اختر نوع المهمة';
      if ((d.service === 'monthly_rental' || d.service === 'daily_rental') && !(d.quantity >= 1)) {
        return d.service === 'monthly_rental' ? 'عدد الأشهر 1 على الأقل' : 'عدد الأيام 1 على الأقل';
      }
      return null;
    }
    if (current === 'customer') {
      if (!d.customer) return 'اختر العميل';
      if (acqQ.isLoading) return 'جارٍ تحميل مصدر العميل…';
      return marketingError(d.mkt ?? EMPTY_MARKETING, acqQ.data ?? null, sourceRows);
    }
    if (current === 'pricing') {
      if (priceLoading) return 'جارٍ احتساب السعر…';
      if (!listPrice || listPrice.base <= 0) return 'لا توجد قاعدة تسعير لهذه الخدمة';
      if (promotion && !promoCheck?.ok) return `الخصم غير مؤهل: ${promoCheck?.reason ?? ''}`;
    }
    return null;
  }
  const err = stepError();
  // خطة السداد: دفعة واحدة أو أقساط شهرية (حتى عدد أشهر العقد الشهري)
  const planOptions = useMemo(() => {
    const max = d.service === 'monthly_rental' ? Math.max(termCount, 1) : 4;
    return Array.from({ length: Math.min(max, 24) }, (_, i) => i + 1);
  }, [d.service, termCount]);
  const planCount = Math.min(d.installments ?? 1, planOptions.length);

  function pickWorker(w: WorkerProfile) {
    set({ worker: w, nationality: w.nationality, profession: w.profession });
  }

  const [booking, setBooking] = useState(false);
  /** قالب عقد التأجير (المعاينة والاعتماد وبيانات الطرف الأول) — داخل «عقد جديد» */
  const [templateOpen, setTemplateOpen] = useState(false);
  /** مهمة التوصيل المتوقعة للعقد (بلا سائق بعد) — فشلها لا يُفشل إنشاء العقد. */
  async function scheduleDelivery(contractId: string) {
    const at =
      d.deliveryAt || (d.start_date ? `${d.start_date}T${isHourly ? d.startTime : '09:00'}` : '');
    if (!isRental || !at) return;
    const minutes = configValue(await listConfig(), 'driver_task_default_minutes', 60);
    const start = new Date(at);
    await createDriverTask({
      contractId,
      kind: 'delivery',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
      driverId: null,
      address: d.customerAddress.trim() || d.customer?.address || undefined,
      workerId: d.worker?.id ?? null,
    }).catch((e: unknown) =>
      toast.error(`أُنشئ العقد دون مهمة التوصيل: ${e instanceof Error ? e.message : ''}`),
    );
  }
  /** الحجز بالساعة يُنشئ العقد في الخادم — تُسجَّل بياناته التسويقية بعده (0098). */
  async function saveMarketing(contractId: string) {
    if (!d.customer) return;
    const m = d.mkt ?? EMPTY_MARKETING;
    try {
      if (!acqQ.data && m.acquisition_source_code)
        await setCustomerAcquisition(d.customer.id, {
          source_code: m.acquisition_source_code,
          source_note: m.acquisition_source_note || null,
          campaign_id: null,
          first_contact_at: m.first_contact_at || null,
        });
      await setContractMarketing(contractId, {
        source_code: m.source_code,
        source_note: m.source_note || null,
        campaign_id: m.campaign_id || null,
      });
    } catch (e) {
      toast.error(`حُجز العقد دون البيانات التسويقية: ${e instanceof Error ? e.message : ''}`);
    }
  }
  /** التأجير بالساعة: الحجز القائم (book_hourly) ينشئ الحجز والطلب والعقد على القالب الموحّد. */
  async function saveHourly() {
    if (!d.customer || !d.worker || !rentalDocFields) return;
    const phone = (d.customer.phone ?? '').replace(/\D/g, '');
    if (!/^05\d{8}$/.test(phone)) {
      toast.error('جوال العميل يجب أن يبدأ بـ 05 ومكوّنًا من 10 أرقام — حدّثه في ملف العميل');
      return;
    }
    setBooking(true);
    try {
      const b = await bookHourly({
        worker_profile_id: d.worker.id,
        worker_name: d.worker.full_name,
        booking_date: d.start_date,
        start_time: d.startTime,
        end_time: d.endTime,
        profession: d.task,
        customer_name: d.customer.full_name,
        customer_phone: phone,
        address: d.customerAddress.trim() || d.customer.address || null,
        notes: null,
        branch: d.branch,
        promotion_code: d.promotionCode,
      });
      if (!b.contract_id) throw new Error('حُجزت العاملة لكن لم يُنشأ العقد');
      const doc = await getWorkerDoc(d.worker.id);
      await setContractDocFields(b.contract_id, {
        ...rentalDocFields,
        worker: rentalDocFields.worker ? { ...rentalDocFields.worker, ...(doc ?? {}) } : null,
      });
      await scheduleDelivery(b.contract_id);
      await saveMarketing(b.contract_id);
      clearDraft(uid);
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      void qc.invalidateQueries({ queryKey: ['hourly'] });
      toast.success(`تم الحجز وإنشاء العقد — ${hours} ساعة`);
      navigate(`/contracts/${b.contract_id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر الحجز');
    } finally {
      setBooking(false);
    }
  }

  function save() {
    if (!d.service || !d.customer) return;
    if (isRental && !rentalTpl) {
      toast.error('قالب عقد التأجير غير معتمد — لا يُنشأ عقد تأجير قبل اعتماده');
      return;
    }
    if (isHourly) {
      void saveHourly();
      return;
    }
    if (!price) {
      toast.error('تعذّر احتساب السعر — حاول مرة أخرى');
      return;
    }
    const termError = validateContractTerm(d.service, d.start_date, termCount);
    if (termError) {
      toast.error(termError);
      return;
    }
    if (promotion && !promoCheck?.ok) {
      toast.error(`لا يمكن تطبيق الخصم: ${promoCheck?.reason ?? 'غير مؤهل'}`);
      return;
    }
    const parsed = createContractInputSchema.safeParse({
      service_code: d.service,
      customer_id: d.customer.id,
      customer_name: d.customer.full_name,
      worker_name: d.worker?.full_name ?? null,
      worker_profile_id: d.worker?.id ?? null,
      branch: d.branch,
      start_date: d.start_date,
      end_date: endDate,
      quantity: priceArgs.quantity,
      nationality: priceArgs.nationality,
      profession: priceArgs.profession,
      template_id: musaned ? null : rentalTpl ? rentalTpl.id : (template?.id ?? null),
      promotion_id: promotion?.id ?? null,
      promotion_code: d.promotionCode,
      package_id: activePkg?.id ?? null,
      marketing: {
        acquisition_source_code: acqQ.data ? null : d.mkt?.acquisition_source_code || null,
        acquisition_source_note: acqQ.data ? null : d.mkt?.acquisition_source_note || null,
        first_contact_at: acqQ.data ? null : d.mkt?.first_contact_at || null,
        source_code: d.mkt?.source_code ?? '',
        source_note: d.mkt?.source_note || null,
        campaign_id: d.mkt?.campaign_id || null,
        lead_id: quote?.lead_id && !quote.lead_id.startsWith('lead-') ? quote.lead_id : null,
      },
      // Musaned contracts carry no in-system clauses — the paperwork is on مساند.
      clauses: musaned ? [] : rentalTpl ? legalClausesOf(rentalTpl.doc) : clausePreview,
      musaned_contract_no: musaned ? d.musanedNo.trim() || undefined : undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'بيانات العقد غير مكتملة');
      return;
    }
    // one quote → one contract (the quote may have been converted meanwhile)
    if (fromQuote && getQuoteRecord(fromQuote)?.contract_id) {
      toast.error('عرض السعر هذا مرتبط بعقد مسبقًا — لا يمكن تحويله مرة أخرى');
      return;
    }
    const docFields = rentalTpl ? rentalDocFields : null;
    if (rentalTpl && !docFields) {
      toast.error('تعذّر تجهيز بيانات العقد — تحقّق من بيانات الطرف الأول');
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: async (created) => {
        if (docFields) {
          // بيانات الأطراف تُثبَّت مع المسودة (لا تتغيّر لاحقاً بتعديل الملفات)
          const doc = d.worker ? await getWorkerDoc(d.worker.id) : null;
          await setContractDocFields(created.id, {
            ...docFields,
            worker: docFields.worker ? { ...docFields.worker, ...(doc ?? {}) } : null,
          }).catch((e: unknown) =>
            toast.error(e instanceof Error ? e.message : 'تعذّر حفظ بيانات العقد'),
          );
        }
        if (fromQuote) {
          // accept + link the quote, mark the sales lead won
          void convertQuoteToContract(fromQuote, created.contract_no ?? created.id)
            .catch((e: unknown) =>
              toast.error(
                `أُنشئ العقد لكن تعذّر ربطه بعرض السعر: ${e instanceof Error ? e.message : ''}`,
              ),
            )
            .finally(() => {
              void qc.invalidateQueries({ queryKey: ['pricing'] });
              void qc.invalidateQueries({ queryKey: ['crm'] });
            });
        }
        await scheduleDelivery(created.id);
        if (planCount > 1 && created.total_amount > 0) {
          await setInstallments(
            created.id,
            buildSchedule(created.total_amount, d.start_date, planCount),
          ).catch((e: unknown) =>
            toast.error(`أُنشئ العقد دون جدول الاستحقاقات: ${e instanceof Error ? e.message : ''}`),
          );
        }
        clearDraft(uid);
        toast.success(
          musaned
            ? 'تم تسجيل العقد — تابِع إنشاءه وتوقيعه على منصة مساند'
            : 'تم إنشاء العقد — جاهز للاعتماد والتوقيع',
        );
        navigate(`/contracts/${created.id}`);
      },
      onError: (e) => toast.error(e.message || 'تعذّر إنشاء العقد'),
    });
  }

  return (
    <div>
      <Link
        to="/contracts"
        className="mb-4 inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
      >
        <ArrowRight size={16} /> العودة للعقود
      </Link>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <FileText size={20} />
        </span>
        <h1 className="text-xl font-bold text-navy">عقد جديد</h1>
      </div>

      {resume && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-gold-500/40 bg-gold-100/50">
          <p className="text-sm text-navy-900">
            لديك مسودة عقد غير محفوظة
            {resume.d.service ? ` (${SERVICE_LABEL[resume.d.service]})` : ''} — تريد استئنافها؟
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setD(resume.d);
                setStep(Math.min(resume.step, 4));
                setResume(null);
              }}
            >
              استئناف المسودة
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearDraft(uid);
                setResume(null);
              }}
            >
              تجاهلها
            </Button>
          </div>
        </Card>
      )}

      {/* progress */}
      <Card className="mb-4">
        <ol className="flex flex-wrap items-center gap-2">
          {stepKeys.map((k, i) => (
            <li key={k} className="flex items-center gap-2">
              <span
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${i < step ? 'bg-navy-50 text-navy' : i === step ? 'bg-navy text-white' : 'bg-gray-100 text-gray-400'}`}
              >
                <span className="num">{i + 1}</span> {STEP_LABEL[k]}
              </span>
              {i < stepKeys.length - 1 && <span className="text-gray-300">←</span>}
            </li>
          ))}
        </ol>
      </Card>

      {quote && (
        <Card className="border-gold-200 bg-gold-50/40 mb-4">
          <p className="text-sm text-navy">
            من عرض السعر <span className="num font-bold">QT-{quote.quote_no}</span>
            {quote.customer_name ? ` · ${quote.customer_name}` : ''} — يُعاد احتساب السعر هنا من
            قائمة الأسعار الحالية.
          </p>
          {quoteWarnings.map((w) => (
            <p key={w} className="mt-1.5 flex items-start gap-1.5 text-xs text-gold-600">
              <CircleAlert size={14} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}
        </Card>
      )}

      {templateOpen && (
        <Modal open onClose={() => setTemplateOpen(false)} title="قالب عقد التأجير" size="xl">
          <RentalTemplatePanel />
        </Modal>
      )}

      <Card>
        {current === 'service' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {wizardServiceCodeSchema.options.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() =>
                  set({
                    service: code,
                    worker: null,
                    templateId: '',
                    promotion: null,
                    promotionCode: null,
                  })
                }
                className={`rounded-xl border p-4 text-right transition ${d.service === code ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy'}`}
              >
                <span className="font-bold text-navy">{SERVICE_LABEL[code]}</span>
                {isRentalService(code) && (
                  <span className="mt-1 block text-[11px] text-purple">
                    على قالب «عقد تأجير خدمات عمالية» المعتمد
                  </span>
                )}
              </button>
            ))}
            {isRental && !rentalTpl && (
              <p className="flex items-start gap-2 rounded-xl bg-gold-100/60 p-3 text-sm text-navy-900 sm:col-span-2">
                <CircleAlert size={16} className="mt-0.5 shrink-0 text-gold-600" />
                <span>
                  {rentalPending
                    ? 'قالب «عقد تأجير خدمات عمالية» بانتظار الاعتماد — لا يُنشأ عقد تأجير قبل اعتماده من '
                    : 'لا يوجد قالب تأجير معتمد — '}
                  <button
                    type="button"
                    onClick={() => setTemplateOpen(true)}
                    className="font-semibold underline"
                  >
                    مراجعة القالب
                  </button>
                  .
                </span>
              </p>
            )}
          </div>
        )}

        {current === 'details' && (
          <div className="grid gap-4 sm:grid-cols-2">
            {d.worker && (
              <div className="rounded-xl bg-navy-50 p-3 text-sm sm:col-span-2">
                <p>
                  <span className="text-purple">العاملة المختارة: </span>
                  <span className="font-semibold text-navy">{d.worker.full_name}</span>
                  <span className="text-purple">
                    {' '}
                    — {d.worker.nationality} · {d.worker.profession} · {d.worker.age} سنة ·{' '}
                    {d.worker.experience_years} سنوات خبرة
                  </span>
                </p>
                {d.worker.languages.length > 0 && (
                  <p className="mt-1 text-xs text-purple">
                    اللغات: {d.worker.languages.join('، ')}
                  </p>
                )}
                {d.worker.bio_ar && (
                  <p className="mt-1 text-xs text-purple/80">{d.worker.bio_ar}</p>
                )}
              </div>
            )}
            {(d.service === 'daily_rental' || isHourly) && (
              <Select
                label="نوع المهمة"
                value={d.task}
                onChange={(e) => set({ task: e.target.value })}
                options={TASK_TYPES.map((t) => ({ value: t, label: t }))}
                placeholder="اختر المهمة"
              />
            )}
            {!needsWorker && d.service === 'sponsorship_transfer' && (
              <Select
                label="جنسية العاملة"
                value={d.nationality}
                onChange={(e) => set({ nationality: e.target.value })}
                options={NATIONALITIES.map((n) => ({ value: n, label: n }))}
                placeholder="اختر الجنسية"
              />
            )}
            {d.service === 'recruitment' && (
              <Select
                label="مدة العقد (أشهر)"
                value={String(d.contractMonths)}
                onChange={(e) => set({ contractMonths: Number(e.target.value) })}
                options={RECRUITMENT_TERM_MONTHS.map((n) => ({
                  value: String(n),
                  label: `${n.toLocaleString('ar-SA')} شهرًا`,
                }))}
              />
            )}
            {packages.length > 0 && (
              <Select
                label="الباقة"
                value={activePkg?.id ?? ''}
                onChange={(e) => {
                  const p = packages.find((x) => x.id === e.target.value);
                  set({
                    packageId: p?.id,
                    ...(p ? { quantity: Math.max(p.duration_count ?? 1, 1) } : {}),
                  });
                }}
                options={[
                  { value: '', label: 'بدون باقة — حسب العدد' },
                  ...packages.map((p) => ({
                    value: p.id,
                    label: `${p.package_name} — ${p.duration_count} ${d.service === 'monthly_rental' ? 'شهر' : 'يوم'} · ${sar(p.base_price)} ر.س للوحدة`,
                  })),
                ]}
              />
            )}
            {(d.service === 'monthly_rental' || d.service === 'daily_rental') && (
              <Input
                label={d.service === 'monthly_rental' ? 'عدد الأشهر' : 'عدد الأيام'}
                type="number"
                min={1}
                step={1}
                value={activePkg ? termCount : d.quantity}
                disabled={Boolean(activePkg)}
                onChange={(e) => set({ quantity: Number(e.target.value) })}
              />
            )}
            <Input
              label={isHourly ? 'تاريخ الحجز' : 'تاريخ البداية'}
              type="date"
              value={d.start_date}
              onChange={(e) =>
                set({ start_date: e.target.value, ...(isHourly ? { worker: null } : {}) })
              }
            />
            {isHourly ? (
              <>
                <Input
                  label="وقت الوصول"
                  type="time"
                  step={(hourlyCfg?.slotMinutes ?? 30) * 60}
                  value={d.startTime}
                  onChange={(e) => set({ startTime: e.target.value, worker: null })}
                />
                <Input
                  label="وقت الانصراف"
                  type="time"
                  step={(hourlyCfg?.slotMinutes ?? 30) * 60}
                  value={d.endTime}
                  onChange={(e) => set({ endTime: e.target.value, worker: null })}
                />
                <p className="self-end rounded-xl bg-navy-50 px-3 py-2.5 text-sm text-navy">
                  المدة: <span className="num font-bold">{hours > 0 ? hours : '—'}</span> ساعة
                  {hourlyCfg && (
                    <span className="text-[11px] text-purple">
                      {' '}
                      (من {hourlyCfg.minHours} إلى {hourlyCfg.maxHours})
                    </span>
                  )}
                </p>
              </>
            ) : (
              <TermSummary
                service={d.service || null}
                start={d.start_date}
                end={endDate}
                label={termLabel}
              />
            )}
            <Select
              label="الفرع"
              value={d.branch}
              onChange={(e) => set({ branch: e.target.value })}
              options={branchOptions.map((b) => ({ value: b, label: b }))}
              placeholder="اختر الفرع"
              disabled={Boolean(ownBranch)}
            />
            {isRental && (
              <div className="grid gap-3 rounded-xl border border-navy-50 p-3 sm:col-span-2 sm:grid-cols-3">
                <p className="text-xs font-bold text-navy sm:col-span-3">
                  بيانات التسليم والاستلام{isHourly ? ' (مكان الخدمة)' : ''}
                </p>
                <Input
                  label={isHourly ? 'عنوان مكان الخدمة' : 'عنوان التسليم'}
                  value={d.customerAddress}
                  onChange={(e) => set({ customerAddress: e.target.value })}
                  placeholder="يُؤخذ من ملف العميل إن تُرك فارغاً"
                />
                <Input
                  label="مكان العمل"
                  value={d.workLocation}
                  onChange={(e) => set({ workLocation: e.target.value })}
                />
                <Input
                  label="جوال الموظف المسؤول"
                  value={d.employeeMobile}
                  inputMode="tel"
                  className="num"
                  onChange={(e) => set({ employeeMobile: e.target.value })}
                />
                <Input
                  label="موعد التسليم المتوقع"
                  type="datetime-local"
                  value={
                    d.deliveryAt ||
                    (d.start_date ? `${d.start_date}T${isHourly ? d.startTime : '09:00'}` : '')
                  }
                  onChange={(e) => set({ deliveryAt: e.target.value })}
                />
                <p className="self-end text-[11px] text-purple sm:col-span-2">
                  تُنشأ مهمة «توصيل العاملة» بانتظار إسناد سائق، ويُسند السائق من تبويب «التوصيل
                  والاستلام».
                </p>
              </div>
            )}
            {musaned && (
              <div className="sm:col-span-2">
                <Input
                  label="رقم عقد مساند (اختياري)"
                  value={d.musanedNo}
                  onChange={(e) => set({ musanedNo: e.target.value })}
                  placeholder="يُدخَل الآن أو بعد إنشاء العقد على منصة مساند"
                />
                <p className="mt-1.5 text-[11px] text-purple">
                  عقود الاستقدام ونقل الكفالة تُنشأ وتُوقّع على منصة مساند — يتتبّع النظام حالتها
                  ورقم عقدها فقط.
                </p>
              </div>
            )}
          </div>
        )}

        {current === 'details' && needsWorker && (
          <div className="mt-5 border-t border-navy-50 pt-4">
            <p className="mb-3 text-sm font-bold text-navy">
              العاملة{' '}
              <span className="text-xs font-normal text-purple">
                {isHourly
                  ? '— غير المحجوزات في التاريخ والوقت أعلاه'
                  : '— توفّرها محسوب لفترة العقد؛ تُعبّأ جنسيتها ومهنتها في العقد تلقائياً'}
              </span>
            </p>
            <WorkerPicker
              service={d.service}
              start={d.start_date}
              end={endDate}
              value={d.worker?.id ?? null}
              onPick={(w) => pickWorker(toProfile(w))}
              exclude={
                isHourly && hourlyCfg
                  ? (w) =>
                      conflictFor(
                        busy,
                        {
                          worker_profile_id: w.id,
                          booking_date: d.start_date,
                          start_time: d.startTime,
                          end_time: d.endTime,
                        },
                        hourlyCfg,
                      )
                        ? 'محجوزة بالساعة في هذا الوقت'
                        : null
                  : undefined
              }
            />
          </div>
        )}

        {current === 'customer' && (
          <>
            <CustomerStep
              selected={d.customer}
              onSelect={(c) =>
                set({ customer: c, ...(c.id !== d.customer?.id ? { mkt: EMPTY_MARKETING } : {}) })
              }
              suggested={
                quote?.customer_name
                  ? { full_name: quote.customer_name, phone: quote.customer_phone ?? '' }
                  : null
              }
            />
            {d.customer && (
              <MarketingSection
                customerId={d.customer.id}
                branch={d.branch}
                value={d.mkt ?? EMPTY_MARKETING}
                onChange={(m) => set({ mkt: m })}
              />
            )}
          </>
        )}

        {current === 'pricing' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <PromotionPicker
                service={service}
                base={listPrice?.base ?? 0}
                floor={floor}
                value={d.promotion}
                code={d.promotionCode}
                onChange={(p, code) => set({ promotion: p, promotionCode: code })}
                disabled={!listPrice}
              />
              {!isHourly && d.service !== 'sponsorship_transfer' && planOptions.length > 1 && (
                <div className="mt-4">
                  <Select
                    label="خطة السداد"
                    value={String(planCount)}
                    onChange={(e) => set({ installments: Number(e.target.value) })}
                    options={planOptions.map((n) => ({
                      value: String(n),
                      label:
                        n === 1
                          ? 'دفعة واحدة'
                          : `${n} أقساط شهرية${price ? ` — ${sar(Math.round((price.total / n) * 100) / 100)} ر.س تقريباً` : ''}`,
                    }))}
                  />
                  <p className="mt-1 text-[11px] text-purple">
                    يُنشأ جدول الاستحقاقات مع العقد، وتُسجَّل الدفعات من صفحة العقد (الطريقة والحساب
                    المستلم ورقم العملية).
                  </p>
                </div>
              )}
              <p className="mt-3 text-[11px] text-purple">
                لا يوجد خصم مفتوح — تُختار الخصومات من القائمة المعتمدة في شاشة التسعير، ويُعاد
                التحقق من شروطها واحتسابها في الـ backend عند حفظ العقد.
              </p>
            </div>
            {detail ? (
              <div className="space-y-2">
                <PriceBreakdown detail={detail} />
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-navy-50 p-3">
                    <dt className="text-xs text-purple">المدفوع</dt>
                    <dd className="num font-bold text-navy">{sar(0)}</dd>
                  </div>
                  <div className="rounded-xl bg-navy-50 p-3">
                    <dt className="text-xs text-purple">المتبقي</dt>
                    <dd className="num font-bold text-navy">{sar(detail.total)}</dd>
                  </div>
                </dl>
                <p className="text-[11px] text-purple">
                  تُسجَّل الدفعات بعد حفظ العقد من صفحة تفاصيله ← «تسجيل دفعة».
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-navy-100 p-4 text-sm text-purple">
                {priceLoading ? 'جارٍ احتساب السعر…' : 'تعذّر احتساب السعر لهذه الخدمة.'}
              </div>
            )}
          </div>
        )}

        {current === 'review' && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="bg-navy-50">
                <p className="mb-2 text-xs font-bold text-navy">بيانات العميل</p>
                <p className="text-sm text-navy-900">{d.customer?.full_name ?? '—'}</p>
                <p className="num text-xs text-purple">
                  {d.customer?.phone ?? ''} · {d.customer?.city ?? ''}
                </p>
              </Card>
              <Card className="bg-navy-50">
                <p className="mb-2 text-xs font-bold text-navy">
                  {d.worker ? 'العاملة' : 'الخدمة'}
                </p>
                {d.worker ? (
                  <>
                    <p className="text-sm text-navy-900">{d.worker.full_name}</p>
                    <p className="text-xs text-purple">
                      {d.worker.nationality} · {d.worker.profession}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-navy-900">{SERVICE_LABEL[service]}</p>
                )}
                <p className="num mt-1 text-xs text-gold-600">
                  الإجمالي {sar(price?.total ?? 0)} ر.س
                  {detail && detail.discounts > 0 && (
                    <span className="text-green-700"> (بعد خصم {sar(detail.discounts)} ر.س)</span>
                  )}
                </p>
              </Card>
              <div className="sm:col-span-2">
                <TermSummary
                  service={d.service || null}
                  start={d.start_date}
                  end={endDate}
                  label={termLabel}
                />
              </div>
            </div>
            {musaned ? (
              <div className="rounded-xl border border-gold-500/30 bg-gold-100/60 p-4">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
                  <FileText size={16} /> العقد على منصة مساند
                </h2>
                <p className="text-sm leading-relaxed text-navy-900">
                  يُنشأ عقد {SERVICE_LABEL[service]} ويُوقّعه العميل على منصة مساند. يسجّل النظام
                  هنا حالة العقد ورقمه لمتابعة سجل التواصل والفوترة — دون توقيع داخلي.
                </p>
                <p className="mt-2 text-sm text-navy-900">
                  <span className="text-purple">رقم عقد مساند: </span>
                  <span className="num font-semibold">{d.musanedNo || 'يُضاف لاحقًا'}</span>
                </p>
              </div>
            ) : rentalTpl ? (
              <RentalReview
                d={d}
                set={set}
                total={price?.total ?? 0}
                html={rentalHtml}
                title={rentalTpl.doc.title}
                version={rentalTpl.version}
              />
            ) : (
              <div>
                {rentalPending && (
                  <p className="mb-3 flex items-start gap-2 rounded-xl bg-gold-100/60 p-3 text-sm text-navy-900">
                    <CircleAlert size={16} className="mt-0.5 shrink-0 text-gold-600" />
                    <span>
                      قالب «عقد تأجير خدمات عمالية» المطابق للعقد الأصلي بانتظار الاعتماد — يُستخدم
                      تلقائياً بعد اعتماده من{' '}
                      <button
                        type="button"
                        onClick={() => setTemplateOpen(true)}
                        className="font-semibold underline"
                      >
                        مراجعة القالب
                      </button>
                      .
                    </span>
                  </p>
                )}
                {serviceTemplates.length > 1 && (
                  <div className="mb-3 max-w-xs">
                    <Select
                      label="قالب العقد"
                      value={template?.id ?? ''}
                      onChange={(e) => set({ templateId: e.target.value })}
                      options={serviceTemplates.map((t) => ({ value: t.id, label: t.name }))}
                    />
                  </div>
                )}
                <h2 className="mb-3 text-sm font-bold text-navy">
                  بنود العقد ({template?.name ?? '—'})
                </h2>
                <ol className="space-y-2">
                  {clausePreview.map((c, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-navy-900">
                      <span className="num font-bold text-gold-600">{i + 1}.</span> {c}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={() => (step === 0 ? navigate('/contracts') : setStep((s) => s - 1))}
          >
            السابق
          </Button>
          {err && <span className="flex-1 text-center text-xs text-red-600">{err}</span>}
          {step < stepKeys.length - 1 ? (
            <Button onClick={() => !err && setStep((s) => s + 1)} disabled={Boolean(err)}>
              التالي
            </Button>
          ) : (
            <Button
              onClick={save}
              loading={create.isPending || booking}
              disabled={!price || (isRental && !rentalTpl)}
            >
              <Check size={16} />{' '}
              {musaned ? 'تسجيل العقد ومتابعة مساند' : 'إنشاء العقد ومتابعة التوقيع'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

/** ملخّص مدة العقد: البداية · النهاية المحسوبة · المدة (للقراءة فقط). */
function TermSummary({
  service,
  start,
  end,
  label,
}: {
  service: ContractServiceCode | null;
  start: string;
  end: string | null;
  label: string | null;
}) {
  if (service === 'sponsorship_transfer') {
    return (
      <p className="self-end rounded-xl bg-navy-50 p-3 text-xs text-purple">
        نقل الكفالة إجراء لمرة واحدة — بلا مدة ولا تاريخ نهاية.
      </p>
    );
  }
  return (
    <div className="rounded-xl bg-navy-50 p-3 text-sm sm:col-span-2">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
        <CalendarRange size={14} /> مدة العقد
      </p>
      <div className="grid grid-cols-3 gap-2">
        <TermCell title="تاريخ البداية" value={start ? dateAr(start) : '—'} />
        <TermCell title="تاريخ النهاية" value={end ? dateAr(end) : '—'} />
        <TermCell title="المدة" value={label ?? '—'} />
      </div>
    </div>
  );
}

function TermCell({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-purple">{title}</p>
      <p className="font-semibold text-navy-900">{value}</p>
    </div>
  );
}

function CustomerStep({
  selected,
  onSelect,
  suggested,
}: {
  selected: CustomerLite | null;
  onSelect: (c: CustomerLite) => void;
  /** customer named on the quote — searched first, prefilled if created */
  suggested: { full_name: string; phone: string } | null;
}) {
  const [q, setQ] = useState(selected ? '' : (suggested?.full_name ?? ''));
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    full_name: suggested?.full_name ?? '',
    phone: suggested?.phone ?? '',
    city: '',
  });
  // مصدر العميل يُسجَّل مع إنشائه من شاشة العقود (0098)
  const { data: sourceList = [] } = useSources();
  const [src, setSrc] = useState('');
  const [srcNote, setSrcNote] = useState('');
  const [firstContact, setFirstContact] = useState(new Date().toISOString().slice(0, 10));
  const srcNeedsNote = noteRequired(sourceList, src);
  const srcError = !src
    ? 'حدّد مصدر العميل'
    : srcNeedsNote && srcNote.trim().length < 2
      ? 'وضّح المصدر'
      : null;
  const { data: results = [] } = useCustomerSearch(q);
  const createCustomer = useCreateCustomer();

  function submitNew() {
    if (srcError) return;
    const acquisition = {
      source_code: src,
      source_note: srcNeedsNote ? srcNote.trim() : null,
      first_contact_at: firstContact || null,
    };
    createCustomer.mutate(
      { ...form, acquisition },
      {
        onSuccess: (c) => {
          onSelect(c);
          setCreating(false);
        },
      },
    );
  }

  return (
    <div>
      {!creating ? (
        <>
          <Input
            placeholder="ابحث عن العميل بالاسم"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c)}
                className={`rounded-xl border p-3 text-right transition ${selected?.id === c.id ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy'}`}
              >
                <span className="block text-sm font-semibold text-navy">{c.full_name}</span>
                <span className="num block text-xs text-purple">
                  {c.phone ?? ''} · {c.city ?? ''}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-4 inline-flex items-center gap-1 text-sm text-navy hover:underline"
          >
            <UserPlus size={16} /> إنشاء عميل جديد
          </button>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="الاسم الكامل"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <Input
            label="الجوال"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Input
            label="المدينة"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
          <Select
            label="مصدر العميل (إلزامي)"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            options={[
              { value: '', label: 'كيف عرف العميل الشركة؟' },
              ...sourceList
                .filter((s) => s.is_active)
                .map((s) => ({ value: s.code, label: s.name_ar })),
            ]}
          />
          {srcNeedsNote && (
            <Input
              label="توضيح المصدر"
              value={srcNote}
              onChange={(e) => setSrcNote(e.target.value)}
            />
          )}
          <Input
            label="تاريخ أول تواصل"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={firstContact}
            onChange={(e) => setFirstContact(e.target.value)}
          />
          {srcError && <p className="text-[11px] text-gold-600 sm:col-span-2">{srcError}</p>}
          <div className="flex items-end gap-2">
            <Button
              onClick={submitNew}
              loading={createCustomer.isPending}
              disabled={Boolean(srcError)}
            >
              حفظ
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** مراجعة عقد التأجير قبل الحفظ: الحقول المكمّلة + بيانات الدفع + العقد كاملاً. */
function RentalReview({
  d,
  set,
  total,
  html,
  title,
  version,
}: {
  d: Draft;
  set: (p: Partial<Draft>) => void;
  total: number;
  html: string;
  title: string;
  version: number;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
          <FileText size={16} /> {title}{' '}
          <span className="num text-xs font-normal text-purple">(النسخة {version} — معتمدة)</span>
        </h2>
        <p className="text-xs text-purple">
          البنود ثابتة بنص العقد الأصلي؛ أكمل البيانات التالية لتظهر في العقد.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="رقم هوية العميل (البطاقة)"
          value={d.customerIdNo || d.customer?.national_id || ''}
          inputMode="numeric"
          className="num"
          onChange={(e) => set({ customerIdNo: e.target.value })}
        />
        <dl className="rounded-xl bg-navy-50 p-3 text-xs">
          <dt className="mb-1 font-bold text-navy">
            بيانات التسليم والاستلام (من «تفاصيل الخدمة»)
          </dt>
          <dd>العنوان: {d.customerAddress || d.customer?.address || 'غير متوفر'}</dd>
          <dd>مكان العمل: {d.workLocation || 'غير متوفر'}</dd>
          <dd>
            جوال الموظف المسؤول: <span className="num">{d.employeeMobile || 'غير متوفر'}</span>
          </dd>
        </dl>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <PayFact label="إجمالي قيمة العقد" value={total} />
        <PayFact label="المبلغ المدفوع" value={0} />
        <PayFact label="المبلغ المتبقي" value={total} />
      </div>
      <p className="text-xs text-purple">
        الدفعات تُسجَّل من «المدفوعات» وتظهر تلقائياً في العقد (المدفوع والمتبقي وجدول المدفوعات).
      </p>
      {html && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => openContractPrint(html)}>
            <Printer size={14} /> طباعة / تنزيل PDF
          </Button>
        </div>
      )}
      {html ? (
        <iframe
          title="معاينة العقد"
          srcDoc={html}
          className="h-[70vh] w-full rounded-xl border border-navy-100 bg-gray-100"
        />
      ) : (
        <p className="rounded-xl bg-navy-50 p-6 text-center text-sm text-purple">
          جارٍ تجهيز معاينة العقد…
        </p>
      )}
    </div>
  );
}

function PayFact({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-navy-50 p-3">
      <p className="text-xs text-purple">{label}</p>
      <p className="num mt-1 text-base font-bold text-navy">{sar(value)} ر.س</p>
    </div>
  );
}
