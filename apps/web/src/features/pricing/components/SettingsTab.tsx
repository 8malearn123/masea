import { useEffect, useState } from 'react';
import { Ban, Clock, Lock, Percent, Receipt, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Card, InfoTip, Input, Modal } from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import type { PricingConfig } from '@/shared/lib/pricing';
import {
  usePricingConfigMeta,
  useUpdatePricingConfig,
} from '@/features/pricing/hooks/usePricingRules';
import { SectionTitle } from '@/features/pricing/components/shared';

type Field = {
  key: keyof PricingConfig;
  label: string;
  suffix: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  pct?: boolean;
};
const LABEL: Record<keyof PricingConfig, string> = {
  vat_rate: 'معدل الضريبة',
  late_grace_days: 'مهلة السماح',
  late_daily_pct: 'الغرامة اليومية',
  late_max_pct: 'الحد الأقصى للغرامة',
  cancellation_pct: 'رسوم الإلغاء',
  absence_per_day: 'تعويض الغياب',
  absence_max_days: 'الحد الأقصى لأيام التعويض',
};

/**
 * إعدادات التسعير — the existing pricing_config values only, grouped. No new
 * financial settings are introduced; behaviours without a setting are shown
 * read-only so nobody mistakes them for configurable.
 */
export function SettingsTab({ cfg }: { cfg: PricingConfig }) {
  const { can, fullName } = usePermissions();
  const editable = can('pricing', 'manage');
  const { data: meta } = usePricingConfigMeta();
  const update = useUpdatePricingConfig();
  // VAT is edited as a percentage in the UI, stored as a fraction (0.15)
  const toForm = (c: PricingConfig) => ({ ...c, vat_rate: Math.round(c.vat_rate * 10000) / 100 });
  const [form, setForm] = useState<PricingConfig>(toForm(cfg));
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setForm(toForm(cfg)), [cfg]);

  const next: PricingConfig = { ...form, vat_rate: form.vat_rate / 100 };
  const changed = (Object.keys(cfg) as (keyof PricingConfig)[]).filter(
    (k) => Math.abs(Number(next[k]) - Number(cfg[k])) > 1e-9,
  );
  const errors = validate(form);
  const set = (k: keyof PricingConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.valueAsNumber }));
  const field = (f: Field) => (
    <Input
      key={f.key}
      label={f.label}
      type="number"
      min={f.min ?? 0}
      {...(f.max != null ? { max: f.max } : {})}
      step={f.step ?? 1}
      suffix={f.suffix}
      value={Number.isFinite(form[f.key]) ? form[f.key] : ''}
      onChange={set(f.key)}
      disabled={!editable}
      error={errors[f.key]}
      hint={f.hint}
    />
  );

  return (
    <div>
      <SectionTitle
        title="إعدادات التسعير"
        desc="القيم المعتمدة في حساب الأسعار (calc_price). أي تعديل يسري على الحسابات القادمة فقط ولا يغير العروض أو العقود السابقة."
      />
      <p className="mb-4 text-xs text-purple">
        آخر تعديل:{' '}
        {meta?.updated_at ? (
          <>
            {dateTimeAr(meta.updated_at)} — {meta.updated_by ?? 'غير معروف'}
          </>
        ) : (
          'لم يُسجل بعد (يبدأ التتبّع مع هذا الإصدار)'
        )}
        {!editable && (
          <span className="mr-2 inline-flex items-center gap-1 text-amber-700">
            <Lock size={12} /> للعرض فقط — التعديل لمن يملك صلاحية إدارة التسعير
          </span>
        )}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Group icon={Receipt} title="الإعدادات الضريبية">
          {field({
            key: 'vat_rate',
            label: LABEL.vat_rate,
            suffix: '٪',
            step: 0.01,
            max: 100,
            hint: 'تُحسب على الصافي بعد الخصومات والرسوم',
          })}
          <ReadOnly
            label="طريقة احتساب الضريبة"
            value="على الصافي (الأساسي − الخصومات + الغرامات والرسوم)"
            tip="سلوك ثابت في calc_price؛ لا يوجد إعداد لتغييره."
          />
          <ReadOnly label="التقريب" value="لأقرب هللة (منزلتان عشريتان) في كل مرحلة" />
        </Group>
        <Group icon={Clock} title="التأخير والغرامات">
          {field({
            key: 'late_grace_days',
            label: LABEL.late_grace_days,
            suffix: 'يوم',
            hint: 'لا غرامة خلالها',
          })}
          {field({
            key: 'late_daily_pct',
            label: LABEL.late_daily_pct,
            suffix: '٪',
            step: 0.1,
            max: 100,
            hint: 'من السعر الأساسي لكل يوم تأخر',
          })}
          {field({
            key: 'late_max_pct',
            label: LABEL.late_max_pct,
            suffix: '٪',
            step: 0.1,
            max: 100,
          })}
        </Group>
        <Group icon={Ban} title="الإلغاء والتعويضات">
          {field({
            key: 'cancellation_pct',
            label: LABEL.cancellation_pct,
            suffix: '٪',
            step: 0.1,
            max: 100,
            hint: 'عند الإلغاء بعد المباشرة، من السعر الأساسي',
          })}
          {field({ key: 'absence_per_day', label: LABEL.absence_per_day, suffix: 'ر.س/يوم' })}
          {field({ key: 'absence_max_days', label: LABEL.absence_max_days, suffix: 'يوم' })}
        </Group>
        <Group icon={Percent} title="سياسات الخصومات">
          <ReadOnly
            label="الحد الأدنى للسعر"
            value="لكل قاعدة سعر على حدة — يُدار من «قائمة الأسعار»"
          />
          <ReadOnly
            label="مصدر الخصم"
            value="من الخصومات المعتمدة أو كوبون برمزه فقط — لا خصم مفتوح"
          />
          <ReadOnly
            label="دمج الخصومات"
            value="غير مسموح — خصم واحد في كل حساب"
            tip="لم تُحدد قاعدة تجارية للدمج؛ لا يُضاف إعداد له قبل ذلك."
          />
          <ReadOnly
            label="الحد الأعلى للخصم / اعتماد الاستثناءات"
            value="غير مُعرّف حاليًا"
            tip="سقف الخصم يُحدد لكل خصم في «الخصومات والكوبونات». صلاحيات الاستثناء تحتاج قاعدة تجارية قبل إضافتها."
          />
        </Group>
      </div>
      {editable && (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-navy-100 bg-white/95 px-4 py-3 shadow-card backdrop-blur">
          <span className="text-xs text-purple">
            {changed.length ? `${changed.length} تغيير غير محفوظ` : 'لا تغييرات'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={!changed.length} onClick={() => setForm(toForm(cfg))}>
              <RotateCcw size={15} /> إلغاء
            </Button>
            <Button
              disabled={!changed.length || Object.keys(errors).length > 0}
              onClick={() => setConfirm(true)}
            >
              <Save size={15} /> حفظ التغييرات
            </Button>
          </div>
        </div>
      )}
      {confirm && (
        <Modal open onClose={() => setConfirm(false)} title="تأكيد تعديل إعدادات التسعير">
          <div className="space-y-3 text-sm">
            <p className="flex items-start gap-1.5 text-purple">
              <ShieldCheck size={15} className="mt-0.5 shrink-0" /> هذه القيم تؤثر على كل الحسابات
              القادمة. العروض والعقود السابقة لا تتغير.
            </p>
            <ul className="space-y-1 rounded-xl bg-navy-50 p-3 text-xs">
              {changed.map((k) => (
                <li key={k} className="flex justify-between gap-2">
                  <span>{LABEL[k]}</span>
                  <span className="num">
                    {fmt(k, cfg[k])} ← <strong>{fmt(k, next[k])}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                loading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { cfg: next, actor: fullName },
                    { onSuccess: () => setConfirm(false) },
                  )
                }
              >
                تأكيد الحفظ
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const fmt = (k: keyof PricingConfig, v: number) =>
  k === 'vat_rate' ? `${Math.round(v * 10000) / 100}٪` : String(v);

function validate(f: PricingConfig): Partial<Record<keyof PricingConfig, string>> {
  const e: Partial<Record<keyof PricingConfig, string>> = {};
  for (const k of Object.keys(f) as (keyof PricingConfig)[]) {
    const v = f[k];
    if (!Number.isFinite(v) || v < 0) e[k] = 'قيمة غير سالبة مطلوبة';
  }
  for (const k of ['vat_rate', 'late_daily_pct', 'late_max_pct', 'cancellation_pct'] as const)
    if (!e[k] && f[k] > 100) e[k] = 'لا تتجاوز 100٪';
  for (const k of ['late_grace_days', 'absence_max_days'] as const)
    if (!e[k] && !Number.isInteger(f[k])) e[k] = 'عدد أيام صحيح';
  if (!e.late_max_pct && f.late_max_pct < f.late_daily_pct)
    e.late_max_pct = 'الحد الأقصى أقل من الغرامة اليومية';
  return e;
}

function Group({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <Icon size={16} /> {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function ReadOnly({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="sm:col-span-2">
      <p className="mb-1 flex items-center gap-1 text-sm font-medium text-navy-900">
        {label} {tip && <InfoTip text={tip} />}
      </p>
      <p className="rounded-xl bg-navy-50/70 px-3.5 py-2.5 text-xs text-purple">{value}</p>
    </div>
  );
}
