/**
 * بوابة العاملة (العرض التجريبي): تجمع بيانات العاملة نفسها فقط من المخازن
 * القائمة دون أي بيانات مختلقة:
 *   - ملفها: كتالوج العاملات (`FALLBACK_WORKERS`).
 *   - سكنها وحالتها والباركود: سجل السكن (`listResidents`) وحركاتها (`listHousingScans`).
 *   - جدولها: حجوزات التوفّر (`bookedRangesOf`).
 *   - مهامها: ملفات الطلبات المُسندة لها + حالة طلب التشغيل المرتبط ومرحلة الرحلة.
 * لا تُعرض بيانات العميل الشخصية (الجوال، العنوان، الهوية) — المدينة والفرع فقط.
 * الربط بالحساب صريح (`workerId`/`residentId` في الحساب)، لا مطابقة بالاسم.
 */
import { FALLBACK_WORKERS, type WorkerProfile } from '@/lib/funnel';
import { bookedRangesOf, type BookedRange } from '@/features/catalog/lib/availability';
import { listHousingScans, listResidents } from '@/features/housing/api/housing.api';
import type { HousingScan, Resident } from '@/features/housing/types';
import { listRequestFiles } from '@/features/requests/api/requests.api';
import type { RequestPeriod } from '@/features/requests/types';
import { findDemoOrderByRequestNo } from '@/features/orders/api/orders.api';
import type { OrderStatus, TripStage } from '@/features/orders/types';

export interface WorkerPortalLink {
  workerId: string;
  residentId: string | null;
}

/** مهمة مُسندة للعاملة — بلا بيانات العميل الشخصية. */
export interface WorkerAssignment {
  requestNo: string;
  serviceName: string;
  city: string;
  branch: string;
  period: RequestPeriod | null;
  /** حالة طلب التشغيل المرتبط؛ null = لا يوجد طلب تشغيل لهذا الرقم. */
  orderStatus: OrderStatus | null;
  tripStage: TripStage | null;
}

export interface WorkerPortal {
  worker: WorkerProfile;
  resident: Resident | null;
  /** حجوزاتها وفترات عدم التوفّر من اليوم فصاعدًا. */
  schedule: BookedRange[];
  assignments: WorkerAssignment[];
  /** آخر حركات الدخول/الخروج من السكن. */
  housingScans: HousingScan[];
}

/** null = الحساب مرتبط بعاملة غير موجودة في الكتالوج. */
export async function getWorkerPortal(link: WorkerPortalLink): Promise<WorkerPortal | null> {
  const worker = FALLBACK_WORKERS.find((w) => w.id === link.workerId);
  if (!worker) return null;

  const [residents, files, scans] = await Promise.all([
    listResidents(),
    listRequestFiles(),
    link.residentId ? listHousingScans(link.residentId) : Promise.resolve([]),
  ]);
  const resident = link.residentId
    ? (residents.find((r) => r.id === link.residentId) ?? null)
    : null;

  const assignments = files
    .filter((f) => f.worker?.id === worker.id)
    .map((f): WorkerAssignment => {
      const order = findDemoOrderByRequestNo(f.request_no);
      return {
        requestNo: f.request_no,
        serviceName: f.service_name,
        city: f.city,
        branch: f.branch,
        period: f.period,
        orderStatus: order?.status ?? null,
        tripStage: order?.trip_stage ?? null,
      };
    })
    .sort((a, b) => (b.period?.startDate ?? '').localeCompare(a.period?.startDate ?? ''));

  return {
    worker,
    resident,
    schedule: [...bookedRangesOf(worker.id)].sort((a, b) => a.start.localeCompare(b.start)),
    assignments,
    housingScans: scans.slice(0, 5),
  };
}
