import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Button, Card, Drawer, InfoTip, Input, Select } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useCustomerSearch } from '@/features/contracts/hooks/useCustomers';
import type { ServiceCode } from '@/lib/funnel';
import type { PricingConfig } from '@/shared/lib/pricing';
import { PromotionPicker } from '@/features/pricing/components/PromotionPicker';
import {
  calculate,
  EMPTY_CALC,
  priceArgsOf,
  validateCalc,
  type CalcInput,
  type CalcResult,
} from '@/features/pricing/lib/engine';
import { validateQuoteMeta } from '@/features/pricing/api/quotes.api';
import { useCreateQuote } from '@/features/pricing/hooks/useQuotes';
import { PRICING_SERVICE_LABEL, UNIT_LABEL, type PricingRule } from '@/features/pricing/types';
import { Money } from '@/features/pricing/components/shared';

const SERVICES = Object.entries(PRICING_SERVICE_LABEL).map(([value, label]) => ({ value, label }));
const QTY_LABEL: Record<string, { label: string; suffix: string }> = {
  fixed: { label: 'العدد', suffix: 'عاملة' },
  month: { label: 'المدة', suffix: 'شهر' },
  day: { label: 'المدة', suffix: 'يوم' },
};

/** حاسبة التسعير — preview in the UI, re-validated on quote creation. */
export function CalculatorTab({
  cfg,
  rules,
  onQuoteCreated,
}: {
  cfg: PricingConfig;
  rules: PricingRule[];
  onQuoteCreated: () => void;
}) {
  const [i, setI] = useState<CalcInput>(EMPTY_CALC);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const set = (p: Partial<CalcInput>) => setI((x) => ({ ...x, ...p }));
  const errors = validateCalc(i);
  const r = useMemo(() => calculate(i, rules, cfg), [i, rules, cfg]);

  const isDaily = i.service === 'daily_rental';
  // options come from the ACTIVE price list (only priced combinations)
  const keyOptions = useMemo(() => {
    const vals = rules
      .filter((x) => x.is_active && x.service_code === i.service)
      .map((x) => (isDaily ? x.profession : x.nationality))
      .filter((v): v is string => !!v);
    return [...new Set(vals)];
  }, [rules, i.service, isDaily]);
  const unit =
    r.rule?.duration_unit ?? (isDaily ? 'day' : i.service === 'monthly_rental' ? 'month' : 'fixed');
  const qty = QTY_LABEL[unit] ?? QTY_LABEL.fixed!;

  function changeService(s: ServiceCode) {
    const first = rules.find((x) => x.is_active && x.service_code === s);
    setI({
      ...EMPTY_CALC,
      service: s,
      nationality: first?.nationality ?? '',
      profession: first?.profession ?? EMPTY_CALC.profession,
    });
  }

  return (
    <div className="grid gap-5 pb-24 lg:grid-cols-[minmax(0,1fr)_380px] lg:pb-0">
      {/* inputs */}
      <div className="space-y-4">
        <Group title="تفاصيل الخدمة" step={1}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="نوع الخدمة"
              value={i.service}
              onChange={(e) => changeService(e.target.value as ServiceCode)}
              options={SERVICES}
            />
            {keyOptions.length > 0 && (
              <Select
                label={isDaily ? 'المهنة / نوع المهمة' : 'الجنسية'}
                value={isDaily ? i.profession : i.nationality}
                onChange={(e) =>
                  set(isDaily ? { profession: e.target.value } : { nationality: e.target.value })
                }
                options={keyOptions.map((v) => ({ value: v, label: v }))}
              />
            )}
            <Input
              label={qty.label}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              suffix={qty.suffix}
              value={Number.isFinite(i.quantity) ? i.quantity : ''}
              onChange={(e) => set({ quantity: e.target.valueAsNumber })}
              error={errors.quantity}
              hint={
                r.rule
                  ? `سعر الوحدة ${sar(r.unitPrice)} ر.س (${UNIT_LABEL[unit] ?? unit})`
                  : undefined
              }
            />
          </div>
          {!r.rule && (
            <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} /> لا توجد قاعدة سعر نشطة لهذا الاختيار — أضفها من «قائمة
              الأسعار».
            </p>
          )}
        </Group>

        <Group title="الرسوم والتعويضات" step={2}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="أيام تأخر السداد"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              suffix="يوم"
              value={Number.isFinite(i.lateDays) ? i.lateDays : ''}
              onChange={(e) => set({ lateDays: e.target.valueAsNumber })}
              error={errors.lateDays}
              hint={`مهلة سماح ${cfg.late_grace_days} أيام · ${cfg.late_daily_pct}٪ يوميًا بحد ${cfg.late_max_pct}٪`}
            />
            <Input
              label="أيام غياب العاملة"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              suffix="يوم"
              value={Number.isFinite(i.absenceDays) ? i.absenceDays : ''}
              onChange={(e) => set({ absenceDays: e.target.valueAsNumber })}
              error={errors.absenceDays}
              hint={`تعويض ${cfg.absence_per_day} ر.س/يوم بحد ${cfg.absence_max_days} أيام`}
            />
          </div>
          <label className="mt-3 flex items-start gap-2 rounded-xl border border-navy-100 px-3 py-2.5 text-sm text-navy-900">
            <input
              type="checkbox"
              checked={i.cancelled}
              onChange={(e) => set({ cancelled: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-navy-100"
            />
            <span>
              إلغاء العقد بعد المباشرة
              <span className="block text-[11px] text-purple">
                تُضاف رسوم {cfg.cancellation_pct}٪ من السعر الأساسي (من الإعدادات)
              </span>
            </span>
          </label>
        </Group>

        <Group title="الخصومات والكوبونات" step={3}>
          <PromotionPicker
            service={i.service}
            base={r.base}
            floor={r.floor}
            value={i.promotion}
            code={i.couponCode}
            onChange={(p, code) => set({ promotion: p, couponCode: code })}
          />
          <p className="mt-2 text-[11px] text-purple">
            لا يوجد خصم مفتوح: الخصم من القائمة المعتمدة أو كوبون برمزه، ويُتحقّق من شروطه في الخادم
            عند إنشاء العرض.
          </p>
        </Group>
      </div>

      {/* summary */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <SummaryCard
          r={r}
          cfg={cfg}
          onReset={() => setI(EMPTY_CALC)}
          onQuote={() => setQuoteOpen(true)}
        />
      </div>

      {/* mobile quick bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-navy-100 bg-white px-4 py-3 shadow-[0_-2px_8px_rgba(31,88,168,0.08)] lg:hidden">
        <div>
          <p className="text-[11px] text-purple">الإجمالي شامل الضريبة</p>
          <Money v={r.detail.total} strong className="text-lg text-navy" />
        </div>
        <Button onClick={() => setQuoteOpen(true)} disabled={r.blockers.length > 0}>
          <FileText size={15} /> إنشاء عرض سعر
        </Button>
      </div>

      {quoteOpen && (
        <QuoteDrawer
          input={i}
          result={r}
          cfg={cfg}
          rules={rules}
          onClose={() => setQuoteOpen(false)}
          onCreated={onQuoteCreated}
        />
      )}
    </div>
  );
}

function Group({
  title,
  step,
  children,
}: {
  title: string;
  step: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <span className="num grid h-6 w-6 place-items-center rounded-full bg-navy-50 text-xs">
          {step}
        </span>
        {title}
      </h3>
      {children}
    </Card>
  );
}

function SummaryCard({
  r,
  cfg,
  onReset,
  onQuote,
}: {
  r: CalcResult;
  cfg: PricingConfig;
  onReset: () => void;
  onQuote: () => void;
}) {
  const d = r.detail;
  return (
    <Card className="space-y-3" aria-live="polite">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-navy">ملخص السعر</h3>
        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal">
          معاينة فورية
        </span>
      </div>
      <dl className="space-y-2 text-sm">
        {r.lines.map((l) => (
          <div key={l.key} className="flex items-start justify-between gap-3">
            <dt className="text-navy-900">
              {l.label}
              {l.hint && (
                <span
                  className={`block text-[11px] ${l.key === 'promo' && r.promotion && !r.promotion.ok ? 'text-red-600' : 'text-purple'}`}
                >
                  {l.hint}
                </span>
              )}
            </dt>
            <dd>
              <Money
                v={l.amount}
                className={
                  l.amount < 0
                    ? '!text-green-700'
                    : l.key === 'base'
                      ? 'text-navy-900'
                      : 'text-amber-700'
                }
              />
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-dashed border-navy-100 pt-2">
          <dt className="flex items-center gap-1 text-navy-900">
            المبلغ الخاضع للضريبة{' '}
            <InfoTip text="الصافي بعد الخصومات والتعويضات وإضافة الغرامات والرسوم — تُحسب عليه ضريبة القيمة المضافة كما يفعل الخادم (calc_price)." />
          </dt>
          <dd>
            <Money v={d.net} className="text-navy-900" />
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-navy-900">
            ضريبة القيمة المضافة ({Math.round(cfg.vat_rate * 100)}٪)
          </dt>
          <dd>
            <Money v={d.vat} className="text-navy-900" />
          </dd>
        </div>
      </dl>
      <div className="rounded-2xl bg-navy-50 px-4 py-3">
        <p className="text-xs text-purple">الإجمالي النهائي شامل الضريبة</p>
        <p className="num text-3xl font-bold text-navy">
          {sar(d.total)} <span className="text-base font-semibold">ر.س</span>
        </p>
      </div>
      {r.floor > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-purple">
          <ShieldCheck size={13} /> الحد الأدنى للسعر قبل الضريبة:{' '}
          <span className="num">{sar(r.floor)}</span> ر.س
          {r.floorApplied ? ' — تم تقييد الخصم به' : ''}
        </p>
      )}
      <details className="text-[11px] text-purple">
        <summary className="cursor-pointer select-none font-medium text-navy">
          ترتيب الحساب المعتمد
        </summary>
        <ol className="mt-1.5 list-inside list-decimal space-y-0.5 leading-relaxed">
          <li>السعر الأساسي × الكمية/المدة من قائمة الأسعار.</li>
          <li>− الخصم المعتمد/الكوبون + تعويض الغياب، بحيث لا ينزل السعر عن الحد الأدنى.</li>
          <li>+ غرامة التأخر (بعد المهلة وبحد أقصى) + رسوم الإلغاء.</li>
          <li>
            = الصافي؛ وعليه تُحسب الضريبة. لا تُفترض رسوم معفاة: كل البنود أعلاه ضمن الوعاء وفق
            calc_price الحالي.
          </li>
        </ol>
      </details>
      {r.blockers.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          {r.blockers.map((b) => (
            <li key={b} className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      )}
      <div className="hidden gap-2 lg:flex">
        <Button className="flex-1" onClick={onQuote} disabled={r.blockers.length > 0}>
          <FileText size={15} /> إنشاء عرض سعر
        </Button>
        <Button variant="outline" onClick={onReset}>
          <RotateCcw size={15} /> إعادة تعيين
        </Button>
      </div>
      <Button variant="ghost" className="w-full lg:hidden" onClick={onReset}>
        <RotateCcw size={15} /> إعادة تعيين
      </Button>
    </Card>
  );
}

function QuoteDrawer({
  input,
  result,
  cfg,
  rules,
  onClose,
  onCreated,
}: {
  input: CalcInput;
  result: CalcResult;
  cfg: PricingConfig;
  rules: PricingRule[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { fullName, can } = usePermissions();
  const create = useCreateQuote();
  const { data: customers = [] } = useCustomerSearch('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [days, setDays] = useState(7);
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const metaErrors = validateQuoteMeta({
    customer_name: name,
    customer_phone: phone || null,
    valid_days: days,
  });
  const allowed = can('pricing', 'create') || can('leads', 'create');
  const args = priceArgsOf(input);

  function submit() {
    setTouched(true);
    if (metaErrors.length || result.blockers.length) return;
    create.mutate(
      {
        input: {
          calc: input,
          customer_name: name,
          customer_phone: phone || null,
          valid_days: days,
          notes: notes.trim() || null,
        },
        rules,
        cfg,
        actor: fullName,
      },
      {
        onSuccess: () => {
          onClose();
          onCreated();
        },
      },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="إنشاء عرض سعر"
      subtitle={`${PRICING_SERVICE_LABEL[input.service] ?? input.service} · ${args.nationality ?? args.profession ?? ''} · ${args.quantity}`}
      footer={
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={submit}
            disabled={!allowed || create.isPending || result.blockers.length > 0}
          >
            {create.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <CheckCircle2 size={15} />
            )}
            {create.isPending ? 'جارٍ التحقق من الخادم…' : 'حفظ عرض السعر'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl bg-navy-50 p-4">
          <p className="text-xs text-purple">الإجمالي شامل الضريبة</p>
          <Money v={result.detail.total} strong className="text-2xl text-navy" />
          <p className="mt-1 text-[11px] text-purple">
            الصافي <span className="num">{sar(result.detail.net)}</span> + ضريبة{' '}
            <span className="num">{sar(result.detail.vat)}</span>
          </p>
        </div>
        <div>
          <Input
            label="اسم العميل"
            list="quote-customers"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              const c = customers.find((x) => x.full_name === e.target.value);
              if (c?.phone) setPhone(c.phone);
            }}
            placeholder="اختر من العملاء أو اكتب الاسم"
          />
          <datalist id="quote-customers">
            {customers.map((c) => (
              <option key={c.id} value={c.full_name} />
            ))}
          </datalist>
        </div>
        <Input
          label="جوال العميل"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="05xxxxxxxx"
          inputMode="tel"
          className="num"
          dir="ltr"
        />
        <Input
          label="صلاحية العرض"
          type="number"
          min={1}
          max={90}
          suffix="يوم"
          value={days}
          onChange={(e) => setDays(e.target.valueAsNumber)}
        />
        <Input
          label="ملاحظات للعميل (اختياري)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {touched && metaErrors.length > 0 && (
          <ul className="space-y-0.5 text-xs text-red-600" role="alert">
            {metaErrors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {!allowed && <p className="text-xs text-red-600">لا تملك صلاحية إنشاء عروض الأسعار.</p>}
        <p className="flex items-start gap-1.5 rounded-xl border border-navy-100 px-3 py-2 text-[11px] leading-relaxed text-purple">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          تُحفظ نسخة ثابتة من الحساب (القاعدة والإعدادات والخصم المطبق) مع العرض؛ تعديل الأسعار
          لاحقًا لا يغيّر هذا العرض.
        </p>
      </div>
    </Drawer>
  );
}
