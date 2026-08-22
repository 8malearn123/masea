import { useEffect, useState } from 'react';
import { Search, Star, UserRound, UserPlus, Clock, MapPin, Package } from 'lucide-react';
import { Badge, Button, Input, Modal, Select } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useAddCall, useCalls } from '@/features/call-center/hooks/useCalls';
import {
  lookupCustomer,
  createDirectoryCustomer,
  type DirectoryCustomer,
} from '@/features/call-center/data/directory';
import {
  CALL_STATUS_LABEL,
  CALL_STATUS_TONE,
  CALL_TYPES,
  CALL_TYPE_LABEL,
  CHANNELS,
  CHANNEL_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  type CallChannel,
  type CallPriority,
  type CallStatus,
  type CallType,
} from '@/features/call-center/types';

const AGENTS = ['ريم الزهراني', 'خالد الدوسري', 'نوال العتيبي'];

/** Interests offered when creating a new customer account (خدمات ماسية الشرق). */
const INTEREST_OPTIONS = ['استقدام', 'تأجير شهري', 'تأجير يومي', 'نقل كفالة'];

/** Last-9-digit key so lookups forgive +966 / 0 prefixes (mirrors the directory). */
function digits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-9);
}

export function NewCallModal({
  open,
  onClose,
  agents = AGENTS,
}: {
  open: boolean;
  onClose: () => void;
  agents?: string[];
}) {
  const add = useAddCall();
  const { data: allCalls = [] } = useCalls();
  const [form, setForm] = useState({
    customer_name: '',
    phone: '',
    topic: '',
    type: 'inquiry' as CallType,
    priority: 'medium' as CallPriority,
    channel: 'phone' as CallChannel,
    agent: agents[0] ?? '',
    notes: '',
  });
  const [searched, setSearched] = useState(false);
  const [customer, setCustomer] = useState<DirectoryCustomer | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [city, setCity] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function doLookup(value: string = form.phone) {
    if (digits(value).length < 9) {
      setSearched(false);
      setCustomer(null);
      return;
    }
    const found = lookupCustomer(value);
    setSearched(true);
    setCustomer(found);
    if (found) setForm((f) => ({ ...f, customer_name: found.name }));
  }

  // Auto-lookup once a full number is entered — الاستعلام يظهر البيانات مباشرة.
  useEffect(() => {
    if (digits(form.phone).length >= 9) doLookup(form.phone);
    else {
      setSearched(false);
      setCustomer(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.phone]);

  function reset() {
    setForm((f) => ({ ...f, customer_name: '', phone: '', topic: '', notes: '' }));
    setSearched(false);
    setCustomer(null);
    setInterests([]);
    setCity('');
    setErr(null);
  }

  const isNewCustomer = searched && !customer;

  // «سجل التواصل» = المكالمات المُسجَّلة لهذا الرقم + سجل الدليل (مثل الاستقبال).
  const commHistory: {
    date: string;
    topic: string;
    status: CallStatus;
    notes?: string | undefined;
  }[] = [
    ...allCalls
      .filter((c) => digits(form.phone).length >= 9 && digits(c.phone) === digits(form.phone))
      .map((c) => ({ date: c.created_at, topic: c.topic, status: c.status, notes: c.notes })),
    ...(customer?.history ?? []).map((h) => ({
      date: h.date,
      topic: h.topic,
      status: h.status,
      notes: undefined as string | undefined,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  function toggleInterest(i: string) {
    setInterests((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]));
  }

  function submit() {
    if (!form.customer_name.trim() || !form.phone.trim() || !form.topic.trim()) {
      setErr('يرجى تعبئة اسم العميل والجوال والموضوع.');
      return;
    }
    if (isNewCustomer && interests.length === 0) {
      setErr('اختر اهتمام العميل واحداً على الأقل لإنشاء حسابه.');
      return;
    }
    setErr(null);

    // عميل جديد → أنشئ له حساباً بالرقم والاهتمامات، ثم سجّل المكالمة.
    if (isNewCustomer) {
      createDirectoryCustomer({
        phone: form.phone.trim(),
        name: form.customer_name.trim(),
        city,
        interests,
      });
    }
    const interestNote =
      isNewCustomer && interests.length ? `[اهتمامات: ${interests.join('، ')}]` : '';
    const notes = [form.notes.trim(), interestNote].filter(Boolean).join('\n');

    add.mutate(
      { ...form, notes },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="تسجيل مكالمة جديدة">
      <div className="max-h-[72vh] space-y-3 overflow-y-auto pl-1">
        {/* phone first — lookup drives the rest */}
        <div>
          <label className="mb-1 block text-sm font-medium text-navy-900">رقم الجوال</label>
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
                <Search size={16} />
              </span>
              <Input
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doLookup()}
                placeholder="05XXXXXXXX"
                inputMode="tel"
                className="num pr-9"
              />
            </div>
            <Button variant="primary" size="md" onClick={() => doLookup()}>
              <span className="flex items-center gap-1.5">
                <Search size={15} /> استعلام
              </span>
            </Button>
          </div>
        </div>

        {/* lookup result: known customer profile (reception-style) */}
        {customer && (
          <div className="rounded-xl border border-navy-100 bg-navy-50/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-base font-bold text-navy">
                  {customer.name.charAt(0)}
                </span>
                <div>
                  <p className="font-bold text-navy">{customer.name}</p>
                  <p className="num flex items-center gap-2 text-[11px] text-purple">
                    <span className="inline-flex items-center gap-0.5">
                      <Package size={10} /> {customer.segment}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin size={10} /> {customer.city}
                    </span>
                  </p>
                </div>
              </div>
              <span className="num inline-flex items-center gap-0.5 rounded-lg bg-white px-2 py-1 text-xs font-bold text-gold-600">
                {customer.loyalty_points}
                <Star size={11} className="fill-gold text-gold" />
              </span>
            </div>

            {customer.worker && (
              <p className="mt-2 flex items-center gap-1.5 border-t border-navy-100/70 pt-2 text-[11px] text-navy">
                <UserRound size={12} className="text-purple" />
                <span className="font-semibold">{customer.worker.name}</span>
                <span className="text-purple">
                  · {customer.worker.nationality} · {customer.worker.status}
                </span>
              </p>
            )}
            {customer.interests && customer.interests.length > 0 && (
              <p className="mt-1.5 text-[11px] text-purple">
                الاهتمامات: <span className="text-navy">{customer.interests.join('، ')}</span>
              </p>
            )}

            {commHistory.length > 0 && (
              <div className="mt-2 border-t border-navy-100/70 pt-2">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-navy">
                  <Clock size={12} /> سجل التواصل
                </p>
                <ul className="space-y-1.5">
                  {commHistory.slice(0, 4).map((h, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] text-navy">{h.topic}</p>
                        <p className="num text-[10px] text-purple">{dateAr(h.date)}</p>
                      </div>
                      <Badge tone={CALL_STATUS_TONE[h.status]}>{CALL_STATUS_LABEL[h.status]}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* lookup result: new customer → create an account with interests */}
        {isNewCustomer && (
          <div className="border-gold-200 bg-gold-50/60 rounded-xl border p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gold-600">
              <UserPlus size={14} /> لا يوجد عميل بهذا الرقم — سيُنشأ حساب جديد
            </p>
            <div className="mb-2">
              <label className="mb-1 block text-[11px] font-medium text-navy-900">
                المدينة (اختياري)
              </label>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="مثال: نجران"
              />
            </div>
            <p className="mb-1.5 text-[11px] font-medium text-navy-900">
              اهتمامات العميل <span className="text-red-600">*</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {INTEREST_OPTIONS.map((i) => {
                const on = interests.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleInterest(i)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                      on
                        ? 'border-navy bg-navy text-white'
                        : 'border-navy-100 bg-white text-navy hover:border-navy'
                    }`}
                  >
                    {i}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Input
          label="اسم العميل"
          value={form.customer_name}
          onChange={(e) => set('customer_name', e.target.value)}
          placeholder="مثال: محمد الأحمدي"
        />
        <Input
          label="الموضوع"
          value={form.topic}
          onChange={(e) => set('topic', e.target.value)}
          placeholder="مثال: استفسار عن باقة الاستقدام"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-navy-900">النوع</label>
            <Select
              value={form.type}
              onChange={(e) => set('type', e.target.value as CallType)}
              options={CALL_TYPES.map((t) => ({ value: t, label: CALL_TYPE_LABEL[t] }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-navy-900">الأولوية</label>
            <Select
              value={form.priority}
              onChange={(e) => set('priority', e.target.value as CallPriority)}
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-navy-900">القناة</label>
            <Select
              value={form.channel}
              onChange={(e) => set('channel', e.target.value as CallChannel)}
              options={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-navy-900">الموظف</label>
            <Select
              value={form.agent}
              onChange={(e) => set('agent', e.target.value)}
              options={agents.map((a) => ({ value: a, label: a }))}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-navy-900">ملاحظات</label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            placeholder="تفاصيل إضافية…"
            className="w-full rounded-xl border border-navy-100 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
          />
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" size="sm" loading={add.isPending} onClick={submit}>
            {isNewCustomer ? 'إنشاء الحساب وتسجيل المكالمة' : 'تسجيل المكالمة'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
