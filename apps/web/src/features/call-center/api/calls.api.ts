import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import type { CallLog, CallStatus, NewCallInput } from '@/features/call-center/types';

const SEED: CallLog[] = [
  {
    id: 'c1',
    customer_name: 'محمد الأحمدي',
    phone: '0501234567',
    topic: 'استفسار عن باقة الاستقدام',
    type: 'inquiry',
    priority: 'medium',
    channel: 'phone',
    status: 'new',
    agent: 'ريم الزهراني',
    notes: 'يرغب بعاملة فلبينية، تواصل خلال أسبوع.',
    callback_at: null,
    created_at: '2026-06-12T08:10:00Z',
  },
  {
    id: 'c2',
    customer_name: 'سارة القحطاني',
    phone: '0552345678',
    topic: 'متابعة طلب تأجير شهري',
    type: 'follow_up',
    priority: 'medium',
    channel: 'whatsapp',
    status: 'in_progress',
    agent: 'ريم الزهراني',
    notes: 'بانتظار توفّر عاملة في فرع جازان.',
    callback_at: null,
    created_at: '2026-06-12T08:25:00Z',
  },
  {
    id: 'c3',
    customer_name: 'فهد العنزي',
    phone: '0533456789',
    topic: 'طلب معاودة اتصال',
    type: 'request',
    priority: 'low',
    channel: 'phone',
    status: 'callback',
    agent: 'خالد الدوسري',
    notes: 'يفضّل الاتصال بعد العصر.',
    callback_at: '2026-06-13T15:00:00Z',
    created_at: '2026-06-12T07:50:00Z',
  },
  {
    id: 'c4',
    customer_name: 'نورة الشهري',
    phone: '0544567890',
    topic: 'شكوى تأخر مباشرة العاملة',
    type: 'complaint',
    priority: 'high',
    channel: 'phone',
    status: 'in_progress',
    agent: 'ريم الزهراني',
    notes: 'تأخر 3 أيام عن الموعد، تحتاج معالجة عاجلة.',
    callback_at: null,
    created_at: '2026-06-11T15:00:00Z',
  },
  {
    id: 'c5',
    customer_name: 'عبدالله الدوسري',
    phone: '0500001111',
    topic: 'تأكيد موعد خدمة يومية',
    type: 'request',
    priority: 'low',
    channel: 'walk_in',
    status: 'resolved',
    agent: 'خالد الدوسري',
    notes: 'تم تأكيد الموعد وإغلاق الطلب.',
    callback_at: null,
    created_at: '2026-06-11T11:00:00Z',
  },
];

/** Mutable in-memory store seeded from demo data; persists for the session. */
const STORE: CallLog[] = SEED.map((c) => ({ ...c }));

export async function listCalls(): Promise<CallLog[]> {
  return STORE.map((c) => ({ ...c }));
}

/**
 * Status change. «معاودة اتصال» needs the callback time (future); any other
 * status clears it.
 */
export async function updateCallStatus(
  id: string,
  status: CallStatus,
  callbackAt: string | null = null,
): Promise<void> {
  if (status === 'callback') {
    if (!callbackAt) throw new Error('حدّد موعد معاودة الاتصال');
    if (new Date(callbackAt).getTime() <= Date.now())
      throw new Error('موعد معاودة الاتصال يجب أن يكون في المستقبل');
  }
  const callback_at = status === 'callback' ? callbackAt : null;
  const row = STORE.find((c) => c.id === id);
  if (row) Object.assign(row, { status, callback_at });
  if (isDemoId(id)) return; // demo row — local store is the source of truth
  const { error } = await supabase.from('call_logs').update({ status, callback_at }).eq('id', id);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

/** Resolving a ticket closes the call(s) that opened it. */
export async function resolveCallsForTicket(ticketNo: string): Promise<void> {
  for (const c of STORE) {
    if (c.ticket_no === ticketNo && c.status !== 'resolved') {
      await updateCallStatus(c.id, 'resolved');
    }
  }
}

/** Callbacks whose time has passed — the agent's overdue queue. */
export function overdueCallbacks(calls: CallLog[], now = new Date()): CallLog[] {
  return calls
    .filter(
      (c) =>
        c.status === 'callback' &&
        c.callback_at &&
        new Date(c.callback_at).getTime() < now.getTime(),
    )
    .sort((a, b) => (a.callback_at ?? '').localeCompare(b.callback_at ?? ''));
}

export async function addCall(input: NewCallInput): Promise<CallLog> {
  const { status = 'new', callback_at = null, ...rest } = input;
  const call: CallLog = {
    id: `c-${Date.now()}`,
    ...rest,
    status,
    callback_at,
    created_at: new Date().toISOString(),
  };
  STORE.unshift({ ...call });

  // Best-effort backend insert; demo ids/missing table are ignored.
  const { error } = await supabase.from('call_logs').insert({
    customer_name: input.customer_name,
    phone: input.phone,
    topic: input.topic,
    agent: input.agent,
    status: 'new',
  });
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
  return call;
}
