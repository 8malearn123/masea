import { useState } from 'react';
import { z } from 'zod';
import { Ticket } from 'lucide-react';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { useServices } from '@/hooks/useServices';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { prizeRuleError } from '@/features/marketing/api/wheel.api';
import { useAddWheelPrize, useUpdateWheelPrize } from '@/features/loyalty/hooks/useLoyalty';
import { generateCouponCode } from '@/features/loyalty/data/engine';
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
});

/** أنواع تستفيد من كوبون مباشر. */
const COUPON_TYPES: PrizeType[] = ['discount', 'free_service', 'wallet'];

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
  const [coupon, setCoupon] = useState(prize?.coupon_code ?? '');
  const [error, setError] = useState<string | null>(null);

  const [services, setServices] = useState<string[]>(prize?.service_codes ?? []);
  const [maxAmount, setMaxAmount] = useState(
    prize?.max_discount_amount == null ? '' : String(prize.max_discount_amount),
  );
  const [validDays, setValidDays] = useState(
    prize?.coupon_valid_days == null ? '30' : String(prize.coupon_valid_days),
  );
  const { data: serviceList = [] } = useServices();
  const { data: config = [] } = useConfig();
  const openMax = configValue(config, 'wheel_open_discount_max_pct', 10);
  const busy = add.isPending || update.isPending;
  const canCoupon = COUPON_TYPES.includes(prizeType);

  function submit() {
    const parsed = schema.safeParse({
      label: label.trim(),
      prize_type: prizeType,
      value: Number(value) || 0,
      probability: Number(probability) || 0,
      active,
      coupon_code: coupon.trim() ? coupon.trim() : null,
      service_codes: services,
      max_discount_amount: maxAmount.trim() === '' ? null : Number(maxAmount),
      coupon_valid_days: validDays.trim() === '' ? null : Number(validDays),
    });
    const rule = parsed.success ? prizeRuleError(parsed.data, openMax) : null;
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

        {canCoupon && (
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">كود الكوبون</label>
            <div className="flex gap-2">
              <Input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="MAS-DISC15-XXXX"
                className="num"
              />
              <Button
                variant="outline"
                onClick={() => setCoupon(generateCouponCode(prizeType, Number(value) || 0))}
              >
                <Ticket size={15} /> توليد
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-purple">
              يُبنى الكوبون مباشرة ويُمنح للعميل عند فوزه بهذه الجائزة.
            </p>
          </div>
        )}

        {prizeType === 'discount' && (
          <div className="space-y-3 rounded-xl border border-navy-100 p-3">
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-navy-900">
                الخدمات المشمولة (إلزامي لخصم أكبر من {openMax}٪)
              </legend>
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
              <Input
                label="الحد الأعلى للخصم (ر.س)"
                inputMode="decimal"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
              />
              <Input
                label="صلاحية الكوبون (يوم)"
                inputMode="numeric"
                value={validDays}
                onChange={(e) => setValidDays(e.target.value)}
              />
            </div>
          </div>
        )}
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
