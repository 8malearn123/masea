import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Filter, RotateCcw, Search, SlidersHorizontal, UserRound } from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { WorkerCard } from '@/features/catalog/components/WorkerCard';
import { useRefList } from '@/features/settings/hooks/useSettings';
import type { RefItem } from '@/features/settings/api/settings.api';
import { isOccasion } from '@/features/requests/types';
import { useOrderIntent } from '@/store/orderIntent';
import {
  AGE_RANGES,
  availabilityOf,
  maritalOf,
  MARITAL_STATUSES,
  motherTongueOf,
  MOTHER_TONGUES,
  NATIONALITIES,
  PROFESSIONS,
  ratingOf,
  religionOf,
  RELIGIONS,
  spokenLanguages,
} from '@/features/catalog/lib/catalog';

type Sort = 'rating' | 'available' | 'salary';

export default function WorkerCatalog() {
  const { data: workers = [], isLoading } = useWorkerProfiles();
  const [search, setSearch] = useState('');
  const [nationality, setNationality] = useState('all');
  const [profession, setProfession] = useState('all');
  const [ageRange, setAgeRange] = useState('all');
  const [religion, setReligion] = useState('all');
  const [marital, setMarital] = useState('all');
  const [motherTongue, setMotherTongue] = useState('all');
  const [language, setLanguage] = useState('all');
  const [minExp, setMinExp] = useState(0);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [sort, setSort] = useState<Sort>('rating');
  const [showFilters, setShowFilters] = useState(false);
  // نوع المستفيد — not a worker filter: it rides along into the order wizard.
  const { data: beneficiaryTypes = [] } = useRefList('beneficiary_types');
  const { data: occasionTypes = [] } = useRefList('occasion_types');
  const intent = useOrderIntent();

  const languageOptions = useMemo(() => spokenLanguages(workers), [workers]);

  const filtered = useMemo(() => {
    const rows = workers.filter((w) => {
      if (nationality !== 'all' && w.nationality !== nationality) return false;
      if (profession !== 'all' && w.profession !== profession) return false;
      if (ageRange !== 'all') {
        const range = AGE_RANGES.find((r) => r.label === ageRange);
        if (range && (w.age == null || w.age < range.min || w.age > range.max)) return false;
      }
      if (religion !== 'all' && religionOf(w) !== religion) return false;
      if (marital !== 'all' && maritalOf(w) !== marital) return false;
      if (motherTongue !== 'all' && motherTongueOf(w) !== motherTongue) return false;
      if (language !== 'all' && !w.languages.includes(language)) return false;
      if (w.experience_years < minExp) return false;
      if (onlyAvailable && availabilityOf(w) !== 'available') return false;
      if (search.trim()) {
        const hay = `${w.full_name} ${w.profession} ${w.nationality}`;
        if (!hay.includes(search.trim())) return false;
      }
      return true;
    });
    return [...rows].sort((a, b) => {
      if (sort === 'salary') return a.monthly_salary - b.monthly_salary;
      if (sort === 'available') {
        return (
          Number(availabilityOf(a) !== 'available') - Number(availabilityOf(b) !== 'available')
        );
      }
      return ratingOf(b) - ratingOf(a);
    });
  }, [
    workers,
    nationality,
    profession,
    ageRange,
    religion,
    marital,
    motherTongue,
    language,
    minExp,
    onlyAvailable,
    search,
    sort,
  ]);

  function reset() {
    setNationality('all');
    setProfession('all');
    setAgeRange('all');
    setReligion('all');
    setMarital('all');
    setMotherTongue('all');
    setLanguage('all');
    setMinExp(0);
    setOnlyAvailable(false);
    setSearch('');
    intent.clearIntent();
  }

  return (
    <div dir="rtl" className="min-h-screen bg-navy-50">
      {/* header */}
      <header className="sticky top-0 z-10 border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/order" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold font-bold text-white">
              م
            </span>
            <span className="hidden text-sm font-bold text-navy sm:block">
              {BRAND.client.nameAr}
            </span>
          </Link>
          <div className="relative flex-1">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
              <Search size={16} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم، المهنة، الجنسية…"
              className="w-full rounded-xl border border-navy-100 bg-white py-2.5 pe-3 ps-9 text-sm outline-none focus:border-navy"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy lg:hidden"
          >
            <Filter size={15} /> فلترة
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl gap-5 px-4 py-5 lg:grid lg:grid-cols-[260px_1fr]">
        {/* filters */}
        <aside className={`${showFilters ? 'block' : 'hidden'} lg:block`}>
          <div className="rounded-2xl border border-navy-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
                <SlidersHorizontal size={16} /> الفلاتر
              </h2>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 text-[11px] text-purple hover:text-navy"
              >
                <RotateCcw size={12} /> إعادة تعيين
              </button>
            </div>

            <Group label="نوع المستفيد">
              <RefPills
                items={beneficiaryTypes}
                value={intent.beneficiaryType}
                onChange={(b) => intent.setIntent({ beneficiaryType: b.code, occasionType: null })}
              />
            </Group>
            {isOccasion(intent.beneficiaryType) && (
              <Group label="نوع المناسبة">
                <RefPills
                  items={occasionTypes}
                  value={intent.occasionType ?? ''}
                  onChange={(t) => intent.setIntent({ occasionType: t.code })}
                />
              </Group>
            )}
            <Group label="الجنسية">
              <Pills value={nationality} onChange={setNationality} options={NATIONALITIES} />
            </Group>
            <Group label="المهنة">
              <Pills value={profession} onChange={setProfession} options={PROFESSIONS} />
            </Group>
            <Group label="العمر">
              <Pills
                value={ageRange}
                onChange={setAgeRange}
                options={AGE_RANGES.map((r) => r.label)}
              />
            </Group>
            <Group label="الديانة">
              <Pills value={religion} onChange={setReligion} options={RELIGIONS} />
            </Group>
            <Group label="الحالة الاجتماعية">
              <Pills value={marital} onChange={setMarital} options={MARITAL_STATUSES} />
            </Group>
            <Group label="اللغة الأم">
              <Pills value={motherTongue} onChange={setMotherTongue} options={MOTHER_TONGUES} />
            </Group>
            <Group label="اللغات التي تتحدثها">
              <Pills value={language} onChange={setLanguage} options={languageOptions} />
            </Group>
            <Group label="سنوات الخبرة">
              <div className="flex gap-1.5">
                {[0, 3, 5, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMinExp(n)}
                    className={`num rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${minExp === n ? 'bg-navy text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'}`}
                  >
                    {n === 0 ? 'الكل' : `+${n}`}
                  </button>
                ))}
              </div>
            </Group>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-navy-900">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
                className="h-4 w-4 rounded border-navy-200"
              />
              متاحة الآن فقط
            </label>
          </div>
        </aside>

        {/* results */}
        <main>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-purple">
              <span className="num font-bold text-navy">{filtered.length}</span> عاملة متاحة
            </p>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-lg border border-navy-100 bg-white px-2.5 py-1.5 text-xs text-navy outline-none focus:border-navy"
            >
              <option value="rating">الأعلى تقييماً</option>
              <option value="available">المتاحة أولاً</option>
              <option value="salary">الأقل سعراً</option>
            </select>
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-64 animate-pulse rounded-2xl bg-white" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-navy-200 bg-white py-16 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-navy-50 text-navy-200">
                <UserRound size={28} />
              </span>
              <p className="mt-3 text-base font-bold text-navy">لا توجد عاملات بهذه الفلاتر</p>
              <p className="mt-1 max-w-sm text-sm text-purple">
                جرّب توسيع نطاق البحث أو إزالة بعض الفلاتر، ويمكننا تنبيهك عند توفّر عاملة مطابقة.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-xl border border-navy-200 px-4 py-2 text-sm font-semibold text-navy hover:bg-navy-50"
                >
                  إعادة ضبط الفلاتر
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90"
                >
                  <BellRing size={15} /> نبّهني عند التوفّر
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((w) => (
                <WorkerCard key={w.id} worker={w} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-t border-navy-50 pt-3 first:border-0 first:pt-0">
      <p className="mb-2 text-xs font-bold text-navy-900">{label}</p>
      {children}
    </div>
  );
}

/** Single-choice chips over a managed reference list (no «الكل» option). */
function RefPills({
  items,
  value,
  onChange,
}: {
  items: RefItem[];
  value: string;
  onChange: (item: RefItem) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items
        .filter((it) => it.is_active)
        .map((it) => (
          <button
            key={it.code}
            type="button"
            onClick={() => onChange(it)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${value === it.code ? 'bg-navy text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'}`}
          >
            {it.name_ar}
          </button>
        ))}
    </div>
  );
}

function Pills({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {['all', ...options].map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${value === opt ? 'bg-navy text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'}`}
        >
          {opt === 'all' ? 'الكل' : opt}
        </button>
      ))}
    </div>
  );
}
