import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  addTicketUpdate,
  createTicket,
  listTickets,
  updateTicketStatus,
  type NewTicketInput,
  type Ticket,
  type TicketStatus,
} from '@/features/call-center/api/tickets.api';

const KEY = ['call-center', 'tickets'] as const;

export function useTickets() {
  return useQuery({ queryKey: KEY, queryFn: listTickets, staleTime: QUERY_DEFAULTS.staleTime });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Ticket, Error, NewTicketInput>({
    mutationFn: (input) => createTicket(input),
    onSuccess: (ticket) => {
      qc.setQueryData<Ticket[]>(KEY, (old) => [ticket, ...(old ?? [])]);
      toast.success(`تم فتح التذكرة ${ticket.ticket_no}`);
    },
    onError: (e) => toast.error(e.message || 'تعذّر فتح التذكرة'),
  });
}

export function useUpdateTicketStatus() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<
    void,
    Error,
    { id: string; status: TicketStatus },
    { prev: Ticket[] | undefined }
  >({
    mutationFn: ({ id, status }) => updateTicketStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Ticket[]>(KEY);
      qc.setQueryData<Ticket[]>(KEY, (old) =>
        old?.map((t) => (t.id === id ? { ...t, status } : t)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error(e.message || 'تعذّر تحديث التذكرة');
    },
    onSuccess: () => toast.success('تم تحديث حالة التذكرة'),
  });
}

export function useAddTicketUpdate() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, { id: string; text: string; by: string }>({
    mutationFn: ({ id, text, by }) => addTicketUpdate(id, text, by),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success('تمت إضافة المتابعة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إضافة المتابعة'),
  });
}
