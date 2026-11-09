/**
 * إدارة السائقين (0084): إضافة/تعديل/تعطيل، «في مهمة» آلية، ربط حساب الدخول،
 * ونطاق الفرع — نفس guard_driver.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import {
  addLocalOrder,
  assignDriver,
  findDemoOrderByRequestNo,
  listDriverAccounts,
  listDrivers,
  saveDriver,
  setOrderStatus,
} from '@/features/orders/api/orders.api';
import { driverChangeError, driverInputOf } from '@/features/orders/lib/driverRules';
import { listDriverLocations } from '@/features/gps/api/gps.api';
import type { Driver } from '@/features/orders/types';

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

const driver = (p: Partial<Driver> = {}): Driver => ({
  id: 'x',
  full_name: 'سائق',
  phone: null,
  branch: 'جازان',
  status: 'available',
  vehicle_no: null,
  rating: 0,
  is_active: true,
  user_id: null,
  ...p,
});

describe('قواعد السائق', () => {
  const accounts = [
    { id: 'a1', full_name: 'ياسر الحازمي', branch: 'جازان', driver_id: null },
    { id: 'a2', full_name: 'ماجد الحربي', branch: 'نجران', driver_id: 'other' },
  ];
  const ctx = (current: Driver | null, busy = 0) => ({ current, busy, accounts });

  it('الاسم والفرع والجوال', () => {
    const base = { ...driverInputOf(driver()), id: null };
    expect(driverChangeError({ ...base, full_name: ' ' }, ctx(null))).toContain('اسم السائق');
    expect(driverChangeError({ ...base, branch: '' }, ctx(null))).toContain('الفرع');
    expect(driverChangeError({ ...base, phone: '123' }, ctx(null))).toContain('05');
    expect(driverChangeError({ ...base, phone: '0551234567' }, ctx(null))).toBeNull();
  });

  it('«في مهمة» آلية، ولا تغيير للحالة أو الفرع أو التعطيل وله طلب نشط', () => {
    const base = driverInputOf(driver());
    expect(driverChangeError({ ...base, status: 'on_route' }, ctx(driver()))).toContain('آليًا');
    const busy = driver({ status: 'on_route' });
    expect(
      driverChangeError({ ...driverInputOf(busy), status: 'off_duty' }, ctx(busy, 1)),
    ).toContain('في مهمة');
    expect(driverChangeError({ ...driverInputOf(busy), is_active: false }, ctx(busy, 1))).toContain(
      'في مهمة',
    );
    expect(driverChangeError({ ...driverInputOf(busy), branch: 'نجران' }, ctx(busy, 1))).toContain(
      'فرع آخر',
    );
    expect(
      driverChangeError({ ...driverInputOf(busy), vehicle_no: 'JZN-1' }, ctx(busy, 1)),
    ).toBeNull();
  });

  it('الحساب: بدور سائق من فرعه وغير مربوط بآخر', () => {
    const base = driverInputOf(driver());
    expect(driverChangeError({ ...base, user_id: 'a1' }, ctx(driver()))).toBeNull();
    expect(driverChangeError({ ...base, user_id: 'a2' }, ctx(driver()))).toContain('فرع السائق');
    expect(driverChangeError({ ...base, branch: 'نجران', user_id: 'a2' }, ctx(driver()))).toContain(
      'بسائق آخر',
    );
  });
});

describe('إدارة السائقين في مخزن العرض', () => {
  it('مدير فرع جازان يضيف سائقًا بحسابه ويُسند له طلبًا ثم يعطّله بعد انتهائه', async () => {
    const acc = signIn('branch_manager');
    const accounts = await listDriverAccounts();
    expect(accounts.every((a) => a.branch === acc.branch)).toBe(true);
    await saveDriver({
      id: null,
      full_name: 'ياسر الحازمي',
      phone: '0551234567',
      branch: acc.branch!,
      vehicle_no: 'jzn-4521',
      status: 'available',
      user_id: accounts[0]!.id,
      is_active: true,
    });
    const added = (await listDrivers()).find((d) => d.full_name === 'ياسر الحازمي')!;
    expect(added).toMatchObject({ vehicle_no: 'JZN-4521', user_id: accounts[0]!.id });
    expect((await listDriverAccounts())[0]!.driver_id).toBe(added.id);

    addLocalOrder({
      request_no: 'REQ-DRV0001',
      customer_name: 'هند العتيبي',
      service_code: 'daily_rental',
      branch: acc.branch!,
      total_amount: 345,
    });
    const order = findDemoOrderByRequestNo('REQ-DRV0001')!;
    await assignDriver(order.id, added.id);
    const busy = (await listDrivers()).find((d) => d.id === added.id)!;
    await expect(saveDriver({ ...driverInputOf(busy), is_active: false })).rejects.toThrow(
      'في مهمة',
    );
    await setOrderStatus(order.id, 'cancelled');
    const free = (await listDrivers()).find((d) => d.id === added.id)!;
    await saveDriver({ ...driverInputOf(free), is_active: false });
    const off = (await listDrivers()).find((d) => d.id === added.id)!;
    expect(off).toMatchObject({ is_active: false, status: 'off_duty' });
    // المعطّل لا يظهر في التتبّع ولا يُسند
    expect((await listDriverLocations()).some((l) => l.id === added.id)).toBe(false);
  });

  it('لا إضافة سائق لفرع خارج النطاق', async () => {
    signIn('branch_manager');
    await expect(
      saveDriver({ ...driverInputOf(driver({ branch: 'نجران' })), id: null }),
    ).rejects.toThrow('خارج نطاقك');
  });
});
