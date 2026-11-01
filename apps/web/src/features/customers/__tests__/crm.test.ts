import { afterEach, describe, expect, it } from 'vitest';
import type { AppRole } from '@masiat/shared';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { crmKpis, customerSegments } from '@/features/customers/lib/classify';
import {
  addInteraction,
  getCustomer,
  listCustomerInsights,
  parseCustomerInput,
  saveCustomer,
  setCustomerActive,
} from '@/features/customers/api/customers.api';
import { DEFAULT_CRM_THRESHOLDS as T, type CustomerInsight } from '@/features/customers/types';

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

const NOW = new Date('2026-11-01T12:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const row = (o: Partial<CustomerInsight>): CustomerInsight => ({
  id: 'x',
  full_name: 'عميل',
  phone: null,
  city: null,
  branch: 'نجران',
  created_at: ago(400),
  is_active: true,
  contracts_count: 0,
  purchases: 0,
  first_purchase_at: null,
  last_purchase_at: null,
  sales_value: 0,
  total_paid: 0,
  active_contracts: 0,
  next_end_date: null,
  last_end_date: null,
  last_contact_at: null,
  days_since_purchase: null,
  days_since_contact: null,
  ...o,
});

describe('customer classification (managed thresholds)', () => {
  it('new / active with a worker / expected return when the running contract ends soon', () => {
    const s = customerSegments(
      row({
        created_at: ago(5),
        purchases: 1,
        last_purchase_at: ago(5),
        days_since_purchase: 5,
        active_contracts: 1,
        next_end_date: '2026-11-20',
      }),
      T,
      NOW,
    );
    expect([...s]).toEqual(
      expect.arrayContaining(['new', 'active', 'with_worker', 'served_before', 'expected_return']),
    );
    expect(s.has('inactive')).toBe(false);
  });

  it('inactive: bought long ago, nothing running, not contacted → needs follow-up', () => {
    const s = customerSegments(
      row({ purchases: 1, last_purchase_at: ago(200), days_since_purchase: 200 }),
      T,
      NOW,
    );
    expect([...s]).toEqual(
      expect.arrayContaining(['inactive', 'without_worker', 'ended_no_worker', 'needs_followup']),
    );
  });

  it('repeat buyer past their usual interval is expected back', () => {
    const s = customerSegments(
      row({
        purchases: 3,
        first_purchase_at: ago(300),
        last_purchase_at: ago(160),
        days_since_purchase: 160,
        last_contact_at: ago(2),
        days_since_contact: 2,
      }),
      T,
      NOW,
    );
    expect(s.has('repeat')).toBe(true);
    expect(s.has('expected_return')).toBe(true); // avg interval 70 days, 160 since last
    expect(s.has('needs_followup')).toBe(false); // contacted 2 days ago
  });

  it('thresholds come from settings, not code', () => {
    const r = row({ purchases: 1, last_purchase_at: ago(60), days_since_purchase: 60 });
    expect(customerSegments(r, T, NOW).has('active')).toBe(true); // 90-day window
    expect(customerSegments(r, { ...T, inactiveDays: 30 }, NOW).has('inactive')).toBe(true);
  });

  it('KPIs: retention, repeat rate, average value, lapsed buckets', () => {
    const rows = [
      row({
        id: 'a',
        purchases: 2,
        sales_value: 20000,
        first_purchase_at: ago(100),
        last_purchase_at: ago(10),
        days_since_purchase: 10,
      }),
      row({
        id: 'b',
        purchases: 1,
        sales_value: 10000,
        last_purchase_at: ago(70),
        days_since_purchase: 70,
      }),
      row({
        id: 'c',
        purchases: 1,
        sales_value: 6000,
        last_purchase_at: ago(120),
        days_since_purchase: 120,
      }),
      row({ id: 'd', created_at: ago(3) }),
      row({ id: 'e', is_active: false, purchases: 5 }),
    ];
    const k = crmKpis(rows, T, NOW);
    expect(k.total).toBe(4); // disabled excluded
    expect(k.purchasers).toBe(3);
    expect(k.repeat).toBe(1);
    expect(k.newCount).toBe(1);
    expect(k.retentionPct).toBe(66.7); // a, b active of 3 buyers
    expect(k.repeatRatePct).toBe(33.3);
    expect(k.avgCustomerValue).toBe(12000);
    expect(k.noPurchaseSince).toEqual({ d30: 2, d60: 2, d90: 1 });
  });
});

describe('customers (demo data from real operations)', () => {
  it('insights are computed from the contracts: history, payments, running contracts', async () => {
    signIn('admin');
    const rows = await listCustomerInsights();
    const mohammed = rows.find((r) => r.full_name === 'محمد الأحمدي');
    expect(mohammed?.contracts_count).toBe(2);
    expect(mohammed?.purchases).toBe(1); // 2025 completed; the 2026 musaned contract is not signed yet
    const noura = rows.find((r) => r.full_name === 'نورة الشهري');
    expect(noura?.purchases).toBe(2);
    expect(noura?.active_contracts).toBe(1);
    expect(noura?.total_paid).toBe(8050 + 8625);
    expect(rows.find((r) => r.full_name === 'ماجد آل سالم')?.purchases).toBe(0);
  });

  it('a branch manager sees the customers of their branch only', async () => {
    const acc = signIn('branch_manager');
    const rows = await listCustomerInsights();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.branch === acc.branch)).toBe(true);
    expect(await getCustomer('cust-00009')).toBeNull(); // نجران
  });

  it('creates, edits, disables a customer and logs a contact — all reflected in the insights', async () => {
    const acc = signIn('branch_manager');
    const c = await saveCustomer({
      full_name: 'تركي آل عباس',
      phone: '0559876543',
      national_id: '1098765432',
      city: 'جازان',
      email: null,
      vat_number: '310123456700003',
      address: null,
      branch: 'نجران', // ignored for a branch role
    });
    expect(c.branch).toBe(acc.branch);
    await saveCustomer({ ...c, city: 'صبيا' }, c.id);
    expect((await getCustomer(c.id))?.city).toBe('صبيا');
    await addInteraction({
      customer_id: c.id,
      kind: 'call',
      note: 'اتصال تعريفي بالخدمات',
      follow_up_at: null,
    });
    let mine = (await listCustomerInsights()).find((r) => r.id === c.id);
    expect(mine?.days_since_contact).toBe(0);
    await setCustomerActive(c.id, false);
    mine = (await listCustomerInsights()).find((r) => r.id === c.id);
    expect(mine?.is_active).toBe(false);
  });

  it('validates the registration fields', () => {
    const ok = {
      full_name: 'سعد الوادعي',
      phone: '0551234567',
      national_id: '',
      city: '',
      email: '',
      vat_number: '',
      address: '',
      branch: 'نجران',
    };
    expect(parseCustomerInput(ok).vat_number).toBeNull();
    expect(() => parseCustomerInput({ ...ok, phone: '12345' })).toThrow(/05/);
    expect(() => parseCustomerInput({ ...ok, vat_number: '123' })).toThrow(/الرقم الضريبي/);
    expect(() => parseCustomerInput({ ...ok, national_id: '3123' })).toThrow(/الهوية/);
  });
});
