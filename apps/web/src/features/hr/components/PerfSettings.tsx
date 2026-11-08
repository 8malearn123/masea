import { useState } from 'react';
import { Gauge, Plus, Save } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Select, Skeleton } from '@/shared/ui';
import { ROLE_META, type RoleCode } from '@/lib/permissions';
import {
  usePerfBands,
  usePerfCriteria,
  useSaveBand,
  useSaveCriterion,
} from '@/features/hr/hooks/usePerformance';
import { bandSchema, criterionSchema, firstError } from '@/features/hr/lib/performanceEngine';
import {
  PERF_SOURCE_LABEL,
  type PerfBand,
  type PerfCriterion,
  type PerfSource,
} from '@/features/hr/types';

const ROLES = Object.keys(ROLE_META) as RoleCode[];
const SOURCES = (Object.keys(PERF_SOURCE_LABEL) as PerfSource[]).map((s) => ({
  value: s,
  label: PERF_SOURCE_LABEL[s],
}));
const TONES: { value: PerfBand['tone']; label: string }[] = [
  { value: 'success', label: 'أخضر' },
  { value: 'navy', label: 'أزرق' },
  { value: 'gold', label: 'ذهبي' },
  { value: 'danger', label: 'أحمر' },
];
const newCode = () => Math.random().toString(16).slice(2, 12).padEnd(10, '0');

/** «تقييم الأداء»: criteria (weight, source, roles) and rating bands — 0076. */
export function PerfSettings({ editable }: { editable: boolean }) {
  return (
    <Card className="space-y-5">
      <div className="flex items-center gap-2">
        <Gauge size={18} className="text-navy" />
        <h3 className="text-sm font-bold text-navy">تقييم الأداء</h3>
      </div>
      <CriteriaList editable={editable} />
      <BandsList editable={editable} />
    </Card>
  );
}

function CriteriaList({ editable }: { editable: boolean }) {
  const { data = [], isLoading, isError, refetch } = usePerfCriteria();
  const save = useSaveCriterion();
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError) return <ErrorState title="تعذّر تحميل المعايير" onRetry={() => void refetch()} />;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-navy">معايير التقييم</p>
          <p className="text-[11px] text-purple">
            الدرجة = متوسط موزون لمعايير دور الموظف (تُطبَّع الأوزان تلقائيًا). بلا أدوار = لكل
            الأدوار.
          </p>
        </div>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              save.mutate({
                item: {
                  code: newCode(),
                  name_ar: `معيار جديد ${data.length + 1}`,
                  source: 'manual',
                  weight: 10,
                  roles: [],
                  is_active: true,
                  sort_order: data.length + 1,
                },
                isNew: true,
              })
            }
          >
            <Plus size={15} /> معيار
          </Button>
        )}
      </div>
      {data.length === 0 ? (
        <p className="py-4 text-center text-sm text-purple">لا توجد معايير — أضف أول معيار.</p>
      ) : (
        data.map((c) => (
          <CriterionRow
            key={c.code}
            item={c}
            editable={editable}
            onSave={(item) => save.mutate({ item, isNew: false })}
            saving={save.isPending}
          />
        ))
      )}
    </div>
  );
}

function CriterionRow({
  item,
  editable,
  onSave,
  saving,
}: {
  item: PerfCriterion;
  editable: boolean;
  onSave: (c: PerfCriterion) => void;
  saving: boolean;
}) {
  const [d, setD] = useState(item);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(d) !== JSON.stringify(item);
  function submit(next = d) {
    const err = firstError(criterionSchema.safeParse(next));
    if (err) return setError(err);
    setError(null);
    onSave(next);
  }
  const toggleRole = (r: string) =>
    setD({ ...d, roles: d.roles.includes(r) ? d.roles.filter((x) => x !== r) : [...d.roles, r] });
  return (
    <div
      className={`space-y-2 rounded-xl border border-navy-50 p-3 ${item.is_active ? '' : 'opacity-60'}`}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem_6rem_auto]">
        <Input
          aria-label="اسم المعيار"
          value={d.name_ar}
          disabled={!editable}
          onChange={(e) => setD({ ...d, name_ar: e.target.value })}
        />
        <Select
          aria-label="مصدر الدرجة"
          value={d.source}
          disabled={!editable}
          onChange={(e) => setD({ ...d, source: e.target.value as PerfSource })}
          options={SOURCES}
        />
        <Input
          aria-label="الوزن"
          type="number"
          min={1}
          max={100}
          value={d.weight}
          disabled={!editable}
          onChange={(e) => setD({ ...d, weight: Number(e.target.value) })}
        />
        <div className="flex items-center gap-1">
          {editable && dirty && (
            <Button size="sm" loading={saving} onClick={() => submit()}>
              <Save size={14} /> حفظ
            </Button>
          )}
          {editable ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => submit({ ...item, is_active: !item.is_active })}
            >
              {item.is_active ? 'تعطيل' : 'تفعيل'}
            </Button>
          ) : (
            <Badge tone={item.is_active ? 'success' : 'neutral'}>
              {item.is_active ? 'مُفعّل' : 'معطّل'}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ROLES.map((r) => {
          const on = d.roles.includes(r);
          return (
            <button
              key={r}
              type="button"
              disabled={!editable}
              onClick={() => toggleRole(r)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${on ? 'border-navy bg-navy text-white' : 'border-navy-100 text-purple'}`}
            >
              {ROLE_META[r].label}
            </button>
          );
        })}
        {d.roles.length === 0 && (
          <span className="text-[11px] text-green-700">يطبَّق على كل الأدوار</span>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function BandsList({ editable }: { editable: boolean }) {
  const bands = usePerfBands();
  const save = useSaveBand();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-navy">شرائح التقدير</p>
          <p className="text-[11px] text-purple">يأخذ التقييم أعلى شريحة يبلغ حدها الأدنى.</p>
        </div>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              save.mutate({
                item: {
                  code: newCode(),
                  name_ar: 'تقدير جديد',
                  min_score: 60,
                  tone: 'navy',
                  is_active: true,
                },
                isNew: true,
              })
            }
          >
            <Plus size={15} /> تقدير
          </Button>
        )}
      </div>
      {bands.map((b) => (
        <BandRow
          key={b.code}
          item={b}
          editable={editable}
          onSave={(item) => save.mutate({ item, isNew: false })}
        />
      ))}
    </div>
  );
}

function BandRow({
  item,
  editable,
  onSave,
}: {
  item: PerfBand;
  editable: boolean;
  onSave: (b: PerfBand) => void;
}) {
  const [d, setD] = useState(item);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(d) !== JSON.stringify(item);
  function submit(next = d) {
    const err = firstError(bandSchema.safeParse(next));
    if (err) return setError(err);
    setError(null);
    onSave(next);
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 ${item.is_active ? '' : 'opacity-60'}`}>
      <div className="w-40">
        <Input
          aria-label="اسم التقدير"
          value={d.name_ar}
          disabled={!editable}
          onChange={(e) => setD({ ...d, name_ar: e.target.value })}
        />
      </div>
      <div className="w-28">
        <Input
          aria-label={`حد ${item.name_ar}`}
          type="number"
          min={0}
          max={100}
          suffix="٪"
          value={d.min_score}
          disabled={!editable}
          onChange={(e) => setD({ ...d, min_score: Number(e.target.value) })}
        />
      </div>
      <div className="w-28">
        <Select
          aria-label="اللون"
          value={d.tone}
          disabled={!editable}
          onChange={(e) => setD({ ...d, tone: e.target.value as PerfBand['tone'] })}
          options={TONES}
        />
      </div>
      <Badge tone={d.tone}>{d.name_ar}</Badge>
      {editable && dirty && (
        <Button size="sm" onClick={() => submit()}>
          <Save size={14} /> حفظ
        </Button>
      )}
      {editable && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => submit({ ...item, is_active: !item.is_active })}
        >
          {item.is_active ? 'تعطيل' : 'تفعيل'}
        </Button>
      )}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
