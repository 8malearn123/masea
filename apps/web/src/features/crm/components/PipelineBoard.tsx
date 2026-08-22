import { useMemo, useState } from 'react';
import { GripVertical, KanbanSquare, Pencil, Phone, Plus, Search } from 'lucide-react';
import { Badge, Button, Card, Input } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { useLeads, useSetLeadStage } from '@/features/crm/hooks/useCrm';
import { useCrmMeta } from '@/features/crm/hooks/useCrmMeta';
import { LeadFormModal } from '@/features/crm/components/LeadFormModal';
import { LeadDrawer } from '@/features/crm/components/LeadDrawer';
import { SERVICE_LABEL, type Lead, type LeadStageCode } from '@/features/crm/types';

export default function PipelineBoard() {
  const { data: leads = [], isLoading } = useLeads();
  const setStage = useSetLeadStage();
  const { stageOrder, stageLabel, stageTone, sourceLabel } = useCrmMeta();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Lead | null>(null);
  const [viewing, setViewing] = useState<Lead | null>(null);
  const [creating, setCreating] = useState(false);
  // سحب وإفلات البطاقات بين مراحل الأنبوب
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const dropOnStage = (stage: string) => {
    const id = draggingId;
    setDragOverStage(null);
    setDraggingId(null);
    if (!id) return;
    const dragged = leads.find((l) => l.id === id);
    if (dragged && dragged.stage_code !== stage) {
      setStage.mutate({ id, stage: stage as LeadStageCode });
    }
  };

  // keep the open drawer's lead in sync with fresh data after mutations
  const liveViewing = viewing ? (leads.find((l) => l.id === viewing.id) ?? viewing) : null;

  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          !search.trim() ||
          l.full_name.includes(search.trim()) ||
          (l.phone ?? '').includes(search.trim()),
      ),
    [leads, search],
  );

  const byStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    stageOrder.forEach((s) => map.set(s, []));
    filtered.forEach((l) => map.get(l.stage_code)?.push(l));
    return map;
  }, [filtered, stageOrder]);

  const openValue = useMemo(
    () =>
      filtered
        .filter((l) => l.stage_code !== 'won' && l.stage_code !== 'lost')
        .reduce((s, l) => s + l.est_value, 0),
    [filtered],
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <KanbanSquare size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">العملاء المحتملون</h1>
            <p className="text-sm text-purple">
              خط مبيعاتي — <span className="num">{sar(openValue)}</span> ر.س قيد التفاوض ·{' '}
              <span className="num">{filtered.length}</span> عميل محتمل.
            </p>
          </div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> عميل محتمل جديد
        </Button>
      </div>

      <Card className="mb-4">
        <div className="relative">
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
            <Search size={16} />
          </span>
          <Input
            placeholder="بحث بالاسم أو الجوال"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
      </Card>

      {isLoading ? (
        <Card className="text-sm text-purple">جارٍ التحميل…</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {stageOrder.map((stage) => {
            const items = byStage.get(stage) ?? [];
            const isDropTarget = dragOverStage === stage && draggingId !== null;
            return (
              <div
                key={stage}
                onDragOver={(e) => {
                  if (!draggingId) return;
                  e.preventDefault();
                  if (dragOverStage !== stage) setDragOverStage(stage);
                }}
                onDragLeave={(e) => {
                  // تجاهل مغادرة العناصر الداخلية؛ لا تُلغِ الإبراز إلا عند مغادرة العمود فعلاً
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverStage((s) => (s === stage ? null : s));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOnStage(stage);
                }}
                className={`rounded-2xl p-2.5 transition ${
                  isDropTarget ? 'bg-navy-100 ring-2 ring-navy ring-offset-1' : 'bg-navy-50/50'
                }`}
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <Badge tone={stageTone(stage)}>{stageLabel(stage)}</Badge>
                  <span className="num text-xs font-bold text-purple">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((l) => (
                    <LeadCard
                      key={l.id}
                      lead={l}
                      stageOrder={stageOrder}
                      stageLabel={stageLabel}
                      sourceLabel={sourceLabel}
                      isDragging={draggingId === l.id}
                      onDragStart={() => setDraggingId(l.id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverStage(null);
                      }}
                      onOpen={() => setViewing(l)}
                      onEdit={() => setEditing(l)}
                      onMove={(s) => setStage.mutate({ id: l.id, stage: s })}
                    />
                  ))}
                  {items.length === 0 && (
                    <p className="px-1 py-3 text-center text-[11px] text-purple/60">لا يوجد</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LeadFormModal lead={null} open={creating} onClose={() => setCreating(false)} />
      <LeadFormModal lead={editing} open={editing !== null} onClose={() => setEditing(null)} />
      <LeadDrawer lead={liveViewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function LeadCard({
  lead,
  stageOrder,
  stageLabel,
  sourceLabel,
  isDragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onEdit,
  onMove,
}: {
  lead: Lead;
  stageOrder: string[];
  stageLabel: (code: string) => string;
  sourceLabel: (code: string | null | undefined) => string;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onMove: (stage: LeadStageCode) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', lead.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-xl border border-navy-100 bg-white p-3 shadow-sm transition active:cursor-grabbing ${
        isDragging ? 'opacity-40 ring-2 ring-navy' : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <GripVertical size={13} className="shrink-0 text-purple/50" aria-hidden />
          <button
            type="button"
            onClick={onOpen}
            className="truncate text-right text-sm font-bold text-navy hover:underline"
          >
            {lead.full_name}
          </button>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-purple hover:text-navy"
          aria-label="تعديل"
        >
          <Pencil size={13} />
        </button>
      </div>
      {lead.phone && (
        <a
          href={`tel:${lead.phone}`}
          draggable={false}
          className="num mt-0.5 flex items-center gap-1 text-[11px] text-purple hover:text-navy"
        >
          <Phone size={11} /> {lead.phone}
        </a>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {lead.service_code && <Badge tone="teal">{SERVICE_LABEL[lead.service_code]}</Badge>}
        {lead.source_code && <span className="text-purple">{sourceLabel(lead.source_code)}</span>}
      </div>
      <p className="num mt-1.5 text-xs font-semibold text-gold-600">{sar(lead.est_value)} ر.س</p>
      <select
        value={lead.stage_code}
        onChange={(e) => onMove(e.target.value as LeadStageCode)}
        className="mt-2 w-full rounded-lg border border-navy-100 bg-navy-50/40 px-2 py-1.5 text-[11px] text-navy outline-none transition focus:border-navy"
      >
        {stageOrder.map((s) => (
          <option key={s} value={s}>
            انقل إلى: {stageLabel(s)}
          </option>
        ))}
      </select>
    </div>
  );
}
