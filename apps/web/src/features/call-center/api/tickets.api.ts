import type { BadgeTone } from '@/shared/ui/Badge';
import type { CallPriority } from '@/features/call-center/types';

export type TicketStatus = 'open' | 'in_progress' | 'pending_customer' | 'resolved';

export interface TicketUpdate {
  at: string;
  by: string;
  text: string;
}

export interface Ticket {
  id: string;
  ticket_no: string;
  customer_name: string;
  phone: string;
  subject: string;
  team: string;
  priority: CallPriority;
  status: TicketStatus;
  created_at: string;
  updates: TicketUpdate[];
}

export interface NewTicketInput {
  customer_name: string;
  phone: string;
  subject: string;
  team: string;
  priority: CallPriority;
  description: string;
  by: string;
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'مفتوحة',
  in_progress: 'قيد المعالجة',
  pending_customer: 'بانتظار العميل',
  resolved: 'محلولة',
};

export const TICKET_STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  open: 'gold',
  in_progress: 'navy',
  pending_customer: 'teal',
  resolved: 'success',
};

export const TICKET_STATUSES: TicketStatus[] = [
  'open',
  'in_progress',
  'pending_customer',
  'resolved',
];

export const TICKET_TEAMS = ['العمليات', 'الجودة', 'المالية', 'الدعم الفني', 'القانوني'];

let seq = 70;
function nextNo(): string {
  seq += 1;
  return `TKT-${seq}`;
}

const STORE: Ticket[] = [
  {
    id: 't-seed-1',
    ticket_no: 'TKT-58',
    customer_name: 'نورة الشهري',
    phone: '0544567890',
    subject: 'تأخر مباشرة العاملة 3 أيام',
    team: 'العمليات',
    priority: 'high',
    status: 'in_progress',
    created_at: '2026-06-11T15:10:00Z',
    updates: [
      {
        at: '2026-06-11T15:10:00Z',
        by: 'ريم الزهراني',
        text: 'تم فتح التذكرة وتحويلها لقسم العمليات.',
      },
      {
        at: '2026-06-12T09:00:00Z',
        by: 'فهد الشهري',
        text: 'جارٍ تنسيق موعد بديل مع المكتب الخارجي.',
      },
    ],
  },
  {
    id: 't-seed-2',
    ticket_no: 'TKT-61',
    customer_name: 'سارة القحطاني',
    phone: '0552345678',
    subject: 'طلب استرجاع جزئي لعقد منتهٍ',
    team: 'المالية',
    priority: 'medium',
    status: 'pending_customer',
    created_at: '2026-06-10T11:30:00Z',
    updates: [
      { at: '2026-06-10T11:30:00Z', by: 'خالد الدوسري', text: 'تم استلام الطلب وإرساله للمالية.' },
      {
        at: '2026-06-11T10:00:00Z',
        by: 'بدر المالكي',
        text: 'بانتظار إرسال العميل للآيبان لإتمام التحويل.',
      },
    ],
  },
];

export async function listTickets(): Promise<Ticket[]> {
  return STORE.map((t) => ({ ...t, updates: [...t.updates] }));
}

export async function createTicket(input: NewTicketInput): Promise<Ticket> {
  const now = new Date().toISOString();
  const ticket: Ticket = {
    id: `t-${Date.now()}`,
    ticket_no: nextNo(),
    customer_name: input.customer_name,
    phone: input.phone,
    subject: input.subject,
    team: input.team,
    priority: input.priority,
    status: 'open',
    created_at: now,
    updates: input.description ? [{ at: now, by: input.by, text: input.description }] : [],
  };
  STORE.unshift(ticket);
  return { ...ticket, updates: [...ticket.updates] };
}

export async function updateTicketStatus(id: string, status: TicketStatus): Promise<void> {
  const t = STORE.find((x) => x.id === id);
  if (t) t.status = status;
}

export async function addTicketUpdate(id: string, text: string, by: string): Promise<void> {
  const t = STORE.find((x) => x.id === id);
  if (t) t.updates.push({ at: new Date().toISOString(), by, text });
}
