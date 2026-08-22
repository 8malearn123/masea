import { useState } from 'react';
import { MessageSquarePlus, Clock, CheckCircle2 } from 'lucide-react';
import { Badge, Button, Card, Modal, Table, type Column } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useAddTicketUpdate,
  useTickets,
  useUpdateTicketStatus,
} from '@/features/call-center/hooks/useTickets';
import {
  TICKET_STATUSES,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  type Ticket,
  type TicketStatus,
} from '@/features/call-center/api/tickets.api';
import { PRIORITY_LABEL, PRIORITY_TONE } from '@/features/call-center/types';

function Kpi({
  label,
  value,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="text-xs text-purple">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

export function TicketsPanel() {
  const { fullName } = usePermissions();
  const { data: tickets = [], isLoading, isError, refetch } = useTickets();
  const updateStatus = useUpdateTicketStatus();
  const addUpdate = useAddTicketUpdate();
  const [active, setActive] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');

  const by = (s: TicketStatus) => tickets.filter((t) => t.status === s).length;
  const current = active ? (tickets.find((t) => t.id === active.id) ?? active) : null;

  const columns: Column<Ticket>[] = [
    {
      key: 'ticket_no',
      header: 'رقم التذكرة',
      cell: (t) => <span className="num font-bold text-navy">{t.ticket_no}</span>,
    },
    {
      key: 'customer',
      header: 'العميل',
      cell: (t) => (
        <div>
          <span className="font-semibold text-navy">{t.customer_name}</span>
          <span className="num block text-[11px] text-purple">{t.phone}</span>
        </div>
      ),
    },
    {
      key: 'subject',
      header: 'الموضوع',
      cell: (t) => <span className="text-sm">{t.subject}</span>,
    },
    { key: 'team', header: 'الفريق', cell: (t) => <Badge tone="navy">{t.team}</Badge> },
    {
      key: 'priority',
      header: 'الأولوية',
      cell: (t) => <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (t) => (
        <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'تاريخ الفتح',
      cell: (t) => <span className="num text-xs">{dateAr(t.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '',
      cell: (t) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setActive(t);
            setReply('');
          }}
        >
          متابعة
        </Button>
      ),
    },
  ];

  function sendReply() {
    if (!current || !reply.trim()) return;
    addUpdate.mutate({ id: current.id, text: reply.trim(), by: fullName || 'موظف' });
    setReply('');
  }

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="مفتوحة" value={String(by('open'))} tone="text-gold-600" />
        <Kpi label="قيد المعالجة" value={String(by('in_progress'))} tone="text-navy" />
        <Kpi label="بانتظار العميل" value={String(by('pending_customer'))} tone="text-teal" />
        <Kpi label="محلولة" value={String(by('resolved'))} tone="text-green-600" />
      </div>

      <Table
        columns={columns}
        rows={tickets}
        rowKey={(t) => t.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد تذاكر"
      />

      <Modal
        open={!!current}
        onClose={() => setActive(null)}
        title={current ? `تذكرة ${current.ticket_no}` : ''}
      >
        {current && (
          <div className="space-y-3">
            <div className="rounded-xl bg-navy-50/60 p-3 text-sm">
              <p className="font-bold text-navy">{current.subject}</p>
              <p className="mt-1 text-[11px] text-purple">
                {current.customer_name} · <span className="num">{current.phone}</span> · الفريق:{' '}
                {current.team}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone={PRIORITY_TONE[current.priority]}>
                  {PRIORITY_LABEL[current.priority]}
                </Badge>
                <Badge tone={TICKET_STATUS_TONE[current.status]}>
                  {TICKET_STATUS_LABEL[current.status]}
                </Badge>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-purple">تغيير الحالة</label>
              <select
                value={current.status}
                onChange={(e) =>
                  updateStatus.mutate({ id: current.id, status: e.target.value as TicketStatus })
                }
                className="w-full rounded-xl border border-navy-100 bg-white px-3 py-2 text-sm outline-none focus:border-navy"
              >
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TICKET_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-navy">
                <Clock size={13} /> سجل المتابعة
              </p>
              <ul className="max-h-40 space-y-2 overflow-y-auto">
                {current.updates.length === 0 && (
                  <li className="text-xs text-purple">لا توجد متابعات بعد.</li>
                )}
                {current.updates.map((u, i) => (
                  <li key={i} className="rounded-lg border border-navy-50 p-2">
                    <p className="text-xs text-navy">{u.text}</p>
                    <p className="num mt-0.5 text-[10px] text-purple">
                      {u.by} · {dateAr(u.at)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-purple">إضافة متابعة</label>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={2}
                placeholder="تحديث للعميل أو ملاحظة داخلية…"
                className="w-full rounded-xl border border-navy-100 bg-white px-3 py-2 text-xs outline-none focus:border-navy"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  loading={addUpdate.isPending}
                  onClick={sendReply}
                >
                  <span className="flex items-center gap-1.5">
                    <MessageSquarePlus size={14} /> إضافة
                  </span>
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-navy-50 pt-3">
              <Button variant="ghost" size="sm" onClick={() => setActive(null)}>
                إغلاق النافذة
              </Button>
              {current.status !== 'resolved' && (
                <Button
                  variant="primary"
                  size="sm"
                  loading={updateStatus.isPending}
                  onClick={() => {
                    updateStatus.mutate({ id: current.id, status: 'resolved' });
                    setActive(null);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={15} /> تحديد كمحلولة وإغلاق
                  </span>
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
