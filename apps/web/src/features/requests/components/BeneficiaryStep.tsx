import { Building2, Coffee, Home, PartyPopper, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ErrorState, Input, Select, Skeleton } from '@/shared/ui';
import { useRefList } from '@/features/settings/hooks/useSettings';
import { activeOnly } from '@/features/settings/api/settings.api';
import type { PlaceDetails } from '@/features/requests/types';
import { isOccasion, isOtherOccasion, placeForType } from '@/features/requests/types';

/** أيقونة لكل نوع مستفيد معروف، وأيقونة عامة لما يضيفه الإداري لاحقًا. */
const TYPE_ICON: Record<string, LucideIcon> = {
  home: Home,
  facility: Building2,
  commercial: Coffee,
  occasion: PartyPopper,
};

/**
 * الخطوة الأولى في طلب العاملة: لمن تُقدَّم الخدمة — منزل، منشأة، مقهى / نشاط
 * تجاري، مناسبة / فعالية — ونوع المناسبة عند اختيارها (و«أخرى» تفتح حقلًا نصيًا).
 * القائمتان مرجعيتان من الإعدادات.
 */
export function BeneficiaryStep({
  place,
  onChange,
}: {
  place: PlaceDetails;
  onChange: (patch: Partial<PlaceDetails>) => void;
}) {
  const types = useRefList('beneficiary_types');
  const occasions = useRefList('occasion_types');

  if (types.isLoading) {
    return (
      <div className="grid gap-2.5 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (types.isError) {
    return (
      <ErrorState description="تعذّر تحميل أنواع المستفيد." onRetry={() => void types.refetch()} />
    );
  }

  const options = activeOnly(types.data ?? []);
  if (options.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-brand-100 bg-white p-6 text-center text-sm text-brand-dark/60">
        لا توجد أنواع مستفيد مُفعّلة — يضيفها المسؤول من الإعدادات.
      </p>
    );
  }

  const occasionOptions = activeOnly(occasions.data ?? []).map((o) => ({
    value: o.code,
    label: o.name_ar,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {options.map((t) => {
          const Icon = TYPE_ICON[t.code] ?? Users;
          const active = place.beneficiaryType === t.code;
          return (
            <button
              key={t.code}
              type="button"
              aria-pressed={active}
              // تغيير النوع يمسح بيانات النوع السابق كلها (لا بيانات مخفية في الطلب)
              onClick={() => onChange(placeForType(place, t.code))}
              className={`flex items-center gap-3 rounded-xl border p-3.5 text-right transition ${
                active ? 'border-brand bg-brand-50' : 'border-brand-100 hover:border-brand'
              }`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
                  active ? 'bg-brand text-white' : 'bg-brand-50 text-brand'
                }`}
              >
                <Icon size={19} strokeWidth={1.8} />
              </span>
              <span className="text-sm font-semibold text-brand-dark">{t.name_ar}</span>
            </button>
          );
        })}
      </div>

      {isOccasion(place.beneficiaryType) && (
        <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
          {occasions.isLoading ? (
            <Skeleton className="h-11 w-full" />
          ) : occasionOptions.length === 0 ? (
            <p className="text-sm text-brand-dark/60">
              لا توجد أنواع مناسبات مُفعّلة — يضيفها المسؤول من الإعدادات.
            </p>
          ) : (
            <Select
              label="نوع المناسبة"
              value={place.occasionType ?? ''}
              onChange={(e) =>
                onChange({ occasionType: e.target.value || null, customOccasionType: '' })
              }
              options={occasionOptions}
              placeholder="اختر نوع المناسبة"
            />
          )}
          {isOtherOccasion(place) && (
            <div className="mt-3">
              <Input
                label="اكتب نوع المناسبة"
                value={place.customOccasionType}
                maxLength={60}
                onChange={(e) => onChange({ customOccasionType: e.target.value })}
                placeholder="مثال: حفل تخرّج، استقبال العيد…"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
