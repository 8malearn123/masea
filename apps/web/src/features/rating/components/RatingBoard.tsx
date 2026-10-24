import { useMemo, useState } from 'react';
import { Check, Clock, RotateCcw, Star, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useModerateRating, useRatings } from '@/features/rating/hooks/useRatings';
import {
  isPublished,
  RATING_TARGET_LABEL,
  RATING_TARGET_TONE,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_TONE,
  type ModerationAction,
  type Rating,
} from '@/features/rating/types';

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} من 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={14} className={i < value ? 'fill-gold text-gold' : 'text-navy-100'} />
      ))}
    </span>
  );
}

function Kpi({
  label,
  value,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="text-xs text-purple">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

const TARGET_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'كل التقييمات' },
  { value: 'worker', label: 'العاملات' },
  { value: 'driver', label: 'السائقون' },
  { value: 'service', label: 'الخدمات' },
  { value: 'branch', label: 'الفروع' },
];

type QueueTab = 'pending' | 'approved' | 'rejected' | 'deleted' | 'all';

const QUEUE_TABS: { value: QueueTab; label: string }[] = [
  { value: 'pending', label: 'قيد المراجعة' },
  { value: 'approved', label: 'منشورة' },
  { value: 'rejected', label: 'مرفوضة' },
  { value: 'deleted', label: 'محذوفة' },
  { value: 'all', label: 'الكل' },
];

function inTab(r: Rating, tab: QueueTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'deleted') return Boolean(r.deleted_at);
  return !r.deleted_at && r.status === tab;
}

export default function RatingBoard() {
  const { data: all = [], isLoading, isError, refetch } = useRatings();
  const { can } = usePermissions();
  const canModerate = can('rating', 'edit');
  const moderate = useModerateRating();
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState<QueueTab>('pending');
  const [noteFor, setNoteFor] = useState<{ r: Rating; action: 'reject' | 'delete' } | null>(null);
  const [note, setNote] = useState('');

  // الإحصاءات من التعليقات المنشورة فقط — ما لم يُعتمد لا يدخل في التقييم
  const ratings = useMemo(() => all.filter(isPublished), [all]);
  const counts = useMemo(() => {
    const c: Record<QueueTab, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      deleted: 0,
      all: 0,
    };
    for (const r of all) for (const t of QUEUE_TABS) if (inTab(r, t.value)) c[t.value] += 1;
    return c;
  }, [all]);
  const rows = all.filter((r) => inTab(r, tab) && (filter === 'all' || r.target_type === filter));

  function act(r: Rating, action: ModerationAction) {
    if (action === 'reject' || action === 'delete') {
      setNote('');
      setNoteFor({ r, action });
      return;
    }
    moderate.mutate({ id: r.id, action });
  }
  const avg = ratings.length ? ratings.reduce((s, r) => s + r.stars, 0) / ratings.length : 0;
  const promoters = ratings.filter((r) => r.stars >= 4).length;
  const detractors = ratings.filter((r) => r.stars <= 2).length;

  // distribution 5..1
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: ratings.filter((r) => r.stars === star).length,
  }));
  const maxCount = Math.max(1, ...dist.map((d) => d.count));

  const columns: Column<Rating>[] = [
    {
      key: 'customer_name',
      header: 'العميل',
      cell: (r) => <span className="font-semibold text-navy">{r.customer_name}</span>,
    },
    {
      key: 'target',
      header: 'المُقيَّم',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Badge tone={RATING_TARGET_TONE[r.target_type]}>
            {RATING_TARGET_LABEL[r.target_type]}
          </Badge>
          <span className="text-xs">{r.target_name}</span>
        </span>
      ),
    },
    { key: 'stars', header: 'التقييم', cell: (r) => <Stars value={r.stars} /> },
    {
      key: 'comment',
      header: 'التعليق',
      cell: (r) => (
        <div className="max-w-xs">
          <span className="text-xs text-navy-900">{r.comment}</span>
          {r.moderation_note && (
            <span className="mt-0.5 block text-[11px] text-red-600">
              ملاحظة المراجعة: {r.moderation_note}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) =>
        r.deleted_at ? (
          <Badge tone="neutral">محذوف</Badge>
        ) : (
          <Badge tone={REVIEW_STATUS_TONE[r.status]}>{REVIEW_STATUS_LABEL[r.status]}</Badge>
        ),
    },
    {
      key: 'created_at',
      header: 'التاريخ',
      cell: (r) => <span className="num text-xs">{dateAr(r.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'المراجعة',
      cell: (r) =>
        canModerate ? <ModerationButtons r={r} onAct={act} busy={moderate.isPending} /> : null,
    },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Star size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">التقييم ومراجعة التعليقات</h1>
          <p className="text-sm text-purple">
            لا يُنشر أي تعليق للزوار قبل موافقة الإدارة — راجِع، انشر، ارفض أو احذف.
          </p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="متوسط التقييم" value={`${avg.toFixed(1)} ★`} tone="text-gold-600" />
        <Kpi label="عدد التقييمات" value={String(ratings.length)} />
        <Kpi label="تقييمات إيجابية (4★+)" value={String(promoters)} tone="text-green-600" />
        <Kpi label="تقييمات سلبية (2★-)" value={String(detractors)} tone="text-red-600" />
      </div>
      {counts.pending > 0 && (
        <p className="mb-5 flex items-center gap-1.5 rounded-xl bg-gold-100 px-3 py-2 text-xs text-gold-600">
          <Clock size={14} /> <span className="num font-bold">{counts.pending}</span> تعليق بانتظار
          المراجعة قبل النشر.
        </p>
      )}

      <Card className="mb-5">
        <h2 className="mb-3 text-sm font-bold text-navy">توزيع التقييمات</h2>
        <div className="space-y-2">
          {dist.map((d) => (
            <div key={d.star} className="flex items-center gap-3">
              <span className="num flex w-10 items-center gap-1 text-xs text-purple">
                {d.star} <Star size={11} className="fill-gold text-gold" />
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-navy-50">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${(d.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="num w-6 text-left text-xs text-navy">{d.count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap rounded-xl bg-navy-50 p-1">
            {QUEUE_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === t.value ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
              >
                {t.label}
                <span className="num rounded-full bg-navy-100 px-1.5 text-[11px] text-navy">
                  {counts[t.value]}
                </span>
              </button>
            ))}
          </div>
          <div className="min-w-[10rem]">
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              options={TARGET_FILTERS}
            />
          </div>
        </div>
      </Card>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle={tab === 'pending' ? 'لا توجد تعليقات بانتظار المراجعة' : 'لا توجد تقييمات'}
      />

      <Modal
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
        title={noteFor?.action === 'delete' ? 'حذف التعليق' : 'رفض التعليق'}
      >
        {noteFor && (
          <div className="space-y-4">
            <p className="rounded-xl bg-navy-50 p-3 text-sm text-navy-900">
              «{noteFor.r.comment}» — {noteFor.r.customer_name}
            </p>
            <Input
              label={noteFor.action === 'delete' ? 'سبب الحذف (اختياري)' : 'سبب الرفض (اختياري)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-[11px] text-purple">
              {noteFor.action === 'delete'
                ? 'يختفي التعليق من الموقع ويبقى في السجل، ويمكن استعادته لاحقاً.'
                : 'لن يظهر التعليق للزوار، ويمكن إعادته للمراجعة أو نشره لاحقاً.'}
            </p>
            <Button
              className="w-full"
              variant="danger"
              loading={moderate.isPending}
              onClick={() =>
                moderate.mutate(
                  { id: noteFor.r.id, action: noteFor.action, note },
                  { onSuccess: () => setNoteFor(null) },
                )
              }
            >
              {noteFor.action === 'delete' ? 'تأكيد الحذف' : 'تأكيد الرفض'}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ModerationButtons({
  r,
  onAct,
  busy,
}: {
  r: Rating;
  onAct: (r: Rating, a: ModerationAction) => void;
  busy: boolean;
}) {
  const btn = (action: ModerationAction, label: string, Icon: typeof Check, tone: string) => (
    <button
      key={action}
      type="button"
      disabled={busy}
      onClick={() => onAct(r, action)}
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${tone}`}
    >
      <Icon size={12} /> {label}
    </button>
  );
  if (r.deleted_at) {
    return btn('restore', 'استعادة', RotateCcw, 'bg-navy-50 text-navy hover:bg-navy-100');
  }
  return (
    <div className="flex flex-wrap gap-1">
      {r.status !== 'approved' &&
        btn('approve', 'نشر', Check, 'bg-green-50 text-green-700 hover:bg-green-100')}
      {r.status !== 'rejected' &&
        btn('reject', 'رفض', X, 'bg-red-50 text-red-700 hover:bg-red-100')}
      {r.status !== 'pending' &&
        btn('pending', 'قيد المراجعة', Clock, 'bg-gold-100 text-gold-600 hover:bg-gold-100/70')}
      {btn('delete', 'حذف', Trash2, 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
    </div>
  );
}
