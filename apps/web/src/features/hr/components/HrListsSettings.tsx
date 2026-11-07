import { useState } from 'react';
import { ArrowDown, ArrowUp, ListChecks, Lock, Plus, Save } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Select, Skeleton } from '@/shared/ui';
import { useHrLookupList, useLookupUsage, useSaveHrLookup } from '@/features/hr/hooks/useHrLookups';
import { assertLookupChange, newLookupCode, ofKind } from '@/features/hr/lib/lookups';
import {
  LOOKUP_KINDS,
  LOOKUP_SCOPE_LABEL,
  type HrLookup,
  type HrLookupKind,
  type LookupScope,
} from '@/features/hr/types';

const SCOPE_OPTIONS = (Object.keys(LOOKUP_SCOPE_LABEL) as LookupScope[]).map((s) => ({
  value: s,
  label: LOOKUP_SCOPE_LABEL[s],
}));

/**
 * «القوائم المرجعية» — departments, job titles, nationalities, professions,
 * skills, languages and document types are managed here (0075): add, rename
 * (flows into the records), reorder, enable/disable — never deleted.
 */
export function HrListsSettings({ editable }: { editable: boolean }) {
  const [kind, setKind] = useState<HrLookupKind>('department');
  const meta = LOOKUP_KINDS.find((k) => k.kind === kind)!;

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <ListChecks size={18} className="text-navy" />
        <h3 className="text-sm font-bold text-navy">القوائم المرجعية</h3>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-navy-100 pb-2" role="tablist">
        {LOOKUP_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            onClick={() => setKind(k.kind)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              kind === k.kind ? 'bg-navy text-white' : 'text-purple hover:bg-navy-50'
            }`}
          >
            {k.title}
          </button>
        ))}
      </div>
      <p className="text-xs text-purple">{meta.hint}</p>
      <KindList key={kind} kind={kind} editable={editable} />
    </Card>
  );
}

function KindList({ kind, editable }: { kind: HrLookupKind; editable: boolean }) {
  const { data, isLoading, isError, refetch } = useHrLookupList();
  const { data: usage } = useLookupUsage(kind);
  const save = useSaveHrLookup();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<LookupScope>('both');
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !data)
    return <ErrorState title="تعذّر تحميل القوائم" onRetry={() => void refetch()} />;

  const items = ofKind(data, kind);
  const uses = (it: HrLookup) => usage?.get(kind === 'doc_type' ? it.code : it.name_ar) ?? 0;

  function add() {
    const item: HrLookup = {
      kind,
      code: newLookupCode(),
      name_ar: name.trim(),
      scope: kind === 'nationality' ? scope : 'both',
      is_active: true,
      is_system: false,
      sort_order: (items.at(-1)?.sort_order ?? 0) + 1,
    };
    try {
      assertLookupChange(data ?? [], item, null);
    } catch (e) {
      return setError((e as Error).message);
    }
    setError(null);
    save.mutate({ item, isNew: true }, { onSuccess: () => setName('') });
  }

  function move(i: number, dir: -1 | 1) {
    const a = items[i];
    const b = items[i + dir];
    if (!a || !b) return;
    // swap positions (re-number when equal so the order really changes)
    const sa = a.sort_order === b.sort_order ? i + 1 : a.sort_order;
    const sb = a.sort_order === b.sort_order ? i + 1 + dir : b.sort_order;
    save.mutate({ item: { ...a, sort_order: sb }, isNew: false, silent: true });
    save.mutate({ item: { ...b, sort_order: sa }, isNew: false, silent: true });
  }

  return (
    <div className="space-y-3">
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Input
              label="عنصر جديد"
              value={name}
              placeholder="الاسم بالعربية"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
          </div>
          {kind === 'nationality' && (
            <div className="w-36">
              <Select
                label="النطاق"
                value={scope}
                onChange={(e) => setScope(e.target.value as LookupScope)}
                options={SCOPE_OPTIONS}
              />
            </div>
          )}
          <Button onClick={add} loading={save.isPending} disabled={!name.trim()}>
            <Plus size={16} /> إضافة
          </Button>
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-purple">القائمة فارغة — أضف أول عنصر.</p>
      ) : (
        <ul className="divide-y divide-navy-50">
          {items.map((it, i) => (
            <LookupRow
              key={it.code}
              item={it}
              all={data}
              uses={uses(it)}
              editable={editable}
              first={i === 0}
              last={i === items.length - 1}
              onMove={(dir) => move(i, dir)}
              onSave={(next) => save.mutate({ item: next, isNew: false })}
              saving={save.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LookupRow({
  item,
  all,
  uses,
  editable,
  first,
  last,
  onMove,
  onSave,
  saving,
}: {
  item: HrLookup;
  all: HrLookup[];
  uses: number;
  editable: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onSave: (next: HrLookup) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(item.name_ar);
  const [error, setError] = useState<string | null>(null);
  const locked = item.kind === 'nationality' && item.code === 'SA';
  const dirty = name.trim() !== item.name_ar;

  function submit(next: HrLookup) {
    try {
      assertLookupChange(all, next, item);
    } catch (e) {
      return setError((e as Error).message);
    }
    setError(null);
    onSave(next);
  }

  return (
    <li className={`space-y-1 py-2.5 ${item.is_active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <div className="flex flex-col">
            <button
              type="button"
              aria-label="لأعلى"
              disabled={first}
              onClick={() => onMove(-1)}
              className="text-purple hover:text-navy disabled:opacity-30"
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              aria-label="لأسفل"
              disabled={last}
              onClick={() => onMove(1)}
              className="text-purple hover:text-navy disabled:opacity-30"
            >
              <ArrowDown size={13} />
            </button>
          </div>
        )}
        <div className="min-w-40 flex-1">
          <Input
            aria-label={`اسم ${item.name_ar}`}
            value={name}
            disabled={!editable || locked}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {item.kind === 'nationality' && (
          <div className="w-32">
            <Select
              aria-label={`نطاق ${item.name_ar}`}
              value={item.scope}
              disabled={!editable || locked}
              onChange={(e) => submit({ ...item, scope: e.target.value as LookupScope })}
              options={SCOPE_OPTIONS}
            />
          </div>
        )}
        <span className="text-[11px] text-purple">
          مستخدم في <span className="num">{uses}</span>
        </span>
        {item.is_system && (
          <Badge tone="navy">
            <Lock size={11} /> نظامي
          </Badge>
        )}
        {editable && dirty && (
          <Button
            size="sm"
            loading={saving}
            onClick={() => submit({ ...item, name_ar: name.trim() })}
          >
            <Save size={14} /> حفظ
          </Button>
        )}
        {editable && !item.is_system ? (
          <Button
            size="sm"
            variant={item.is_active ? 'ghost' : 'outline'}
            onClick={() => submit({ ...item, is_active: !item.is_active })}
          >
            {item.is_active ? 'تعطيل' : 'تفعيل'}
          </Button>
        ) : (
          !item.is_system && (
            <Badge tone={item.is_active ? 'success' : 'neutral'}>
              {item.is_active ? 'مُفعّل' : 'معطّل'}
            </Badge>
          )
        )}
      </div>
      {dirty && uses > 0 && (
        <p className="text-[11px] text-gold-600">
          سيُحدَّث الاسم تلقائيًا في <span className="num">{uses}</span> سجل.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  );
}
