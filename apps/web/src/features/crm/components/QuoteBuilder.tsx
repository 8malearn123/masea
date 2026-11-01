import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import type { Promotion } from '@/shared/lib/pricing';
import { quoteNeedsApproval, type QuoteRecord } from '@/shared/lib/quotesLedger';
import { NATIONALITIES, TASK_TYPES } from '@/lib/orderTypes';
import { usePermissions } from '@/hooks/usePermissions';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { computeEndDate, today } from '@/features/requests/lib/period';
import { calculate, EMPTY_CALC, type CalcInput } from '@/features/pricing/lib/engine';
import { usePricingConfig, usePricingRules } from '@/features/pricing/hooks/usePricingRules';
import { PromotionPicker } from '@/features/pricing/components/PromotionPicker';
import { useContractTemplates } from '@/features/contracts/hooks/useContracts';
import { renderClauses } from '@/features/contracts/lib/clauses';
import { RECRUITMENT_TERM_MONTHS } from '@/features/contracts/lib/contractTerm';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { useCreateLeadQuote, useQuoteApprovalPolicy } from '@/features/crm/hooks/useCrm';
import { SERVICE_LABEL, type Lead, type ServiceCode } from '@/features/crm/types';

const SERVICE_OPTS = (Object.entries(SERVICE_LABEL) as [ServiceCode, string][]).map(
  ([value, label]) => ({ value, label }),
);
const NAT_OPTS = NATIONALITIES.map((n) => ({ value: n, label: n }));
const TASK_OPTS = TASK_TYPES.map((t) => ({ value: t, label: t }));
const TERM_OPTS = RECRUITMENT_TERM_MONTHS.map((m) => ({ value: String(m), label: `${m} شهرًا` }));

/** Rentals are priced per unit of time, so the quantity IS the duration. */
const RENTAL_UNIT: Partial<Record<ServiceCode, 'month' | 'day'>> = {
  monthly_rental: 'month',
  daily_rental: 'day',
};
const QTY_LABEL: Record<ServiceCode, string> = {
  recruitment: 'عدد العاملات',
  monthly_rental: 'عدد الأشهر',
  daily_rental: 'عدد الأيام',
  sponsorship_transfer: 'عدد العاملات',
};

/**
 * عرض سعر من ملف العميل المحتمل: الخدمة والعاملة والمدة والكوبون والشروط في
 * شاشة واحدة، والسعر من محرّك التسعير نفسه (القائمة المُدارة + الضريبة المُدارة)
 * ثم يُعاد احتسابه في الـ backend. «تعديل» عرض = نسخة جديدة منه (parent).
 */
export function QuoteBuilder({
  lead,
  open,
  onClose,
  parent = null,
}: {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  parent?: QuoteRecord | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={parent ? `نسخة معدّلة من QT-${parent.quote_no}` : 'إنشاء عرض سعر'}
    >
      {open && <QuoteBuilderBody lead={lead} parent={parent} onDone={onClose} />}
    </Modal>
  );
}

function QuoteBuilderBody({
  lead,
  parent,
  onDone,
}: {
  lead: Lead;
  parent: QuoteRecord | null;
  onDone: () => void;
}) {
  const { fullName } = usePermissions();
  const { data: rules = [], isLoading: rulesLoading } = usePricingRules();
  const { data: cfg } = usePricingConfig();
  const { data: config = [] } = useConfig();
  const { data: workers = [] } = useWorkerProfiles();
  const { data: templates = [] } = useContractTemplates();
  const policy = useQuoteApprovalPolicy();
  const createQuote = useCreateLeadQuote();

  const snapInputs = (parent?.snapshot as { inputs?: Partial<CalcInput> } | null)?.inputs;
  const [service, setService] = useState<ServiceCode>(
    (parent?.service_code as ServiceCode | undefined) ?? lead.service_code ?? 'recruitment',
  );
  const [nationality, setNationality] = useState(parent?.nationality ?? EMPTY_CALC.nationality);
  const [task, setTask] = useState(parent?.profession ?? EMPTY_CALC.profession);
  const [qty, setQty] = useState(String(parent?.quantity ?? 1));
  const [termMonths, setTermMonths] = useState(
    String(parent?.duration_unit === 'month' && !RENTAL_UNIT[service] ? parent.duration_count : 24),
  );
  const [startDate, setStartDate] = useState(parent?.start_date ?? today());
  const [workerId, setWorkerId] = useState(parent?.worker_profile_id ?? '');
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [coupon, setCoupon] = useState<string | null>(snapInputs?.couponCode ?? null);
  const [validDays, setValidDays] = useState('');
  const [notes, setNotes] = useState(parent?.notes ?? '');
  const [terms, setTerms] = useState<string[]>(parent?.terms ?? []);
  const [termsTouched, setTermsTouched] = useState(Boolean(parent?.terms?.length));

  const defaultValid = configValue(config, 'quote_validity_days', 7);
  const isDaily = service === 'daily_rental';
  const rentalUnit = RENTAL_UNIT[service] ?? null;
  const quantity = Math.max(Number(qty) || 0, 0);
  const durationUnit = rentalUnit ?? 'month';
  const durationCount = rentalUnit ? quantity : Number(termMonths);
  const endDate =
    startDate && durationCount > 0 ? computeEndDate(startDate, durationUnit, durationCount) : '';

  const nationalityWorkers = useMemo(
    () => workers.filter((w) => isDaily || w.nationality === nationality),
    [workers, nationality, isDaily],
  );
  const worker = workers.find((w) => w.id === workerId) ?? null;

  const calc: CalcInput = {
    ...EMPTY_CALC,
    service,
    nationality,
    profession: task,
    quantity,
    promotion,
    couponCode: coupon,
  };
  const result = useMemo(
    () => (cfg ? calculate(calc, rules, cfg) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [service, nationality, task, quantity, promotion, coupon, rules, cfg],
  );

  // default terms = the active contract template of the service, rendered
  const template = templates.find((t) => t.service_code === service && t.is_active);
  useEffect(() => {
    if (termsTouched || !template) return;
    setTerms(
      renderClauses(template.clauses, {
        customer_name: lead.full_name,
        nationality: worker?.nationality ?? nationality,
        profession: task,
        task,
        duration: String(durationCount || '—'),
        days: String(quantity),
        monthly: '—',
        start_date: startDate || '—',
        total: result ? sar(result.detail.total) : '—',
      }),
    );
  }, [
    template,
    termsTouched,
    lead.full_name,
    worker,
    nationality,
    task,
    durationCount,
    quantity,
    startDate,
    result,
  ]);

  const needsApproval =
    !!result &&
    quoteNeedsApproval(
      {
        gross_amount: result.detail.base,
        base_amount: result.detail.net,
        discount_amount: result.detail.discounts,
        approved_at: null,
      },
      policy.thresholdPct,
    );
  const validNum = Number(validDays || defaultValid);
  const blocker = !result
    ? 'جارٍ تحميل قائمة الأسعار…'
    : (result.blockers[0] ??
      (quantity < 1
        ? 'العدد يجب أن يكون 1 على الأقل'
        : !startDate
          ? 'حدّد تاريخ بداية الخدمة'
          : !Number.isInteger(validNum) || validNum < 1 || validNum > 90
            ? 'صلاحية العرض بين 1 و90 يومًا'
            : null));

  function save() {
    if (!cfg || blocker) return;
    createQuote.mutate(
      {
        input: {
          lead,
          calc,
          valid_days: validNum,
          notes: notes.trim() || null,
          parent_id: parent?.id ?? null,
          extra: {
            worker_profile_id: worker?.id ?? null,
            worker_name: worker?.full_name ?? null,
            start_date: startDate,
            duration_unit: durationUnit,
            duration_count: durationCount,
            end_date: endDate || null,
            terms: terms.map((t) => t.trim()).filter(Boolean),
          },
        },
        rules,
        cfg,
        actor: fullName,
      },
      { onSuccess: onDone },
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-navy-50/60 p-3 text-sm">
        <div className="text-xs text-purple">العميل</div>
        <div className="font-bold text-navy">{lead.full_name}</div>
        <div className="num text-xs text-purple">{lead.phone ?? '—'}</div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Select
          label="نوع الخدمة"
          options={SERVICE_OPTS}
          value={service}
          onChange={(e) => {
            setService(e.target.value as ServiceCode);
            setTermsTouched(false);
          }}
        />
        {isDaily ? (
          <Select
            label="المهمة"
            options={TASK_OPTS}
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
        ) : (
          <Select
            label="الجنسية"
            options={NAT_OPTS}
            value={nationality}
            onChange={(e) => {
              setNationality(e.target.value);
              setWorkerId('');
            }}
          />
        )}
        <Select
          label="العاملة المرشّحة (اختياري)"
          options={[
            { value: '', label: 'بدون تحديد' },
            ...nationalityWorkers.map((w) => ({
              value: w.id,
              label: `${w.full_name} — ${w.profession}`,
            })),
          ]}
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
        />
        <Input
          label={QTY_LABEL[service]}
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Input
          label="تاريخ بداية الخدمة"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        {rentalUnit ? (
          <div className="rounded-xl border border-navy-100 px-3 py-2 text-sm">
            <div className="text-xs text-purple">تاريخ النهاية (محسوب)</div>
            <div className="num font-medium text-navy">{endDate || '—'}</div>
          </div>
        ) : (
          <Select
            label="مدة العقد"
            options={TERM_OPTS}
            value={termMonths}
            onChange={(e) => setTermMonths(e.target.value)}
          />
        )}
      </section>

      {result && (
        <PromotionPicker
          service={service}
          base={result.base}
          floor={result.floor}
          value={promotion}
          code={coupon}
          onChange={(p, code) => {
            setPromotion(p);
            setCoupon(code);
          }}
        />
      )}

      <section className="rounded-xl border border-navy-100 p-3">
        <h3 className="mb-2 text-sm font-bold text-navy">ملخص السعر</h3>
        {rulesLoading || !result ? (
          <div className="text-sm text-purple">جارٍ تحميل قائمة الأسعار…</div>
        ) : (
          <dl className="space-y-1 text-sm">
            {result.lines.map((l) => (
              <div key={l.key} className="flex justify-between gap-3">
                <dt className="text-navy/80">
                  {l.label}
                  {l.hint && <span className="ms-1 text-xs text-purple">({l.hint})</span>}
                </dt>
                <dd className={`num ${l.amount < 0 ? 'text-red-600' : ''}`}>{sar(l.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-navy-50 pt-1">
              <dt>الخاضع للضريبة</dt>
              <dd className="num">{sar(result.detail.net)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>ضريبة القيمة المضافة</dt>
              <dd className="num">{sar(result.detail.vat)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-base font-bold text-navy">
              <dt>الإجمالي شامل الضريبة</dt>
              <dd className="num">{sar(result.detail.total)} ر.س</dd>
            </div>
          </dl>
        )}
        {needsApproval && (
          <p className="mt-2 rounded-lg bg-teal-100 px-3 py-2 text-xs text-teal">
            الخصم يتجاوز {policy.thresholdPct}٪ — سيحتاج العرض اعتماد مدير الفرع قبل إرساله للعميل.
          </p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-navy">الشروط والأحكام</h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTerms((t) => [...t, '']);
              setTermsTouched(true);
            }}
          >
            <Plus size={14} /> بند
          </Button>
        </div>
        {terms.length === 0 ? (
          <p className="text-xs text-purple">
            لا توجد بنود — أضف بندًا أو اختر خدمة لها نموذج عقد.
          </p>
        ) : (
          <ol className="space-y-2">
            {terms.map((t, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="num mt-2 text-xs text-purple">{i + 1}</span>
                <textarea
                  className="min-h-[2.5rem] flex-1 rounded-xl border border-navy-100 px-3 py-2 text-sm focus:border-navy focus:outline-none"
                  value={t}
                  aria-label={`البند ${i + 1}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTerms((all) => all.map((x, j) => (j === i ? v : x)));
                    setTermsTouched(true);
                  }}
                />
                <button
                  type="button"
                  className="mt-2 text-red-600"
                  aria-label={`حذف البند ${i + 1}`}
                  onClick={() => {
                    setTerms((all) => all.filter((_, j) => j !== i));
                    setTermsTouched(true);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Input
          label="صلاحية العرض (أيام)"
          type="number"
          min={1}
          max={90}
          placeholder={String(defaultValid)}
          value={validDays}
          onChange={(e) => setValidDays(e.target.value)}
        />
        <Input label="ملاحظات للعميل" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>

      {blocker && !rulesLoading && result && <p className="text-sm text-red-600">{blocker}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          إلغاء
        </Button>
        <Button disabled={Boolean(blocker)} loading={createQuote.isPending} onClick={save}>
          حفظ عرض السعر
        </Button>
      </div>
    </div>
  );
}
