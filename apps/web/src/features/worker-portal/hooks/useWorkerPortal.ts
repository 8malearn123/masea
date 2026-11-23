import { useQuery } from '@tanstack/react-query';
import { loadDemo } from '@/lib/demo';
import {
  getWorkerPortal,
  type WorkerPortalLink,
} from '@/features/worker-portal/services/workerPortal';

/** ربط الحساب الحالي بملف العاملة (من الحساب نفسه؛ null = غير مرتبط). */
export function currentWorkerLink(): WorkerPortalLink | null {
  const acc = loadDemo();
  if (!acc || acc.role !== 'worker' || !acc.workerId) return null;
  return { workerId: acc.workerId, residentId: acc.residentId ?? null };
}

/** بيانات لوحة العاملة — تُقرأ من جديد عند كل عرض (الحالة قد يغيّرها الموظفون). */
export function useWorkerPortal(link: WorkerPortalLink | null) {
  return useQuery({
    queryKey: ['worker-portal', link?.workerId ?? 'none', link?.residentId ?? 'none'],
    queryFn: () => getWorkerPortal(link!),
    enabled: link !== null,
    staleTime: 0,
  });
}
