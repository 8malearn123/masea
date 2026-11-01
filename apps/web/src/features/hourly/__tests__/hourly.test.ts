import { afterEach, describe, expect, it } from 'vitest';
import type { AppRole } from '@masiat/shared';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { addDays, today } from '@/features/requests/lib/period';
import { calculate, EMPTY_CALC } from '@/features/pricing/lib/engine';
import { getPricingConfig, listPricingRules } from '@/features/pricing/api/pricing.api';
import { getContract } from '@/features/contracts/api/contracts.api';
import { listOrders } from '@/features/orders/api/orders.api';
import { getQuoteRecord } from '@/shared/lib/quotesLedger';
import {
  convertQuote,
  createLeadQuote,
  getLead,
  setLeadQuoteStatus,
} from '@/features/crm/api/crm.api';
import {
  bookHourly,
  listBookings,
  setBookingStatus,
  type BookingInput,
} from '@/features/hourly/api/hourly.api';
import {
  conflictFor,
  DEFAULT_HOURLY_CONFIG as CFG,
  hourlyTotals,
  hoursBetween,
  validateHours,
} from '@/features/hourly/lib/hourly';

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(role);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const D = addDays(today(), 3);
const input = (o: Partial<BookingInput> = {}): BookingInput => ({
  worker_profile_id: 'w4',
  worker_name: 'ديوي أنغرايني',
  booking_date: D,
  start_time: '09:00',
  end_time: '13:00',
  profession: 'تنظيف',
  customer_name: 'جواهر آل منصور',
  customer_phone: '0554000001',
  address: 'نجران — حي الفيصلية',
  notes: null,
  branch: null,
  ...o,
});

describe('hourly rules (managed)', () => {
  it('4 to 12 hours, in slot multiples, end after start', () => {
    expect(hoursBetween('09:00', '13:30')).toBe(4.5);
    expect(validateHours('09:00', '13:00', CFG)).toBeNull();
    expect(validateHours('09:00', '12:00', CFG)).toMatch(/الحد الأدنى/);
    expect(validateHours('08:00', '21:00', CFG)).toMatch(/الحد الأقصى/);
    expect(validateHours('09:00', '13:15', CFG)).toMatch(/مضاعفات/);
    expect(validateHours('13:00', '09:00', CFG)).toMatch(/بعد ساعة الوصول/);
    expect(validateHours('09:00', '12:00', { ...CFG, minHours: 3 })).toBeNull();
  });

  it('a live booking blocks the worker including the buffer; cancelled ones do not', () => {
    const live = [
      {
        worker_profile_id: 'w1',
        booking_date: D,
        start_time: '09:00',
        end_time: '13:00',
        status: 'booked' as const,
      },
    ];
    const want = (s: string, e: string) => ({
      worker_profile_id: 'w1',
      booking_date: D,
      start_time: s,
      end_time: e,
    });
    expect(conflictFor(live, want('12:00', '16:00'), CFG)).not.toBeNull();
    expect(conflictFor(live, want('13:00', '17:00'), CFG)).not.toBeNull(); // 30-minute buffer
    expect(conflictFor(live, want('13:30', '17:30'), CFG)).toBeNull();
    expect(
      conflictFor([{ ...live[0]!, status: 'cancelled' }], want('10:00', '14:00'), CFG),
    ).toBeNull();
    expect(
      conflictFor(live, { ...want('10:00', '14:00'), worker_profile_id: 'w2' }, CFG),
    ).toBeNull();
  });

  it('price = hours × the task rate; a branch rate wins for its branch only', async () => {
    const [rules, cfg] = await Promise.all([listPricingRules(), getPricingConfig()]);
    const at = (branch: string | null) =>
      calculate(
        { ...EMPTY_CALC, service: 'hourly_rental', profession: 'تنظيف', quantity: 4, branch },
        rules,
        cfg,
      );
    expect(at('جازان').detail.base).toBe(160);
    expect(at('نجران').detail.base).toBe(152);
    expect(at(null).detail.base).toBe(160);
  });

  it('totals exclude cancelled and no-show bookings', () => {
    const t = hourlyTotals([
      { status: 'completed', hours: 4, base_amount: 160 },
      { status: 'booked', hours: 6, base_amount: 300 },
      { status: 'cancelled', hours: 5, base_amount: 200 },
    ]);
    expect(t).toEqual({ count: 2, hours: 10, revenue: 460, completed: 1, cancelled: 1 });
  });
});

describe('hourly bookings (demo mode)', () => {
  it('books in the user branch with the price, a draft contract and an order; refuses conflicts', async () => {
    const acc = signIn('branch_manager'); // جازان
    const b = await bookHourly(input());
    expect(b.branch).toBe(acc.branch);
    expect(b.hours).toBe(4);
    expect(b.base_amount).toBe(160);
    const contract = b.contract_id ? await getContract(b.contract_id) : null;
    expect(contract?.service_code).toBe('hourly_rental');
    expect(contract?.status).toBe('draft');
    expect(contract?.total_amount).toBe(b.total_amount);
    const orders = await listOrders({ status: 'all', branch: 'all', search: '' });
    expect(
      orders.some((o) => o.contract_id === b.contract_id && o.service_code === 'hourly_rental'),
    ).toBe(true);

    await expect(bookHourly(input({ start_time: '12:00', end_time: '16:00' }))).rejects.toThrow(
      /محجوزة/,
    );
    await expect(bookHourly(input({ start_time: '13:00', end_time: '17:00' }))).rejects.toThrow(
      /محجوزة/,
    );
    await expect(bookHourly(input({ start_time: '13:00', end_time: '15:00' }))).rejects.toThrow(
      /الحد الأدنى/,
    );
    await expect(bookHourly(input({ booking_date: addDays(today(), -1) }))).rejects.toThrow(
      /لا يسبق اليوم/,
    );
    const second = await bookHourly(
      input({ start_time: '13:30', end_time: '17:30', customer_name: 'نوال اليامي' }),
    );
    expect(second.id).not.toBe(b.id);
  });

  it('records the start and end of the service; a cancelled slot is free again', async () => {
    signIn('branch_manager');
    const b = await bookHourly(input({ worker_profile_id: 'w6', worker_name: 'فيث أتيينو' }));
    await setBookingStatus(b.id, 'in_progress');
    await setBookingStatus(b.id, 'completed');
    const done = (await listBookings()).find((x) => x.id === b.id);
    expect(done?.actual_start_at).not.toBeNull();
    expect(done?.actual_end_at).not.toBeNull();
    await expect(setBookingStatus(b.id, 'in_progress')).rejects.toThrow();

    const c = await bookHourly(input({ worker_profile_id: 'w8', worker_name: 'بريندا أكينيي' }));
    await setBookingStatus(c.id, 'cancelled');
    await expect(
      bookHourly(
        input({
          worker_profile_id: 'w8',
          worker_name: 'بريندا أكينيي',
          customer_name: 'هند المدخلي',
        }),
      ),
    ).resolves.toBeTruthy();
  });

  it('a branch manager sees the bookings of their branch only', async () => {
    const acc = signIn('branch_manager');
    const rows = await listBookings();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((b) => b.branch === acc.branch)).toBe(true);
  });

  it('an accepted hourly quote converts into a contract and books the worker', async () => {
    const acc = signIn('sales'); // شرورة
    const lead = await getLead('lead-6');
    if (!lead) throw new Error('lead-6 missing');
    const [rules, cfg] = await Promise.all([listPricingRules(), getPricingConfig()]);
    const q = await createLeadQuote(
      {
        lead,
        calc: { ...EMPTY_CALC, service: 'hourly_rental', profession: 'طبخ', quantity: 5 },
        valid_days: 7,
        notes: null,
        extra: {
          worker_profile_id: 'w10',
          worker_name: 'نسرين أكتر',
          start_date: D,
          start_time: '16:00',
          end_time: '21:00',
          duration_unit: 'hour',
          duration_count: 5,
          end_date: D,
          terms: ['مدة الخدمة خمس ساعات'],
        },
      },
      { rules, cfg, actor: acc.name },
    );
    expect(q.base_amount).toBe(250);
    const policy = { thresholdPct: 10, canApprove: false };
    await setLeadQuoteStatus(q.id, 'sent', acc.name, policy);
    await setLeadQuoteStatus(q.id, 'accepted', acc.name, policy);
    const accepted = getQuoteRecord(q.id);
    if (!accepted) throw new Error('quote missing');
    const { contract_id } = await convertQuote(accepted, acc.name);
    const booking = (await listBookings()).find((b) => b.contract_id === contract_id);
    expect(booking?.worker_profile_id).toBe('w10');
    expect(booking?.hours).toBe(5);
    expect(booking?.base_amount).toBe(250);
  });
});
