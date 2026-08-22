import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, FileText, UserPlus, UserRound } from 'lucide-react';
import { Button, Card, Input, Select, useToast } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { NATIONALITIES, TASK_TYPES } from '@/lib/orderTypes';
import { BRANCHES_AR, type WorkerProfile } from '@/lib/funnel';
import { usePrice } from '@/hooks/usePricing';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { useContractTemplates } from '@/features/contracts/hooks/useContracts';
import { useServiceOrigins } from '@/features/contracts/hooks/useServiceOrigins';
import { isMusaned } from '@/features/contracts/lib/contractOrigin';
import { useCreateCustomer, useCustomerSearch } from '@/features/contracts/hooks/useCustomers';
import { renderClauses } from '@/features/contracts/lib/clauses';
import { formatContractNo } from '@/features/contracts/lib/contractNo';
import { contractKeys } from '@/features/contracts/api/keys';
import {
  SERVICE_LABEL,
  type ContractClause,
  type ContractListItem,
  type ContractServiceCode,
} from '@/features/contracts/types';
import type { CustomerLite } from '@/features/contracts/api/customers.api';

interface Draft {
  service: ContractServiceCode | '';
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
};

const STEP_LABEL: Record<string, string> = {
  service: 'نوع الخدمة',
  worker: 'العاملة',
  details: 'التفاصيل',
  customer: 'العميل',
  pricing: 'التسعير',
  review: 'المعاينة',
};

export default function ContractWizard() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: templates = [] } = useContractTemplates();
  const { data: origins } = useServiceOrigins();
  const { data: workers = [] } = useWorkerProfiles();

  const [d, setD] = useState<Draft>(() => {
    const s = params.get('service');
    return s === 'recruitment' ||
      s === 'monthly_rental' ||
      s === 'daily_rental' ||
      s === 'sponsorship_transfer'
      ? { ...EMPTY, service: s }
      : EMPTY;
  });
  const [step, setStep] = useState(0);

  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  // مساند: العقد يُنشأ ويُوقّع على منصة مساند — لا بنود ولا توقيع داخلي.
  const musaned = isMusaned(origins, d.service || null);
  const needsWorker = d.service === 'recruitment' || d.service === 'monthly_rental';
  const stepKeys = [
    'service',
    ...(needsWorker ? ['worker'] : []),
    'details',
    'customer',
    'pricing',
    'review',
  ];
  const current = stepKeys[step] ?? 'service';

  const service = d.service || 'recruitment';
  const priceArgs = useMemo(
    () => ({
      nationality: d.nationality || undefined,
      profession: d.service === 'daily_rental' ? d.task : d.profession || undefined,
      quantity:
        d.service === 'monthly_rental' || d.service === 'daily_rental'
          ? Math.max(d.quantity, 1)
          : 1,
    }),
    [d.nationality, d.profession, d.task, d.quantity, d.service],
  );
  const { data: price } = usePrice(service, priceArgs, d.service !== '');

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
      monthly: price ? sar(Math.round((price.base || 0) / Math.max(d.quantity, 1))) : '—',
      start_date: d.start_date || '—',
      total: price ? sar(price.total) : '—',
    });
  }, [template, d, price]);

  function stepError(): string | null {
    if (current === 'service') return d.service ? null : 'اختر نوع الخدمة';
    if (current === 'worker') return d.worker ? null : 'اختر العاملة';
    if (current === 'details') {
      if (!d.start_date) return 'حدّد تاريخ البداية';
      if (!d.branch) return 'اختر الفرع';
      if (d.service === 'daily_rental' && !d.task) return 'اختر نوع المهمة';
      return null;
    }
    if (current === 'customer') return d.customer ? null : 'اختر العميل';
    return null;
  }
  const err = stepError();

  function pickWorker(w: WorkerProfile) {
    set({ worker: w, nationality: w.nationality, profession: w.profession });
  }

  function save() {
    if (!d.service || !d.customer || !price) return;
    const id = `c-${Date.now()}`;
    const item: ContractListItem = {
      id,
      contract_no: formatContractNo(
        new Date().getFullYear(),
        Math.floor(Math.random() * 99999) + 1,
      ),
      service_code: d.service,
      template_id: template?.id ?? null,
      customer_id: d.customer.id,
      worker_id: null,
      branch_id: d.branch,
      created_by: null,
      start_date: d.start_date,
      end_date: null,
      base_amount: price.base,
      vat_amount: price.vat,
      total_amount: price.total,
      amount_paid: 0,
      status: 'draft',
      version: 1,
      parent_contract_id: null,
      signed_at: null,
      musaned_contract_no: musaned ? d.musanedNo.trim() || null : null,
      created_at: new Date().toISOString(),
      assigned_office_id: null,
      assigned_at: null,
      recruitment_stage: null,
      visa_number: null,
      expected_arrival_date: null,
      flight_no: null,
      customer_name: d.customer.full_name,
      worker_name: d.worker?.full_name ?? null,
    };
    // Musaned contracts carry no in-system clauses — the paperwork is on مساند.
    const clauses: ContractClause[] = musaned
      ? []
      : clausePreview.map((body, i) => ({
          id: `cl-${id}-${i}`,
          contract_id: id,
          sort_order: i,
          body,
        }));

    qc.setQueryData(contractKeys.detail(id), item);
    qc.setQueryData(contractKeys.clauses(id), clauses);
    qc.setQueryData(contractKeys.history(id), [
      {
        id: `h-${id}`,
        contract_id: id,
        from_status: null,
        to_status: 'draft',
        changed_by: null,
        created_at: new Date().toISOString(),
      },
    ]);
    qc.setQueriesData<ContractListItem[]>({ queryKey: ['contracts', 'list'] }, (old) =>
      old ? [item, ...old] : old,
    );

    toast.success(
      musaned
        ? 'تم تسجيل العقد — تابِع إنشاءه وتوقيعه على منصة مساند'
        : 'تم إنشاء العقد — جاهز للاعتماد والتوقيع',
    );
    navigate(`/contracts/${id}`);
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

      <Card>
        {current === 'service' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(SERVICE_LABEL) as ContractServiceCode[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => set({ service: code, worker: null, templateId: '' })}
                className={`rounded-xl border p-4 text-right transition ${d.service === code ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy'}`}
              >
                <span className="font-bold text-navy">{SERVICE_LABEL[code]}</span>
              </button>
            ))}
          </div>
        )}

        {current === 'worker' && (
          <div>
            <p className="mb-3 text-sm text-brand-dark/60 text-purple">
              اختر العاملة — ستُعبّأ جنسيتها ومهنتها في العقد تلقائيًا.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {workers.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => pickWorker(w)}
                  className={`flex items-center gap-3 rounded-xl border p-3.5 text-right transition ${d.worker?.id === w.id ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy'}`}
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy-50 text-navy">
                    <UserRound size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-navy">
                      {w.full_name}
                    </span>
                    <span className="block text-xs text-purple">
                      {w.nationality} · {w.profession} · {w.age} سنة
                    </span>
                    <span className="num block text-xs text-gold-600">
                      {w.monthly_salary} ر.س / شهر · {w.experience_years} سنوات خبرة
                    </span>
                    {w.languages.length > 0 && (
                      <span className="block text-[11px] text-purple">
                        اللغات: {w.languages.join('، ')}
                      </span>
                    )}
                    {w.bio_ar && (
                      <span className="block truncate text-[11px] text-purple/80">{w.bio_ar}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
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
            {!needsWorker && d.service === 'daily_rental' && (
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
                options={[
                  { value: '12', label: '١٢ شهرًا' },
                  { value: '24', label: '٢٤ شهرًا' },
                ]}
              />
            )}
            {(d.service === 'monthly_rental' || d.service === 'daily_rental') && (
              <Input
                label={d.service === 'monthly_rental' ? 'عدد الأشهر' : 'عدد الأيام'}
                type="number"
                min={1}
                value={d.quantity}
                onChange={(e) => set({ quantity: Number(e.target.value) })}
              />
            )}
            <Input
              label="تاريخ البداية"
              type="date"
              value={d.start_date}
              onChange={(e) => set({ start_date: e.target.value })}
            />
            <Select
              label="الفرع"
              value={d.branch}
              onChange={(e) => set({ branch: e.target.value })}
              options={BRANCHES_AR.map((b) => ({ value: b, label: b }))}
              placeholder="اختر الفرع"
            />
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

        {current === 'customer' && (
          <CustomerStep selected={d.customer} onSelect={(c) => set({ customer: c })} />
        )}

        {current === 'pricing' && (
          <div className="rounded-xl border border-navy-100 p-4">
            <Row label="السعر الأساسي" value={`${sar(price?.base ?? 0)} ر.س`} />
            <Row label="ضريبة القيمة المضافة (١٥٪)" value={`${sar(price?.vat ?? 0)} ر.س`} />
            <div className="my-2 border-t border-navy-100" />
            <Row label="الإجمالي" value={`${sar(price?.total ?? 0)} ر.س`} strong />
            <p className="mt-3 text-[11px] text-purple">
              يُحتسب التسعير في الـ backend (ضريبة 15%).
            </p>
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
                </p>
              </Card>
            </div>
            {musaned ? (
              <div className="border-gold-200 bg-gold-50/60 rounded-xl border p-4">
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
            ) : (
              <div>
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
            <Button onClick={save}>
              <Check size={16} />{' '}
              {musaned ? 'تسجيل العقد ومتابعة مساند' : 'إنشاء العقد ومتابعة التوقيع'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={strong ? 'font-bold text-navy' : 'text-sm text-purple'}>{label}</span>
      <span
        className={`num ${strong ? 'text-lg font-bold text-gold-600' : 'text-sm text-navy-900'}`}
      >
        {value}
      </span>
    </div>
  );
}

function CustomerStep({
  selected,
  onSelect,
}: {
  selected: CustomerLite | null;
  onSelect: (c: CustomerLite) => void;
}) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ full_name: '', phone: '', city: '' });
  const { data: results = [] } = useCustomerSearch(q);
  const createCustomer = useCreateCustomer();

  function submitNew() {
    createCustomer.mutate(form, {
      onSuccess: (c) => {
        onSelect(c);
        setCreating(false);
      },
    });
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
          <div className="flex items-end gap-2">
            <Button onClick={submitNew} loading={createCustomer.isPending}>
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
