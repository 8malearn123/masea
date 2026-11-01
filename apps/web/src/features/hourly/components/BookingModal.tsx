import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { BRANCHES_AR } from '@/lib/funnel';
import { TASK_TYPES } from '@/lib/orderTypes';
import { usePermissions } from '@/hooks/usePermissions';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { today } from '@/features/requests/lib/period';
import { calculate, EMPTY_CALC } from '@/features/pricing/lib/engine';
import { usePricingConfig, usePricingRules } from '@/features/pricing/hooks/usePricingRules';
import { useBookHourly, useBusySlots, useHourlyConfig } from '@/features/hourly/hooks/useHourly';
import { conflictFor, hoursBetween, validateHours } from '@/features/hourly/lib/hourly';

const TASK_OPTS = TASK_TYPES.map((t) => ({ value: t, label: t }));

/**
 * حجز تأجير بالساعة: التاريخ + الوصول + الانصراف ← عدد الساعات والسعر تلقائيًا،
 * والعاملات المشغولات في الفترة يظهرن غير متاحات (لا تعارض). الحجز ينشئ الطلب
 * ومسودة العقد الخاص بالخدمة.
 */
export function BookingModal({
  open,
  onClose,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="حجز تأجير بالساعة" size="lg">
      {open && <Body onDone={onClose} defaultDate={defaultDate ?? today()} />}
    </Modal>
  );
}

function Body({ onDone, defaultDate }: { onDone: () => void; defaultDate: string }) {
  const { meta, branchLabel } = usePermissions();
  const cfg = useHourlyConfig();
  const { data: workers = [] } = useWorkerProfiles();
  const [date, setDate] = useState(defaultDate);
  // every branch's bookings count — a worker can't be in two places
  const { data: bookings = [] } = useBusySlots(date);
  const { data: rules = [] } = usePricingRules();
  const { data: pcfg } = usePricingConfig();
  const book = useBookHourly();

  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [task, setTask] = useState<string>(TASK_TYPES[0]);
  const [workerId, setWorkerId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [branch, setBranch] = useState(meta?.crossBranch ? '' : (branchLabel ?? ''));

  const hoursError = validateHours(start, end, cfg);
  const hours = hoursError ? 0 : hoursBetween(start, end);
  const busy = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers) {
      const c = conflictFor(
        bookings,
        { worker_profile_id: w.id, booking_date: date, start_time: start, end_time: end },
        cfg,
      );
      if (c) map.set(w.id, `${c.start_time}–${c.end_time}`);
    }
    return map;
  }, [workers, bookings, date, start, end, cfg]);
  const price = useMemo(
    () =>
      pcfg && hours > 0
        ? calculate(
            {
              ...EMPTY_CALC,
              service: 'hourly_rental',
              profession: task,
              quantity: hours,
              branch: branch || null,
            },
            rules,
            pcfg,
          )
        : null,
    [pcfg, hours, task, branch, rules],
  );
  const worker = workers.find((w) => w.id === workerId) ?? null;
  const blocker =
    hoursError ??
    (!branch
      ? 'اختر الفرع'
      : !worker
        ? 'اختر عاملة متاحة'
        : busy.has(worker.id)
          ? 'العاملة محجوزة في هذه الفترة'
          : name.trim().length < 3
            ? 'اسم العميل مطلوب'
            : !/^05\d{8}$/.test(phone.trim())
              ? 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام'
              : (price?.blockers[0] ?? null));

  function submit() {
    if (blocker || !worker) return;
    book.mutate(
      {
        worker_profile_id: worker.id,
        worker_name: worker.full_name,
        booking_date: date,
        start_time: start,
        end_time: end,
        profession: task,
        customer_name: name,
        customer_phone: phone,
        address: address.trim() || null,
        notes: notes.trim() || null,
        branch: branch || null,
      },
      { onSuccess: onDone },
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-4">
        <Input
          label="تاريخ الحجز"
          type="date"
          min={today()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="ساعة الوصول"
          type="time"
          step={cfg.slotMinutes * 60}
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <Input
          label="ساعة الانصراف"
          type="time"
          step={cfg.slotMinutes * 60}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${hoursError ? 'border-red-200 bg-red-50' : 'border-navy-100'}`}
        >
          <div className="text-xs text-purple">عدد الساعات</div>
          <div className="num text-lg font-bold text-navy">{hours || '—'}</div>
        </div>
      </section>
      <p className="text-xs text-purple">
        من {cfg.minHours} إلى {cfg.maxHours} ساعة · بمضاعفات {cfg.slotMinutes} دقيقة · فاصل{' '}
        {cfg.bufferMinutes} دقيقة بين حجزين لنفس العاملة
      </p>

      <section className="grid gap-3 sm:grid-cols-2">
        <Select
          label="المهمة"
          options={TASK_OPTS}
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
        {meta?.crossBranch ? (
          <Select
            label="الفرع"
            options={[
              { value: '', label: 'اختر الفرع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
        ) : (
          <div className="rounded-xl border border-navy-100 px-3 py-2 text-sm">
            <div className="text-xs text-purple">الفرع</div>
            <div className="font-medium text-navy">{branch || '—'}</div>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold text-navy">العاملة (التوفّر في الفترة المحددة)</h3>
        <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
          {workers.map((w) => {
            const taken = busy.get(w.id);
            const selected = w.id === workerId;
            return (
              <button
                key={w.id}
                type="button"
                disabled={Boolean(taken) || Boolean(hoursError)}
                onClick={() => setWorkerId(w.id)}
                aria-pressed={selected}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-start text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy'
                }`}
              >
                <span>
                  <span className="font-medium text-navy">{w.full_name}</span>
                  <span className="block text-xs text-purple">
                    {w.nationality} · {w.profession}
                  </span>
                </span>
                {taken ? (
                  <span className="inline-flex items-center gap-1 text-xs text-red-600">
                    <CircleAlert size={14} /> محجوزة {taken}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <CircleCheck size={14} /> متاحة
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Input label="اسم العميل" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label="الجوال"
          placeholder="05xxxxxxxx"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Input label="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} />
        <Input label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>

      {price && (
        <section className="rounded-xl border border-navy-100 p-3 text-sm">
          <div className="flex justify-between">
            <span>
              سعر الساعة{' '}
              <span className="text-xs text-purple">
                ({task}
                {branch ? ` · ${branch}` : ''})
              </span>
            </span>
            <span className="num">{sar(price.unitPrice)}</span>
          </div>
          <div className="flex justify-between">
            <span>{hours} ساعات</span>
            <span className="num">{sar(price.detail.net)}</span>
          </div>
          <div className="flex justify-between">
            <span>ضريبة القيمة المضافة</span>
            <span className="num">{sar(price.detail.vat)}</span>
          </div>
          <div className="flex justify-between border-t border-navy-50 pt-1 text-base font-bold text-navy">
            <span>الإجمالي</span>
            <span className="num">{sar(price.detail.total)} ر.س</span>
          </div>
        </section>
      )}

      {blocker && <p className="text-sm text-red-600">{blocker}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          إلغاء
        </Button>
        <Button disabled={Boolean(blocker)} loading={book.isPending} onClick={submit}>
          تأكيد الحجز
        </Button>
      </div>
    </div>
  );
}
