import { useState } from 'react';
import { Flag, Plus, Save } from 'lucide-react';
import { Badge, Button, Card, Input, Select } from '@/shared/ui';
import { configValue } from '@/features/settings/api/settings.api';
import { useConfig, useUpdateConfig } from '@/features/settings/hooks/useSettings';
import { useNitaqatBands, useSaveNitaqat } from '@/features/hr/hooks/useHrReports';
import {
  DEFAULT_FULL_WAGE,
  DEFAULT_HALF_WEIGHT,
  SAUDI_FULL_WAGE_KEY,
  SAUDI_HALF_WEIGHT_KEY,
} from '@/features/hr/lib/hrReports';
import type { NitaqatBand } from '@/features/hr/types';

const TONES: { value: NitaqatBand['tone']; label: string }[] = [
  { value: 'success', label: 'أخضر' },
  { value: 'gold', label: 'ذهبي' },
  { value: 'navy', label: 'أزرق' },
  { value: 'danger', label: 'أحمر' },
];

/** «السعودة ونطاقات»: bands (0077) + how a Saudi is counted (app_config). */
export function NitaqatSettings({ editable }: { editable: boolean }) {
  const bands = useNitaqatBands();
  const save = useSaveNitaqat();
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag size={18} className="text-navy" />
          <h3 className="text-sm font-bold text-navy">السعودة ونطاقات</h3>
        </div>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              save.mutate({
                item: {
                  code: Math.random().toString(16).slice(2, 12),
                  name_ar: 'نطاق جديد',
                  min_pct: 10,
                  tone: 'navy',
                  is_active: true,
                },
                isNew: true,
              })
            }
          >
            <Plus size={15} /> نطاق
          </Button>
        )}
      </div>
      <p className="text-xs text-purple">
        حدود النطاقات تختلف حسب نشاط المنشأة وحجمها في «قوى» — عدّلها لتطابق نطاق ماسية الشرق
        الفعلي.
      </p>
      {bands.map((b) => (
        <BandRow
          key={b.code}
          item={b}
          editable={editable}
          onSave={(item) => save.mutate({ item, isNew: false })}
        />
      ))}
      <CountingRules editable={editable} />
    </Card>
  );
}

function BandRow({
  item,
  editable,
  onSave,
}: {
  item: NitaqatBand;
  editable: boolean;
  onSave: (b: NitaqatBand) => void;
}) {
  const [d, setD] = useState(item);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(d) !== JSON.stringify(item);
  function submit(next = d) {
    if (!next.name_ar.trim()) return setError('أدخل اسم النطاق');
    if (!(next.min_pct >= 0 && next.min_pct <= 100)) return setError('الحد بين 0 و100');
    setError(null);
    onSave(next);
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 ${item.is_active ? '' : 'opacity-60'}`}>
      <div className="w-40">
        <Input
          aria-label="اسم النطاق"
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
          value={d.min_pct}
          disabled={!editable}
          onChange={(e) => setD({ ...d, min_pct: Number(e.target.value) })}
        />
      </div>
      <div className="w-28">
        <Select
          aria-label="لون النطاق"
          value={d.tone}
          disabled={!editable}
          onChange={(e) => setD({ ...d, tone: e.target.value as NitaqatBand['tone'] })}
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

function CountingRules({ editable }: { editable: boolean }) {
  const { data = [] } = useConfig();
  const update = useUpdateConfig();
  const wage = configValue(data, SAUDI_FULL_WAGE_KEY, DEFAULT_FULL_WAGE);
  const weight = configValue(data, SAUDI_HALF_WEIGHT_KEY, DEFAULT_HALF_WEIGHT);
  const [w, setW] = useState<string | null>(null);
  const [h, setH] = useState<string | null>(null);
  const wv = Number(w ?? wage);
  const hv = Number(h ?? weight);
  const bad = !(wv >= 0) || !(hv >= 0 && hv <= 1);
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-navy-50 pt-3">
      <div className="w-48">
        <Input
          label="أجر الاحتساب الكامل"
          type="number"
          min={0}
          suffix="ريال"
          value={w ?? String(wage)}
          disabled={!editable}
          onChange={(e) => setW(e.target.value)}
        />
      </div>
      <div className="w-48">
        <Input
          label="وزن السعودي الأقل أجرًا"
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={h ?? String(weight)}
          disabled={!editable}
          {...(hv > 1 || hv < 0 ? { error: 'بين 0 و1' } : {})}
          onChange={(e) => setH(e.target.value)}
        />
      </div>
      {editable && (
        <Button
          disabled={bad || (wv === wage && hv === weight)}
          loading={update.isPending}
          onClick={() => {
            if (wv !== wage)
              update.mutate(
                { key: SAUDI_FULL_WAGE_KEY, value: wv },
                { onSuccess: () => setW(null) },
              );
            if (hv !== weight)
              update.mutate(
                { key: SAUDI_HALF_WEIGHT_KEY, value: hv },
                { onSuccess: () => setH(null) },
              );
          }}
        >
          <Save size={16} /> حفظ قواعد الاحتساب
        </Button>
      )}
    </div>
  );
}
