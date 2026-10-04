import { useEffect, useRef, useState } from 'react';
import {
  PhoneIncoming,
  Search,
  User,
  UserRound,
  Clock,
  Star,
  FileText,
  Bot,
  Send,
  NotebookPen,
  X,
  CheckCircle2,
  AlarmClock,
  Banknote,
  ShieldAlert,
  Gift,
  Ticket as TicketIcon,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Phone,
  MapPin,
  Package,
} from 'lucide-react';
import { Badge, Button, Input, Select } from '@/shared/ui';
import type { BadgeTone } from '@/shared/ui/Badge';
import { dateAr, sar } from '@/shared/lib/format';
import { calcPriceDetail } from '@/shared/lib/pricing';
import type { ServiceCode } from '@/lib/funnel';
import { NATIONALITIES, TASK_TYPES, emptyDraft } from '@/lib/orderTypes';
import { useCreateRequest } from '@/hooks/useCreateRequest';
import { useAddCall, useCalls } from '@/features/call-center/hooks/useCalls';
import { useCreateTicket, useTickets } from '@/features/call-center/hooks/useTickets';
import { TICKET_TEAMS } from '@/features/call-center/api/tickets.api';
import { lookupCustomer, type DirectoryCustomer } from '@/features/call-center/data/directory';
import { searchPolicies, POLICIES, type Policy } from '@/features/call-center/data/policies';
import {
  assessCustomer,
  RISK_LABEL,
  RISK_TONE,
  type RetentionOffer,
} from '@/features/call-center/data/retention';
import {
  CALL_STATUS_LABEL,
  CALL_STATUS_TONE,
  PRIORITY_LABEL,
  PRIORITIES,
  type CallPriority,
  type CallStatus,
} from '@/features/call-center/types';

/** last-9-digit match so the console and directory agree on phone identity. */
function samePhone(a: string, b: string): boolean {
  return a.replace(/\D/g, '').slice(-9) === b.replace(/\D/g, '').slice(-9);
}

const SERVICES: { code: ServiceCode; label: string }[] = [
  { code: 'recruitment', label: 'استقدام' },
  { code: 'monthly_rental', label: 'تأجير شهري' },
  { code: 'daily_rental', label: 'خدمة يومية' },
  { code: 'sponsorship_transfer', label: 'نقل كفالة' },
];
const SERVICE_LABEL: Record<ServiceCode, string> = {
  recruitment: 'استقدام',
  monthly_rental: 'تأجير شهري',
  daily_rental: 'خدمة يومية',
  sponsorship_transfer: 'نقل كفالة',
};

/** Demo numbers wired to the directory — clickable shortcuts for agents. */
const DEMO_PHONES = ['0501234567', '0552345678', '0544567890'];

/** Category → badge tone for the policy browser. */
const CATEGORY_TONE: Record<string, BadgeTone> = {
  المالية: 'gold',
  العمليات: 'teal',
  الاستبدال: 'navy',
  الضمان: 'success',
  القانوني: 'navy',
  الخدمات: 'teal',
  الجودة: 'danger',
};

interface ChatMsg {
  role: 'user' | 'bot';
  text: string;
  policy?: Policy;
}

const GREETING =
  'مرحباً، اكتب استفسار العميل الوارد (استبدال، استرجاع، تأخر مباشرة، ضمان، نقل كفالة…) وسأزوّدك بالإجابة مع السياسة المرجعية التي استندت إليها.';

/** Elapsed-call clock as mm:ss. */
function fmtClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function IncomingCallConsole({
  open,
  onClose,
  agent,
  initialPhone = '',
}: {
  open: boolean;
  onClose: () => void;
  agent: string;
  initialPhone?: string;
}) {
  const add = useAddCall();
  const createTicket = useCreateTicket();
  const createRequest = useCreateRequest();
  const { data: tickets = [] } = useTickets();
  const { data: allCalls = [] } = useCalls();
  const [phone, setPhone] = useState('');
  const [searched, setSearched] = useState(false);
  const [customer, setCustomer] = useState<DirectoryCustomer | null>(null);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([{ role: 'bot', text: GREETING }]);
  const [notes, setNotes] = useState('');
  const [panel, setPanel] = useState<'none' | 'deal' | 'ticket' | 'callback'>('none');
  const [tab, setTab] = useState<'history' | 'retention'>('history');
  const [polSearch, setPolSearch] = useState('');
  const [openPolicy, setOpenPolicy] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [closeMsg, setCloseMsg] = useState<string | null>(null);
  const [deal, setDeal] = useState<{
    service: ServiceCode;
    nationality: string;
    profession: string;
    quantity: number;
  }>({
    service: 'recruitment',
    nationality: 'الفلبين',
    profession: 'تنظيف',
    quantity: 1,
  });
  const [ticket, setTicket] = useState({
    subject: '',
    team: TICKET_TEAMS[0] ?? '',
    priority: 'high' as CallPriority,
  });
  const [callbackAt, setCallbackAt] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  const busy = add.isPending || createTicket.isPending || createRequest.isPending;

  const dealDetail = calcPriceDetail(deal.service, {
    nationality: deal.nationality,
    profession: deal.service === 'daily_rental' ? deal.profession : undefined,
    quantity: Math.max(deal.quantity, 1),
  });

  const openTickets = customer
    ? tickets.filter((t) => samePhone(t.phone, customer.phone) && t.status !== 'resolved').length
    : 0;
  const assessment = customer ? assessCustomer(customer, openTickets) : null;

  // «سجل التواصل» يدمج سجل الدليل الثابت مع المكالمات المُسجَّلة فعلياً لهذا الرقم،
  // فتنعكس كل مكالمة سجّلها الموظف فور حفظها (topic + الحالة + الملاحظات).
  const phoneForHistory = customer?.phone ?? phone;
  const commHistory: {
    date: string;
    topic: string;
    status: CallStatus;
    notes?: string | undefined;
  }[] = [
    ...allCalls
      .filter((c) => phoneForHistory.trim() !== '' && samePhone(c.phone, phoneForHistory))
      .map((c) => ({ date: c.created_at, topic: c.topic, status: c.status, notes: c.notes })),
    ...(customer?.history ?? []).map((h) => ({
      date: h.date,
      topic: h.topic,
      status: h.status,
      notes: undefined as string | undefined,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  // Incoming calls are logged MANUALLY against the agent — the console cannot
  // be dismissed until the caller is looked up and an inquiry is recorded, so
  // every handled call ends up saved with the employee's name.
  const hasInquiry = notes.trim() !== '' || messages.some((m) => m.role === 'user');
  const started = phone.trim() !== '' || hasInquiry;
  const requiredMet = searched && phone.trim() !== '' && hasInquiry;

  function attemptClose() {
    if (!started) {
      onClose();
      return;
    }
    if (busy) return;
    setCloseMsg(
      requiredMet
        ? 'لإنهاء المكالمة اختر أحد الإجراءات بالأسفل حتى تُحفظ باسمك في السجل.'
        : 'لا يمكن إغلاق المكالمة قبل إدخال رقم العميل وتسجيل الاستفسار، ثم أنهِها بأحد الإجراءات.',
    );
  }

  const q = polSearch.trim();
  const filteredPolicies = q
    ? POLICIES.filter(
        (p) =>
          p.title.includes(q) ||
          p.category.includes(q) ||
          p.answer.includes(q) ||
          p.keywords.some((k) => k.includes(q)),
      )
    : POLICIES;

  const closeRef = useRef<() => void>(() => {});
  closeRef.current = attemptClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Any agent action clears a pending blocked-close warning.
  useEffect(() => {
    setCloseMsg(null);
  }, [phone, notes, messages, searched]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open && initialPhone) {
      setPhone(initialPhone);
      setCustomer(lookupCustomer(initialPhone));
      setSearched(true);
    }
  }, [open, initialPhone]);

  // Live recording clock — restarts each time the console opens.
  useEffect(() => {
    if (!open) return;
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  function reset() {
    setPhone('');
    setSearched(false);
    setCustomer(null);
    setQuery('');
    setMessages([{ role: 'bot', text: GREETING }]);
    setNotes('');
    setPanel('none');
    setTab('history');
    setPolSearch('');
    setOpenPolicy(null);
    setCloseMsg(null);
    setTicket({ subject: '', team: TICKET_TEAMS[0] ?? '', priority: 'high' });
    setDeal({ service: 'recruitment', nationality: 'الفلبين', profession: 'تنظيف', quantity: 1 });
    setCallbackAt('');
  }

  const lastUser = () => [...messages].reverse().find((m) => m.role === 'user')?.text;
  const customerName = () => customer?.name ?? 'عميل جديد';

  function doLookup(value: string = phone) {
    setCustomer(lookupCustomer(value));
    setSearched(true);
    setTab('history');
  }

  function pickDemo(p: string) {
    setPhone(p);
    doLookup(p);
  }

  function ask() {
    const text = query.trim();
    if (!text) return;
    const results = searchPolicies(text);
    const bot: ChatMsg = results[0]
      ? { role: 'bot', text: results[0].answer, policy: results[0] }
      : {
          role: 'bot',
          text: 'لم أجد سياسة مطابقة. جرّب كلمة أوضح مثل: استبدال، استرجاع، ضمان، نقل كفالة، تأخر مباشرة.',
        };
    setMessages((m) => [...m, { role: 'user', text }, bot]);
    setQuery('');
  }

  function addToNotes(text: string) {
    setNotes((n) => (n ? `${n}\n— ${text}` : `— ${text}`));
  }

  const done = {
    onSuccess: () => {
      reset();
      onClose();
    },
  };

  function resolveInquiry() {
    if (!phone.trim()) return;
    // لا يُغلق الاستفسار قبل تدوين ما دار في المكالمة (متطلب جودة).
    if (!notes.trim()) {
      setCloseMsg('اكتب ملاحظات المكالمة (ما دار فيها) قبل إغلاق الاستفسار.');
      return;
    }
    add.mutate(
      {
        customer_name: customerName(),
        phone: phone.trim(),
        topic: lastUser() || 'استفسار عام',
        type: 'inquiry',
        priority: 'low',
        channel: 'phone',
        agent,
        notes,
        status: 'resolved',
      },
      done,
    );
  }

  function scheduleCallback() {
    if (!phone.trim() || !callbackAt) return;
    add.mutate(
      {
        customer_name: customerName(),
        phone: phone.trim(),
        topic: lastUser() || 'طلب معاودة اتصال',
        type: 'request',
        priority: 'medium',
        channel: 'phone',
        agent,
        notes,
        status: 'callback',
        callback_at: new Date(callbackAt).toISOString(),
      },
      done,
    );
  }

  function applyRetention(o: RetentionOffer) {
    if (!phone.trim()) return;
    add.mutate(
      {
        customer_name: customerName(),
        phone: phone.trim(),
        topic: `إجراء احتفاظ: ${o.label}`,
        type: 'follow_up',
        priority: 'high',
        channel: 'phone',
        agent,
        notes: notes
          ? `${notes}\n[عرض احتفاظ] ${o.label} — ${o.detail}`
          : `[عرض احتفاظ] ${o.label} — ${o.detail}`,
        status: 'resolved',
      },
      done,
    );
  }

  // Closing a deal runs the REAL direct-sale pipeline: price comes from the
  // pricing engine, a service_request (order) is created, then the call is
  // logged as a sale linked to that order number.
  function closeDeal() {
    if (!phone.trim()) return;
    const total = dealDetail.total;
    const draft = {
      ...emptyDraft(deal.service),
      customerName: customerName(),
      phone: phone.trim(),
      nationality: deal.nationality,
      profession: deal.profession,
      taskType: deal.profession,
      months: deal.quantity,
      days: deal.quantity,
    };
    createRequest.mutate(
      {
        draft,
        price: { base: dealDetail.base, vat: dealDetail.vat, total },
        serviceName: SERVICE_LABEL[deal.service],
      },
      {
        onSuccess: (res) => {
          add.mutate(
            {
              customer_name: customerName(),
              phone: phone.trim(),
              topic: `بيع: ${SERVICE_LABEL[deal.service]} — طلب ${res.requestNo}`,
              type: 'sale',
              priority: 'medium',
              channel: 'phone',
              agent,
              notes: notes ? `${notes}\n[طلب بيع ${res.requestNo}]` : `[طلب بيع ${res.requestNo}]`,
              amount: total,
              status: 'resolved',
            },
            done,
          );
        },
      },
    );
  }

  function openTicket() {
    if (!phone.trim() || !ticket.subject.trim()) return;
    createTicket.mutate(
      {
        customer_name: customerName(),
        phone: phone.trim(),
        subject: ticket.subject.trim(),
        team: ticket.team,
        priority: ticket.priority,
        description: notes,
        by: agent,
      },
      {
        onSuccess: (t) => {
          add.mutate(
            {
              customer_name: customerName(),
              phone: phone.trim(),
              topic: ticket.subject.trim(),
              type: 'complaint',
              priority: ticket.priority,
              channel: 'phone',
              agent,
              notes: notes ? `${notes}\n[تذكرة ${t.ticket_no}]` : `[تذكرة ${t.ticket_no}]`,
              ticket_no: t.ticket_no,
              status: 'in_progress',
            },
            done,
          );
        },
      },
    );
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3"
      role="dialog"
      aria-modal="true"
      onClick={attemptClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-navy-50/40 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between bg-gradient-to-l from-navy to-navy-700 px-5 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            <PhoneIncoming size={20} />
            <h2 className="text-base font-bold">كونسول اتصال وارد</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold sm:flex">
              <User size={12} /> {agent}
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              مدة المكالمة
              <span className="num tabular-nums">{fmtClock(seconds)}</span>
            </span>
            <button
              onClick={attemptClose}
              className="rounded-lg p-1 hover:bg-white/10"
              aria-label="إغلاق"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* incoming-only notice */}
        <div className="flex items-center gap-2 border-b border-gold-100 bg-gold-100/50 px-5 py-2 text-[11.5px] text-gold-600">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            المكالمات <b>واردة فقط</b> — لا يُجري النظام أي اتصال؛ يسجّل الموظف تفاصيل المكالمة
            يدوياً لأغراض المتابعة والجودة.
          </span>
        </div>

        {/* phone bar */}
        <div className="border-b border-navy-100 bg-white px-5 py-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-purple">رقم المتصل</label>
              <div className="relative">
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
                  <Search size={16} />
                </span>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doLookup()}
                  placeholder="05XXXXXXXX"
                  inputMode="tel"
                  className="num pr-9"
                />
              </div>
            </div>
            <Button variant="primary" size="md" onClick={() => doLookup()}>
              <span className="flex items-center gap-1.5">
                <Search size={15} /> بحث
              </span>
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-purple">جرّب أرقام تجريبية:</span>
            {DEMO_PHONES.map((p) => (
              <button
                key={p}
                onClick={() => pickDemo(p)}
                className="num rounded-lg border border-navy-100 bg-navy-50/60 px-2 py-0.5 text-[11px] font-semibold text-navy transition hover:border-navy hover:bg-navy-50"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* blocked-close warning */}
        {closeMsg && (
          <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-5 py-2 text-[11.5px] font-semibold text-red-700">
            <AlertTriangle size={14} className="shrink-0" /> {closeMsg}
          </div>
        )}

        {/* body: policies · chat · customer */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-3">
          {/* left: policy browser */}
          <div className="flex min-h-0 flex-col border-navy-100 p-4 lg:border-l">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy">
              <BookOpen size={15} className="text-navy" /> السياسات واللوائح
            </h3>
            <div className="relative mb-2">
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
                <Search size={15} />
              </span>
              <Input
                value={polSearch}
                onChange={(e) => setPolSearch(e.target.value)}
                placeholder="ابحث في السياسات…"
                className="pr-9 text-xs"
              />
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {filteredPolicies.length === 0 ? (
                <div className="grid h-full place-items-center text-center text-xs text-purple">
                  لا توجد سياسة مطابقة.
                </div>
              ) : (
                filteredPolicies.map((p) => {
                  const isOpen = openPolicy === p.id;
                  return (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-xl border border-navy-100 bg-white"
                    >
                      <button
                        onClick={() => setOpenPolicy((o) => (o === p.id ? null : p.id))}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-right"
                        aria-expanded={isOpen}
                      >
                        <span className="flex-1 text-xs font-semibold text-navy">{p.title}</span>
                        <Badge tone={CATEGORY_TONE[p.category] ?? 'neutral'}>{p.category}</Badge>
                        <ChevronDown
                          size={15}
                          className={`shrink-0 text-purple transition ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {isOpen && (
                        <div className="border-t border-navy-50 px-3 py-2.5">
                          <p className="text-[11px] leading-relaxed text-purple">{p.answer}</p>
                          <button
                            onClick={() => addToNotes(`${p.title}: ${p.answer}`)}
                            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 text-[10px] font-semibold text-navy hover:bg-navy-100"
                          >
                            <NotebookPen size={11} /> أضف للملاحظات
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* middle: assistant chat + notes */}
          <div className="flex min-h-0 flex-col border-navy-100 p-4 lg:border-l">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-navy">
                <Bot size={15} className="text-teal" /> محادثة الرد والاستفسار
              </h3>
              <span className="text-[10px] text-purple">مدعومة بمحرك السياسات</span>
            </div>
            <div
              className="flex-1 space-y-2 overflow-y-auto rounded-2xl bg-white p-3 shadow-card"
              style={{ minHeight: 160 }}
            >
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-left' : 'text-right'}>
                  <div
                    className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-xs ${m.role === 'user' ? 'bg-navy text-white' : 'bg-navy-50 text-navy'}`}
                  >
                    {m.policy && (
                      <p className="mb-0.5 font-bold text-gold-600">
                        {m.policy.category} · {m.policy.title}
                      </p>
                    )}
                    <p className="leading-relaxed">{m.text}</p>
                    {m.policy && (
                      <button
                        onClick={() => addToNotes(`${m.policy!.title}: ${m.policy!.answer}`)}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-semibold text-navy hover:bg-navy-50"
                      >
                        <NotebookPen size={11} /> أضف للملاحظات
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder="اكتب استفسار العميل…"
              />
              <Button variant="accent" size="md" onClick={ask} aria-label="إرسال">
                <Send size={15} />
              </Button>
            </div>
            <label className="mb-1 mt-3 flex items-center justify-between text-xs font-medium text-purple">
              <span>
                ملاحظات المكالمة <span className="text-red-600">*</span>
              </span>
              <span className="text-[10px] text-purple/80">مطلوبة لإغلاق الاستفسار</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="دوّن ما دار في المكالمة قبل الإغلاق…"
              className={`w-full rounded-xl border bg-white px-3 py-2 text-xs outline-none focus:border-navy ${
                notes.trim() ? 'border-navy-100' : 'border-gold-300'
              }`}
            />
          </div>

          {/* right: customer */}
          <div className="min-h-0 space-y-3 overflow-y-auto p-4">
            {!searched ? (
              <div className="grid h-full place-items-center text-center text-sm text-purple">
                <div>
                  <User size={28} className="mx-auto mb-2 text-navy-100" />
                  أدخل رقم المتصل لعرض بياناته
                </div>
              </div>
            ) : customer ? (
              <>
                <div className="rounded-2xl bg-white p-4 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-navy-50 text-lg font-bold text-navy">
                        {customer.name.charAt(0)}
                      </span>
                      <div>
                        <p className="font-bold text-navy">{customer.name}</p>
                        <p className="text-[11px] text-purple">
                          عميل منذ{' '}
                          <span className="num">
                            {new Date(customer.member_since).getFullYear()}
                          </span>
                          {customer.worker && (
                            <>
                              {' · '}
                              <span className="num">{customer.worker.contract_no}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    {assessment && (
                      <Badge tone={RISK_TONE[assessment.risk]}>
                        خطر الفقد: {RISK_LABEL[assessment.risk]}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-navy-50 pt-3 text-center">
                    <div>
                      <p className="mb-0.5 flex items-center justify-center gap-1 text-[10px] text-purple">
                        <Phone size={10} /> الرقم
                      </p>
                      <p className="num text-xs font-bold text-navy">{customer.phone}</p>
                    </div>
                    <div>
                      <p className="mb-0.5 flex items-center justify-center gap-1 text-[10px] text-purple">
                        <Package size={10} /> الشريحة
                      </p>
                      <p className="text-xs font-bold text-navy">{customer.segment}</p>
                    </div>
                    <div>
                      <p className="mb-0.5 flex items-center justify-center gap-1 text-[10px] text-purple">
                        <MapPin size={10} /> المدينة
                      </p>
                      <p className="text-xs font-bold text-navy">{customer.city}</p>
                    </div>
                  </div>
                  <p className="mt-3 flex items-center gap-1 border-t border-navy-50 pt-2 text-[10.5px] text-purple">
                    <UserRound size={11} /> يسجّل المكالمة:{' '}
                    <span className="font-semibold text-navy">{agent}</span>
                  </p>
                </div>

                {/* tabs */}
                <div className="inline-flex w-full rounded-xl bg-navy-50 p-1">
                  <button
                    onClick={() => setTab('history')}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === 'history' ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
                  >
                    سجل التواصل
                  </button>
                  <button
                    onClick={() => setTab('retention')}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === 'retention' ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
                  >
                    تحليل الاحتفاظ
                  </button>
                </div>

                {tab === 'history' ? (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-white py-2 shadow-card">
                        <p className="num text-base font-bold text-navy">
                          {customer.open_contracts}
                        </p>
                        <p className="text-[10px] text-purple">عقود قائمة</p>
                      </div>
                      <div className="rounded-xl bg-white py-2 shadow-card">
                        <p className="num flex items-center justify-center gap-0.5 text-base font-bold text-gold-600">
                          {customer.loyalty_points}
                          <Star size={11} className="fill-gold text-gold" />
                        </p>
                        <p className="text-[10px] text-purple">نقاط الولاء</p>
                      </div>
                      <div className="rounded-xl bg-white py-2 shadow-card">
                        <p className="num text-base font-bold text-navy">
                          {dateAr(customer.member_since)}
                        </p>
                        <p className="text-[10px] text-purple">عميل منذ</p>
                      </div>
                    </div>

                    {customer.worker && (
                      <div className="rounded-2xl bg-white p-4 shadow-card">
                        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy">
                          <UserRound size={15} /> العاملة المرتبطة
                        </h4>
                        <div className="flex items-center justify-between text-sm">
                          <div>
                            <p className="font-semibold text-navy">{customer.worker.name}</p>
                            <p className="text-[11px] text-purple">
                              {customer.worker.nationality} · {customer.worker.profession}
                            </p>
                          </div>
                          <Badge tone="navy">{customer.worker.status}</Badge>
                        </div>
                      </div>
                    )}

                    <div className="rounded-2xl bg-white p-4 shadow-card">
                      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy">
                        <Clock size={15} /> سجل التواصل
                      </h4>
                      {commHistory.length === 0 ? (
                        <p className="text-xs text-purple">لا يوجد سجل تواصل بعد.</p>
                      ) : (
                        <ul className="space-y-2">
                          {commHistory.map((h, i) => (
                            <li
                              key={i}
                              className="flex items-start justify-between gap-2 border-b border-navy-50 pb-1.5 last:border-0"
                            >
                              <div className="min-w-0">
                                <p className="text-xs text-navy">{h.topic}</p>
                                {h.notes && (
                                  <p className="mt-0.5 whitespace-pre-line text-[10.5px] leading-relaxed text-purple">
                                    {h.notes}
                                  </p>
                                )}
                                <p className="num mt-0.5 text-[10px] text-purple">
                                  {dateAr(h.date)}
                                </p>
                              </div>
                              <Badge tone={CALL_STATUS_TONE[h.status]}>
                                {CALL_STATUS_LABEL[h.status]}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                ) : (
                  assessment && (
                    <div className="rounded-2xl bg-white p-4 shadow-card">
                      <h4 className="flex items-center gap-1.5 text-sm font-bold text-navy">
                        <ShieldAlert size={15} className="text-red-500" /> تحليل الاحتفاظ بالعميل
                      </h4>
                      <ul className="mt-2 list-disc space-y-0.5 pr-4 text-[11px] text-purple">
                        {assessment.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                      <div className="mt-2 rounded-lg bg-navy-50/60 p-2 text-[11px] text-navy">
                        <span className="font-bold">التوصية: </span>
                        {assessment.action}
                      </div>
                      <p className="mb-1.5 mt-3 flex items-center gap-1.5 text-[11px] font-bold text-gold-600">
                        <Gift size={12} /> عروض الاحتفاظ المقترحة
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {assessment.offers.map((o) => (
                          <button
                            key={o.id}
                            disabled={busy}
                            onClick={() => applyRetention(o)}
                            title={o.detail}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-gold px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-gold-600 disabled:opacity-50"
                          >
                            <Gift size={12} /> {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-navy-100 bg-white p-5 text-center text-sm">
                <FileText size={26} className="mx-auto mb-2 text-gold-600" />
                <p className="font-semibold text-navy">عميل جديد</p>
                <p className="mt-1 text-xs text-purple">
                  لا يوجد سجل لهذا الرقم. يمكنك إنهاء المكالمة وتسجيلها كعميل جديد.
                </p>
                <p className="mt-2 flex items-center justify-center gap-1 text-[10.5px] text-purple">
                  <UserRound size={11} /> يسجّل المكالمة:{' '}
                  <span className="font-semibold text-navy">{agent}</span>
                </p>
                {commHistory.length > 0 && (
                  <div className="mt-3 border-t border-navy-50 pt-3 text-right">
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
                      <Clock size={13} /> سجل التواصل
                    </h4>
                    <ul className="space-y-2">
                      {commHistory.map((h, i) => (
                        <li
                          key={i}
                          className="flex items-start justify-between gap-2 border-b border-navy-50 pb-1.5 last:border-0"
                        >
                          <div className="min-w-0">
                            <p className="text-xs text-navy">{h.topic}</p>
                            {h.notes && (
                              <p className="mt-0.5 whitespace-pre-line text-[10.5px] leading-relaxed text-purple">
                                {h.notes}
                              </p>
                            )}
                            <p className="num mt-0.5 text-[10px] text-purple">{dateAr(h.date)}</p>
                          </div>
                          <Badge tone={CALL_STATUS_TONE[h.status]}>
                            {CALL_STATUS_LABEL[h.status]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* footer: outcomes */}
        <div className="border-t border-navy-100 bg-white px-5 py-3">
          {/* deal panel */}
          {panel === 'deal' && (
            <div className="mb-3 rounded-xl border border-green-200 bg-green-50/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-green-700">
                <Banknote size={14} /> إتمام صفقة بيع — السعر من محرك التسعير، ويُنشأ طلب فعلي
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Select
                  value={deal.service}
                  onChange={(e) =>
                    setDeal((d) => ({ ...d, service: e.target.value as ServiceCode }))
                  }
                  options={SERVICES.map((s) => ({ value: s.code, label: s.label }))}
                />
                {deal.service === 'daily_rental' ? (
                  <Select
                    value={deal.profession}
                    onChange={(e) => setDeal((d) => ({ ...d, profession: e.target.value }))}
                    options={TASK_TYPES.map((t) => ({ value: t, label: t }))}
                  />
                ) : (
                  <Select
                    value={deal.nationality}
                    onChange={(e) => setDeal((d) => ({ ...d, nationality: e.target.value }))}
                    options={NATIONALITIES.map((n) => ({ value: n, label: n }))}
                  />
                )}
                {(deal.service === 'monthly_rental' || deal.service === 'daily_rental') && (
                  <Input
                    type="number"
                    min={1}
                    value={deal.quantity}
                    onChange={(e) => setDeal((d) => ({ ...d, quantity: Number(e.target.value) }))}
                    placeholder={deal.service === 'monthly_rental' ? 'عدد الأشهر' : 'عدد الأيام'}
                  />
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-purple">
                  الإجمالي (شامل الضريبة):{' '}
                  <span className="num font-bold text-navy">{sar(dealDetail.total)} ر.س</span>
                </span>
                <Button variant="primary" size="md" loading={busy} onClick={closeDeal}>
                  <span className="flex items-center justify-center gap-1.5">
                    <CheckCircle2 size={15} /> تأكيد البيع وإنشاء الطلب
                  </span>
                </Button>
              </div>
            </div>
          )}

          {/* ticket panel */}
          {panel === 'ticket' && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-red-700">
                <TicketIcon size={14} /> فتح تذكرة متابعة
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={ticket.subject}
                  onChange={(e) => setTicket((t) => ({ ...t, subject: e.target.value }))}
                  placeholder="موضوع المشكلة"
                />
                <Select
                  value={ticket.team}
                  onChange={(e) => setTicket((t) => ({ ...t, team: e.target.value }))}
                  options={TICKET_TEAMS.map((t) => ({ value: t, label: `الفريق: ${t}` }))}
                />
                <Select
                  value={ticket.priority}
                  onChange={(e) =>
                    setTicket((t) => ({ ...t, priority: e.target.value as CallPriority }))
                  }
                  options={PRIORITIES.map((p) => ({
                    value: p,
                    label: `أولوية: ${PRIORITY_LABEL[p]}`,
                  }))}
                />
                <Button variant="danger" size="md" loading={busy} onClick={openTicket}>
                  <span className="flex items-center justify-center gap-1.5">
                    <TicketIcon size={15} /> فتح التذكرة وتحويلها
                  </span>
                </Button>
              </div>
            </div>
          )}

          {/* callback panel */}
          {panel === 'callback' && (
            <div className="mb-3 rounded-xl border border-teal-100 bg-teal-100/40 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-teal">
                <AlarmClock size={14} /> تحديد موعد معاودة الاتصال
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="datetime-local"
                  value={callbackAt}
                  onChange={(e) => setCallbackAt(e.target.value)}
                  className="w-full rounded-xl border border-navy-100 bg-white px-3 py-2 text-sm outline-none focus:border-navy"
                />
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!callbackAt}
                  onClick={scheduleCallback}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <AlarmClock size={15} /> تأكيد الموعد
                  </span>
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-purple">
                سيظهر الموعد على بطاقة المكالمة وفي تنبيهات المعاودة المتأخرة.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-purple">إنهاء المكالمة:</span>
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                disabled={!phone.trim() || busy}
                onClick={() => setPanel((p) => (p === 'callback' ? 'none' : 'callback'))}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold transition disabled:opacity-50 ${panel === 'callback' ? 'border-navy bg-navy-50 text-navy' : 'border-navy-100 text-navy hover:bg-navy-50'}`}
              >
                <AlarmClock size={15} /> جدولة معاودة
              </button>
              <button
                disabled={!phone.trim() || busy}
                onClick={() => setPanel((p) => (p === 'ticket' ? 'none' : 'ticket'))}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold text-white transition disabled:opacity-50 ${panel === 'ticket' ? 'bg-red-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                <TicketIcon size={15} /> فتح تذكرة (مشكلة)
              </button>
              <button
                disabled={!phone.trim() || busy || !notes.trim()}
                onClick={resolveInquiry}
                title={!notes.trim() ? 'اكتب ملاحظات المكالمة أولاً' : undefined}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-navy px-3 py-2.5 text-xs font-bold text-white transition hover:bg-navy-700 disabled:opacity-50"
              >
                <CheckCircle2 size={15} /> إغلاق استفسار
              </button>
              <button
                disabled={!phone.trim() || busy}
                onClick={() => setPanel((p) => (p === 'deal' ? 'none' : 'deal'))}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold text-white transition disabled:opacity-50 ${panel === 'deal' ? 'bg-green-700' : 'bg-green-600 hover:bg-green-700'}`}
              >
                <Banknote size={15} /> بيع / إغلاق صفقة
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
