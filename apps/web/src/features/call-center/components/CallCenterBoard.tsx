import { useMemo, useState } from 'react';
import {
  Headphones,
  Phone,
  Plus,
  Search,
  AlarmClock,
  MessageCircle,
  MapPin,
  PhoneIncoming,
} from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useCalls, useUpdateCallStatus } from '@/features/call-center/hooks/useCalls';
import { NewCallModal } from '@/features/call-center/components/NewCallModal';
import { IncomingCallConsole } from '@/features/call-center/components/IncomingCallConsole';
import { FeedbackInbox } from '@/features/chatbot/components/FeedbackInbox';
import { TicketsPanel } from '@/features/call-center/components/TicketsPanel';
import { RetentionPanel } from '@/features/call-center/components/RetentionPanel';
import {
  CALL_STATUS_LABEL,
  CALL_STATUS_TONE,
  CALL_STATUSES,
  CALL_TYPE_LABEL,
  CALL_TYPE_TONE,
  CHANNEL_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type CallLog,
  type CallStatus,
} from '@/features/call-center/types';
import { Eye } from 'lucide-react';

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

const CHANNEL_ICON = { phone: Phone, whatsapp: MessageCircle, walk_in: MapPin } as const;
const DEFAULT_AGENTS = ['ريم الزهراني', 'خالد الدوسري', 'نوال العتيبي'];

export default function CallCenterBoard() {
  const { can, fullName } = usePermissions();
  const editable = can('call_center', 'edit');
  const { data: calls = [], isLoading, isError, refetch } = useCalls();
  const update = useUpdateCallStatus();

  const [status, setStatus] = useState<CallStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [agent, setAgent] = useState('all');
  const [modal, setModal] = useState(false);
  const [console_, setConsole] = useState(false);
  const [consolePhone, setConsolePhone] = useState('');
  const [view, setView] = useState<'calls' | 'tickets' | 'retention' | 'feedback'>('calls');
  const [detail, setDetail] = useState<CallLog | null>(null);

  function openConsoleFor(p: string) {
    setConsolePhone(p);
    setConsole(true);
  }

  const agents = useMemo(() => Array.from(new Set(calls.map((c) => c.agent))), [calls]);

  const counts = useMemo(() => {
    const by = (s: CallStatus) => calls.filter((c) => c.status === s).length;
    return {
      all: calls.length,
      new: by('new'),
      in_progress: by('in_progress'),
      callback: by('callback'),
      resolved: by('resolved'),
      urgent: calls.filter((c) => c.priority === 'high' && c.status !== 'resolved').length,
    };
  }, [calls]);

  const rows = useMemo(() => {
    const q = search.trim();
    return calls.filter(
      (c) =>
        (status === 'all' || c.status === status) &&
        (agent === 'all' || c.agent === agent) &&
        (!q || c.customer_name.includes(q) || c.phone.includes(q) || c.topic.includes(q)),
    );
  }, [calls, status, agent, search]);

  const columns: Column<CallLog>[] = [
    {
      key: 'customer_name',
      header: 'العميل',
      cell: (c) => {
        const Icon = CHANNEL_ICON[c.channel];
        return (
          <div>
            <span className="font-semibold text-navy">{c.customer_name}</span>
            <span className="num mt-0.5 flex items-center gap-1 text-[11px] text-purple">
              <Icon size={11} className="text-gold-600" /> {c.phone} · {CHANNEL_LABEL[c.channel]}
            </span>
          </div>
        );
      },
    },
    {
      key: 'topic',
      header: 'الموضوع',
      cell: (c) => (
        <div className="max-w-xs">
          <div className="flex items-center gap-2">
            <Badge tone={CALL_TYPE_TONE[c.type]}>{CALL_TYPE_LABEL[c.type]}</Badge>
            <span className="text-sm text-navy">{c.topic}</span>
          </div>
          {c.notes && <p className="mt-0.5 truncate text-[11px] text-purple">{c.notes}</p>}
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'الأولوية',
      cell: (c) => <Badge tone={PRIORITY_TONE[c.priority]}>{PRIORITY_LABEL[c.priority]}</Badge>,
    },
    { key: 'agent', header: 'الموظف', cell: (c) => <span className="text-sm">{c.agent}</span> },
    {
      key: 'status',
      header: 'الحالة',
      cell: (c) => <Badge tone={CALL_STATUS_TONE[c.status]}>{CALL_STATUS_LABEL[c.status]}</Badge>,
    },
    {
      key: 'created_at',
      header: 'الوقت',
      cell: (c) => (
        <div>
          <span className="num text-xs">{dateAr(c.created_at)}</span>
          {c.status === 'callback' && c.callback_at && (
            <span className="num mt-0.5 flex items-center gap-1 text-[11px] text-teal">
              <AlarmClock size={11} /> {dateAr(c.callback_at)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (c) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => setDetail(c)}
            title="عرض التفاصيل وما دار في المكالمة"
            className="inline-flex items-center gap-1 rounded-lg border border-navy-100 bg-white px-2 py-1.5 text-xs font-semibold text-navy transition hover:bg-navy-50"
          >
            <Eye size={13} /> تفاصيل
          </button>
          {editable && (
            <select
              value={c.status}
              onChange={(e) => update.mutate({ id: c.id, status: e.target.value as CallStatus })}
              className="rounded-lg border border-navy-100 bg-white px-2 py-1.5 text-xs outline-none focus:border-navy"
            >
              {CALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CALL_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </div>
      ),
    },
  ];

  const PILLS: { value: CallStatus | 'all'; label: string; count: number }[] = [
    { value: 'all', label: 'الكل', count: counts.all },
    { value: 'new', label: CALL_STATUS_LABEL.new, count: counts.new },
    { value: 'in_progress', label: CALL_STATUS_LABEL.in_progress, count: counts.in_progress },
    { value: 'callback', label: CALL_STATUS_LABEL.callback, count: counts.callback },
    { value: 'resolved', label: CALL_STATUS_LABEL.resolved, count: counts.resolved },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <Headphones size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-navy">مركز الاتصال</h1>
            <p className="text-sm text-purple">إدارة مكالمات واستفسارات العملاء.</p>
          </div>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <Button variant="accent" size="sm" onClick={() => setConsole(true)}>
              <span className="flex items-center gap-1.5">
                <PhoneIncoming size={15} /> اتصال وارد
              </span>
            </Button>
            <Button variant="primary" size="sm" onClick={() => setModal(true)}>
              <span className="flex items-center gap-1.5">
                <Plus size={15} /> مكالمة جديدة
              </span>
            </Button>
          </div>
        )}
      </div>

      <div className="mb-4 inline-flex flex-wrap rounded-xl bg-navy-50 p-1">
        <button
          onClick={() => setView('calls')}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${view === 'calls' ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
        >
          المكالمات
        </button>
        <button
          onClick={() => setView('tickets')}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${view === 'tickets' ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
        >
          التذاكر
        </button>
        <button
          onClick={() => setView('retention')}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${view === 'retention' ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
        >
          الاحتفاظ بالعملاء
        </button>
        <button
          onClick={() => setView('feedback')}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${view === 'feedback' ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
        >
          ملاحظات العملاء
        </button>
      </div>

      {view === 'tickets' && <TicketsPanel />}
      {view === 'retention' && <RetentionPanel onCall={openConsoleFor} />}
      {view === 'feedback' && <FeedbackInbox />}

      {view === 'calls' && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="إجمالي المكالمات" value={String(counts.all)} />
            <Kpi label="جديدة" value={String(counts.new)} tone="text-gold-600" />
            <Kpi label="قيد المعالجة" value={String(counts.in_progress)} tone="text-navy" />
            <Kpi label="معاودة اتصال" value={String(counts.callback)} tone="text-teal" />
            <Kpi label="مغلقة" value={String(counts.resolved)} tone="text-green-600" />
            <Kpi label="عاجلة مفتوحة" value={String(counts.urgent)} tone="text-red-600" />
          </div>

          {/* filters */}
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              {PILLS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setStatus(p.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    status === p.value
                      ? 'bg-navy text-white'
                      : 'bg-navy-50 text-navy hover:bg-navy-100'
                  }`}
                >
                  {p.label}
                  <span
                    className={`num rounded-full px-1.5 text-[10px] ${status === p.value ? 'bg-white/20' : 'bg-white text-purple'}`}
                  >
                    {p.count}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
                  <Search size={16} />
                </span>
                <Input
                  placeholder="بحث بالاسم أو الجوال أو الموضوع"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9"
                />
              </div>
              <Select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                options={[
                  { value: 'all', label: 'كل الموظفين' },
                  ...agents.map((a) => ({ value: a, label: a })),
                ]}
              />
            </div>
          </Card>

          <Table
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            emptyTitle="لا توجد مكالمات مطابقة"
          />
        </>
      )}

      <NewCallModal
        open={modal}
        onClose={() => setModal(false)}
        agents={agents.length ? agents : DEFAULT_AGENTS}
      />
      <IncomingCallConsole
        open={console_}
        onClose={() => {
          setConsole(false);
          setConsolePhone('');
        }}
        agent={fullName || 'موظف مركز الاتصال'}
        initialPhone={consolePhone}
      />

      <Modal open={detail !== null} onClose={() => setDetail(null)} title="تفاصيل المكالمة">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold text-navy">{detail.customer_name}</p>
                <p className="num text-xs text-purple">
                  {detail.phone} · {CHANNEL_LABEL[detail.channel]}
                </p>
              </div>
              <Badge tone={CALL_STATUS_TONE[detail.status]}>
                {CALL_STATUS_LABEL[detail.status]}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-navy-50 pt-3">
              <DetailRow label="النوع">
                <Badge tone={CALL_TYPE_TONE[detail.type]}>{CALL_TYPE_LABEL[detail.type]}</Badge>
              </DetailRow>
              <DetailRow label="الأولوية">
                <Badge tone={PRIORITY_TONE[detail.priority]}>
                  {PRIORITY_LABEL[detail.priority]}
                </Badge>
              </DetailRow>
              <DetailRow label="الموظف">{detail.agent}</DetailRow>
              <DetailRow label="الوقت">
                <span className="num">{dateAr(detail.created_at)}</span>
              </DetailRow>
              {detail.callback_at && (
                <DetailRow label="موعد المعاودة">
                  <span className="num">{dateAr(detail.callback_at)}</span>
                </DetailRow>
              )}
              {detail.amount != null && (
                <DetailRow label="المبلغ">
                  <span className="num">{sar(detail.amount)} ر.س</span>
                </DetailRow>
              )}
              {detail.ticket_no && (
                <DetailRow label="التذكرة">
                  <span className="num">{detail.ticket_no}</span>
                </DetailRow>
              )}
            </div>

            <div className="border-t border-navy-50 pt-3">
              <p className="mb-1 text-xs font-semibold text-purple">الموضوع</p>
              <p className="text-navy">{detail.topic}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-purple">
                ما دار في المكالمة (الملاحظات)
              </p>
              {detail.notes.trim() ? (
                <p className="whitespace-pre-line rounded-xl bg-navy-50/60 p-3 text-[13px] leading-relaxed text-navy-900">
                  {detail.notes}
                </p>
              ) : (
                <p className="text-xs text-purple">لا توجد ملاحظات مسجّلة.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-purple">{label}:</span>
      <span className="text-xs font-medium text-navy-900">{children}</span>
    </div>
  );
}
