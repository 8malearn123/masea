import { useState } from 'react';
import { FileSignature, FlaskConical, ListChecks, Plus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Skeleton } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useLookups,
  useSaveLookup,
  useSettlementTerms,
  useUpdateSettlementTerm,
} from '@/features/contracts/hooks/useContractOps';
import {
  LOOKUP_FLAG_LABEL,
  LOOKUP_KIND_LABEL,
  LOOKUP_KINDS,
  type ContractLookup,
  type LookupKind,
  type SettlementTermRow,
} from '@/features/contracts/api/contractOps.api';
import {
  useApproveTrialTerms,
  useSaveTrialTerms,
  useTrialTerms,
} from '@/features/contracts/hooks/useTrials';
import { trialTermsSchema } from '@/features/contracts/api/trials.api';

function newCode(): string {
  return Math.random().toString(16).slice(2, 12);
}

function LookupRow({ item, editable }: { item: ContractLookup; editable: boolean }) {
  const save = useSaveLookup();
  const [name, setName] = useState(item.name_ar);
  const dirty = name.trim() !== item.name_ar && name.trim().length > 0;
  const flagLabel = LOOKUP_FLAG_LABEL[item.kind];
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <Input
        value={name}
        disabled={!editable}
        onChange={(e) => setName(e.target.value)}
        className="min-w-[12rem] flex-1"
      />
      {flagLabel && (
        <label className="flex items-center gap-1 text-[11px] text-purple">
          <input
            type="checkbox"
            checked={item.flag}
            disabled={!editable || save.isPending}
            onChange={() => save.mutate({ item: { ...item, flag: !item.flag }, isNew: false })}
          />
          {flagLabel}
        </label>
      )}
      <button
        type="button"
        disabled={!editable || save.isPending}
        onClick={() => save.mutate({ item: { ...item, is_active: !item.is_active }, isNew: false })}
        aria-label="تفعيل/تعطيل"
      >
        <Badge tone={item.is_active ? 'success' : 'neutral'}>
          {item.is_active ? 'مُفعّل' : 'معطّل'}
        </Badge>
      </button>
      {editable && (
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ item: { ...item, name_ar: name.trim() }, isNew: false })}
        >
          حفظ
        </Button>
      )}
    </li>
  );
}

function LookupList({ kind, editable }: { kind: LookupKind; editable: boolean }) {
  const { data: items = [], isLoading, isError, refetch } = useLookups(kind);
  const save = useSaveLookup();
  const [name, setName] = useState('');
  return (
    <Card>
      <h3 className="mb-2 text-sm font-bold text-navy">{LOOKUP_KIND_LABEL[kind]}</h3>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="لا عناصر بعد" />
      ) : (
        <ul className="divide-y divide-navy-50">
          {items.map((it) => (
            <LookupRow key={`${it.kind}-${it.code}`} item={it} editable={editable} />
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="عنصر جديد"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1"
          />
          <Button
            variant="outline"
            disabled={!name.trim() || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  item: {
                    kind,
                    code: newCode(),
                    name_ar: name.trim(),
                    flag: false,
                    is_active: true,
                    sort_order: items.length + 1,
                  },
                  isNew: true,
                },
                { onSuccess: () => setName('') },
              )
            }
          >
            <Plus size={15} /> إضافة
          </Button>
        </div>
      )}
    </Card>
  );
}

function TermRow({ t, editable }: { t: SettlementTermRow; editable: boolean }) {
  const save = useUpdateSettlementTerm();
  const [value, setValue] = useState(t.value);
  const [ref, setRef] = useState(t.clause_ref);
  const [note, setNote] = useState(t.note ?? '');
  const dirty =
    value !== t.value || ref.trim() !== t.clause_ref || (note.trim() || null) !== t.note;
  const patch = (extra: Partial<SettlementTermRow>) =>
    save.mutate({
      id: t.id,
      value,
      clause_ref: ref.trim(),
      is_active: t.is_active,
      note: note.trim() || null,
      ...extra,
    });
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-navy">{t.label_ar}</p>
        <button
          type="button"
          disabled={!editable || save.isPending}
          onClick={() => patch({ is_active: !t.is_active })}
        >
          <Badge tone={t.is_active ? 'success' : 'neutral'}>
            {t.is_active ? 'يُطبَّق آلياً' : 'غير مفعّل — يُضاف يدوياً'}
          </Badge>
        </button>
      </div>
      <p className="text-[11px] text-purple">
        القالب <span className="num">{t.template_code}</span> · النسخة{' '}
        <span className="num">{t.template_version}</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          label="القيمة"
          type="number"
          min={0}
          disabled={!editable}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
        />
        <Input
          label="البند"
          disabled={!editable}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <Input
          label="ملاحظة"
          disabled={!editable}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {editable && (
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || !ref.trim() || save.isPending}
          onClick={() => patch({})}
        >
          حفظ
        </Button>
      )}
    </li>
  );
}

/**
 * شروط «تجربة عاملة بغرض نقل الخدمات» — تكتبها الشركة وتعتمدها، ثم تُقفل.
 * التعديل بعد الاعتماد = نسخة جديدة (التجارب السابقة تبقى على نسختها).
 */
function TrialTermsEditor({ editable }: { editable: boolean }) {
  const { data: versions = [], isLoading, isError, refetch } = useTrialTerms();
  const save = useSaveTrialTerms();
  const approve = useApproveTrialTerms();
  const approved = versions.find((v) => v.status === 'approved') ?? null;
  const pending =
    versions.find((v) => v.status === 'pending_review' || v.status === 'draft') ?? null;
  const base = pending ?? approved;
  const [title, setTitle] = useState(base?.title ?? 'شروط تجربة العاملة بغرض نقل الخدمات');
  const [text, setText] = useState((base?.clauses ?? []).join('\n'));
  const clauses = text
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);
  const parsed = trialTermsSchema.safeParse({ title, clauses });
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
        <FlaskConical size={16} /> شروط تجربة العاملة بغرض نقل الخدمات
      </h2>
      <p className="mb-2 text-[11px] text-purple">
        النص الذي يقبله العميل إلكترونياً. لا شروط افتراضية — تكتبها الشركة (بعد مراجعتها نظامياً)
        ثم تعتمدها؛ المعتمد يُقفل وأي تعديل يصبح نسخة جديدة.
      </p>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            {approved ? (
              <Badge tone="success">المعتمدة: النسخة {approved.version}</Badge>
            ) : (
              <Badge tone="danger">لا نسخة معتمدة — لا يمكن إنشاء تجارب</Badge>
            )}
            {pending && <Badge tone="gold">بانتظار الاعتماد: النسخة {pending.version}</Badge>}
          </div>
          {editable && (
            <div className="space-y-2">
              <Input label="العنوان" value={title} onChange={(e) => setTitle(e.target.value)} />
              <label className="block text-sm font-medium text-navy-900">
                البنود (بند في كل سطر)
                <textarea
                  className="mt-1 min-h-40 w-full rounded-xl border border-navy-100 p-3 text-sm"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              {!parsed.success && (
                <p className="text-[11px] text-gold-600">{parsed.error.issues[0]?.message}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!parsed.success || save.isPending}
                  onClick={() => save.mutate({ title, clauses })}
                >
                  حفظ {pending ? 'التعديلات على النسخة المعلّقة' : 'كنسخة جديدة'}
                </Button>
                {pending && (
                  <Button disabled={approve.isPending} onClick={() => approve.mutate(pending.id)}>
                    اعتماد النسخة {pending.version} وقفلها
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * إعدادات عمليات العقود: القوائم المرجعية (أسباب الإلغاء والإرجاع والاستبدال،
 * حالة العاملة، متطلبات التجربة) وشروط التسوية المستخرجة من القوالب المعتمدة.
 * التعديل لمن يملك اعتماد العقود (contracts.approve) — يفرضه RLS في 0090.
 */
export function ContractOpsSettings() {
  const { can } = usePermissions();
  const editable = can('contracts', 'approve');
  const termsQ = useSettlementTerms();
  return (
    <div className="space-y-4">
      <TrialTermsEditor editable={editable} />
      <Card>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
          <FileSignature size={16} /> شروط التسوية من نصوص العقود المعتمدة
        </h2>
        <p className="mb-2 text-[11px] text-purple">
          الأرقام هنا منقولة من بنود القالب المعتمد لكل نسخة — تُعدَّل عند تصحيح النقل فقط، والقالب
          نفسه لا يتغيّر. الشرط غير المفعّل لا يُحسب آلياً ويُضاف عند انطباقه برقم البند.
        </p>
        {termsQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : termsQ.isError ? (
          <ErrorState onRetry={() => void termsQ.refetch()} />
        ) : (termsQ.data ?? []).length === 0 ? (
          <EmptyState title="لا شروط تسوية مسجّلة" />
        ) : (
          <ul className="divide-y divide-navy-50">
            {(termsQ.data ?? []).map((t) => (
              <TermRow key={t.id} t={t} editable={editable} />
            ))}
          </ul>
        )}
      </Card>
      <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
        <ListChecks size={16} /> القوائم المرجعية لعمليات العقد
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {LOOKUP_KINDS.map((k) => (
          <LookupList key={k} kind={k} editable={editable} />
        ))}
      </div>
      {!editable && (
        <p className="text-[11px] text-purple">التعديل لمن يملك صلاحية اعتماد العقود.</p>
      )}
    </div>
  );
}
