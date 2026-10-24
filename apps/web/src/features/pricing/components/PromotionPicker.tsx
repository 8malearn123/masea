import { useMemo } from 'react';
import { BadgeCheck, BadgePercent, CircleAlert } from 'lucide-react';
import { Select } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { evaluatePromotion, type Promotion } from '@/shared/lib/pricing';
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
 * Select a PREDEFINED discount (no free-typed discount). Lists only active
 * discounts that apply to the service, and shows whether the selected one is
 * eligible for this base amount before it's applied — the backend re-validates.
 */
export function PromotionPicker({
  service,
  base,
  value,
  onChange,
  disabled,
}: {
  service: string;
  base: number;
  value: Promotion | null;
  onChange: (p: Promotion | null) => void;
  disabled?: boolean;
}) {
  const { data: promotions = [], isLoading, isError } = usePromotions();
  const available = useMemo(
    () =>
      promotions.filter(
        (p) => p.is_active && (p.service_codes.length === 0 || p.service_codes.includes(service)),
      ),
    [promotions, service],
  );
  const check = value ? evaluatePromotion(value, service, base) : null;

  return (
    <div>
      <Select
        label="الخصم (من الخصومات المعتمدة)"
        value={value?.id ?? ''}
        disabled={disabled || isLoading}
        onChange={(e) => onChange(available.find((p) => p.id === e.target.value) ?? null)}
        placeholder={isLoading ? 'جارٍ تحميل الخصومات…' : 'بدون خصم'}
        options={available.map((p) => ({
          value: p.id,
          label: `${p.name} — ${promotionValueLabel(p)}`,
        }))}
      />
      {isError && <p className="mt-1 text-xs text-red-600">تعذّر تحميل الخصومات المعتمدة.</p>}
      {!isLoading && !isError && available.length === 0 && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-purple">
          <BadgePercent size={12} /> لا توجد خصومات معتمدة لهذه الخدمة.
        </p>
      )}
      {check && check.ok && (
        <p className="mt-1 flex items-center gap-1 text-xs text-green-700">
          <BadgeCheck size={13} /> خصم مؤهَّل: <span className="num">{sar(check.amount)}</span> ر.س
        </p>
      )}
      {check && !check.ok && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
          <CircleAlert size={13} /> لن يُطبَّق: {check.reason}
        </p>
      )}
    </div>
  );
}
