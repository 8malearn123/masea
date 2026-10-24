import {
  Baby,
  Building2,
  HeartHandshake,
  Layers,
  Minus,
  Plus,
  Store,
  UsersRound,
} from 'lucide-react';
import { ErrorState, Input, Skeleton } from '@/shared/ui';
import { useRefList } from '@/features/settings/hooks/useSettings';
import { activeOnly } from '@/features/settings/api/settings.api';
import { today } from '@/features/requests/lib/period';
import type { PlaceDetails } from '@/features/requests/types';
import {
  COMMERCIAL_CODE,
  FACILITY_CODE,
  HOME_CODE,
  OCCASION_BENEFICIARY_CODE,
} from '@/features/requests/types';

type Patch = (patch: Partial<PlaceDetails>) => void;

/**
 * تفاصيل مكان الخدمة — الحقول تتبدّل بحسب نوع المستفيد المختار في الخطوة
 * السابقة (منزل، منشأة، مقهى / نشاط تجاري، مناسبة / فعالية)، فلا يظهر إلا ما
 * ينطبق. التحقق في `placeDetailsSchema`، والحقول نفسها مدخلات ترشيح العاملة.
 */
export function PlaceStep({ place, onChange }: { place: PlaceDetails; onChange: Patch }) {
  const careList = useRefList('care_needs');

  const toggleCare = (code: string) =>
    onChange({
      careNeeds: place.careNeeds.includes(code)
        ? place.careNeeds.filter((c) => c !== code)
        : [...place.careNeeds, code],
    });

  return (
    <div className="space-y-5">
      {place.beneficiaryType === HOME_CODE && <HomeFields place={place} onChange={onChange} />}
      {place.beneficiaryType === FACILITY_CODE && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="نوع المنشأة"
            value={place.facilityType}
            maxLength={60}
            onChange={(e) => onChange({ facilityType: e.target.value })}
            placeholder="مثال: مستشفى، مدرسة، مجمّع سكني"
          />
          <PeopleInput
            label="عدد المستفيدين / الموظفين"
            value={place.guests}
            max={1000}
            onChange={(guests) => onChange({ guests })}
          />
          <Counter
            icon={Building2}
            label="عدد الأقسام"
            value={place.sections}
            min={1}
            max={50}
            onChange={(sections) => onChange({ sections })}
          />
        </div>
      )}
      {place.beneficiaryType === COMMERCIAL_CODE && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="نوع النشاط"
            value={place.businessType}
            maxLength={60}
            onChange={(e) => onChange({ businessType: e.target.value })}
            placeholder="مثال: مقهى، مطعم، محل حلويات"
          />
          <PeopleInput
            label="عدد الأشخاص المطلوب خدمتهم يوميًا"
            value={place.guests}
            max={1000}
            onChange={(guests) => onChange({ guests })}
          />
          <Counter
            icon={Store}
            label="عدد الفروع"
            value={place.branchesCount}
            min={1}
            max={50}
            onChange={(branchesCount) => onChange({ branchesCount })}
          />
        </div>
      )}
      {place.beneficiaryType === OCCASION_BENEFICIARY_CODE && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="تاريخ المناسبة (اختياري)"
            type="date"
            min={today()}
            value={place.eventDate}
            onChange={(e) => onChange({ eventDate: e.target.value })}
          />
          <PeopleInput
            label="عدد الحضور التقريبي"
            value={place.guests}
            max={2000}
            onChange={(guests) => onChange({ guests })}
          />
        </div>
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
        <span className="mb-1 block text-sm font-medium text-brand-dark">
          ملاحظات عن المكان أو احتياجات الخدمة
        </span>
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

/** بيانات المنزل: الأدوار والغرف، والأطفال وكبار السن بأسئلة نعم/لا. */
function HomeFields({ place, onChange }: { place: PlaceDetails; onChange: Patch }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Counter
          icon={Layers}
          label="عدد الأدوار"
          value={place.floors}
          min={1}
          max={8}
          onChange={(floors) => onChange({ floors })}
        />
        <Counter
          icon={Layers}
          label="عدد الغرف"
          value={place.rooms}
          min={1}
          max={30}
          onChange={(rooms) => onChange({ rooms })}
        />
      </div>

      <YesNo
        icon={Baby}
        label="هل يوجد أطفال؟"
        value={place.hasChildren}
        onChange={(yes) =>
          onChange({ hasChildren: yes, children: yes ? Math.max(1, place.children) : 0 })
        }
      />
      {place.hasChildren && (
        <Counter
          icon={Baby}
          label="عدد الأطفال"
          value={place.children}
          min={1}
          max={12}
          onChange={(children) => onChange({ children })}
        />
      )}

      <YesNo
        icon={UsersRound}
        label="هل يوجد كبار سن؟"
        value={place.hasElderly}
        onChange={(yes) =>
          onChange(
            yes
              ? { hasElderly: true, elderly: 1 }
              : { hasElderly: false, elderly: 0, elderlyCareNeeded: null },
          )
        }
      />
      {place.hasElderly && (
        <YesNo
          icon={HeartHandshake}
          label="هل يحتاجون إلى رعاية؟"
          value={place.elderlyCareNeeded}
          onChange={(yes) => onChange({ elderlyCareNeeded: yes })}
        />
      )}
    </div>
  );
}

/** سؤال نعم/لا بزرين — null يعني لم يُجب بعد. */
function YesNo({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: typeof Layers;
  label: string;
  value: boolean | null;
  onChange: (yes: boolean) => void;
}) {
  const option = (yes: boolean, text: string) => {
    const active = value === yes;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onChange(yes)}
        className={`min-w-14 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          active ? 'bg-brand text-white' : 'bg-brand-50 text-brand-dark hover:bg-brand-100'
        }`}
      >
        {text}
      </button>
    );
  };
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-100 px-3.5 py-2.5"
    >
      <span className="flex items-center gap-2 text-sm text-brand-dark">
        <Icon size={15} className="text-brand" /> {label}
      </span>
      <span className="flex items-center gap-2">
        {option(true, 'نعم')}
        {option(false, 'لا')}
      </span>
    </div>
  );
}

/** عدد أشخاص (حضور/مستفيدين) — رقم صحيح غير سالب، و0 يعني لم يُدخل بعد. */
function PeopleInput({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Input
      label={label}
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      className="num"
      value={value > 0 ? value : ''}
      onChange={(e) => {
        const n = Math.trunc(Number(e.target.value));
        onChange(Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0);
      }}
      placeholder="مثال: 50"
    />
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
