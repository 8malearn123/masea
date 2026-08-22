import { useState } from 'react';
import { Star } from 'lucide-react';
import { Badge, Card, Select, Table, type Column } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useRatings } from '@/features/rating/hooks/useRatings';
import { RATING_TARGET_LABEL, RATING_TARGET_TONE, type Rating } from '@/features/rating/types';

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

export default function RatingBoard() {
  const { data: ratings = [], isLoading, isError, refetch } = useRatings();
  const [filter, setFilter] = useState('all');

  const rows = filter === 'all' ? ratings : ratings.filter((r) => r.target_type === filter);
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
      cell: (r) => <span className="text-xs text-purple">{r.comment}</span>,
    },
    {
      key: 'created_at',
      header: 'التاريخ',
      cell: (r) => <span className="num text-xs">{dateAr(r.created_at)}</span>,
    },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Star size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">التقييم</h1>
          <p className="text-sm text-purple">تقييمات العملاء للعاملات والسائقين والخدمات.</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="متوسط التقييم" value={`${avg.toFixed(1)} ★`} tone="text-gold-600" />
        <Kpi label="عدد التقييمات" value={String(ratings.length)} />
        <Kpi label="تقييمات إيجابية (4★+)" value={String(promoters)} tone="text-green-600" />
        <Kpi label="تقييمات سلبية (2★-)" value={String(detractors)} tone="text-red-600" />
      </div>

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
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          options={TARGET_FILTERS}
        />
      </Card>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد تقييمات"
      />
    </div>
  );
}
