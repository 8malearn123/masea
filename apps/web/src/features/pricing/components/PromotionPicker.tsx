import { useMemo, useState } from 'react';
import { BadgeCheck, BadgePercent, CircleAlert, Ticket, X } from 'lucide-react';
import { Button, Input, Select } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { evaluatePromotion, findByCode, type Promotion } from '@/shared/lib/pricing';
import { usePromotions } from '@/features/pricing/hooks/usePromotions';

/** Short human label of a discount's value, e.g. «٥٪ (حد ١٬٠٠٠ ر.س)» or «٥٠٠ ر.س». */
export function promotionValueLabel(p: Promotion): string {
  if (p.discount_pct != null) {
    const cap = p.max_discount_amount != null ? ` (حد ${sar(p.max_discount_amount)} ر.س)` : '';
    return `${p.discount_pct}٪${cap}`;
  }
  return `${sar(p.discount_amount ?? 0)} ر.س`;
}

/**
 * Pick a discount — either a PREDEFINED discount from the list, or a COUPON by
 * entering its code. There is no free-typed discount: both resolve to a managed
 * promotion, are checked here for eligibility, and re-validated by the backend.
 */
export function PromotionPicker({
  service,
  base,
  value,
  code,
  onChange,
  disabled,
  floor = 0,
}: {
  service: string;
  base: number;
  value: Promotion | null;
  /** The coupon code the current selection was applied with (null = picked from the list). */
  code?: string | null;
  onChange: (p: Promotion | null, code: string | null) => void;
  disabled?: boolean;
  /** Managed floor — the shown discount is capped so the price never goes below it. */
  floor?: number;
}) {
  const { data: promotions = [], isLoading, isError } = usePromotions();
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  // coupons (requires_code) never appear in the list — only via their code
  const available = useMemo(
    () =>
      promotions.filter(
        (p) =>
          p.is_active &&
          !p.requires_code &&
          (p.service_codes.length === 0 || p.service_codes.includes(service)),
      ),
    [promotions, service],
  );
  const viaCoupon = Boolean(value && code);
  const check = value ? evaluatePromotion(value, service, base, new Date(), code ?? null) : null;
  const applied = check?.ok ? Math.min(check.amount, Math.max(base - floor, 0)) : 0;

  function applyCoupon() {
    const entered = couponInput.trim();
    if (!entered) return;
    const found = findByCode(promotions, entered);
    if (!found) {
      setCouponError('رمز الكوبون غير صحيح');
      return;
    }
    setCouponError(null);
    setCouponInput('');
    onChange(found, entered.toUpperCase());
  }

  return (
    <div className="space-y-3">
      <Select
        label="الخصم (من الخصومات المعتمدة)"
        value={viaCoupon ? '' : (value?.id ?? '')}
        disabled={disabled || isLoading || viaCoupon}
        onChange={(e) => onChange(available.find((p) => p.id === e.target.value) ?? null, null)}
        placeholder={isLoading ? 'جارٍ تحميل الخصومات…' : 'بدون خصم'}
        options={available.map((p) => ({
          value: p.id,
          label: `${p.name} — ${promotionValueLabel(p)}`,
        }))}
      />
      {isError && <p className="text-xs text-red-600">تعذّر تحميل الخصومات المعتمدة.</p>}
      {!isLoading && !isError && available.length === 0 && (
        <p className="flex items-center gap-1 text-[11px] text-purple">
          <BadgePercent size={12} /> لا توجد خصومات معتمدة لهذه الخدمة.
        </p>
      )}

      {viaCoupon && value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-gold-500/30 bg-gold-100/60 px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm text-navy-900">
            <Ticket size={15} className="text-gold-600" />
            كوبون <span className="num font-bold">{code}</span> — {value.name}
          </span>
          <button
            type="button"
            onClick={() => onChange(null, null)}
            aria-label="إزالة الكوبون"
            className="rounded-lg p-1 text-purple hover:bg-white"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="أو كوبون خصم"
                value={couponInput}
                disabled={disabled || isLoading}
                placeholder="أدخل رمز الكوبون"
                className="num uppercase"
                error={couponError ?? undefined}
                onChange={(e) => {
                  setCouponInput(e.target.value);
                  setCouponError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCoupon();
                  }
                }}
              />
            </div>
            <Button
              variant="outline"
              disabled={disabled || isLoading || !couponInput.trim()}
              onClick={applyCoupon}
              className={couponError ? 'mb-5' : ''}
            >
              تطبيق
            </Button>
          </div>
        </div>
      )}

      {check && check.ok && (
        <p className="flex items-center gap-1 text-xs text-green-700">
          <BadgeCheck size={13} /> خصم مؤهَّل: <span className="num">{sar(applied)}</span> ر.س
          {applied < check.amount && <span className="text-purple">(بحد السعر الأدنى للخدمة)</span>}
        </p>
      )}
      {check && !check.ok && (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <CircleAlert size={13} /> لن يُطبَّق: {check.reason}
        </p>
      )}
    </div>
  );
}
