import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { getClauses, getContract } from '@/features/contracts/api/contracts.api';
import {
  approvedTemplateFor,
  isRentalService,
  listRentalTemplates,
  resetRentalDemoStore,
} from '@/features/contracts/api/rentalContract.api';
import { legalClausesOf } from '@/features/contracts/lib/rentalContract/template';
import { bookHourly } from '@/features/hourly/api/hourly.api';

function signIn(): void {
  const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  if (!admin) throw new Error('no demo admin');
  saveDemo(admin);
  useAuth.setState({ profile: demoProfile(admin) });
}
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const booking = (worker: string) => ({
  worker_profile_id: worker,
  worker_name: 'ماريا سانتوس',
  booking_date: tomorrow(),
  start_time: '09:00',
  end_time: '13:00',
  profession: 'تنظيف',
  customer_name: 'محمد الأحمدي',
  customer_phone: '0501234567',
  address: null,
  notes: null,
  branch: 'نجران',
});

afterEach(() => {
  resetRentalDemoStore();
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('one rental template for monthly, daily and hourly (0094)', () => {
  it('maps every rental service to the same approved text; others to none', async () => {
    const rows = await listRentalTemplates();
    const doc = approvedTemplateFor(rows, 'monthly_rental')?.doc;
    expect(doc).toBeDefined();
    expect(approvedTemplateFor(rows, 'daily_rental')?.doc).toBe(doc);
    expect(approvedTemplateFor(rows, 'hourly_rental')?.doc).toBe(doc);
    expect(isRentalService('hourly_rental')).toBe(true);
    expect(isRentalService('recruitment')).toBe(false);
    expect(approvedTemplateFor(rows, 'sponsorship_transfer')).toBeNull();
  });

  it('an hourly booking issues its contract on the rental template with the verbatim clauses', async () => {
    signIn();
    const b = await bookHourly(booking('wp-unified-1'));
    const c = await getContract(b.contract_id!);
    const rows = await listRentalTemplates();
    const tpl = approvedTemplateFor(rows, 'hourly_rental')!;
    expect(c?.template_id).toBe(tpl.id);
    expect(c?.worker_name).toBe('ماريا سانتوس');
    expect((await getClauses(c!.id)).map((x) => x.body)).toEqual(legalClausesOf(tpl.doc));
  });

  it('no rental contract while the template is not approved', async () => {
    signIn();
    resetRentalDemoStore('pending_review');
    await expect(bookHourly(booking('wp-unified-2'))).rejects.toThrow('لم يُعتمد');
  });
});
