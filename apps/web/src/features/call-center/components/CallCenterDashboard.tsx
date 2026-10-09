import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Headphones,
  PhoneCall,
  PhoneIncoming,
  Repeat2,
  Ticket as TicketIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, Card } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useCalls } from '@/features/call-center/hooks/useCalls';
import { useTickets } from '@/features/call-center/hooks/useTickets';
import {
  CALL_STATUS_LABEL,
  CALL_STATUS_TONE,
  CALL_TYPE_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
} from '@/features/call-center/types';
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from '@/features/call-center/api/tickets.api';

function Kpi({
  icon: Icon,
  label,
  value,
  bg,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  bg: string;
}) {
  return (
    <Card className="flex items-center gap-3 py-4">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${bg}`}>
        <Icon size={20} />
      </span>
      <div>
        <p className="num text-2xl font-bold leading-none text-navy">{value}</p>
        <p className="mt-1 text-xs text-purple">{label}</p>
      </div>
    </Card>
  );
}

/** Call-center cockpit — today's queue, open tickets, retention follow-ups. */
export function CallCenterDashboard() {
  const { data: calls = [] } = useCalls();
  const { data: tickets = [] } = useTickets();

  const stats = useMemo(
    () => ({
      newCalls: calls.filter((c) => c.status === 'new').length,
      inProgress: calls.filter((c) => c.status === 'in_progress').length,
      callbacks: calls.filter((c) => c.status === 'callback').length,
      openTickets: tickets.filter((t) => t.status !== 'resolved').length,
    }),
    [calls, tickets],
  );

  // queue: unresolved calls, newest first; callbacks surfaced
  const queue = useMemo(
    () =>
      [...calls]
        .filter((c) => c.status !== 'resolved')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 8),
    [calls],
  );
  const openTickets = useMemo(
    () => tickets.filter((t) => t.status !== 'resolved').slice(0, 6),
    [tickets],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={PhoneIncoming}
          label="مكالمات جديدة"
          value={stats.newCalls}
          bg="bg-navy-50 text-navy"
        />
        <Kpi
          icon={PhoneCall}
          label="قيد المعالجة"
          value={stats.inProgress}
          bg="bg-gold-100 text-gold-600"
        />
        <Kpi
          icon={Repeat2}
          label="معاودة اتصال"
          value={stats.callbacks}
          bg="bg-teal-100 text-teal"
        />
        <Kpi
          icon={TicketIcon}
          label="تذاكر مفتوحة"
          value={stats.openTickets}
          bg="bg-navy-50 text-navy"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* today's call queue */}
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
              <Headphones size={16} /> قائمة المكالمات
            </h2>
            <Link
              to="/call-center"
              className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
            >
              فتح مركز الاتصال <ArrowLeft size={13} />
            </Link>
          </div>
          {queue.length === 0 ? (
            <p className="py-6 text-center text-sm text-purple">لا توجد مكالمات قيد المعالجة.</p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {queue.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-navy-900">
                      {c.customer_name}
                      <Badge tone={PRIORITY_TONE[c.priority]}>{PRIORITY_LABEL[c.priority]}</Badge>
                    </p>
                    <p className="num text-[11px] text-purple">
                      {CALL_TYPE_LABEL[c.type]} · {dateAr(c.created_at)}
                    </p>
                  </div>
                  <Badge tone={CALL_STATUS_TONE[c.status]}>{CALL_STATUS_LABEL[c.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* open tickets */}
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <TicketIcon size={16} /> تذاكر مفتوحة
          </h2>
          {openTickets.length === 0 ? (
            <p className="py-6 text-center text-sm text-purple">
              <CheckCircle2 size={20} className="mx-auto mb-1 text-teal" /> لا تذاكر مفتوحة.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {openTickets.map((t) => (
                <li key={t.id} className="rounded-xl border border-navy-100 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="num text-[11px] font-bold text-navy">{t.ticket_no}</span>
                    <Badge tone={TICKET_STATUS_TONE[t.status]}>
                      {TICKET_STATUS_LABEL[t.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-navy-900">{t.subject}</p>
                  <p className="text-[11px] text-purple">
                    {t.customer_name} · {t.team}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
