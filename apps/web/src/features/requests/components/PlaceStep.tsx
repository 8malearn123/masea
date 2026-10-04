import { Baby, HeartHandshake, Layers, Minus, Plus, UsersRound } from 'lucide-react';
import { ErrorState, Skeleton } from '@/shared/ui';
import { useRefList } from '@/features/settings/hooks/useSettings';
import { activeOnly } from '@/features/settings/api/settings.api';
import type { PlaceDetails } from '@/features/requests/types';
import { asksForGuests, asksForHouseholdCare, isOccasion } from '@/features/requests/types';

/**
 * بيانات المنزل / مكان الخدمة: الأدوار والغرف والأطفال وكبار السن واحتياج
 * الرعاية — وهي نفسها مدخلات ترشيح العاملة في الخطوة التالية.
 * الحقول تتبدّل بحسب نوع المستفيد المختار في الخطوة السابقة.
 */
export function PlaceStep({
  place,
  onChange,
}: {
  place: PlaceDetails;
  onChange: (patch: Partial<PlaceDetails>) => void;
}) {
  const careList = useRefList('care_needs');
  const household = asksForHouseholdCare(place.beneficiaryType);
  const guests = asksForGuests(place.beneficiaryType);

  const toggleCare = (code: string) =>
    onChange({
      careNeeds: place.careNeeds.includes(code)
        ? place.careNeeds.filter((c) => c !== code)
        : [...place.careNeeds, code],
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Counter
          icon={Layers}
          label={isOccasion(place.beneficiaryType) ? 'عدد الأدوار في مكان المناسبة' : 'عدد الأدوار'}
          value={place.floors}
          min={1}
          max={8}
          onChange={(floors) => onChange({ floors })}
        />
        <Counter
          icon={Layers}
          label={guests ? 'عدد الصالات / الأقسام' : 'عدد الغرف'}
          value={place.rooms}
          min={1}
          max={30}
          onChange={(rooms) => onChange({ rooms })}
        />
        {household && (
          <>
            <Counter
              icon={Baby}
              label="عدد الأطفال"
              value={place.children}
              min={0}
              max={12}
              onChange={(children) => onChange({ children })}
            />
            <Counter
              icon={UsersRound}
              label="عدد كبار السن"
              value={place.elderly}
              min={0}
              max={8}
              onChange={(elderly) =>
                onChange({
                  elderly,
                  elderlyCareNeeded: elderly === 0 ? false : place.elderlyCareNeeded,
                })
              }
            />
          </>
        )}
        {guests && (
          <Counter
            icon={UsersRound}
            label="عدد الحضور المتوقّع"
            value={place.guests}
            min={0}
            max={600}
            step={10}
            onChange={(g) => onChange({ guests: g })}
          />
        )}
      </div>

      {household && place.elderly > 0 && (
        <label className="flex items-center gap-2.5 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-brand-dark">
          <input
            type="checkbox"
            checked={place.elderlyCareNeeded}
            onChange={(e) => onChange({ elderlyCareNeeded: e.target.checked })}
            className="h-4 w-4 accent-[#1f58a8]"
          />
          يحتاج كبار السن رعاية مباشرة (مرافقة، دواء، حركة)
        </label>
      )}

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-brand-dark">
          <HeartHandshake size={15} className="text-brand" /> احتياجات الرعاية المطلوبة
        </p>
        {careList.isLoading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-28" />
            ))}
          </div>
        ) : careList.isError ? (
          <ErrorState
            description="تعذّر تحميل احتياجات الرعاية."
            onRetry={() => void careList.refetch()}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {activeOnly(careList.data ?? []).map((c) => {
              const active = place.careNeeds.includes(c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleCare(c.code)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'bg-brand text-white'
                      : 'bg-brand-50 text-brand-dark hover:bg-brand-100'
                  }`}
                >
                  {c.name_ar}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-brand-dark/50">
          الاحتياجات المختارة هي أساس ترشيح العاملة الأنسب لطلبك.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-brand-dark">ملاحظات إضافية</span>
        <textarea
          rows={3}
          value={place.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="مثال: يفضّل من تجيد العربية، الدور العلوي غير مستخدم…"
          className="w-full rounded-xl border border-brand-100 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
      </label>
    </div>
  );
}

function Counter({
  icon: Icon,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  icon: typeof Layers;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="flex items-center justify-between rounded-xl border border-brand-100 px-3.5 py-2.5">
      <span className="flex items-center gap-2 text-sm text-brand-dark">
        <Icon size={15} className="text-brand" /> {label}
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => set(value - step)}
          disabled={value <= min}
          className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand transition hover:bg-brand-100 disabled:opacity-40"
          aria-label={`إنقاص ${label}`}
        >
          <Minus size={14} />
        </button>
        <span className="num w-10 text-center text-sm font-bold text-brand">{value}</span>
        <button
          type="button"
          onClick={() => set(value + step)}
          disabled={value >= max}
          className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand transition hover:bg-brand-100 disabled:opacity-40"
          aria-label={`زيادة ${label}`}
        >
          <Plus size={14} />
        </button>
      </span>
    </div>
  );
}
