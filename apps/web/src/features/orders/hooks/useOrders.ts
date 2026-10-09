import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import { orderKeys } from '@/features/orders/api/keys';
import {
  advanceTripStage,
  assignDriver,
  listDrivers,
  listOrders,
  setOrderStatus,
} from '@/features/orders/api/orders.api';
import { recordTripScan } from '@/features/gps/api/gps.api';
import type { Driver, Order, OrderFilters, OrderStatus } from '@/features/orders/types';

const LIST_KEY = ['orders', 'list'] as const;

interface OptimisticCtx {
  snapshots: [QueryKey, unknown][];
}

export function useOrders(filters: OrderFilters) {
  return useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: () => listOrders(filters),
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useDrivers() {
  return useQuery({
    queryKey: orderKeys.drivers(),
    queryFn: listDrivers,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useAssignDriver() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { orderId: string; driverId: string }, OptimisticCtx>({
    mutationFn: ({ orderId, driverId }) => assignDriver(orderId, driverId),
    onMutate: async ({ orderId, driverId }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const drivers = qc.getQueryData<Driver[]>(orderKeys.drivers()) ?? [];
      const driver = drivers.find((d) => d.id === driverId);
      const snapshots = qc.getQueriesData({ queryKey: LIST_KEY });
      qc.setQueriesData<Order[]>({ queryKey: LIST_KEY }, (old) =>
        old?.map((o) =>
          o.id === orderId
            ? {
                ...o,
                driver_id: driverId,
                driver_name: driver?.full_name ?? o.driver_name,
                status: 'assigned',
              }
            : o,
        ),
      );
      return { snapshots };
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(e.message || 'تعذّر الإسناد');
    },
    onSuccess: () => toast.success('تم إسناد السائق'),
  });
}

export function useAdvanceTrip() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    { stage: Order['trip_stage']; status: OrderStatus },
    Error,
    { orderId: string; scanType: string; doneLabel: string }
  >({
    mutationFn: ({ orderId, scanType }) => advanceTripStage(orderId, scanType),
    onSuccess: (res, { orderId, doneLabel }) => {
      qc.setQueriesData<Order[]>({ queryKey: LIST_KEY }, (old) =>
        old?.map((o) =>
          o.id === orderId ? { ...o, trip_stage: res.stage, status: res.status } : o,
        ),
      );
      toast.success(doneLabel);
    },
    onError: (e) => toast.error(e.message || 'تعذّر تحديث الرحلة'),
  });
}

/**
 * مسح خطوة رحلة من شاشة السائق (تسجيل المحاولة + تطبيق الخطوة في عملية واحدة).
 * رسالة النجاح فقط عند قبول الخطوة؛ عند الرفض تبقى المحاولة في السجل موسومة
 * «مرفوض» ويُعاد تحميل الطلبات لتعرض الخطوة الصحيحة.
 */
export function useTripScan() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    Awaited<ReturnType<typeof recordTripScan>>,
    Error,
    Parameters<typeof recordTripScan>[0] & { doneLabel: string }
  >({
    mutationFn: ({ orderId, requestNo, barcode, scanType, lat, lng }) =>
      recordTripScan({ orderId, requestNo, barcode, scanType, lat: lat ?? null, lng: lng ?? null }),
    onSuccess: (res, { orderId, doneLabel }) => {
      qc.setQueriesData<Order[]>({ queryKey: LIST_KEY }, (old) =>
        old?.map((o) =>
          o.id === orderId ? { ...o, trip_stage: res.stage, status: res.status } : o,
        ),
      );
      toast.success(`${doneLabel} — ${res.worker_name}`);
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.error(e.message || 'تعذّر تطبيق المسح');
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['gps', 'trip-scans'] }),
  });
}

export function useSetOrderStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { orderId: string; status: OrderStatus }, OptimisticCtx>({
    mutationFn: ({ orderId, status }) => setOrderStatus(orderId, status),
    onMutate: async ({ orderId, status }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const snapshots = qc.getQueriesData({ queryKey: LIST_KEY });
      qc.setQueriesData<Order[]>({ queryKey: LIST_KEY }, (old) =>
        old?.map((o) => (o.id === orderId ? { ...o, status } : o)),
      );
      return { snapshots };
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(e.message || 'تعذّر التحديث');
    },
    onSuccess: () => toast.success('تم تحديث حالة الطلب'),
  });
}
