import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Search, UserRound } from 'lucide-react';
import { Badge, EmptyState, ErrorState, Input, Select, Skeleton } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import {
  listWorkerCandidates,
  WORKER_STATUS_LABEL,
  type WorkerCandidate,
} from '@/features/contracts/api/workersDrivers.api';
import type { ContractServiceCode } from '@/features/contracts/types';

/**
 * اختيار العاملة للعقد من بياناتها الفعلية: المؤهلات للخدمة بتوفرهن في الفترة،
 * مع البحث والتصفية بالجنسية والمهنة والفرع. غير المتاحة تظهر بسببها وتاريخ
 * توفرها ولا يمكن اختيارها (قيد منع التداخل 0089 يفرض ذلك في الخادم أيضاً).
 */
export function WorkerPicker({
  service,
  start,
  end,
  value,
  onPick,
  exclude,
}: {
  service: ContractServiceCode | '';
  start: string;
  end: string | null;
  value: string | null;
  onPick: (w: WorkerCandidate) => void;
  /** workers hidden from the list (e.g. busy in an hourly slot) */
  exclude?: ((w: WorkerCandidate) => string | null) | undefined;
}) {
  const q = useQuery({
    queryKey: ['contracts', 'worker-candidates', service, start, end],
    queryFn: () => listWorkerCandidates(service, start, end),
    enabled: Boolean(start),
  });
  const [text, setText] = useState('');
  const [nat, setNat] = useState('all');
  const [prof, setProf] = useState('all');
  const [branch, setBranch] = useState('all');
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const rows = useMemo(() => {
    const all = (q.data ?? []).map((w) => {
      const extra = exclude?.(w) ?? null;
      return extra && w.available ? { ...w, available: false, reason: extra } : w;
    });
    return all.filter(
      (w) =>
        (!text.trim() ||
          w.full_name.includes(text.trim()) ||
          (w.internal_no ?? '').includes(text.trim())) &&
        (nat === 'all' || w.nationality === nat) &&
        (prof === 'all' || w.profession === prof) &&
        (branch === 'all' || w.branch_name === branch) &&
        (!onlyAvailable || w.available),
    );
  }, [q.data, text, nat, prof, branch, onlyAvailable, exclude]);
  const opts = (k: 'nationality' | 'profession' | 'branch_name', all: string) => [
    { value: 'all', label: all },
    ...[...new Set((q.data ?? []).map((w) => w[k]).filter((x): x is string => Boolean(x)))].map(
      (v) => ({ value: v, label: v }),
    ),
  ];

  if (!start)
    return (
      <p className="text-sm text-purple">حدّد تاريخ البداية أولاً لعرض توفر العاملات في الفترة.</p>
    );
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const availableCount = (q.data ?? []).filter((w) => w.available).length;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="relative sm:col-span-1">
          <Search size={15} className="absolute right-3 top-3 text-purple" />
          <Input
            className="pr-9"
            placeholder="الاسم أو الرقم الداخلي"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Select
          aria-label="الجنسية"
          value={nat}
          onChange={(e) => setNat(e.target.value)}
          options={opts('nationality', 'كل الجنسيات')}
        />
        <Select
          aria-label="المهنة"
          value={prof}
          onChange={(e) => setProf(e.target.value)}
          options={opts('profession', 'كل المهن')}
        />
        <Select
          aria-label="الفرع"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          options={opts('branch_name', 'كل الفروع')}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-purple">
        <input
          type="checkbox"
          checked={onlyAvailable}
          onChange={(e) => setOnlyAvailable(e.target.checked)}
        />
        المتاحات فقط (<span className="num">{availableCount}</span> من{' '}
        <span className="num">{q.data?.length ?? 0}</span>)
      </label>
      {rows.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="لا عاملات مطابقة"
          description="غيّر الفلاتر أو الفترة."
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((w) => {
            const selected = value === w.id;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  disabled={!w.available}
                  onClick={() => onPick(w)}
                  aria-pressed={selected}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-right transition ${
                    selected
                      ? 'border-navy bg-navy-50'
                      : w.available
                        ? 'border-navy-100 hover:border-navy'
                        : 'cursor-not-allowed border-navy-50 bg-gray-50 opacity-70'
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy-50 text-navy">
                    {selected ? <CheckCircle2 size={18} /> : <UserRound size={18} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-1">
                      <span className="truncate text-sm font-bold text-navy">{w.full_name}</span>
                      <Badge tone={w.available ? 'success' : 'neutral'}>
                        {w.available ? 'متاحة' : (WORKER_STATUS_LABEL[w.status] ?? 'غير متاحة')}
                      </Badge>
                    </span>
                    <span className="block text-xs text-purple">
                      {w.nationality} · {w.profession}
                      {w.branch_name ? ` · ${w.branch_name}` : ''}
                    </span>
                    <span className="num block text-[11px] text-purple">
                      {w.internal_no ?? 'بلا رقم داخلي'}
                      {w.id_no ? ` · ${w.id_no}` : ''}
                    </span>
                    {!w.available && w.reason && (
                      <span className="block text-[11px] text-gold-600">{w.reason}</span>
                    )}
                    {!w.available && w.next_free_date && (
                      <span className="block text-[11px] text-purple">
                        تتوفر من <span className="num">{dateAr(w.next_free_date)}</span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
