import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import {
  bookHourly,
  getHourlyConfig,
  listBusySlots,
  listBookings,
  setBookingStatus,
  type BookingInput,
  type HourlyBooking,
} from '@/features/hourly/api/hourly.api';
import { DEFAULT_HOURLY_CONFIG, type BookingStatus } from '@/features/hourly/lib/hourly';

const KEY = ['hourly'] as const;

export function useBookings() {
  return useQuery({ queryKey: [...KEY, 'bookings'], queryFn: listBookings, staleTime: 30_000 });
}

export function useBusySlots(date: string) {
  return useQuery({
    queryKey: [...KEY, 'busy', date],
    queryFn: () => listBusySlots(date),
    enabled: Boolean(date),
  });
}

export function useHourlyConfig() {
  const q = useQuery({
    queryKey: [...KEY, 'config'],
    queryFn: getHourlyConfig,
    staleTime: 5 * 60_000,
  });
  return q.data ?? DEFAULT_HOURLY_CONFIG;
}

export function useBookHourly() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<HourlyBooking, Error, BookingInput>({
    mutationFn: bookHourly,
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success(`تم الحجز HB-${b.booking_no} — ${b.hours} ساعات`);
    },
    onError: (e) => toast.error(e.message || 'تعذّر الحجز'),
  });
}

const DONE: Partial<Record<BookingStatus, string>> = {
  in_progress: 'تم تسجيل بداية الخدمة',
  completed: 'تم تسجيل نهاية الخدمة',
  cancelled: 'تم إلغاء الحجز',
  no_show: 'تم تسجيل عدم الحضور',
};

export function useSetBookingStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; status: BookingStatus }>({
    mutationFn: ({ id, status }) => setBookingStatus(id, status),
    onSuccess: (_, { status }) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(DONE[status] ?? 'تم التحديث');
    },
    onError: (e) => toast.error(e.message || 'تعذّر التحديث'),
  });
}
