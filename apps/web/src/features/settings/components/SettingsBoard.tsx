import { useMemo, useState } from 'react';
import {
  CalendarHeart,
  KanbanSquare,
  Plus,
  Settings2,
  SlidersHorizontal,
  Tag,
  UsersRound,
} from 'lucide-react';
import { Badge, Button, Card, Input } from '@/shared/ui';
import {
  useBeneficiaryTypes,
  useConfig,
  useEventTypes,
  useSaveRef,
  useSources,
  useStages,
  useUpdateConfig,
  type RefKind,
} from '@/features/settings/hooks/useSettings';
import { newCode, type ConfigItem, type RefItem } from '@/features/settings/api/settings.api';

type Tab = RefKind | 'config';

const TABS: { key: Tab; label: string; icon: typeof Tag }[] = [
  { key: 'sources', label: 'مصادر العملاء', icon: Tag },
  { key: 'stages', label: 'مراحل المبيعات', icon: KanbanSquare },
  { key: 'beneficiary_types', label: 'أنواع المستفيد', icon: UsersRound },
  { key: 'event_types', label: 'أنواع المناسبات', icon: CalendarHeart },
  { key: 'config', label: 'قيم النظام', icon: SlidersHorizontal },
];

const REF_QUERY = {
  sources: useSources,
  stages: useStages,
  beneficiary_types: useBeneficiaryTypes,
  event_types: useEventTypes,
} satisfies Record<RefKind, typeof useSources>;

export default function SettingsBoard() {
  const [tab, setTab] = useState<Tab>('sources');

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Settings2 size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">الإعدادات</h1>
          <p className="text-sm text-purple">إدارة القوائم المرجعية وقيم النظام من الواجهة.</p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-navy-100">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                active ? 'border-navy text-navy' : 'border-transparent text-purple hover:text-navy'
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'sources' && (
        <RefSection
          kind="sources"
          title="مصادر العملاء المحتملين"
          hint="من أين يأتي العميل المحتمل (الموقع، مركز الاتصال، إحالة…)."
        />
      )}
      {tab === 'stages' && (
        <RefSection
          kind="stages"
          title="مراحل خط المبيعات"
          hint="مراحل تقدّم العميل المحتمل في الـpipeline."
        />
      )}
      {tab === 'beneficiary_types' && (
        <RefSection
          kind="beneficiary_types"
          title="أنواع المستفيد في الطلب"
          hint="تظهر للعميل عند إنشاء طلب جديد (منزل، منشأة تجارية…). النوع «مناسبة أو فعالية» يُظهر قائمة المناسبات."
        />
      )}
      {tab === 'event_types' && (
        <RefSection
          kind="event_types"
          title="أنواع المناسبات"
          hint="تظهر عند اختيار «مناسبة أو فعالية». النوع «مناسبة أخرى» يسمح للعميل بكتابة اسمها."
        />
      )}
      {tab === 'config' && <ConfigSection />}
    </div>
  );
}

function RefSection({ kind, title, hint }: { kind: RefKind; title: string; hint: string }) {
  const query = REF_QUERY[kind];
  const { data: items = [], isLoading } = query();
  const save = useSaveRef(kind);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-navy">{title}</h2>
          <p className="text-[11px] text-purple">{hint}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const name = window.prompt('اسم العنصر الجديد');
            if (name?.trim()) {
              save.mutate({
                item: {
                  code: newCode(kind),
                  name_ar: name.trim(),
                  is_active: true,
                  sort_order: items.length + 1,
                },
                isNew: true,
              });
            }
          }}
        >
          <Plus size={15} /> إضافة
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-purple">جارٍ التحميل…</p>
      ) : (
        <ul className="divide-y divide-navy-50">
          {items.map((it) => (
            <RefRow
              key={it.code}
              item={it}
              onSave={(item) => save.mutate({ item, isNew: false })}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RefRow({ item, onSave }: { item: RefItem; onSave: (item: RefItem) => void }) {
  const [name, setName] = useState(item.name_ar);
  const dirty = name.trim() !== item.name_ar && name.trim().length > 0;

  return (
    <li className="flex items-center gap-3 py-2.5">
      <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
      <button
        type="button"
        onClick={() => onSave({ ...item, is_active: !item.is_active })}
        className="shrink-0"
        aria-label="تفعيل/تعطيل"
      >
        <Badge tone={item.is_active ? 'success' : 'neutral'}>
          {item.is_active ? 'مُفعّل' : 'معطّل'}
        </Badge>
      </button>
      <Button
        variant="outline"
        size="sm"
        disabled={!dirty}
        onClick={() => onSave({ ...item, name_ar: name.trim() })}
      >
        حفظ
      </Button>
    </li>
  );
}

function ConfigSection() {
  const { data: items = [], isLoading } = useConfig();
  const update = useUpdateConfig();

  const groups = useMemo(() => {
    const map = new Map<string, ConfigItem[]>();
    items.forEach((c) => {
      const arr = map.get(c.grp) ?? [];
      arr.push(c);
      map.set(c.grp, arr);
    });
    return [...map.entries()];
  }, [items]);

  if (isLoading) return <Card className="text-sm text-purple">جارٍ التحميل…</Card>;

  return (
    <div className="space-y-4">
      {groups.map(([grp, rows]) => (
        <Card key={grp}>
          <h2 className="mb-3 text-sm font-bold text-navy">{grp}</h2>
          <ul className="divide-y divide-navy-50">
            {rows.map((c) => (
              <ConfigRow
                key={c.key}
                item={c}
                onSave={(value) => update.mutate({ key: c.key, value })}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function ConfigRow({ item, onSave }: { item: ConfigItem; onSave: (value: number) => void }) {
  const [val, setVal] = useState(String(item.value));
  const dirty = val.trim() !== '' && Number(val) !== item.value && !Number.isNaN(Number(val));

  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-navy-900">{item.label_ar}</span>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            inputMode="decimal"
            className="w-28 text-left"
          />
          {item.unit && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-purple">
              {item.unit}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" disabled={!dirty} onClick={() => onSave(Number(val))}>
          حفظ
        </Button>
      </div>
    </li>
  );
}
