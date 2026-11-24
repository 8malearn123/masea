import { useState } from 'react';
import { z } from 'zod';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { useServices } from '@/hooks/useServices';
import { prizeActivationError } from '@/features/marketing/api/wheel.api';
import { useAddWheelPrize, useUpdateWheelPrize } from '@/features/loyalty/hooks/useLoyalty';
import { PRIZE_TYPE_LABEL, type PrizeType, type WheelPrize } from '@/features/loyalty/types';

const PRIZE_TYPE_OPTS = (Object.entries(PRIZE_TYPE_LABEL) as [PrizeType, string][]).map(
  ([value, label]) => ({ value, label }),
);

const schema = z.object({
  label: z.string().trim().min(2, 'اسم الجائزة قصير جداً'),
  prize_type: z.enum(['points', 'wallet', 'discount', 'free_service', 'none']),
  value: z.number().min(0, 'القيمة غير صالحة'),
  probability: z.number().min(0, 'النسبة غير صالحة').max(100, 'النسبة لا تتجاوز 100'),
  active: z.boolean(),
  coupon_code: z.string().nullable(),
  service_codes: z.array(z.string()),
  max_discount_amount: z.number().positive('الحد الأعلى أكبر من صفر').nullable(),
  coupon_valid_days: z.number().int().min(1, 'صلاحية يوم على الأقل').max(365).nullable(),
  usage_limit: z.number().int().min(1, 'مرة واحدة على الأقل').max(100),
  max_awards: z.number().int().positive('العدد الأقصى أكبر من صفر').nullable(),
  terms: z.string().nullable(),
});

/** جوائز تُستخدم على عقد (لها خدمات وحد وصلاحية وعدد استخدام). */
const DEFINED_TYPES: PrizeType[] = ['discount', 'free_service'];

export function WheelPrizeFormModal({
  prize,
  open,
  onClose,
}: {
  prize: WheelPrize | null;
  open: boolean;
  onClose: () => void;
}) {
  const add = useAddWheelPrize();
  const update = useUpdateWheelPrize();
  const editing = Boolean(prize);

  const [label, setLabel] = useState(prize?.label ?? '');
  const [prizeType, setPrizeType] = useState<PrizeType>(prize?.prize_type ?? 'points');
  const [value, setValue] = useState(String(prize?.value ?? 0));
  const [probability, setProbability] = useState(String(prize?.probability ?? 10));
  const [active, setActive] = useState(prize?.active ?? true);
  const [usageLimit, setUsageLimit] = useState(String(prize?.usage_limit ?? 1));
  const [maxAwards, setMaxAwards] = useState(
    prize?.max_awards == null ? '' : String(prize.max_awards),
  );
  const [terms, setTerms] = useState(prize?.terms ?? '');
  const [error, setError] = useState<string | null>(null);

  const [services, setServices] = useState<string[]>(prize?.service_codes ?? []);
  const [maxAmount, setMaxAmount] = useState(
    prize?.max_discount_amount == null ? '' : String(prize.max_discount_amount),
  );
  const [validDays, setValidDays] = useState(
    prize?.coupon_valid_days == null ? '30' : String(prize.coupon_valid_days),
  );
  const { data: serviceList = [] } = useServices();
  const busy = add.isPending || update.isPending;
  const defined = DEFINED_TYPES.includes(prizeType);

  function submit() {
    const parsed = schema.safeParse({
      label: label.trim(),
      prize_type: prizeType,
      value: Number(value) || 0,
      probability: Number(probability) || 0,
      active,
      coupon_code: prize?.coupon_code ?? null,
      service_codes: services,
      max_discount_amount: maxAmount.trim() === '' ? null : Number(maxAmount),
      coupon_valid_days: validDays.trim() === '' ? null : Number(validDays),
      usage_limit: Number(usageLimit) || 0,
      max_awards: maxAwards.trim() === '' ? null : Number(maxAwards),
      terms: terms.trim() || null,
    });
    const rule = parsed.success ? prizeActivationError(parsed.data) : null;
    if (rule) {
      setError(rule);
      return;
    }
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'تحقّق من الحقول');
      return;
    }
    setError(null);
    if (editing && prize) {
      update.mutate({ id: prize.id, patch: parsed.data }, { onSuccess: onClose });
    } else {
      add.mutate(parsed.data, { onSuccess: onClose });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'تعديل جائزة' : 'جائزة جديدة'}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-navy-900">اسم الجائزة</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="مثال: خصم 15٪"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">النوع</label>
            <Select
              value={prizeType}
              onChange={(e) => setPrizeType(e.target.value as PrizeType)}
              options={PRIZE_TYPE_OPTS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">
              القيمة (نقاط/ريال/نسبة)
            </label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="numeric"
              disabled={prizeType === 'none'}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">
              احتمال الظهور (٪)
            </label>
            <Input
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-navy">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 accent-navy"
              />
              مفعّلة على العجلة
            </label>
          </div>
        </div>

        {defined && (
          <div className="space-y-3 rounded-xl border border-navy-100 p-3">
            <p className="text-[11px] text-purple">
              لا تُفعَّل الجائزة قبل اعتماد تعريفها: الخدمات المشمولة
              {prizeType === 'discount'
                ? ' والحد الأعلى للخصم بالريال'
                : '، والتعريف والشروط، ومدة الصلاحية'}
              . يُصدر لكل فائز مرجع خاص به.
            </p>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-navy-900">الخدمات المشمولة</legend>
              <div className="flex flex-wrap gap-3">
                {serviceList.map((sv) => (
                  <label key={sv.code} className="flex items-center gap-1.5 text-sm text-navy">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-navy"
                      checked={services.includes(sv.code)}
                      onChange={(e) =>
                        setServices((all) =>
                          e.target.checked ? [...all, sv.code] : all.filter((c) => c !== sv.code),
                        )
                      }
                    />
                    {sv.name_ar}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              {prizeType === 'discount' && (
                <Input
                  label="الحد الأعلى للخصم (ر.س)"
                  inputMode="decimal"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                />
              )}
              <Input
                label="الصلاحية بعد الفوز (يوم)"
                inputMode="numeric"
                value={validDays}
                onChange={(e) => setValidDays(e.target.value)}
              />
              <Input
                label="عدد مرات الاستخدام"
                inputMode="numeric"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
              />
            </div>
          </div>
        )}
        <Input
          label="العدد الأقصى للجوائز (اتركه فارغاً بلا حد)"
          inputMode="numeric"
          value={maxAwards}
          onChange={(e) => setMaxAwards(e.target.value)}
        />
        <div>
          <label className="mb-1 block text-xs font-medium text-navy-900">
            تعريف الجائزة وشروطها (تظهر للعميل)
          </label>
          <textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none"
            placeholder="تكتبها الإدارة كما اعتمدتها — لا شروط افتراضية"
          />
        </div>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {editing ? 'حفظ' : 'إضافة'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
