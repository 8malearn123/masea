import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { Badge, Button, Card, Skeleton, useToast } from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import {
  driverTaskStep,
  listMyDriverTasks,
  TASK_KIND_LABEL,
  TASK_STATUS_LABEL,
  type DriverTask,
} from '@/features/contracts/api/workersDrivers.api';

/** مهام التوصيل والاستلام المُسندة للسائق من العقود (0095) — يحدّث حالتها بنفسه. */
export function DriverContractTasks() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['contracts', 'my-driver-tasks'], queryFn: listMyDriverTasks });
  const step = useMutation({
    mutationFn: ({ t, a }: { t: DriverTask; a: 'start' | 'done' }) => driverTaskStep(t, a),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      toast.success('حُدّثت المهمة');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const open = (q.data ?? []).filter((t) => t.status === 'assigned' || t.status === 'on_the_way');
  if (q.isLoading) return <Skeleton className="mb-5 h-20 w-full" />;
  if (open.length === 0) return null;
  return (
    <div className="mb-5 space-y-2">
      <h2 className="text-sm font-bold text-navy">مهام العقود (توصيل واستلام العاملات)</h2>
      {open.map((t) => (
        <Card key={t.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-navy">
              {TASK_KIND_LABEL[t.kind]} · <span className="num">{t.task_no}</span>
            </p>
            <Badge tone={t.status === 'on_the_way' ? 'teal' : 'navy'}>
              {TASK_STATUS_LABEL[t.status]}
            </Badge>
          </div>
          <p className="num text-xs text-purple">
            {dateTimeAr(t.starts_at)} ← {dateTimeAr(t.ends_at)}
          </p>
          {t.address && (
            <p className="flex items-center gap-1 text-xs text-navy-900">
              <MapPin size={12} /> {t.address}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {t.status === 'assigned' && (
              <Button
                size="sm"
                disabled={step.isPending}
                onClick={() => step.mutate({ t, a: 'start' })}
              >
                في الطريق
              </Button>
            )}
            <Button
              size="sm"
              variant="success"
              disabled={step.isPending}
              onClick={() => step.mutate({ t, a: 'done' })}
            >
              تم التنفيذ
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
